"""Camera service lifecycle tests use fakes; no physical camera is opened."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import Mock, patch

from backend.vision import model
from backend.vision.service import LocalVisionService, observation_metadata, unavailable_metadata
from backend.vision.posture import PostureClassifier as RealPostureClassifier


class Frame:
    shape = (480, 640, 3)


class Camera:
    def __init__(self, *, fail_after=None, read_gate=None):
        self.released = 0
        self.reads = 0
        self.fail_after = fail_after
        self.read_gate = read_gate

    def read(self):
        self.reads += 1
        if self.read_gate:
            self.read_gate.wait(5)
        time.sleep(.01)
        return (False, None) if self.fail_after is not None and self.reads > self.fail_after else (True, Frame())

    def release(self):
        self.released += 1


class Inference:
    def __init__(self):
        self.closed = 0
        self.timestamps = []

    def detect(self, frame, timestamp):
        self.timestamps.append(timestamp)
        return {"landmarks": [[{"x": .5, "y": .5, "visibility": .99}]], "worldLandmarks": []}

    def close(self):
        self.closed += 1


class Classifier:
    def __init__(self, *, view="front"):
        self.view = view
        self.calibrations = 0
        self.frames = []

    def update(self, frame):
        self.frames.append(frame)
        return {"posture": "GOOD", "candidate": "GOOD", "personDetected": True, "confidence": .94,
                "geometry": {"trackingMode": "upper_body", "headHeightRatio": .5},
                "calibration": {"status": "ready", "frames": 30, "required": 30}, "reason": "tracking_upper_body"}

    def start_calibration(self):
        self.calibrations += 1

    def set_view(self, view):
        self.view = view


def eventually(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        Event().wait(.01)
    raise AssertionError("Timed out waiting for camera worker condition")


class LocalVisionTests(unittest.TestCase):
    def setUp(self):
        self.model_patch = patch("backend.vision.service.ensure_model", return_value=Path("verified.task"))
        self.classifier_patch = patch("backend.vision.service.PostureClassifier", side_effect=Classifier)
        self.environment = patch.dict("os.environ", {"CAMERA_BACKEND": "opencv", "VISION_DELEGATE": "cpu", "CALIBRATION_FILE": ""})
        self.model_patch.start()
        self.classifier_constructor = self.classifier_patch.start()
        self.environment.start()
        self.addCleanup(self.model_patch.stop)
        self.addCleanup(self.classifier_patch.stop)
        self.addCleanup(self.environment.stop)
        self.metadata = []
        self.camera = Camera()
        self.inference = Inference()
        self.camera_factory = Mock(return_value=self.camera)
        self.inference_factory = Mock(return_value=self.inference)
        self.service = LocalVisionService(self.metadata.append, camera_factory=self.camera_factory,
                                          inference_factory=self.inference_factory)
        self.addCleanup(self.service.close)

    def running(self):
        self.service.start()
        eventually(lambda: self.service.snapshot()["frames"] >= 2)

    def real_calibration_evidence(self):
        fixture = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"
        good = next(image for image in json.loads(fixture.read_text(encoding="utf-8"))["images"] if image["filename"] == "GOOD.png")
        classifier = RealPostureClassifier(view="front")
        classifier.start_calibration()
        for index in range(30):
            classifier.update({**good, "timestampMs": (index + 1) * 67})
        return good, classifier.export_calibration()

    def use_real_classifier(self, good):
        self.classifier_constructor.side_effect = RealPostureClassifier
        frame = type("DatasetFrame", (), {"shape": (good["height"], good["width"], 3)})()
        def read():
            time.sleep(.01)
            return True, frame
        self.camera.read = read
        self.inference.detect = lambda *args: {key: good[key] for key in ("landmarks", "worldLandmarks")}

    def test_constructor_has_no_camera_or_native_dependency_side_effects(self):
        self.assertEqual(self.service.snapshot()["status"], "idle")
        self.camera_factory.assert_not_called()
        self.inference_factory.assert_not_called()
        self.assertIsNone(self.service.preview_jpeg())
        self.assertFalse(self.service.snapshot()["previewEnabled"])

    def test_worker_reports_metadata_only_and_stop_releases_all_resources(self):
        with self.assertLogs("focusguard.vision", level="INFO") as logs:
            self.running()
            eventually(lambda: any(item["vision_available"] for item in self.metadata))
            state = self.service.snapshot()
            self.assertEqual(state["status"], "running")
            self.assertEqual(state["delegate"], "CPU")
            self.assertEqual(state["observation"]["landmarks"], [])
            self.assertEqual(state["observation"]["result"]["posture"], "GOOD")
            allowed = {"person_detected", "posture", "confidence", "fps", "vision_available", "inference_ms", "ambiguous_people"}
            self.assertTrue(all(set(item) == allowed for item in self.metadata))
            self.service.stop()
        self.assertEqual(self.camera.released, 1)
        self.assertEqual(self.inference.closed, 1)
        self.assertEqual(self.metadata[-1], unavailable_metadata())
        self.assertEqual(self.service.snapshot()["status"], "stopped")
        self.assertIsNone(self.service.snapshot()["observation"])
        self.assertTrue(any("posture=GOOD" in line and "mode=upper_body" in line for line in logs.output))
        self.assertTrue(all(right > left for left, right in zip(self.inference.timestamps, self.inference.timestamps[1:])))

    def test_same_start_is_idempotent_and_active_camera_cannot_be_replaced(self):
        self.running()
        self.service.start()
        self.camera_factory.assert_called_once_with(0, "opencv")
        with self.assertRaisesRegex(RuntimeError, "still active"):
            self.service.start(camera_index=1)

    def test_calibration_and_view_commands_execute_on_worker(self):
        instances = []
        def create(**kwargs):
            classifier = Classifier(**kwargs)
            instances.append(classifier)
            return classifier
        self.classifier_constructor.side_effect = create
        self.running()
        self.service.calibrate()
        eventually(lambda: instances[0].calibrations == 1)
        self.service.set_view("side")
        eventually(lambda: instances[0].view == "side")
        self.assertEqual(self.service.snapshot()["view"], "side")
        self.assertGreaterEqual(sum(not item["vision_available"] for item in self.metadata), 2)

    def test_preview_requires_explicit_opt_in_and_is_cleared_on_disable_and_stop(self):
        with patch("backend.vision.service._render_preview", return_value=b"memory-only-jpeg") as render:
            self.running()
            render.assert_not_called()
            self.assertIsNone(self.service.preview_jpeg())
            self.assertTrue(self.service.set_preview(True)["previewEnabled"])
            eventually(lambda: self.service.preview_jpeg() == b"memory-only-jpeg")
            self.assertFalse(self.service.set_preview(False)["previewEnabled"])
            self.assertIsNone(self.service.preview_jpeg())
            self.service.set_preview(True)
            eventually(lambda: self.service.preview_jpeg() is not None)
            self.service.stop()
            self.assertIsNone(self.service.preview_jpeg())

    def test_calibration_discards_an_observation_already_in_native_inference(self):
        entered, release = Event(), Event()
        self.addCleanup(release.set)
        original_detect = self.inference.detect
        def delayed_detect(frame, timestamp):
            if not entered.is_set():
                entered.set()
                release.wait(3)
            return original_detect(frame, timestamp)
        self.inference.detect = delayed_detect
        classifier = Classifier()
        applied = []
        original_update = classifier.update
        def update(frame):
            applied.append(classifier.calibrations)
            return original_update(frame)
        classifier.update = update
        self.classifier_constructor.side_effect = lambda **kwargs: classifier
        self.service.start()
        self.assertTrue(entered.wait(2))
        self.service.calibrate()
        release.set()
        eventually(lambda: self.service.snapshot()["frames"] >= 1)
        self.assertTrue(applied)
        self.assertTrue(all(count == 1 for count in applied))

    def test_gpu_initialization_falls_back_to_reported_cpu(self):
        with patch.dict("os.environ", {"VISION_DELEGATE": "auto"}):
            self.inference_factory.side_effect = [RuntimeError("GPU unavailable in this build"), self.inference]
            with self.assertLogs("focusguard.vision", level="WARNING") as logs:
                self.running()
            self.assertEqual([call.args[1] for call in self.inference_factory.call_args_list], ["GPU", "CPU"])
            self.assertEqual(self.service.snapshot()["delegate"], "CPU")
            self.assertIn("using CPU", self.service.snapshot()["message"])
            self.assertTrue(any("GPU initialization unavailable" in line for line in logs.output))

    def test_camera_open_failure_closes_model_and_marks_unavailable(self):
        self.camera_factory.side_effect = OSError("Camera denied")
        with self.assertLogs("focusguard.vision", level="ERROR"):
            self.service.start()
            eventually(lambda: self.service.snapshot()["status"] == "error")
            eventually(lambda: self.inference.closed == 1)
        self.assertEqual(self.service.snapshot()["error"], "Camera denied")
        self.assertEqual(self.metadata[-1], unavailable_metadata())

    def test_camera_disconnect_releases_camera_and_retains_error(self):
        self.camera.fail_after = 1
        with self.assertLogs("focusguard.vision", level="ERROR"):
            self.service.start()
            eventually(lambda: self.service.snapshot()["status"] == "error")
            eventually(lambda: self.camera.released == 1)
        self.assertIn("disconnected", self.service.snapshot()["error"])
        self.service.stop()
        self.assertEqual(self.service.snapshot()["status"], "error")
        self.assertEqual(self.inference.closed, 1)

    def test_snapshot_is_a_copy_and_inactive_controls_do_not_open_camera(self):
        state = self.service.snapshot()
        state["status"] = "running"
        self.assertEqual(self.service.snapshot()["status"], "idle")
        with self.assertRaisesRegex(RuntimeError, "Start the camera"):
            self.service.calibrate()
        for invalid in (-1, 17, True, "0"):
            with self.assertRaises(ValueError):
                self.service.start(invalid)
        with self.assertRaises(ValueError):
            self.service.set_view("overhead")
        self.camera_factory.assert_not_called()

    def test_optional_unavailable_callback_is_used_for_final_stop(self):
        unavailable = Mock()
        self.service._on_unavailable = unavailable
        self.running()
        self.service.stop()
        unavailable.assert_called_once_with()
        self.assertTrue(all(item["vision_available"] for item in self.metadata))

    def test_stop_during_initialization_cancels_before_camera_open(self):
        gate = Event()
        entered = Event()
        def initialize(*args):
            entered.set()
            gate.wait(5)
            return self.inference
        self.inference_factory.side_effect = initialize
        self.service.start()
        self.assertTrue(entered.wait(2))
        # A blocked native initializer must not permit a second worker to open.
        self.service.stop()
        with self.assertRaisesRegex(RuntimeError, "still active"):
            self.service.start()
        gate.set()
        eventually(lambda: self.inference.closed == 1)
        self.camera_factory.assert_not_called()

    def test_configured_numeric_calibration_is_restored_without_collecting_again(self):
        good, payload = self.real_calibration_evidence()
        self.use_real_classifier(good)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "neutral.json"
            encoded = json.dumps(payload)
            path.write_text(encoded, encoding="utf-8")
            with patch.dict("os.environ", {"CALIBRATION_FILE": str(path)}), self.assertLogs("focusguard.vision", level="INFO") as logs:
                self.running()
                result = self.service.snapshot()["observation"]["result"]
                self.assertEqual(result["calibration"]["status"], "ready")
                self.assertEqual(result["calibration"]["frames"], 0)
                self.assertIn("restored", self.service.snapshot()["message"])
                self.service.stop()
            self.assertEqual(path.read_text(encoding="utf-8"), encoded)
            self.assertTrue(any("Calibration restored" in line for line in logs.output))

    def test_invalid_legacy_and_wrong_view_calibration_warn_and_require_explicit_calibration(self):
        good, payload = self.real_calibration_evidence()
        self.use_real_classifier(good)
        invalid = ("not json", json.dumps({"view": "front", "head_height": .5}), json.dumps({**payload, "view": "side"}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "neutral.json"
            with patch.dict("os.environ", {"CALIBRATION_FILE": str(path)}):
                for encoded in invalid:
                    with self.subTest(encoded=encoded), self.assertLogs("focusguard.vision", level="WARNING") as logs:
                        path.write_text(encoded, encoding="utf-8")
                        self.running()
                        calibration = self.service.snapshot()["observation"]["result"]["calibration"]
                        self.assertEqual(calibration["status"], "needed")
                        self.assertEqual(calibration["frames"], 0)
                        self.service.stop()
                    self.assertEqual(path.read_text(encoding="utf-8"), encoded)
                    self.assertTrue(any("explicit upright calibration is required" in line for line in logs.output))

    def test_explicit_calibration_saves_only_after_ready_and_never_persists_frames(self):
        good, _ = self.real_calibration_evidence()
        self.use_real_classifier(good)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "neutral.json"
            with patch.dict("os.environ", {"CALIBRATION_FILE": str(path)}), self.assertLogs("focusguard.vision", level="INFO"):
                self.running()
                self.assertFalse(path.exists())
                self.assertEqual(self.service.snapshot()["observation"]["result"]["calibration"]["status"], "needed")
                self.service.calibrate()
                eventually(lambda: self.service.snapshot()["observation"] is not None
                           and self.service.snapshot()["observation"]["result"]["calibration"]["status"] == "collecting")
                self.assertFalse(path.exists())
                eventually(path.exists)
                self.service.stop()
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(payload), {"schema", "view", "observations", "baseline"})
            self.assertEqual((payload["schema"], payload["view"]), ("focusguard.pose-calibration.v1", "front"))
            self.assertGreaterEqual(payload["observations"], 30)
            self.assertNotIn("landmarks", path.read_text(encoding="utf-8"))
            self.assertNotIn("image", payload)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])
            restored = RealPostureClassifier(view="front")
            restored.load_calibration(payload)
            self.assertEqual(restored.calibration_status, "ready")


class VisionMetadataTests(unittest.TestCase):
    def observation(self):
        return {"result": Classifier().update({}), "people": 1, "fps": 17, "inferenceMs": 14}

    def test_confidence_is_zero_for_uncalibrated_unknown_and_ambiguous_results(self):
        for change in ("uncalibrated", "UNKNOWN", "NO_PERSON", "multiple"):
            item = self.observation()
            if change == "uncalibrated":
                item["result"]["calibration"]["status"] = "collecting"
            elif change == "multiple":
                item["people"] = 2
            else:
                item["result"]["posture"] = change
            self.assertEqual(observation_metadata(item)["confidence"], 0)

    def test_metadata_clamps_finite_measurements(self):
        item = self.observation()
        item["fps"], item["inferenceMs"], item["result"]["confidence"] = float("inf"), -2, 2
        result = observation_metadata(item)
        self.assertEqual((result["fps"], result["inference_ms"], result["confidence"]), (0, 0, 1))


class ModelSetupTests(unittest.TestCase):
    def test_missing_model_never_downloads_in_runtime_resolution(self):
        with tempfile.TemporaryDirectory() as directory, patch("backend.vision.model.urlopen") as download:
            with self.assertRaisesRegex(FileNotFoundError, "--download"):
                model.ensure_model(Path(directory) / "missing.task")
            download.assert_not_called()

    def test_model_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.task"
            path.write_bytes(b"not-the-pinned-model")
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                model.ensure_model(path)

    def test_explicit_download_verifies_before_atomic_move(self):
        payload = b"test model bytes"
        with tempfile.TemporaryDirectory() as directory, patch.object(model, "MODEL_SHA256", hashlib.sha256(payload).hexdigest()), \
             patch("backend.vision.model.urlopen", return_value=io.BytesIO(payload)) as download:
            path = Path(directory) / "models" / "test.task"
            self.assertEqual(model.ensure_model(path, download=True), path.resolve())
            self.assertEqual(path.read_bytes(), payload)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])
            download.assert_called_once()

    def test_failed_download_cleans_temporary_file_and_preserves_no_bad_model(self):
        with tempfile.TemporaryDirectory() as directory, patch("backend.vision.model.urlopen", return_value=io.BytesIO(b"invalid")):
            path = Path(directory) / "bad.task"
            with self.assertRaises(ValueError):
                model.ensure_model(path, download=True)
            self.assertFalse(path.exists())
            self.assertEqual(list(path.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
