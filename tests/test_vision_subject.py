"""Foreground selection never uses labels and preserves true ambiguity."""
from copy import deepcopy
import math
import unittest

from backend.vision.service import observation_metadata
from backend.vision.posture import PostureClassifier
from backend.vision.subject import select_subject, subject_ambiguous


def pose(scale=1, center=.5):
    points = [{"x": center, "y": .5, "z": 0, "visibility": .99, "presence": .99} for _ in range(33)]
    points[0].update(y=.5 - .2 * scale)
    points[11].update(x=center - .2 * scale)
    points[12].update(x=center + .2 * scale)
    return points


class ForegroundSubjectTests(unittest.TestCase):
    def select(self, poses):
        return select_subject(poses, 640, 480)

    def test_absent_and_single_keep_existing_classifier_geometry_contract(self):
        self.assertEqual(self.select([]), {"index": None, "ambiguous": False, "detected": 0, "reason": "no_person"})
        self.assertEqual(self.select([[]]), {"index": 0, "ambiguous": False, "detected": 1, "reason": "single_person"})

    def test_equal_and_similar_bodies_are_ambiguous_regardless_of_order(self):
        for poses in ([pose(), pose()], [pose(), pose(.8)], [pose(.8), pose()]):
            result = self.select(poses)
            self.assertTrue(result["ambiguous"])
            self.assertIsNone(result["index"])
            self.assertEqual(result["reason"], "multiple_people")

    def test_dominant_foreground_selects_corresponding_world_index_in_any_order(self):
        for poses, expected in (([pose(), pose(.5)], 0), ([pose(.5), pose()], 1)):
            result = self.select(poses)
            self.assertEqual(result, {"index": expected, "ambiguous": False, "detected": 2, "reason": "dominant_foreground"})

    def test_partial_offscreen_subject_is_not_a_competing_desk_subject(self):
        for field, value in (("x", -.01), ("y", 1.01)):
            partial = pose()
            partial[11][field] = value
            result = self.select([partial, pose()])
            self.assertEqual((result["index"], result["reason"], result["detected"]), (1, "sole_reliable_subject", 2))

    def test_large_in_frame_weak_subject_blocks_handoff_to_background(self):
        for field, value in (("visibility", .59), ("presence", .1), ("z", math.nan)):
            foreground = pose()
            foreground[11][field] = value
            result = self.select([foreground, pose(.5)])
            self.assertEqual(result["reason"], "unreliable_competing_subject")
            self.assertTrue(result["ambiguous"])
            self.assertIsNone(result["index"])

    def test_small_weak_background_does_not_block_foreground(self):
        background = pose(.5)
        background[11]["visibility"] = .1
        result = self.select([background, pose()])
        self.assertFalse(result["ambiguous"])
        self.assertEqual(result["index"], 1)

    def test_foreground_occlusion_clears_actual_classifier_and_metadata(self):
        foreground, background = pose(), pose(.5)
        classifier = PostureClassifier()
        classifier.start_calibration()
        def frame(timestamp, points):
            return {"timestampMs": timestamp, "width": 640, "height": 480, "landmarks": points}
        for index in range(30):
            classifier.update(frame(index * 50, [foreground]))
        classifier.update(frame(1500, [foreground, background]))
        self.assertEqual(classifier.update(frame(2200, [foreground, background]))["posture"], "GOOD")
        occluded = deepcopy(foreground)
        occluded[11]["visibility"] = .1
        result = classifier.update(frame(2250, [occluded, background]))
        self.assertEqual(result["posture"], "UNKNOWN")
        self.assertEqual(result["reason"], "multiple_people")
        self.assertTrue(result["subject"]["ambiguous"])
        metadata = observation_metadata({"result": result, "people": 2, "fps": 12, "inferenceMs": 10})
        self.assertEqual(metadata["confidence"], 0)
        self.assertTrue(metadata["ambiguous_people"])

    def test_no_reliable_candidate_and_invalid_frame_remain_ambiguous(self):
        self.assertTrue(self.select([[], pose(.1)])["ambiguous"])
        for size in ((0, 480), (640, math.inf), (True, 480)):
            self.assertTrue(select_subject([pose(), pose(.5)], *size)["ambiguous"])

    def test_selection_uses_aspect_corrected_geometry_and_is_mirror_invariant(self):
        source = [pose(.5, .3), pose(1, .6)]
        mirrored = [[dict(p, x=1-p["x"]) for p in points] for points in source]
        self.assertEqual(self.select(source), self.select(mirrored))
        landscape = self.select(source)
        self.assertEqual(landscape, select_subject(source, 1280, 960))

    def test_label_like_extra_fields_do_not_change_geometry_selection(self):
        source = [pose(.5), pose()]
        changed = deepcopy(source)
        for points in changed:
            for point in points:
                point["label"] = "GOOD"
                point["filename"] = "anything.png"
        self.assertEqual(self.select(source), self.select(changed))

    def test_malformed_points_do_not_make_a_foreground_claim(self):
        for invalid in (None, "point", {"x": .4, "y": .4, "visibility": True}):
            points = pose()
            points[0] = invalid
            self.assertTrue(self.select([points, []])["ambiguous"])


class SubjectMetadataTests(unittest.TestCase):
    def observation(self, subject=None):
        result = {"calibration": {"status": "ready"}, "personDetected": True,
                  "posture": "GOOD", "confidence": .91}
        if subject is not None:
            result["subject"] = subject
        return {"result": result, "people": 2, "fps": 12, "inferenceMs": 20}

    def test_selected_foreground_retains_confidence_with_raw_two_person_count(self):
        observation = self.observation({"index": 0, "detected": 2, "ambiguous": False})
        metadata = observation_metadata(observation)
        self.assertEqual(metadata["confidence"], .91)
        self.assertFalse(metadata["ambiguous_people"])
        self.assertEqual(observation["people"], 2)

    def test_ambiguity_still_clears_confidence_and_older_adapter_uses_raw_count(self):
        for subject in (None, {"ambiguous": True}, {"ambiguous": "false"}):
            metadata = observation_metadata(self.observation(subject))
            self.assertEqual(metadata["confidence"], 0)
            self.assertTrue(metadata["ambiguous_people"])

    def test_single_subject_compatibility_and_explicit_ambiguity(self):
        self.assertFalse(subject_ambiguous({}, 1))
        self.assertTrue(subject_ambiguous({"subject": {"ambiguous": True}}, 1))


if __name__ == "__main__":
    unittest.main()
