"""Behavioral regressions for the canonical PC/Pi classifier; no camera needed."""
from copy import deepcopy
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

from backend.vision.posture import PostureClassifier, TemporalPosture, extract_pose_geometry


def pose(overrides=None):
    points = [dict(x=0.5, y=0.5, z=0, visibility=0.99, presence=0.99) for _ in range(33)]
    changes = {0: dict(x=0.5, y=0.22), 11: dict(x=0.38, y=0.4), 12: dict(x=0.62, y=0.4),
               23: dict(x=0.42, y=0.76), 24: dict(x=0.58, y=0.76)}
    for index, change in changes.items():
        points[index].update(change)
    for index, change in (overrides or {}).items():
        points[index].update(change)
    return points


def upper_pose(overrides=None):
    changes = {
        2: dict(x=0.47, y=0.205), 5: dict(x=0.53, y=0.205),
        7: dict(x=0.44, y=0.21), 8: dict(x=0.56, y=0.21),
        9: dict(x=0.48, y=0.255), 10: dict(x=0.52, y=0.255),
        23: dict(y=1.2, visibility=0.1, presence=0.1), 24: dict(y=1.2, visibility=0.1, presence=0.1),
    }
    changes.update(overrides or {})
    return pose(changes)


def visible_hips(points):
    result = deepcopy(points)
    for i in (23, 24):
        result[i].update(y=0.76, visibility=0.99, presence=0.99)
    return result


def upper_forward():
    points = upper_pose({11: dict(x=0.35), 12: dict(x=0.65)})
    for i in (0, 2, 5, 7, 8, 9, 10):
        points[i]["x"] = 0.5 + (points[i]["x"] - 0.5) * 1.25
        points[i]["y"] = 0.3 + (points[i]["y"] - 0.22) * 1.25
    return points


def world(overrides=None):
    points = [dict(x=0, y=0, z=0, visibility=0.99, presence=0.99) for _ in range(33)]
    for i, values in {0: dict(x=0, y=-0.72, z=-0.12), 11: dict(x=-0.18, y=-0.45),
                      12: dict(x=0.18, y=-0.45), 23: dict(x=-0.12), 24: dict(x=0.12)}.items():
        points[i].update(values)
    for i, values in (overrides or {}).items():
        points[i].update(values)
    return points


def frame(timestamp, points=None, world_points=None):
    return dict(timestampMs=timestamp, width=640, height=480, landmarks=[pose() if points is None else points],
                worldLandmarks=[world_points] if world_points is not None else [])


def calibrated(points=None, world_points=None, **options):
    classifier = PostureClassifier(**options)
    classifier.start_calibration()
    for i in range(30):
        classifier.update(frame(i * 50, points, world_points))
    return classifier


def stable(classifier, points=None, world_points=None, start=1500):
    classifier.update(frame(start, points, world_points))
    return classifier.update(frame(start + 650, points, world_points))


class GeometryTests(unittest.TestCase):
    def test_full_body_does_not_require_visible_ears(self):
        geometry = extract_pose_geometry(pose({7: dict(visibility=0), 8: dict(visibility=0)}), 640, 480)["geometry"]
        self.assertAlmostEqual(geometry["headHeightRatio"], 0.5)
        self.assertEqual(geometry["forwardSource"], "unavailable")

    def test_geometry_uses_actual_image_aspect_ratio(self):
        points = pose({0: dict(x=0.55), 11: dict(x=0.43), 12: dict(x=0.67)})
        wide = extract_pose_geometry(points, 1280, 720)["geometry"]
        square = extract_pose_geometry(points, 720, 720)["geometry"]
        self.assertAlmostEqual(wide["torsoAngleDeg"], math.degrees(math.atan2(64, 0.36 * 720)))
        self.assertGreater(wide["torsoAngleDeg"], square["torsoAngleDeg"])

    def test_degenerate_and_tiny_upper_bodies_are_rejected(self):
        points = pose()
        for point in points:
            point.update(x=0.5, y=0.5)
        for item in (points, upper_pose({11: dict(x=0.499), 12: dict(x=0.501)}), upper_pose({0: dict(y=0.99)})):
            self.assertIsNone(extract_pose_geometry(item, 640, 480)["geometry"])

    def test_visible_edge_shoulders_are_accepted_but_off_frame_is_not(self):
        self.assertEqual(extract_pose_geometry(upper_pose({11: dict(x=0), 12: dict(x=1)}), 640, 480)["geometry"]["trackingMode"], "upper_body")
        self.assertIsNone(extract_pose_geometry(upper_pose({11: dict(x=-0.001)}), 640, 480)["geometry"])

    def test_seated_crop_presence_and_visibility_have_separate_gates(self):
        geometry = extract_pose_geometry(upper_pose({11: dict(presence=0.55, visibility=0.95)}), 640, 480)["geometry"]
        self.assertEqual(geometry["trackingMode"], "upper_body")
        self.assertAlmostEqual(geometry["confidence"], math.sqrt(0.55 * 0.95))
        self.assertGreaterEqual(geometry["confidence"], 0.6)
        self.assertIsNone(extract_pose_geometry(upper_pose({11: dict(presence=0.1, visibility=0.95)}), 640, 480)["geometry"])
        self.assertIsNone(extract_pose_geometry(upper_pose({0: dict(visibility=0.59)}), 640, 480)["geometry"])

    def test_invalid_dimensions_or_missing_points_are_not_posture(self):
        self.assertIsNone(extract_pose_geometry([], 640, 480)["geometry"])
        self.assertEqual(extract_pose_geometry(pose(), 0, 480)["reason"], "invalid_frame")
        self.assertIsNone(extract_pose_geometry(pose(), math.nan, 480)["geometry"])

    def test_missing_visibility_is_never_assumed_perfect(self):
        points = [{k: p[k] for k in ("x", "y", "z")} for p in pose()]
        self.assertIsNone(extract_pose_geometry(points, 640, 480)["geometry"])

    def test_world_depth_requires_plausible_reliable_world_torso(self):
        geometry = extract_pose_geometry(pose(), 640, 480, "front", world({11: dict(z=-0.2), 12: dict(z=-0.2), 0: dict(z=-0.32)}))["geometry"]
        self.assertEqual(geometry["forwardSource"], "world")
        self.assertAlmostEqual(geometry["forwardRatio"], 0.2 / math.hypot(0.45, 0.2))
        self.assertAlmostEqual(geometry["neckForwardRatio"], 0.12 / math.hypot(0.45, 0.2))
        self.assertEqual(extract_pose_geometry(pose(), 640, 480, "front", world({11: dict(z=math.nan)}))["geometry"]["forwardSource"], "unavailable")

    def test_confidence_includes_weakest_world_point_when_used(self):
        geometry = extract_pose_geometry(pose(), 640, 480, "front", world({23: dict(visibility=0.64)}))["geometry"]
        self.assertEqual(geometry["forwardSource"], "world")
        self.assertEqual(geometry["confidence"], 0.64)


# Separate named regressions make every rejected input and optional-hip fallback
# visible in terminal reports instead of concealing them within one bulk test.
for name, overrides in {
    "low_head_visibility": {0: dict(visibility=0.1)}, "low_shoulder_visibility": {11: dict(visibility=0.1)},
    "low_head_presence": {0: dict(presence=0.1)}, "low_shoulder_presence": {12: dict(presence=0.1)},
    "off_frame_shoulder": {12: dict(x=1.001)}, "nonfinite_nose": {0: dict(x=math.nan)},
    "nonfinite_depth": {12: dict(z=math.inf)}, "invalid_reliability": {12: dict(visibility=math.nan)},
}.items():
    def reject(self, overrides=overrides):
        self.assertIsNone(extract_pose_geometry(pose(overrides), 640, 480)["geometry"])
    setattr(GeometryTests, f"test_reject_{name}", reject)

for name, overrides in {
    "low_hip_visibility": {23: dict(visibility=0.1)}, "low_hip_presence": {24: dict(presence=0.1)},
    "off_frame_hip": {24: dict(y=1.2)}, "clipped_hip": {23: dict(y=0.999)},
    "nonfinite_hip": {23: dict(x=math.nan)}, "tiny_torso": {23: dict(y=0.42), 24: dict(y=0.42)},
    "inverted_torso": {23: dict(y=0.3), 24: dict(y=0.3)},
}.items():
    def fallback(self, overrides=overrides):
        geometry = extract_pose_geometry(pose(overrides), 640, 480)["geometry"]
        self.assertEqual(geometry["trackingMode"], "upper_body")
        self.assertIsNone(geometry["forwardRatio"])
        self.assertIsNone(geometry["neckForwardRatio"])
        self.assertGreaterEqual(geometry["upperBody"]["confidence"], 0.6)
    setattr(GeometryTests, f"test_optional_hip_fallback_{name}", fallback)


class ClassifierTests(unittest.TestCase):
    def test_explicit_calibration_is_required(self):
        result = PostureClassifier().update(frame(0))
        self.assertEqual(result["posture"], "UNKNOWN")
        self.assertEqual(result["reason"], "calibration_needed")
        self.assertTrue(result["personDetected"])

    def test_calibration_needs_30_frames_and_real_time(self):
        classifier = PostureClassifier(calibration_frames=2)
        classifier.start_calibration()
        for i in range(30):
            result = classifier.update(frame(i * 10))
            self.assertEqual(result["calibration"]["status"], "collecting")
            self.assertEqual(result["calibration"]["required"], 30)
        result = classifier.update(frame(1200))
        self.assertEqual(result["calibration"]["status"], "ready")
        self.assertEqual(result["posture"], "UNKNOWN")
        self.assertEqual(stable(classifier)["posture"], "GOOD")

    def test_actual_movement_restarts_calibration_but_brief_occlusion_does_not(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i * 50))
        moved = classifier.update(frame(750, pose({0: dict(y=0.31)})))
        self.assertEqual(moved["reason"], "calibration_unstable")
        self.assertEqual(moved["calibration"]["frames"], 1)
        weak = classifier.update(frame(800, pose({11: dict(visibility=0.1)})))
        self.assertEqual(weak["posture"], "UNKNOWN")
        self.assertEqual(weak["calibration"]["frames"], 1)

    def test_neutral_jitter_does_not_bias_median_baseline(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(30):
            classifier.update(frame(i * 50, pose({0: dict(y=0.24 if i % 5 == 0 else 0.22)})))
        result = stable(classifier, pose({0: dict(y=0.277)}))
        self.assertEqual(result["candidate"], "SLOUCH")
        self.assertEqual(result["posture"], "SLOUCH")

    def test_front_head_drop_is_slouch(self):
        self.assertEqual(stable(calibrated(), pose({0: dict(y=0.31)}))["posture"], "SLOUCH")

    def test_front_forward_lean_uses_calibrated_world_torso_depth(self):
        result = stable(calibrated(world_points=world()), pose(), world({11: dict(z=-0.22), 12: dict(z=-0.22), 0: dict(z=-0.34)}))
        self.assertEqual(result["posture"], "LEAN_FORWARD")
        self.assertEqual(result["geometry"]["forwardSource"], "world")

    def test_neck_protrusion_is_slouch_rather_than_forward_torso(self):
        self.assertEqual(stable(calibrated(world_points=world()), pose(), world({0: dict(z=-0.25)}))["posture"], "SLOUCH")

    def test_front_2d_does_not_claim_measured_depth(self):
        result = stable(calibrated())
        self.assertEqual(result["posture"], "GOOD")
        self.assertIsNone(result["geometry"]["forwardRatio"])
        self.assertEqual(result["geometry"]["forwardSource"], "unavailable")
        self.assertEqual(result["reason"], "tracking_2d")

    def test_world_dropout_reports_2d_limitation(self):
        result = stable(calibrated(world_points=world()))
        self.assertIsNone(result["geometry"]["forwardRatio"])
        self.assertEqual(result["geometry"]["forwardSource"], "unavailable")
        self.assertEqual(result["reason"], "tracking_2d")

    def test_sideways_head_movement_is_not_front_slouch(self):
        self.assertEqual(stable(calibrated(), pose({0: dict(x=0.58)}))["posture"], "GOOD")

    def test_full_body_uniform_scale_preserves_geometry_ratios(self):
        resized = [dict(p, x=0.5 + (p["x"] - 0.5) * 1.15, y=0.5 + (p["y"] - 0.5) * 1.15) for p in pose()]
        result = stable(calibrated(world_points=world()), resized, world())
        self.assertEqual(result["posture"], "GOOD")
        self.assertAlmostEqual(result["geometry"]["headHeightRatio"], 0.5)
        self.assertEqual(result["geometry"]["forwardRatio"], 0)

    def test_front_lateral_torso_and_shoulder_lean(self):
        for points in (pose({0: dict(x=0.61), 11: dict(x=0.49), 12: dict(x=0.73)}), pose({11: dict(y=0.35), 12: dict(y=0.45)})):
            self.assertEqual(stable(calibrated(), points)["posture"], "LEAN_LEFT_RIGHT")

    def test_side_camera_needs_only_one_visible_shoulder_and_hip(self):
        side = pose({0: dict(x=0.52), 11: dict(x=0.44), 23: dict(x=0.44), 12: dict(visibility=0.1), 24: dict(visibility=0.1)})
        classifier = calibrated(side, view="side")
        self.assertEqual(stable(classifier, side)["posture"], "GOOD")
        leaning = pose({0: dict(x=0.65), 11: dict(x=0.57), 23: dict(x=0.44), 12: dict(visibility=0.1), 24: dict(visibility=0.1)})
        result = stable(classifier, leaning, start=2200)
        self.assertEqual(result["posture"], "LEAN_FORWARD")
        self.assertEqual(result["geometry"]["forwardSource"], "image-plane")

    def test_backward_side_tilt_is_not_forward_lean(self):
        side = pose({0: dict(x=0.52), 11: dict(x=0.44), 23: dict(x=0.44), 12: dict(visibility=0.1), 24: dict(visibility=0.1)})
        backward = pose({0: dict(x=0.39), 11: dict(x=0.31), 23: dict(x=0.44), 12: dict(visibility=0.1), 24: dict(visibility=0.1)})
        self.assertEqual(stable(calibrated(side, view="side"), backward)["posture"], "UNKNOWN")

    def test_absence_multiple_people_and_missing_points_clear_previous_label(self):
        classifier, slouch = calibrated(), pose({0: dict(y=0.31)})
        self.assertEqual(stable(classifier, slouch)["posture"], "SLOUCH")
        self.assertEqual(classifier.update(dict(frame(2200), landmarks=[]))["posture"], "NO_PERSON")
        result = classifier.update(dict(frame(2250), landmarks=[pose(), pose()]))
        self.assertEqual((result["posture"], result["confidence"], result["personDetected"], result["reason"]), ("UNKNOWN", 0, True, "multiple_people"))
        self.assertEqual(classifier.update(frame(2300, pose({12: dict(y=1.1)})))["posture"], "UNKNOWN")
        self.assertEqual(classifier.update(frame(2350, slouch))["posture"], "UNKNOWN")
        self.assertEqual(classifier.update(frame(3000, slouch))["posture"], "SLOUCH")

    def test_view_changes_and_restart_reset_calibration(self):
        classifier = calibrated()
        self.assertEqual(stable(classifier)["posture"], "GOOD")
        classifier.set_view("side")
        self.assertEqual(classifier.update(frame(2200))["calibration"]["status"], "needed")
        classifier.start_calibration()
        self.assertEqual(classifier.update(frame(2250))["calibration"]["frames"], 1)
        classifier.reset()
        self.assertEqual(classifier.update(frame(2300))["calibration"]["status"], "needed")

    def test_duplicate_and_discontinuous_timestamps_do_not_count(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i * 50))
        self.assertEqual(classifier.update(frame(700))["calibration"]["frames"], 1)
        self.assertEqual(classifier.update(frame(5000))["calibration"]["frames"], 1)
        self.assertEqual(classifier.update(frame(math.nan))["posture"], "UNKNOWN")


class UpperBodyTests(unittest.TestCase):
    def test_hidden_hips_do_not_bypass_explicit_calibration(self):
        result = PostureClassifier().update(frame(0, upper_pose()))
        self.assertEqual((result["posture"], result["confidence"], result["reason"], result["personDetected"]), ("UNKNOWN", 0, "calibration_needed", True))
        self.assertEqual(result["geometry"]["trackingMode"], "upper_body")

    def test_upper_body_uniform_size_change_is_not_forward_or_slouch(self):
        neutral = upper_pose()
        farther = [dict(p, x=0.5 + (p["x"] - 0.5) * 0.8, y=0.5 + (p["y"] - 0.5) * 0.8) for p in neutral]
        self.assertEqual(stable(calibrated(neutral), farther)["posture"], "GOOD")

    def test_calibration_continues_as_optional_hips_appear_and_disappear(self):
        classifier, upper = PostureClassifier(), upper_pose()
        full = visible_hips(upper)
        classifier.start_calibration()
        for i in range(30):
            result = classifier.update(frame(i * 50, full if i % 2 else upper))
            self.assertEqual(result["calibration"]["frames"], i + 1)
            self.assertNotEqual(result["reason"], "calibration_unstable")
        self.assertEqual(stable(classifier, upper)["posture"], "GOOD")
        self.assertEqual(stable(classifier, full, start=2200)["posture"], "GOOD")

    def test_weak_frame_keeps_samples_but_is_never_counted(self):
        classifier, neutral = PostureClassifier(), upper_pose()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i * 50, neutral))
        weak = classifier.update(frame(750, upper_pose({11: dict(visibility=0.1)})))
        self.assertEqual((weak["posture"], weak["confidence"], weak["calibration"]["frames"]), ("UNKNOWN", 0, 15))
        self.assertEqual(classifier.update(frame(800, neutral))["calibration"]["frames"], 16)
        for i in range(14):
            classifier.update(frame(850 + i * 50, neutral))
        result = stable(classifier, neutral, start=1550)
        self.assertEqual(result["posture"], "GOOD")
        self.assertEqual(result["calibration"], dict(status="ready", frames=30, required=30))

    def test_weak_observations_beyond_grace_restart_collection(self):
        classifier, neutral = PostureClassifier(), upper_pose()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i * 50, neutral))
        weak = upper_pose({11: dict(presence=0.1)})
        self.assertEqual(classifier.update(frame(750, weak))["calibration"]["frames"], 15)
        self.assertEqual(classifier.update(frame(1450, weak))["calibration"]["frames"], 0)
        self.assertEqual(classifier.update(frame(1500, neutral))["calibration"]["frames"], 1)

    def test_reliable_sub_gap_delay_keeps_samples_but_real_gap_restarts(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i * 50, upper_pose()))
        self.assertEqual(classifier.update(frame(1600, upper_pose()))["calibration"]["frames"], 16)
        self.assertEqual(classifier.update(frame(3200, upper_pose()))["calibration"]["frames"], 1)

    def test_missing_head_or_shoulder_clears_stable_upper_body_label(self):
        classifier = calibrated(upper_pose())
        self.assertEqual(stable(classifier, upper_forward())["posture"], "LEAN_FORWARD")
        for timestamp, points in ((2200, upper_pose({0: dict(x=math.nan)})), (2250, upper_pose({12: dict(presence=0.1)}))):
            result = classifier.update(frame(timestamp, points))
            self.assertEqual((result["posture"], result["confidence"]), ("UNKNOWN", 0))
        self.assertEqual(classifier.update(dict(frame(2300), landmarks=[]))["posture"], "NO_PERSON")


def _upper_variants():
    collapsed = upper_pose()
    for i in (0, 2, 5, 7, 8, 9, 10):
        collapsed[i]["y"] += 0.19
    return {
        "neutral": (upper_pose(), "GOOD"), "forward": (upper_forward(), "LEAN_FORWARD"),
        "collapsed": (collapsed, "SLOUCH"),
        "reclined": (upper_pose({11: dict(x=0.404), 12: dict(x=0.596), 7: dict(x=0.452), 8: dict(x=0.548), 9: dict(y=0.28), 10: dict(y=0.28)}), "SLOUCH"),
        "lateral": (upper_pose({11: dict(y=0.35), 12: dict(y=0.45)}), "LEAN_LEFT_RIGHT"),
    }


for name, (points, expected) in _upper_variants().items():
    def recognize(self, points=points, expected=expected):
        result = stable(calibrated(upper_pose()), points)
        self.assertEqual(result["posture"], expected)
        self.assertEqual(result["reason"], "tracking_upper_body")
        self.assertEqual(result["geometry"]["trackingMode"], "upper_body")
        self.assertGreaterEqual(result["confidence"], 0.6)
    setattr(UpperBodyTests, f"test_recognize_{name}", recognize)

for transition in ("upper_to_full", "full_to_upper"):
    def preserve(self, transition=transition):
        upper, full = upper_pose(), visible_hips(upper_pose())
        classifier = calibrated(upper if transition == "upper_to_full" else full)
        self.assertEqual(stable(classifier, full if transition == "upper_to_full" else upper)["posture"], "GOOD")
        forward = visible_hips(upper_forward()) if transition == "upper_to_full" else upper_forward()
        result = stable(classifier, forward, start=2200)
        self.assertEqual(result["posture"], "LEAN_FORWARD")
        self.assertEqual(result["calibration"]["status"], "ready")
    setattr(UpperBodyTests, f"test_baseline_preserved_{transition}", preserve)


class TemporalTests(unittest.TestCase):
    def test_debounce_retains_previous_stable_label_during_transition(self):
        temporal = TemporalPosture()
        for label, timestamp, expected in (
            ("GOOD", 0, "UNKNOWN"), ("GOOD", 650, "GOOD"), ("SLOUCH", 700, "GOOD"),
            ("GOOD", 750, "GOOD"), ("SLOUCH", 800, "GOOD"), ("SLOUCH", 1400, "SLOUCH"),
            ("UNKNOWN", 1450, "UNKNOWN"), ("NO_PERSON", 1500, "NO_PERSON"),
            ("GOOD", 1550, "UNKNOWN"), ("GOOD", 2200, "GOOD"),
        ):
            self.assertEqual(temporal.update(label, timestamp), expected)

    def test_temporal_jumps_invalid_time_and_reset_clear_old_label(self):
        temporal = TemporalPosture()
        temporal.update("SLOUCH", 0)
        self.assertEqual(temporal.update("SLOUCH", 650), "SLOUCH")
        self.assertEqual(temporal.update("SLOUCH", 5000), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", 5650), "SLOUCH")
        self.assertEqual(temporal.update("SLOUCH", 1000), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", math.nan), "UNKNOWN")
        temporal.update("GOOD", 2000)
        temporal.update("GOOD", 2650)
        temporal.reset()
        self.assertEqual(temporal.update("GOOD", 2700), "UNKNOWN")


class SavedCalibrationTests(unittest.TestCase):
    def test_numeric_calibration_round_trip_keeps_accepted_labels(self):
        original = calibrated(upper_pose())
        saved = original.export_calibration()
        self.assertNotIn("landmarks", json.dumps(saved))
        restored = PostureClassifier()
        restored.load_calibration(json.loads(json.dumps(saved, allow_nan=False)))
        self.assertEqual(restored.calibration_status, "ready")
        self.assertEqual(stable(restored, upper_forward())["posture"], "LEAN_FORWARD")
        saved["baseline"]["upperBody"]["headHeightRatio"] = -999
        self.assertGreater(restored.baseline["upperBody"]["headHeightRatio"], 0)

    def test_old_or_wrong_view_calibration_requires_recalibration(self):
        classifier = PostureClassifier()
        for saved in ({"torso_angle": 0, "head_height": 0.5}, dict(calibrated().export_calibration(), view="side")):
            with self.assertRaises(ValueError):
                classifier.load_calibration(saved)
        self.assertEqual(classifier.calibration_status, "needed")

    def test_unready_or_nonfinite_calibration_cannot_be_saved_or_loaded(self):
        with self.assertRaises(ValueError):
            PostureClassifier().export_calibration()
        for mutate in (
            lambda saved: saved["baseline"].update(headHeightRatio=math.nan),
            lambda saved: saved["baseline"].update(confidence=0),
            lambda saved: saved["baseline"]["upperBody"].update(shoulderSpanRatio=0),
            lambda saved: saved["baseline"]["upperBody"].update(faceSpanRatio=0),
        ):
            saved = calibrated(upper_pose()).export_calibration()
            mutate(saved)
            with self.assertRaises(ValueError):
                PostureClassifier().load_calibration(saved)


class PiRuntimeTests(unittest.TestCase):
    def test_pi_runtime_uses_shared_rules_and_publishes_only_derived_metadata(self):
        from raspberry_pi.vision import run_vision

        frame_data = SimpleNamespace(shape=(480, 640, 3))
        camera = MagicMock()
        counter = {"frames": 0}

        def read():
            counter["frames"] += 1
            return True, frame_data

        camera.read.side_effect = read
        stop = SimpleNamespace(is_set=lambda: counter["frames"] >= 55, set=lambda: None)
        cv2 = MagicMock()
        cv2.VideoCapture.return_value = camera
        cv2.cvtColor.return_value = frame_data
        mp = MagicMock()
        python = SimpleNamespace(BaseOptions=MagicMock())
        python.BaseOptions.Delegate.CPU = "CPU"
        landmarker = MagicMock()
        landmarker.__enter__.return_value = landmarker
        detected = SimpleNamespace(pose_landmarks=[[SimpleNamespace(**p) for p in upper_pose()]], pose_world_landmarks=[])
        landmarker.detect_for_video.return_value = detected
        vision = SimpleNamespace(PoseLandmarkerOptions=MagicMock(), RunningMode=SimpleNamespace(VIDEO="VIDEO"),
                                 PoseLandmarker=SimpleNamespace(create_from_options=MagicMock(return_value=landmarker)))
        python.vision = vision
        tasks = SimpleNamespace(python=python)
        mqtt = MagicMock()
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "pose.task"
            model.write_bytes(b"model loader is mocked")
            calibration = Path(temporary) / "calibration.json"
            with patch.dict("sys.modules", {"cv2": cv2, "mediapipe": mp, "mediapipe.tasks": tasks,
                                             "mediapipe.tasks.python": python, "mediapipe.tasks.python.vision": vision}), \
                 patch.dict("os.environ", {"POSE_MODEL": str(model), "CALIBRATION_FILE": str(calibration), "CAMERA_VIEW": "front", "CAMERA_BACKEND": "opencv"}), \
                 patch("raspberry_pi.vision.time.monotonic", side_effect=[i * 0.067 for i in range(55)]), \
                 self.assertLogs("focusguard.vision.pi", level="INFO") as logs:
                run_vision(mqtt, stop)
            published = [call.args[1] for call in mqtt.publish.call_args_list]
            self.assertTrue(any(item["posture"] == "GOOD" for item in published))
            self.assertEqual(published[-1]["vision_available"], False)
            self.assertTrue(all("landmarks" not in item and "frame" not in item for item in published))
            self.assertTrue(any("reason=tracking_upper_body" in item for item in logs.output))
            self.assertTrue(any("inference_ms=" in item and "fps=" in item for item in logs.output))
            self.assertEqual(json.loads(calibration.read_text())["schema"], "focusguard.pose-calibration.v1")
        camera.release.assert_called_once()

    def test_pi_landmark_adapter_supports_older_sdk_missing_presence(self):
        from raspberry_pi.vision import landmark_dict
        point = SimpleNamespace(x=0.4, y=0.2, z=-0.1, visibility=0.9)
        self.assertEqual(landmark_dict(point), {"x": 0.4, "y": 0.2, "z": -0.1, "visibility": 0.9})


DATASET_PATH = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"
DATASET = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
GOOD = next(sample for sample in DATASET["images"] if sample["label"] == "GOOD")


def dataset_frame(sample, timestamp, landmarks=None):
    return dict(timestampMs=timestamp, width=sample["width"], height=sample["height"],
                landmarks=sample["landmarks"] if landmarks is None else landmarks,
                worldLandmarks=sample["worldLandmarks"])


def run_dataset(sample, transform=lambda item: item["landmarks"]):
    classifier = PostureClassifier(view="front")
    classifier.start_calibration()
    for i in range(30):
        classifier.update(dataset_frame(GOOD, i * 100, transform(GOOD)))
    for i in range(15):
        result = classifier.update(dataset_frame(sample, 3000 + i * 100, transform(sample)))
    return result


class DatasetTests(unittest.TestCase):
    """Seven tuning images from one person; not held-out accuracy trials."""

    def test_occluded_head_or_shoulders_do_not_use_invented_hips(self):
        for index in (0, 11, 12):
            points = deepcopy(GOOD["landmarks"][0])
            points[index]["visibility"] = 0.1
            self.assertIsNone(extract_pose_geometry(points, GOOD["width"], GOOD["height"])["geometry"])

    def test_sparse_dataset_provenance_remains_explicit(self):
        self.assertEqual(len(DATASET["images"]), 7)
        self.assertEqual(sum(sample["label"] == "GOOD" for sample in DATASET["images"]), 1)
        self.assertEqual(DATASET["provenance"]["sdk_version"], "0.10.32")
        self.assertEqual(DATASET["provenance"]["running_mode"], "VIDEO")
        self.assertEqual(DATASET["provenance"]["model_sha256"], "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a")


for sample in DATASET["images"]:
    name = Path(sample["filename"]).stem.lower()
    def real_points(self, sample=sample):
        result = run_dataset(sample)
        self.assertEqual(result["posture"], sample["label"])
        self.assertEqual(result["geometry"]["trackingMode"], "upper_body")
        self.assertEqual(result["reason"], "tracking_upper_body")
        self.assertGreaterEqual(result["confidence"], 0.6)
        self.assertTrue(all(point["y"] > 1 for point in sample["landmarks"][0][23:25]))
    def mirrored(self, sample=sample):
        transform = lambda item: [[dict(p, x=1 - p["x"]) for p in points] for points in item["landmarks"]]
        self.assertEqual(run_dataset(sample, transform)["posture"], sample["label"])
    def jitter(self, sample=sample):
        transform = lambda item: [[dict(p, x=p["x"] + (1 if i % 2 else -1) / item["width"],
                                           y=p["y"] + (1 if i % 3 else -1) / item["height"]) for i, p in enumerate(points)] for points in item["landmarks"]]
        self.assertEqual(run_dataset(sample, transform)["posture"], sample["label"])
    setattr(DatasetTests, f"test_real_{name}", real_points)
    setattr(DatasetTests, f"test_mirrored_{name}", mirrored)
    setattr(DatasetTests, f"test_jitter_{name}", jitter)

for scale in (0.8, 1.2):
    def resized(self, scale=scale):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(30):
            classifier.update(dataset_frame(GOOD, i * 100))
        cx = (GOOD["landmarks"][0][11]["x"] + GOOD["landmarks"][0][12]["x"]) / 2
        cy = (GOOD["landmarks"][0][11]["y"] + GOOD["landmarks"][0][12]["y"]) / 2
        points = [[dict(p, x=cx + (p["x"] - cx) * scale, y=cy + (p["y"] - cy) * scale) for p in pose] for pose in GOOD["landmarks"]]
        classifier.update(dataset_frame(GOOD, 3000, points))
        self.assertEqual(classifier.update(dataset_frame(GOOD, 3700, points))["posture"], "GOOD")
    setattr(DatasetTests, f"test_uniform_scale_{str(scale).replace('.', '_')}", resized)


if __name__ == "__main__":
    unittest.main()
