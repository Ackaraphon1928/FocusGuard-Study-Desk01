"""Browser input lifecycle tests; no physical camera or MediaPipe is opened."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import Mock, patch

from backend.vision.browser_frames import MAX_JPEG_BYTES, decode_jpeg, validate_jpeg
from backend.vision.posture import PostureClassifier
from backend.vision.service import LocalVisionService, unavailable_metadata


HAS_PIL = importlib.util.find_spec("PIL") is not None


def jpeg(width=64, height=48, *, format="JPEG"):
    from PIL import Image
    output = BytesIO()
    Image.new("RGB", (width, height), (30, 60, 90)).save(output, format=format)
    return output.getvalue()


def eventually(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        Event().wait(.01)
    raise AssertionError("Timed out waiting for the browser worker")


class Frame:
    shape = (48, 64, 3)


class Inference:
    def __init__(self):
        self.timestamps = []
        self.closed = 0

    def detect(self, frame, timestamp):
        self.timestamps.append(timestamp)
        return {"landmarks": [], "worldLandmarks": []}

    def close(self):
        self.closed += 1


@unittest.skipUnless(HAS_PIL, "Optional vision dependencies are not installed")
class BrowserJPEGTests(unittest.TestCase):
    def test_valid_jpeg_header_is_checked_without_native_decoder(self):
        self.assertEqual(validate_jpeg(jpeg(1280, 960)), (1280, 960))

    def test_oversized_bytes_non_jpeg_truncation_and_large_dimensions_are_rejected(self):
        samples = (b"\xff\xd8" + b"x" * MAX_JPEG_BYTES + b"\xff\xd9", jpeg(format="PNG"),
                   jpeg()[:-2], b"\xff\xd8broken\xff\xd9", jpeg(1281, 1), jpeg(1, 961))
        for sample in samples:
            with self.subTest(size=len(sample)), self.assertRaises(ValueError):
                validate_jpeg(sample)
        with self.assertRaisesRegex(ValueError, "binary JPEG"):
            validate_jpeg({"posture": "GOOD"})

    @unittest.skipUnless(importlib.util.find_spec("cv2"), "Optional OpenCV is not installed")
    def test_decoder_returns_bounded_bgr_color_without_writing_files(self):
        data = jpeg()
        frame = decode_jpeg(data, validate_jpeg(data))
        self.assertEqual(frame.shape, (48, 64, 3))
        self.assertGreater(int(frame[0, 0, 0]), int(frame[0, 0, 2]))
        with self.assertRaisesRegex(ValueError, "dimensions"):
            decode_jpeg(data, (65, 48))


@unittest.skipUnless(HAS_PIL, "Optional vision dependencies are not installed")
class BrowserVisionTests(unittest.TestCase):
    def setUp(self):
        self.model = patch("backend.vision.service.ensure_model", return_value=Path("verified.task"))
        self.decode = patch("backend.vision.service.decode_jpeg", return_value=Frame())
        self.environment = patch.dict("os.environ", {"CAMERA_BACKEND": "opencv", "VISION_DELEGATE": "cpu", "CALIBRATION_FILE": ""})
        self.model.start()
        self.decoder = self.decode.start()
        self.environment.start()
        self.addCleanup(self.model.stop)
        self.addCleanup(self.decode.stop)
        self.addCleanup(self.environment.stop)
        self.inference = Inference()
        self.camera_factory = Mock(side_effect=AssertionError("Browser input must never open a backend camera"))
        self.inference_factory = Mock(return_value=self.inference)
        self.metadata = []
        self.service = LocalVisionService(self.metadata.append, camera_factory=self.camera_factory,
                                          inference_factory=self.inference_factory)
        self.addCleanup(self.service.close)
        self.data = jpeg()

    def running(self):
        self.service.start_browser()
        eventually(lambda: self.service.snapshot()["status"] == "running")

    def test_browser_frames_use_python_classifier_and_ack_only_after_processing(self):
        with self.assertLogs("focusguard.vision", level="INFO") as logs:
            self.running()
            state = self.service.process_browser_frame(self.data)
        self.assertEqual(state["inputMode"], "pc_camera")
        self.assertEqual(state["frames"], 1)
        self.assertEqual(state["observation"]["result"]["posture"], "NO_PERSON")
        self.assertEqual(state["observation"]["result"]["reason"], "no_person")
        self.assertEqual(state["observation"]["landmarks"], [])
        self.assertEqual(state["observation"]["width"], 64)
        self.assertEqual(self.metadata[-1]["posture"], "NO_PERSON")
        self.assertNotIn("landmarks", self.metadata[-1])
        self.assertNotIn("jpeg", json.dumps(state))
        self.camera_factory.assert_not_called()
        self.assertTrue(any("input_mode=pc_camera" in line and "posture=NO_PERSON" in line for line in logs.output))
        self.service.stop()
        self.assertEqual(self.inference.closed, 1)
        self.assertEqual(self.metadata[-1], unavailable_metadata())

    def test_idle_browser_waits_without_decoding_or_inference_until_frame(self):
        self.running()
        Event().wait(.06)
        self.decoder.assert_not_called()
        self.assertEqual(self.inference.timestamps, [])
        self.assertEqual(self.service.snapshot()["frames"], 0)

    def test_frame_input_is_refused_until_browser_mode_selected(self):
        with self.assertRaisesRegex(RuntimeError, "not running"):
            self.service.process_browser_frame(self.data)
        self.decoder.assert_not_called()

    def test_invalid_header_never_reaches_native_decoder_and_model_keeps_running(self):
        self.running()
        with self.assertRaises(ValueError):
            self.service.process_browser_frame(jpeg(1281, 4))
        self.decoder.assert_not_called()
        self.assertEqual(self.service.snapshot()["status"], "running")

    def test_native_decode_error_is_rejected_without_crashing_inference_worker(self):
        self.running()
        self.decoder.side_effect = [ValueError("JPEG could not be decoded"), Frame()]
        with self.assertRaisesRegex(ValueError, "could not be decoded"):
            self.service.process_browser_frame(self.data)
        self.assertEqual(self.service.snapshot()["status"], "running")
        self.assertEqual(self.service.process_browser_frame(self.data)["frames"], 1)

    def test_only_one_frame_can_be_in_flight(self):
        entered, release = Event(), Event()
        original = self.inference.detect
        def delayed(*args):
            entered.set()
            release.wait(2)
            return original(*args)
        self.inference.detect = delayed
        self.running()
        with ThreadPoolExecutor() as pool:
            future = pool.submit(self.service.process_browser_frame, self.data)
            self.assertTrue(entered.wait(1))
            with self.assertRaisesRegex(RuntimeError, "still processing"):
                self.service.process_browser_frame(self.data)
            release.set()
            self.assertEqual(future.result(timeout=2)["frames"], 1)

    def test_timeout_does_not_accept_another_frame_until_native_inference_finishes(self):
        entered, release = Event(), Event()
        original = self.inference.detect
        def delayed(*args):
            entered.set()
            release.wait(2)
            return original(*args)
        self.inference.detect = delayed
        self.running()
        try:
            with self.assertRaises(TimeoutError):
                self.service.process_browser_frame(self.data, timeout=.02)
            self.assertTrue(entered.is_set())
            with self.assertRaisesRegex(RuntimeError, "still processing"):
                self.service.process_browser_frame(self.data)
        finally:
            release.set()
        eventually(lambda: self.service.snapshot()["frames"] == 1)

    def test_stop_wakes_pending_frame_and_no_late_inference_result_is_published(self):
        entered, release = Event(), Event()
        def delayed(*args):
            entered.set()
            release.wait(2)
            return {"landmarks": [], "worldLandmarks": []}
        self.inference.detect = delayed
        self.running()
        with ThreadPoolExecutor() as pool:
            result = pool.submit(self.service.process_browser_frame, self.data)
            self.assertTrue(entered.wait(1))
            stopped = pool.submit(self.service.stop)
            with self.assertRaisesRegex(RuntimeError, "stopped"):
                result.result(timeout=1)
            release.set()
            stopped.result(timeout=2)
        self.assertEqual(self.service.snapshot()["frames"], 0)
        self.assertEqual(self.metadata, [unavailable_metadata()])

    def test_first_frame_waits_for_model_initialization(self):
        entered, release = Event(), Event()
        def initialize(*args):
            entered.set()
            release.wait(2)
            return self.inference
        self.inference_factory.side_effect = initialize
        self.service.start_browser()
        self.assertTrue(entered.wait(1))
        with ThreadPoolExecutor() as pool:
            result = pool.submit(self.service.process_browser_frame, self.data)
            self.assertFalse(result.done())
            release.set()
            self.assertEqual(result.result(timeout=2)["frames"], 1)

    def test_delayed_call_from_an_old_browser_lease_cannot_enter_a_new_session(self):
        self.running()
        old_session = self.service.session_identity()
        entered, release = Event(), Event()
        def occupy_transport_thread():
            entered.set()
            release.wait(2)
        with ThreadPoolExecutor(max_workers=1) as pool:
            occupied = pool.submit(occupy_transport_thread)
            self.assertTrue(entered.wait(1))
            old_frame = pool.submit(self.service.process_browser_frame, self.data, expected_session=old_session)
            self.service.stop()
            self.running()
            new_session = self.service.session_identity()
            self.assertNotEqual(old_session, new_session)
            release.set()
            occupied.result(timeout=1)
            with self.assertRaisesRegex(RuntimeError, "session is no longer active"):
                old_frame.result(timeout=1)
        self.decoder.assert_not_called()
        self.assertEqual(self.service.snapshot()["frames"], 0)
        self.assertEqual(self.metadata, [unavailable_metadata()])
        self.assertEqual(self.service.process_browser_frame(self.data, expected_session=new_session)["frames"], 1)

    def test_controls_wake_worker_and_discard_inference_which_precedes_new_calibration(self):
        entered, release = Event(), Event()
        original = self.inference.detect
        def delayed(*args):
            if not entered.is_set():
                entered.set()
                release.wait(2)
            return original(*args)
        self.inference.detect = delayed
        self.running()
        with ThreadPoolExecutor() as pool:
            result = pool.submit(self.service.process_browser_frame, self.data)
            self.assertTrue(entered.wait(1))
            self.service.calibrate()
            release.set()
            self.assertEqual(result.result(timeout=2)["frames"], 0)
        state = self.service.process_browser_frame(self.data)
        self.assertEqual(state["observation"]["result"]["calibration"]["status"], "collecting")
        self.service.set_view("side")
        state = self.service.process_browser_frame(self.data)
        self.assertEqual(state["view"], "side")
        self.assertEqual(state["observation"]["result"]["calibration"]["status"], "needed")

    def test_browser_mode_never_loads_or_overwrites_native_calibration_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "native.json"
            path.write_text("native-calibration-must-stay-untouched", encoding="utf-8")
            with patch.dict("os.environ", {"CALIBRATION_FILE": str(path)}), \
                 patch("backend.vision.service.load_calibration") as load, \
                 patch("backend.vision.service.save_calibration") as save:
                self.running()
                self.service.calibrate()
                self.service.process_browser_frame(self.data)
                self.service.stop()
            load.assert_not_called()
            save.assert_not_called()
            self.assertEqual(path.read_text(encoding="utf-8"), "native-calibration-must-stay-untouched")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_native_profile_is_private_and_idle_restore_opens_no_resources(self):
        self.service.set_view("side")
        self.service.set_preview(True)
        profile = self.service.capture_state()
        self.assertEqual(profile["inputMode"], "python_backend")
        self.running()
        self.assertFalse(self.service.snapshot()["previewEnabled"])
        self.service.stop()
        calls = self.inference_factory.call_count
        state = self.service.restore_idle(profile)
        self.assertEqual((state["inputMode"], state["status"], state["view"]), ("python_backend", "idle", "side"))
        self.assertTrue(state["previewEnabled"])
        self.assertNotIn("calibration", state)
        self.assertEqual(self.inference_factory.call_count, calls)
        self.camera_factory.assert_not_called()

    def test_ready_native_calibration_can_be_captured_and_restored_across_browser_mode(self):
        fixture = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"
        good = next(image for image in json.loads(fixture.read_text(encoding="utf-8"))["images"] if image["filename"] == "GOOD.png")
        classifier = PostureClassifier()
        classifier.start_calibration()
        for index in range(30):
            classifier.update({**good, "timestampMs": (index + 1) * 67})
        calibration = classifier.export_calibration()
        self.service.restore_idle({"cameraIndex": 2, "view": "front", "status": "stopped", "calibration": calibration})
        profile = self.service.capture_state()
        profile["calibration"]["baseline"]["confidence"] = .9
        self.assertNotEqual(self.service.capture_state()["calibration"]["baseline"]["confidence"], .9)
        profile = self.service.capture_state()
        self.running()
        self.assertIsNone(self.service.capture_state()["calibration"])
        self.service.stop()
        self.service.restore_idle(profile)
        self.assertEqual(self.service.capture_state()["calibration"], calibration)
        self.assertNotIn("baseline", json.dumps(self.service.snapshot()))

    def test_native_resume_reopens_saved_index_and_reuses_private_calibration(self):
        render = patch("backend.vision.service._render_preview", return_value=b"preview")
        render.start()
        self.addCleanup(render.stop)
        fixture = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"
        good = next(image for image in json.loads(fixture.read_text(encoding="utf-8"))["images"] if image["filename"] == "GOOD.png")
        classifier = PostureClassifier()
        classifier.start_calibration()
        for index in range(30):
            classifier.update({**good, "timestampMs": (index + 1) * 67})
        calibration = classifier.export_calibration()
        class Camera:
            released = 0
            def read(self):
                Event().wait(.01)
                return True, Frame()
            def release(self):
                self.released += 1
        camera = Camera()
        self.camera_factory.side_effect = None
        self.camera_factory.return_value = camera
        self.service.start(camera_index=3, view="front", calibration=calibration, restore_persisted=False)
        eventually(lambda: self.service.snapshot()["frames"] >= 1)
        self.service.set_preview(True)
        profile = self.service.capture_state()
        self.service.stop()
        self.running()
        self.service.process_browser_frame(self.data)
        self.service.stop()
        with patch("backend.vision.service.load_calibration") as load, patch.dict("os.environ", {"CALIBRATION_FILE": "unused-native-profile.json"}):
            self.service.start(profile["cameraIndex"], profile["view"], calibration=profile["calibration"], restore_persisted=False)
            self.service.set_preview(profile["previewEnabled"])
            eventually(lambda: self.service.snapshot()["frames"] >= 1)
            self.service.stop()
            load.assert_not_called()
        self.assertEqual([call.args for call in self.camera_factory.call_args_list], [(3, "opencv"), (3, "opencv")])
        self.assertEqual(camera.released, 2)
        self.assertEqual(self.service.capture_state()["calibration"], calibration)
        self.assertEqual(self.service.snapshot()["inputMode"], "python_backend")


if __name__ == "__main__":
    unittest.main()
