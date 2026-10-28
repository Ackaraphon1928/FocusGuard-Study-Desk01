"""Real labeled edge cases and geometric invariants, without native CV or a camera."""
from copy import deepcopy
import json
import math
from pathlib import Path
import unittest

from backend.engine import FocusGuardEngine
from backend.storage import Store
from backend.vision.posture import PostureClassifier, extract_pose_geometry
from backend.vision.service import observation_metadata
from backend.vision.subject import select_subject
from tests.test_posture import calibrated, frame, stable, upper_pose, world


DATA = json.loads((Path(__file__).resolve().parents[1] /
                   "evaluation/fixtures/pc-dataset-edges.landmarks.json").read_text(encoding="utf8"))
IMAGES = {image["filename"]: image for image in DATA["images"]}


def observation(image, timestamp):
    return {k: image[k] for k in ("landmarks", "worldLandmarks", "width", "height")} | {"timestampMs": timestamp}


def replay(image, transform=lambda item: item, target_transform=None):
    neutral = transform(IMAGES[image["calibration_reference"]])
    target = (target_transform or transform)(image)
    classifier = PostureClassifier()
    classifier.start_calibration()
    for i in range(30):
        result = classifier.update(observation(neutral, i * 100))
    if result["calibration"]["status"] != "ready":
        raise AssertionError(f"Neutral calibration not ready: {result['reason']}")
    for i in range(15):
        result = classifier.update(observation(target, 3000 + i * 100))
    return result


def single_scaled(image, factor):
    """Change only target distance/zoom about the principal point, not its pose."""
    item = deepcopy(image)
    index = select_subject(item["landmarks"], item["width"], item["height"])["index"]
    points = item["landmarks"][index]
    item["landmarks"] = [[dict(p, x=.5+(p["x"]-.5)*factor,
                              y=.5+(p["y"]-.5)*factor, z=p["z"]*factor) for p in points]]
    item["worldLandmarks"] = [item["worldLandmarks"][index]] if item["worldLandmarks"] else []
    return item


class EdgeDatasetTests(unittest.TestCase):
    def test_personal_neutrals_are_paired_and_do_not_mix_people(self):
        self.assertEqual(len(IMAGES), 16)
        self.assertEqual(IMAGES["edge case/SLOUCH1.png"]["calibration_reference"], "edge case/GOOD1.png")
        self.assertEqual(IMAGES["edge case/SLOUCH2.png"]["calibration_reference"], "edge case/GOOD2.png")

    def test_pose_order_does_not_change_foreground_or_its_world_geometry(self):
        def reverse(image):
            item = deepcopy(image)
            item["landmarks"].reverse()
            item["worldLandmarks"].reverse()
            return item
        for name in ("edge case/GOOD2.png", "edge case/SLOUCH2.png"):
            with self.subTest(name=name):
                result = replay(IMAGES[name], reverse)
                self.assertEqual(result["posture"], IMAGES[name]["label"])
                self.assertFalse(result["subject"]["ambiguous"])
                self.assertEqual(result["subject"]["detected"], 2)

    def test_foreground_result_reaches_engine_even_with_background_person(self):
        image = IMAGES["edge case/SLOUCH2.png"]
        result = replay(image)
        metadata = observation_metadata({"result": result, "people": len(image["landmarks"]), "fps": 8, "inferenceMs": 30})
        self.assertFalse(metadata["ambiguous_people"])
        store = Store(":memory:")
        try:
            engine = FocusGuardEngine(store, now=1000)
            engine.set_vision_source("pc_camera", 1000)
            engine.ingest_pc_vision(metadata, 1001)
            engine.step(1001)
            self.assertEqual(engine.state(1001)["sensors"]["posture"], "SLOUCH")
        finally:
            store.close()


for image in DATA["images"]:
    name = image["filename"].replace("/", "_").replace(" ", "_").replace(".png", "").lower()
    def real_case(self, image=image):
        result = replay(image)
        self.assertEqual(result["posture"], image["label"])
        self.assertFalse(result["subject"]["ambiguous"])
    def distance(self, image=image):
        # The target changes distance after a fixed upright calibration. Its
        # projected position and size scale together; no image ID enters rules.
        for factor in (.65, .8):
            with self.subTest(scale=factor):
                self.assertEqual(replay(image, lambda item: single_scaled(item, 1),
                                        lambda item: single_scaled(item, factor))["posture"], image["label"])
    def jitter(self, image=image):
        def transform(item):
            changed = deepcopy(item)
            changed["landmarks"] = [[dict(p, x=p["x"]+(1 if index % 2 else -1)/item["width"],
                                          y=p["y"]+(1 if index % 3 else -1)/item["height"])
                                     for index, p in enumerate(points)] for points in changed["landmarks"]]
            return changed
        self.assertEqual(replay(image, transform)["posture"], image["label"])
    setattr(EdgeDatasetTests, f"test_label_{name}", real_case)
    setattr(EdgeDatasetTests, f"test_farther_{name}", distance)
    setattr(EdgeDatasetTests, f"test_jitter_{name}", jitter)


class RelativeDepthTests(unittest.TestCase):
    def test_new_camera_level_features_prevent_moving_calibration(self):
        classifier = PostureClassifier()
        classifier.start_calibration()
        for i in range(15):
            classifier.update(frame(i*50, upper_pose()))
        lowered = [dict(p, y=p["y"]+.07) for p in upper_pose()]
        result = classifier.update(frame(750, lowered))
        self.assertEqual(result["reason"], "calibration_unstable")
        self.assertEqual(result["calibration"]["frames"], 1)

    def test_upper_world_evidence_reports_its_weakest_point(self):
        geometry = extract_pose_geometry(upper_pose(), 640, 480,
                                         world_landmarks=world({0: {"visibility": .64}}))["geometry"]
        self.assertEqual(geometry["upperBody"]["neckDepthSource"], "world")
        self.assertEqual(geometry["confidence"], .64)

    def test_upright_near_and_far_is_good_without_recalibration(self):
        neutral = upper_pose()
        for factor in (.65, .8, 1.2, 1.4):
            changed = [dict(p, x=.5+(p["x"]-.5)*factor, y=.5+(p["y"]-.5)*factor, z=p["z"]*factor) for p in neutral]
            with self.subTest(scale=factor):
                self.assertEqual(stable(calibrated(neutral), changed)["posture"], "GOOD")

    def test_upper_depth_works_without_hips_and_cancels_xyz_origin(self):
        points, xyz = upper_pose(), world()
        first = extract_pose_geometry(points, 640, 480, world_landmarks=xyz)["geometry"]["upperBody"]
        shifted = [dict(p, x=p["x"]+.1, y=p["y"]+.2, z=p["z"]+.3) for p in xyz]
        second = extract_pose_geometry(points, 640, 480, world_landmarks=shifted)["geometry"]["upperBody"]
        self.assertEqual(first["neckDepthSource"], "world")
        for key in ("neckDepthRatio", "neckHeightRatio3d", "neckInclinationDeg"):
            self.assertAlmostEqual(first[key], second[key])

    def test_z_alone_cannot_turn_upright_into_slouch(self):
        self.assertEqual(stable(calibrated(upper_pose(), world()), upper_pose(), world({0: {"z": -.3}}))["posture"], "GOOD")

    def test_modest_relative_neck_collapse_needs_matching_depth_evidence(self):
        changed = upper_pose()
        for i in (0, 2, 5, 7, 8, 9, 10):
            changed[i]["y"] += .045
        xyz = world({0: {"y": -.63, "z": -.2}})
        self.assertEqual(stable(calibrated(upper_pose(), world()), changed, xyz)["posture"], "SLOUCH")
        self.assertEqual(stable(calibrated(upper_pose(), world()), changed)["posture"], "GOOD")

    def test_invalid_or_unreliable_world_depth_uses_normalized_fallback(self):
        for changes in ({0: {"z": math.nan}}, {11: {"visibility": .2}}):
            geometry = extract_pose_geometry(upper_pose(), 640, 480, world_landmarks=world(changes))["geometry"]
            self.assertEqual(geometry["upperBody"]["neckDepthSource"], "normalized")

    def test_old_v1_calibration_still_loads_and_invalid_depth_does_not(self):
        payload = calibrated(upper_pose()).export_calibration()
        added = ("headLevelRatio", "shoulderLevelRatio", "neckDepthRatio", "neckHeightRatio3d", "neckInclinationDeg", "neckDepthSource")
        for key in added:
            payload["baseline"]["upperBody"].pop(key)
        restored = PostureClassifier()
        restored.load_calibration(payload)
        self.assertEqual(stable(restored, upper_pose())["posture"], "GOOD")
        for key, invalid in (("headLevelRatio", math.inf), ("neckDepthRatio", 100), ("neckDepthSource", "camera_distance")):
            bad = calibrated(upper_pose()).export_calibration()
            bad["baseline"]["upperBody"][key] = invalid
            with self.subTest(key=key), self.assertRaises(ValueError):
                PostureClassifier().load_calibration(bad)


if __name__ == "__main__":
    unittest.main()
