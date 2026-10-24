"""Browser input ownership, native restoration and binary transport boundaries."""
from contextlib import contextmanager
from copy import deepcopy
import importlib.util
from pathlib import Path
from threading import Event
import asyncio
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.main import create_app
from backend.vision.input_mode import InputModeCoordinator
from backend.vision.service import LocalVisionService
from tests.test_vision_api import FakeVision, metadata


JPEG = b"\xff\xd8\xff\xe0in-memory-test-jpeg\xff\xd9"
ORIGIN = {"origin": "http://testserver"}


class InputVision(FakeVision):
    def __init__(self, callback):
        super().__init__(callback)
        self.state["inputMode"] = "python_backend"
        self.saved_calibration = {"view": "side", "baseline": {"headHeightRatio": .42}}
        self.restore_calls = []
        self.start_options = []
        self.browser_starts = []
        self.process_calls = []
        self.browser_error = None
        self.processing_error = None
        self.browser_loading = False
        self.session = 0

    def capture_state(self):
        return {**self.snapshot(), "calibration": deepcopy(self.saved_calibration)}

    def start(self, camera_index=0, view="front", *, calibration=None, restore_persisted=True):
        self.session += 1
        self.start_options.append({"calibration": deepcopy(calibration), "restore_persisted": restore_persisted})
        if not restore_persisted:
            self.restore_calls.append({"cameraIndex": camera_index, "view": view,
                                       "calibration": deepcopy(calibration), "restore_persisted": restore_persisted})
        snapshot = super().start(camera_index, view)
        self.state["inputMode"] = "python_backend"
        return self.snapshot()

    def start_browser(self, view="front"):
        self.session += 1
        self.browser_starts.append(view)
        if self.browser_error:
            raise self.browser_error
        self.state.update(inputMode="pc_camera", status="loading" if self.browser_loading else "running",
                          view=view, error=None)
        return self.snapshot()

    def restore_idle(self, profile):
        self.restore_calls.append(deepcopy(profile))
        self.state.update(inputMode="python_backend", status="idle" if profile["status"] == "idle" else "stopped",
                          cameraIndex=profile["cameraIndex"], view=profile["view"],
                          previewEnabled=profile["previewEnabled"])
        return self.snapshot()

    def session_identity(self):
        return self.session

    def process_browser_frame(self, jpeg, timeout=8, *, expected_session=None):
        if self.state["inputMode"] != "pc_camera" or (expected_session is not None and expected_session != self.session):
            raise RuntimeError("PC camera session is no longer active.")
        self.process_calls.append((len(jpeg), timeout))
        if self.processing_error:
            raise self.processing_error
        self.callback(metadata(posture="SLOUCH"))
        self.state.update(status="running", frames=self.state["frames"] + 1, fps=12.0)
        return self.snapshot()


class PcCameraModeTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict("os.environ", {"MQTT_ENABLED": "false", "INFLUX_URL": "", "INFLUX_TOKEN": "",
                                                  "BEDROCK_MODEL_ID": "", "VISION_AUTOSTART": "false",
                                                  "FOCUSGUARD_LOG_LEVEL": "CRITICAL"})
        environment.start()
        self.addCleanup(environment.stop)

    @contextmanager
    def client(self, mode="demo"):
        instances = []
        def factory(callback):
            instances.append(InputVision(callback))
            return instances[-1]
        app = create_app(db_path=":memory:", mode=mode, background=False, vision_factory=factory)
        with TestClient(app) as client:
            yield client, app.state.runtime, instances[0]

    def activate(self, client, view="front"):
        response = client.post("/api/vision/input", json={"mode": "pc_camera", "view": view})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["inputMode"], "pc_camera")
        token = response.json()["browserToken"]
        self.assertGreaterEqual(len(token), 32)
        return token

    def wait_native(self, client, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            snapshot = client.get("/api/vision/status").json()
            if snapshot["inputMode"] == "python_backend" and snapshot["status"] != "loading":
                return snapshot
            time.sleep(.01)
        self.fail("PC camera lease was not released")

    def test_switch_releases_native_and_restores_exact_profile_with_calibration(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={"camera_index": 3, "view": "side"})
            client.post("/api/vision/preview", json={"enabled": True})
            calibration = deepcopy(vision.saved_calibration)
            token = self.activate(client)
            self.assertEqual(vision.stops, 1)
            self.assertEqual(vision.browser_starts, ["front"])
            self.assertFalse(vision.state["previewEnabled"])
            response = client.post("/api/vision/input", json={"mode": "python_backend", "token": token})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["inputMode"], "python_backend")
            self.assertEqual(vision.starts, [(3, "side"), (3, "side")])
            self.assertEqual(vision.restore_calls, [{"cameraIndex": 3, "view": "side", "calibration": calibration,
                                                    "restore_persisted": False}])
            self.assertTrue(vision.state["previewEnabled"])
            self.assertEqual(client.get("/api/state").json()["vision_source"], "pc_camera")

    def test_previous_idle_native_remains_idle_without_opening_camera(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/view", json={"view": "side"})
            token = self.activate(client)
            response = client.post("/api/vision/input", json={"mode": "python_backend", "token": token})
            self.assertEqual(response.json()["status"], "idle")
            self.assertEqual(response.json()["view"], "side")
            self.assertEqual(vision.starts, [])
            self.assertEqual(vision.restore_calls[0]["calibration"], vision.saved_calibration)
            self.assertEqual(client.post("/api/vision/input", json={"mode": "python_backend"}).status_code, 200)
            self.assertEqual(len(vision.restore_calls), 1)

    def test_restore_pending_saved_calibration_only_when_native_was_still_loading(self):
        for previous_status, expected_restore in (("loading", True), ("running", False)):
            with self.subTest(previous_status=previous_status), self.client() as (client, runtime, vision):
                client.post("/api/vision/start", json={})
                vision.state["status"] = previous_status
                vision.saved_calibration = None
                token = self.activate(client)
                client.post("/api/vision/input", json={"mode": "python_backend", "token": token})
                self.assertEqual(vision.start_options[-1], {"calibration": None, "restore_persisted": expected_restore})

    def test_exclusive_token_does_not_leak_to_status_state_or_other_client(self):
        with self.client() as (client, runtime, vision):
            token = self.activate(client)
            for endpoint in ("/api/vision/status", "/api/state"):
                self.assertNotIn(token, client.get(endpoint).text)
                self.assertNotIn("browserToken", client.get(endpoint).text)
            self.assertEqual(client.post("/api/vision/input", json={"mode": "pc_camera"}).status_code, 409)
            for token_value in (None, "wrong-token"):
                response = client.post("/api/vision/input", json={"mode": "python_backend", "token": token_value})
                self.assertEqual(response.status_code, 409)
            self.assertEqual(client.post("/api/vision/start", json={}).status_code, 409)
            self.assertEqual(vision.browser_starts, ["front"])

    def test_mode_parameters_are_strict_and_pc_mode_is_demo_only(self):
        invalid = [{}, {"mode": "browser"}, {"mode": True}, {"mode": "pc_camera", "view": "back"},
                   {"mode": "pc_camera", "frames": []}, {"mode": "pc_camera", "token": "uninvited"},
                   {"mode": "python_backend", "token": 42}]
        with self.client() as (client, runtime, vision):
            for payload in invalid:
                with self.subTest(payload=payload):
                    self.assertEqual(client.post("/api/vision/input", json=payload).status_code, 422)
            self.assertEqual(vision.browser_starts, [])
            self.assertEqual(client.post("/api/vision/input", json={"mode": "pc_camera"},
                                         headers={"origin": "https://example.org"}).status_code, 403)
        with self.client("hardware") as (client, runtime, vision):
            self.assertEqual(client.post("/api/vision/input", json={"mode": "pc_camera"}).status_code, 409)
            self.assertEqual(vision.stops, 0)

    def test_browser_start_failure_restores_native_profile(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={"camera_index": 2})
            vision.browser_error = RuntimeError("Test initialization failure")
            response = client.post("/api/vision/input", json={"mode": "pc_camera"})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(vision.starts, [(2, "front"), (2, "front")])
            self.assertEqual(client.get("/api/vision/status").json()["inputMode"], "python_backend")

    def test_binary_frame_ack_comes_from_python_and_disconnect_restores_native(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={"camera_index": 1, "view": "side"})
            token = self.activate(client)
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                self.assertEqual(socket.accepted_subprotocol, "focusguard-pc")
                socket.send_bytes(JPEG)
                result = socket.receive_json()
                self.assertEqual(result["inputMode"], "pc_camera")
                self.assertEqual(result["frames"], 1)
                self.assertEqual(vision.process_calls, [(len(JPEG), 8.0)])
                self.assertEqual(client.get("/api/state").json()["sensors"]["posture"], "SLOUCH")
                self.assertNotIn("jpeg", result)
            snapshot = self.wait_native(client)
            self.assertEqual(snapshot["status"], "running")
            self.assertEqual(vision.starts, [(1, "side"), (1, "side")])

    def test_first_loading_frame_gets_model_initialization_grace(self):
        with self.client() as (client, runtime, vision):
            vision.browser_loading = True
            token = self.activate(client)
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                socket.send_bytes(JPEG)
                socket.receive_json()
                self.assertEqual(vision.process_calls[0][1], 45.0)
                socket.send_bytes(JPEG)
                socket.receive_json()
                self.assertEqual(vision.process_calls[1][1], 8.0)

    def test_queued_old_websocket_frame_cannot_enter_new_browser_session(self):
        original_to_thread = asyncio.to_thread
        waiting, release = Event(), Event()
        async def delayed(function, *args, **kwargs):
            if getattr(function, "__name__", "") == "process_browser_frame":
                waiting.set()
                while not release.is_set():
                    await asyncio.sleep(.005)
            return await original_to_thread(function, *args, **kwargs)
        with self.client() as (client, runtime, vision), patch("backend.main.asyncio.to_thread", side_effect=delayed):
            token = self.activate(client)
            try:
                with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                              subprotocols=["focusguard-pc", token]) as old_socket:
                    old_socket.send_bytes(JPEG)
                    self.assertTrue(waiting.wait(1))
                    client.post("/api/vision/input", json={"mode": "python_backend", "token": token})
                    new_token = self.activate(client)
                    release.set()
                    with self.assertRaises(WebSocketDisconnect):
                        old_socket.receive_json()
                    self.assertTrue(runtime.vision_input.owns(new_token))
                    self.assertEqual(vision.process_calls, [])
                    self.assertEqual(vision.snapshot()["frames"], 0)
            finally:
                release.set()

    def test_websocket_requires_same_origin_protocol_token_and_single_connection(self):
        with self.client() as (client, runtime, vision):
            token = self.activate(client)
            invalid = [({}, ["focusguard-pc", token]), ({"origin": "https://example.org"}, ["focusguard-pc", token]),
                       (ORIGIN, ["focusguard-pc", "wrong"]), (ORIGIN, []),
                       ({**ORIGIN, "sec-fetch-site": "cross-site"}, ["focusguard-pc", token])]
            for headers, protocols in invalid:
                with self.subTest(headers=headers, protocols=protocols):
                    with self.assertRaises(WebSocketDisconnect) as rejection:
                        with client.websocket_connect("/api/vision/pc-camera", headers=dict(headers), subprotocols=protocols):
                            pass
                    self.assertEqual(rejection.exception.code, 1008)
            self.assertTrue(runtime.vision_input.active)
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                with self.assertRaises(WebSocketDisconnect) as rejection:
                    with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                                  subprotocols=["focusguard-pc", token]):
                        pass
                self.assertEqual(rejection.exception.code, 1008)
                socket.send_bytes(JPEG)
                self.assertEqual(socket.receive_json()["frames"], 1)

    def test_metadata_text_non_jpeg_and_large_frames_are_rejected_before_inference(self):
        cases = [("text", '{"posture":"GOOD"}', 1003), ("bytes", b"not-an-image", 1003),
                 ("bytes", b"\xff\xd8\xff" + bytes(512 * 1024), 1009)]
        for kind, value, code in cases:
            with self.subTest(kind=kind, code=code), self.client() as (client, runtime, vision):
                token = self.activate(client)
                with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                              subprotocols=["focusguard-pc", token]) as socket:
                    if kind == "text":
                        socket.send_text(value)
                    else:
                        socket.send_bytes(value)
                    with self.assertRaises(WebSocketDisconnect) as rejected:
                        socket.receive_json()
                    self.assertEqual(rejected.exception.code, code)
                self.wait_native(client)
                self.assertEqual(vision.process_calls, [])

    def test_inference_error_reports_snapshot_then_restores_native(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            token = self.activate(client)
            vision.processing_error = ValueError("Invalid JPEG dimensions")
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                socket.send_bytes(JPEG)
                self.assertEqual(socket.receive_json()["status"], "error")
                with self.assertRaises(WebSocketDisconnect) as rejected:
                    socket.receive_json()
                self.assertEqual(rejected.exception.code, 1011)
            self.assertEqual(self.wait_native(client)["status"], "running")

    def test_explicit_workspace_stop_and_simulation_do_not_restart_native(self):
        for path, payload in [("/api/vision/stop", {}), ("/api/mode", {"mode": "hardware"}),
                              ("/api/demo/vision-source", {"source": "simulated"})]:
            with self.subTest(path=path), self.client() as (client, runtime, vision):
                client.post("/api/vision/start", json={})
                token = self.activate(client)
                self.assertEqual(client.post(path, json=payload).status_code, 200)
                self.assertFalse(runtime.vision_input.active)
                self.assertEqual(vision.starts, [(0, "front")])
                self.assertEqual(client.post("/api/vision/input", json={"mode": "python_backend", "token": token}).status_code, 200)
                self.assertEqual(vision.starts, [(0, "front")])

    def test_late_frame_after_explicit_stop_closes_old_socket_without_restart_or_error(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            token = self.activate(client)
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                stopped = client.post("/api/vision/stop", json={})
                self.assertEqual(stopped.json()["inputMode"], "python_backend")
                socket.send_bytes(JPEG)
                with self.assertRaises(WebSocketDisconnect) as closed:
                    socket.receive_json()
                self.assertEqual(closed.exception.code, 1000)
            self.assertEqual(vision.process_calls, [])
            self.assertEqual(vision.starts, [(0, "front")])
            self.assertEqual(client.get("/api/vision/status").json()["status"], "stopped")
            self.assertEqual(client.post("/api/vision/view", json={"view": "side"}).json()["inputMode"], "python_backend")
            self.assertEqual(client.post("/api/vision/preview", json={"enabled": False}).json()["inputMode"], "python_backend")

    def test_permission_failure_cancel_before_websocket_restores_running_native(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={"camera_index": 4})
            token = self.activate(client)
            # Browser permission rejection follows the same OFF request as Stop.
            client.post("/api/vision/input", json={"mode": "python_backend", "token": token})
            self.assertEqual(vision.starts, [(4, "front"), (4, "front")])

    def test_unattached_and_connected_idle_leases_expire_and_restore(self):
        with patch.object(InputModeCoordinator, "CONNECT_TIMEOUT", .05):
            with self.client() as (client, runtime, vision):
                client.post("/api/vision/start", json={})
                self.activate(client)
                self.assertEqual(self.wait_native(client)["status"], "running")
                self.assertEqual(len(vision.starts), 2)
        with patch.object(InputModeCoordinator, "IDLE_TIMEOUT", .05):
            with self.client() as (client, runtime, vision):
                token = self.activate(client)
                with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                              subprotocols=["focusguard-pc", token]) as socket:
                    with self.assertRaises(WebSocketDisconnect) as closed:
                        socket.receive_json()
                    self.assertEqual(closed.exception.code, 1001)
                self.assertEqual(self.wait_native(client)["status"], "idle")

    def test_shutdown_cancels_pc_lease_without_reopening_remembered_native_camera(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            self.activate(client)
        self.assertFalse(runtime.vision_input.active)
        self.assertEqual(vision.starts, [(0, "front")])
        self.assertEqual(vision.stops, 2)

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Optional vision dependencies are not installed")
    def test_websocket_frame_runs_real_python_pipeline_and_engine_without_native_capture(self):
        from tests.test_browser_vision import Frame, Inference, jpeg
        inference = Inference()
        cameras = []
        def factory(callback):
            def camera_factory(*args):
                cameras.append(args)
                raise AssertionError("Browser demo must not open a backend camera")
            return LocalVisionService(callback, camera_factory=camera_factory,
                                      inference_factory=lambda *args: inference)
        app = create_app(db_path=":memory:", mode="demo", background=False, vision_factory=factory)
        with patch("backend.vision.service.ensure_model", return_value=Path("verified.task")), \
                patch("backend.vision.service.decode_jpeg", return_value=Frame()), \
                patch.dict("os.environ", {"CAMERA_BACKEND": "opencv", "VISION_DELEGATE": "cpu", "CALIBRATION_FILE": ""}), \
                TestClient(app) as client:
            token = self.activate(client)
            with client.websocket_connect("/api/vision/pc-camera", headers=dict(ORIGIN),
                                          subprotocols=["focusguard-pc", token]) as socket:
                socket.send_bytes(jpeg())
                snapshot = socket.receive_json()
                self.assertEqual(snapshot["observation"]["result"]["posture"], "NO_PERSON")
                self.assertEqual(snapshot["observation"]["landmarks"], [])
                state = client.get("/api/state").json()
                self.assertEqual(state["sensors"]["posture"], "NO_PERSON")
                self.assertTrue(state["sensors"]["vision_available"])
            self.assertEqual(self.wait_native(client)["status"], "idle")
        self.assertEqual(cameras, [])
        self.assertEqual(len(inference.timestamps), 1)
        self.assertEqual(inference.closed, 1)


if __name__ == "__main__":
    unittest.main()
