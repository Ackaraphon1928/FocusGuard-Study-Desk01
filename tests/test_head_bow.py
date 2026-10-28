"""Head-only evidence stays narrow, calibrated and independent of image scale."""
from copy import deepcopy
import math
import json
from pathlib import Path
import unittest

from backend.vision.head_bow import HEAD_BOW_FIELDS, extract_head_bow, pronounced_head_bow, validate_head_bow
from backend.vision.posture import PostureClassifier


def face(bowed=False):
    points = [{"x": .5, "y": .5, "z": 0, "visibility": .99, "presence": .99} for _ in range(33)]
    changes = {0: (.5, .38 if bowed else .28),
               2: (.46, .33 if bowed else .25), 5: (.54, .33 if bowed else .25),
               7: (.4, .25), 8: (.6, .25),
               9: (.48, .40 if bowed else .31), 10: (.52, .40 if bowed else .31)}
    for index, (x, y) in changes.items():
        points[index].update(x=x, y=y)
    return points


def extract(points):
    return extract_head_bow(points, 640, 480)


class HeadBowTests(unittest.TestCase):
    def test_pronounced_bow_needs_relative_nose_eye_and_mouth_signals(self):
        neutral = extract(face())
        bowed = extract(face(True))
        self.assertTrue(pronounced_head_bow(bowed, neutral))
        self.assertFalse(pronounced_head_bow(neutral, neutral))
        for key in ("noseEarPitchRatio", "eyeEarPitchRatio", "mouthPitchRatio"):
            changed = deepcopy(bowed)
            changed[key] = neutral[key]
            self.assertFalse(pronounced_head_bow(changed, neutral))

    def test_missing_cropped_or_low_quality_face_points_reject_evidence(self):
        for index in (0, 2, 5, 7, 8, 9, 10):
            for key, value in (("visibility", .74), ("presence", .74), ("x", -.01),
                               ("y", 1.01), ("z", math.inf)):
                points = face(True)
                points[index][key] = value
                self.assertIsNone(extract(points))

    def test_invalid_frames_and_degenerate_face_are_rejected(self):
        for size in ((0, 480), (640, math.nan), (True, 480)):
            self.assertIsNone(extract_head_bow(face(), *size))
        self.assertIsNone(extract_head_bow([], 640, 480))
        tiny = face()
        tiny[7]["x"], tiny[8]["x"] = .499, .501
        self.assertIsNone(extract(tiny))

    def test_uniform_near_far_scale_translation_and_pixel_resolution_preserve_pitch(self):
        baseline = extract(face())
        for scale in (.65, 1.4):
            changed = [dict(p, x=.5+(p["x"]-.5)*scale, y=.5+(p["y"]-.5)*scale) for p in face()]
            shifted = [dict(p, x=p["x"]+.05, y=p["y"]+.1) for p in changed]
            for points in (changed, shifted):
                geometry = extract(points)
                for key in ("noseEarPitchRatio", "eyeEarPitchRatio", "noseOffsetRatio", "eyeSpanRatio"):
                    self.assertAlmostEqual(geometry[key], baseline[key])
                self.assertFalse(pronounced_head_bow(geometry, baseline))
        larger = extract_head_bow(face(), 1280, 960)
        self.assertEqual(larger, baseline)

    def test_roll_is_removed_from_pitch_and_large_roll_change_is_rejected(self):
        neutral, bowed = extract(face()), face(True)
        for degrees in (10, 30):
            angle = math.radians(degrees)
            changed = []
            for point in bowed:
                dx, dy = (point["x"]-.5)*640, (point["y"]-.25)*480
                changed.append(dict(point, x=.5+(dx*math.cos(angle)-dy*math.sin(angle))/640,
                                    y=.25+(dx*math.sin(angle)+dy*math.cos(angle))/480))
            geometry = extract(changed)
            self.assertAlmostEqual(geometry["noseEarPitchRatio"], extract(bowed)["noseEarPitchRatio"])
            self.assertAlmostEqual(geometry["eyeEarPitchRatio"], extract(bowed)["eyeEarPitchRatio"])
            self.assertEqual(pronounced_head_bow(geometry, neutral), degrees == 10)

    def test_yaw_inconsistent_geometry_and_implausible_saved_values_are_rejected(self):
        points = face(True)
        points[0]["x"] = .7
        self.assertIsNone(extract(points))
        original = extract(face())
        for key, value in (("confidence", .74), ("headRollDeg", math.nan), ("eyeSpanRatio", 2),
                           ("noseEarPitchRatio", 100), ("faceSpanRatio", True)):
            bad = deepcopy(original)
            bad[key] = value
            with self.assertRaises(ValueError):
                validate_head_bow(bad)
            self.assertFalse(pronounced_head_bow(bad, original))

    def test_saved_calibration_copies_only_numeric_fields_and_never_uses_image_identity(self):
        original = extract(face())
        extended = {**original, "landmarks": "discard", "label": "SLOUCH", "filename": "fixture.png"}
        saved = validate_head_bow(extended)
        self.assertEqual(set(saved), set(HEAD_BOW_FIELDS))
        self.assertEqual(saved, original)
        saved["confidence"] = .8
        self.assertEqual(original["confidence"], .99)

    def test_old_sdk_without_presence_uses_visibility_but_missing_visibility_is_rejected(self):
        points = face(True)
        for point in points:
            point.pop("presence")
        self.assertIsNotNone(extract(points))
        points[7].pop("visibility")
        self.assertIsNone(extract(points))


class CalibratedFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"
        cls.images = {image["filename"]: image for image in json.loads(path.read_text(encoding="utf-8"))["images"]}

    def frame(self, filename, timestamp, hide_shoulders=False):
        image = self.images[filename]
        points = deepcopy(image["landmarks"])
        if hide_shoulders:
            for index in (11, 12):
                points[0][index]["visibility"] = .1
        return {"timestampMs": timestamp, "width": image["width"], "height": image["height"],
                "landmarks": points, "worldLandmarks": image["worldLandmarks"]}

    def calibrated(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for index in range(30):
            classifier.update(self.frame("GOOD.png", index * 100))
        return classifier

    def test_face_component_does_not_mislabel_original_forward_examples_with_hidden_shoulders(self):
        for filename in ("GOOD.png", "LEAN_FORWARD.png", "LEAN_FORWARD2.png"):
            classifier = self.calibrated()
            classifier.update(self.frame(filename, 3000, True))
            result = classifier.update(self.frame(filename, 3700, True))
            self.assertEqual(result["posture"], "UNKNOWN", filename)
            self.assertNotEqual(result["reason"], "tracking_head_bow")

    def test_severe_bow_uses_only_real_face_geometry_and_still_needs_face_reliability(self):
        classifier = self.calibrated()
        classifier.update(self.frame("SLOUCH1.png", 3000, True))
        result = classifier.update(self.frame("SLOUCH1.png", 3700, True))
        self.assertEqual(result["posture"], "SLOUCH")
        self.assertEqual(result["reason"], "tracking_head_bow")
        self.assertEqual(result["geometry"]["trackingMode"], "head_only")
        for key in ("headHeightRatio", "headOffsetRatio", "torsoAngleDeg", "shoulderAngleDeg", "forwardRatio", "neckForwardRatio"):
            self.assertIsNone(result["geometry"][key])
        weak = self.frame("SLOUCH1.png", 3750, True)
        weak["landmarks"][0][9]["visibility"] = .74
        self.assertEqual(classifier.update(weak)["posture"], "UNKNOWN")

    def test_head_only_never_publishes_retained_good_while_bow_is_settling(self):
        classifier = self.calibrated()
        classifier.update(self.frame("GOOD.png", 3000))
        self.assertEqual(classifier.update(self.frame("GOOD.png", 3700))["posture"], "GOOD")
        pending = classifier.update(self.frame("SLOUCH1.png", 3750, True))
        self.assertEqual(pending["candidate"], "SLOUCH")
        self.assertEqual(pending["posture"], "UNKNOWN")
        self.assertEqual(pending["confidence"], 0)
        self.assertEqual(pending["geometry"]["trackingMode"], "head_only")
        self.assertEqual(classifier.update(self.frame("SLOUCH1.png", 4400, True))["posture"], "SLOUCH")

    def test_head_only_never_publishes_retained_good_while_bow_is_settling(self):
        classifier = self.calibrated()
        classifier.update(self.frame("GOOD.png", 3000))
        self.assertEqual(classifier.update(self.frame("GOOD.png", 3700))["posture"], "GOOD")
        pending = classifier.update(self.frame("SLOUCH1.png", 3750, True))
        self.assertEqual(pending["candidate"], "SLOUCH")
        self.assertEqual(pending["posture"], "UNKNOWN")
        self.assertEqual(pending["confidence"], 0)
        self.assertEqual(pending["geometry"]["trackingMode"], "head_only")
        self.assertEqual(classifier.update(self.frame("SLOUCH1.png", 4400, True))["posture"], "SLOUCH")

    def test_older_baseline_without_face_reference_cannot_infer_a_hidden_body(self):
        saved = self.calibrated().export_calibration()
        saved["baseline"].pop("headBow")
        classifier = PostureClassifier()
        classifier.load_calibration(saved)
        classifier.update(self.frame("SLOUCH1.png", 3000, True))
        self.assertEqual(classifier.update(self.frame("SLOUCH1.png", 3700, True))["posture"], "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
