"""Public Python vision API boundaries, with no camera/native/network side effects."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from threading import Lock
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.engine import VISION_TOPIC
from backend.main import create_app
from backend.vision.service import LocalVisionService, unavailable_metadata


def metadata(**changes):
    return {"person_detected": True, "posture": "GOOD", "confidence": .94, "fps": 14.2,
            "vision_available": True, "inference_ms": 21.4, "ambiguous_people": False, **changes}


class FakeVision:
    def __init__(self, callback):
        self.callback = callback
        self.starts = []
        self.stops = 0
        self.calibrations = 0
        self.preview_reads = 0
        self.end_stream_after_one = False
        self.control_lock = Lock()
        self.active_controls = 0
        self.overlaps = 0
        self.state = {"status": "idle", "error": None, "message": "Idle", "delegate": None,
                      "cameraIndex": 0, "view": "front", "observation": None,
                      "fps": 0, "inferenceMs": 0, "frames": 0, "updatedAt": None, "previewEnabled": False}

    @contextmanager
    def control(self):
        with self.control_lock:
            self.active_controls += 1
            if self.active_controls > 1:
                self.overlaps += 1
        try:
            time.sleep(.01)
            yield
        finally:
            with self.control_lock:
                self.active_controls -= 1

    def snapshot(self):
        return deepcopy(self.state)

    def start(self, camera_index=0, view="front"):
        with self.control():
            self.starts.append((camera_index, view))
            self.state.update(status="running", delegate="CPU", cameraIndex=camera_index, view=view)
            return self.snapshot()

    def stop(self):
        with self.control():
            self.stops += 1
            self.state.update(status="stopped", observation=None, fps=0)
            # A worker can finish while cancellation is in flight. Runtime must
            # have invalidated its ownership before waiting for this callback.
            self.callback(unavailable_metadata())
            return self.snapshot()

    def close(self):
        return self.stop()

    def calibrate(self):
        with self.control():
            if self.state["status"] != "running":
                raise RuntimeError("Start the camera before calibration")
            self.calibrations += 1
            self.state["observation"] = None
            return self.snapshot()

    def set_view(self, view):
        with self.control():
            self.state.update(view=view, observation=None)
            return self.snapshot()

    def set_preview(self, enabled):
        with self.control():
            self.state["previewEnabled"] = enabled
            return self.snapshot()

    def preview_jpeg(self):
        self.preview_reads += 1
        if self.end_stream_after_one:
            self.state["status"] = "stopped"
        return b"fake-in-memory-jpeg"

    def emit(self, value):
        self.callback(deepcopy(value))


class VisionApiTests(unittest.TestCase):
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
            instance = FakeVision(callback)
            instances.append(instance)
            return instance
        app = create_app(db_path=":memory:", mode=mode, background=False, vision_factory=factory)
        with TestClient(app) as client:
            yield client, app.state.runtime, instances[0]

    def test_startup_and_status_do_not_open_camera_and_shutdown_stops_it(self):
        with self.client() as (client, runtime, vision):
            response = client.get("/api/vision/status")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")
            self.assertEqual(vision.starts, [])
            self.assertEqual(client.get("/api/state").json()["vision_runtime"]["status"], "idle")
            self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(vision.stops, 1)

    def test_strict_start_parameters_reject_coercion_unknown_fields_and_media(self):
        invalid = [{"camera_index": True}, {"camera_index": "0"}, {"camera_index": -1}, {"camera_index": 17},
                   {"view": "back"}, {"frames": []}, {"landmarks": []}, {"delegate": "GPU"}]
        with self.client() as (client, runtime, vision):
            for payload in invalid:
                with self.subTest(payload=payload):
                    self.assertEqual(client.post("/api/vision/start", json=payload).status_code, 422)
            self.assertEqual(vision.starts, [])
            response = client.post("/api/vision/start", json={"camera_index": 2, "view": "side"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual((response.json()["cameraIndex"], response.json()["view"]), (2, "side"))
            self.assertEqual(vision.starts, [(2, "side")])

    def test_start_is_idempotent_until_stopped_and_active_configuration_change_conflicts(self):
        with self.client() as (client, runtime, vision):
            self.assertEqual(client.post("/api/vision/start", json={}).status_code, 200)
            self.assertEqual(client.post("/api/vision/start", json={}).status_code, 200)
            self.assertEqual(vision.starts, [(0, "front")])
            self.assertEqual(client.post("/api/vision/start", json={"camera_index": 1}).status_code, 409)
            self.assertEqual(client.post("/api/vision/start", json={"view": "side"}).status_code, 409)
            self.assertEqual(client.post("/api/vision/stop", json={}).status_code, 200)
            self.assertEqual(client.post("/api/vision/start", json={"camera_index": 1}).status_code, 200)

    def test_controls_validate_and_calibrate_only_after_start(self):
        with self.client() as (client, runtime, vision):
            self.assertEqual(client.post("/api/vision/calibrate", json={}).status_code, 409)
            self.assertEqual(client.post("/api/vision/stop", json={"frames": []}).status_code, 422)
            self.assertEqual(client.post("/api/vision/view", json={"view": "overhead"}).status_code, 422)
            self.assertEqual(client.post("/api/vision/preview", json={"enabled": "true"}).status_code, 422)
            client.post("/api/vision/start", json={})
            self.assertEqual(client.post("/api/vision/calibrate", json={}).status_code, 200)
            self.assertEqual(vision.calibrations, 1)
            response = client.post("/api/vision/view", json={"view": "side"})
            self.assertEqual(response.json()["view"], "side")

    def test_native_metadata_enters_demo_engine_and_late_frames_after_stop_are_dropped(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            vision.emit(metadata(posture="SLOUCH"))
            state = client.get("/api/state").json()
            self.assertEqual(state["vision_source"], "pc_camera")
            self.assertEqual(state["sensors"]["posture"], "SLOUCH")
            self.assertEqual(state["sensors"]["fps"], 14.2)
            client.post("/api/vision/stop", json={})
            before = deepcopy(runtime.engine.sources[VISION_TOPIC])
            vision.emit(metadata(posture="LEAN_FORWARD"))
            self.assertEqual(runtime.engine.sources[VISION_TOPIC], before)
            state = client.get("/api/state").json()
            self.assertEqual(state["vision_source"], "pc_camera")
            self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
            self.assertFalse(state["sensors"]["vision_available"])

    def test_native_metadata_uses_gateway_source_in_hardware_mode(self):
        with self.client("hardware") as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            vision.emit(metadata(posture="LEAN_LEFT_RIGHT"))
            state = client.get("/api/state").json()
            self.assertEqual(state["vision_source"], "gateway")
            self.assertEqual(state["sensors"]["posture"], "LEAN_LEFT_RIGHT")
            self.assertEqual(client.post("/api/demo/vision-source", json={"source": "simulated"}).status_code, 409)

    def test_mode_change_stops_capture_and_rejects_old_worker_callback(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            self.assertEqual(client.post("/api/mode", json={"mode": "hardware"}).status_code, 200)
            self.assertEqual(vision.state["status"], "stopped")
            before = deepcopy(runtime.engine.sources)
            vision.emit(metadata())
            self.assertEqual(runtime.engine.sources, before)
            self.assertIsNone(runtime.camera_mode)

    def test_simulation_selection_stops_capture_drops_late_callback_and_separates_sessions(self):
        with self.client() as (client, runtime, vision):
            # Explicit session controls make this independent of occupancy timing.
            client.post("/api/control", json={"action": "start"})
            original = client.get("/api/state").json()["session"]["id"]
            client.post("/api/vision/start", json={})
            ended = client.get(f"/api/sessions/{original}").json()
            self.assertEqual(ended["vision_source"], "simulated")
            self.assertEqual(ended["state"], "ENDED")
            client.post("/api/control", json={"action": "start"})
            observed = client.get("/api/state").json()["session"]["id"]
            response = client.post("/api/demo/vision-source", json={"source": "simulated"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(vision.state["status"], "stopped")
            self.assertEqual(client.get(f"/api/sessions/{observed}").json()["vision_source"], "pc_camera")
            before = deepcopy(runtime.engine.sources)
            vision.emit(metadata(posture="SLOUCH"))
            self.assertEqual(runtime.engine.sources, before)
            self.assertEqual(client.get("/api/state").json()["vision_source"], "simulated")

    def test_legacy_external_metadata_cannot_override_running_python_pipeline(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            response = client.post("/api/demo/vision", json=metadata())
            self.assertEqual(response.status_code, 409)
            self.assertIn("Python camera owns", response.json()["detail"])
            for field in ("frames", "landmarks", "image", "audio"):
                self.assertEqual(client.post("/api/demo/vision", json={**metadata(), field: []}).status_code, 422)

    def test_preview_get_never_enables_preview_or_opens_camera_and_cross_site_is_rejected(self):
        with self.client() as (client, runtime, vision):
            self.assertEqual(client.get("/api/vision/preview.mjpeg").status_code, 409)
            self.assertEqual(client.get("/api/vision/preview.mjpeg", headers={"origin": "https://example.org"}).status_code, 403)
            self.assertEqual(client.get("/api/vision/preview.mjpeg", headers={"sec-fetch-site": "cross-site"}).status_code, 403)
            self.assertEqual(client.post("/api/vision/preview", json={"enabled": True}, headers={"origin": "https://example.org"}).status_code, 403)
            self.assertFalse(vision.state["previewEnabled"])
            self.assertEqual((vision.starts, vision.preview_reads), ([], 0))

    def test_preview_opt_in_streams_one_memory_frame_and_exits_when_capture_stops(self):
        with self.client() as (client, runtime, vision):
            client.post("/api/vision/start", json={})
            self.assertEqual(client.post("/api/vision/preview", json={"enabled": True}).status_code, 200)
            vision.end_stream_after_one = True
            response = client.get("/api/vision/preview.mjpeg")
            self.assertEqual(response.status_code, 200)
            self.assertIn("multipart/x-mixed-replace", response.headers["content-type"])
            self.assertEqual(response.headers["cross-origin-resource-policy"], "same-origin")
            self.assertEqual(response.content.count(b"fake-in-memory-jpeg"), 1)
            self.assertEqual(vision.preview_reads, 1)
            client.post("/api/vision/preview", json={"enabled": False})
            self.assertEqual(client.get("/api/vision/preview.mjpeg").status_code, 409)

    def test_parallel_camera_controls_are_serialized(self):
        with self.client() as (client, runtime, vision):
            requests = [("/api/vision/start", {}), ("/api/vision/view", {"view": "side"}),
                        ("/api/vision/preview", {"enabled": True}), ("/api/vision/stop", {})]
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(lambda request: client.post(request[0], json=request[1]), requests))
            self.assertTrue(all(response.status_code in {200, 409} for response in responses))
            self.assertEqual(vision.overlaps, 0)

    def test_hardware_autostart_is_opt_in_and_demo_never_autoopens(self):
        with patch.dict("os.environ", {"VISION_AUTOSTART": "true", "CAMERA_INDEX": "3", "CAMERA_VIEW": "side"}):
            with self.client("demo") as (client, runtime, vision):
                self.assertEqual(vision.starts, [])
            with self.client("hardware") as (client, runtime, vision):
                self.assertEqual(vision.starts, [(3, "side")])
                self.assertEqual(vision.snapshot()["status"], "running")

    def test_actual_service_http_snapshot_exposes_no_inference_landmarks(self):
        class Frame:
            shape = (480, 640, 3)
        class Camera:
            released = False
            def read(self):
                time.sleep(.01)
                return True, Frame()
            def release(self):
                self.released = True
        class Inference:
            closed = False
            def detect(self, frame, timestamp):
                return {"landmarks": [[{"x": .5, "y": .5, "z": 0, "visibility": .9, "presence": .9}] * 33]}
            def close(self):
                self.closed = True
        camera, inference = Camera(), Inference()
        def factory(callback):
            return LocalVisionService(callback, camera_factory=lambda *args: camera,
                                      inference_factory=lambda *args: inference)
        app = create_app(db_path=":memory:", mode="demo", background=False, vision_factory=factory)
        with patch("backend.vision.service.ensure_model", return_value=Path("verified.task")), TestClient(app) as client:
            self.assertEqual(client.post("/api/vision/start", json={}).status_code, 200)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                state = client.get("/api/vision/status").json()
                if state["frames"]:
                    break
                time.sleep(.01)
            self.assertGreater(state["frames"], 0)
            self.assertEqual(state["observation"]["landmarks"], [])
            self.assertNotIn("worldLandmarks", state["observation"])
            self.assertNotIn("image", state)
            self.assertNotIn("jpeg", state)
            self.assertFalse(state["previewEnabled"])
        self.assertTrue(camera.released)
        self.assertTrue(inference.closed)


if __name__ == "__main__":
    unittest.main()
