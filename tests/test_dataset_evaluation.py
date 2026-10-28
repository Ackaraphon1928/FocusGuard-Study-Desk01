"""Personal dataset pairing and deterministic offline evaluation boundaries."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from evaluation.evaluate_pc_posture import evaluate
from evaluation.extract_pc_dataset import calibration_groups, calibration_reference, dataset_images, label_for


FIXTURE = Path(__file__).resolve().parents[1] / "evaluation/fixtures/pc-dataset.landmarks.json"


class DatasetEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.dataset = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_legacy_single_reference_replays_original_labels(self):
        report = evaluate(self.dataset)
        self.assertEqual((report["matched"], report["total"]), (7, 7))
        self.assertTrue(all(row["reference"] == "GOOD.png" for row in report["rows"]))

    def test_personal_reference_pairs_are_used_with_multiple_good_people(self):
        neutral = next(image for image in self.dataset["images"] if image["label"] == "GOOD")
        target = next(image for image in self.dataset["images"] if image["label"] == "SLOUCH")
        images = []
        for index in (1, 2):
            for source, name in ((neutral, "GOOD"), (target, "SLOUCH")):
                image = deepcopy(source)
                image.update(filename=f"people/{name}{index}.png", calibration_group="people",
                             calibration_reference=f"people/GOOD{index}.png")
                images.append(image)
        report = evaluate({"images": images, "provenance": {}})
        self.assertEqual(report["matched"], 4)
        self.assertEqual([row["reference"] for row in report["rows"]],
                         ["people/GOOD1.png", "people/GOOD1.png", "people/GOOD2.png", "people/GOOD2.png"])

    def test_cross_group_reference_is_rejected_instead_of_silently_calibrating(self):
        image = deepcopy(self.dataset["images"][0])
        image.update(calibration_group="other", calibration_reference="GOOD.png")
        with self.assertRaisesRegex(ValueError, "Invalid personal GOOD reference"):
            evaluate({"images": [*self.dataset["images"], {**image, "filename": "other/target.png"}], "provenance": {}})

    def test_missing_reference_pose_remains_unknown_without_invented_landmarks(self):
        neutral = deepcopy(next(image for image in self.dataset["images"] if image["label"] == "GOOD"))
        neutral.update(landmarks=[], worldLandmarks=[])
        report = evaluate({"images": [neutral], "provenance": {}})
        self.assertEqual(report["rows"][0]["predicted"], "NO_PERSON")
        self.assertFalse(report["rows"][0]["calibration_ready"])
        self.assertEqual(report["matched"], 0)

    def test_multiple_good_references_require_explicit_personal_pairing(self):
        duplicate = deepcopy(next(image for image in self.dataset["images"] if image["label"] == "GOOD"))
        duplicate["filename"] = "GOOD2.png"
        with self.assertRaisesRegex(ValueError, "explicit personal GOOD reference"):
            evaluate({"images": [*self.dataset["images"], duplicate], "provenance": {}})

    def test_recursive_discovery_keeps_groups_and_validates_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "other").mkdir()
            for filename in ("GOOD.png", "SLOUCH1.jpg", "other/GOOD2.png", "other/SLOUCH2.jpeg"):
                (root / filename).touch()
            self.assertEqual([path.name for path in dataset_images(root)], ["GOOD.png", "SLOUCH1.jpg"])
            images = dataset_images(root, True)
            groups = calibration_groups(images, root)
            self.assertEqual(set(groups), {".", "other"})
            self.assertEqual(calibration_reference(root / "other/SLOUCH2.jpeg", root, groups, {}), root / "other/GOOD2.png")
            self.assertEqual(label_for(root / "SLOUCH123.png"), "SLOUCH")
            (root / "other/UNLABELED.png").touch()
            with self.assertRaisesRegex(ValueError, "Unrecognized labeled"):
                dataset_images(root, True)

    def test_multiple_references_need_manifest_and_must_point_to_group_good(self):
        root = Path("dataset")
        paths = [root / name for name in ("GOOD1.png", "GOOD2.png", "SLOUCH1.png")]
        groups = calibration_groups(paths, root)
        with self.assertRaisesRegex(ValueError, "Multiple GOOD references"):
            calibration_reference(paths[2], root, groups, {})
        self.assertEqual(calibration_reference(paths[2], root, groups, {"SLOUCH1.png": "GOOD2.png"}), paths[1])
        with self.assertRaisesRegex(ValueError, "must be a GOOD image"):
            calibration_reference(paths[2], root, groups, {"SLOUCH1.png": "../outside/GOOD.png"})

    def test_group_without_good_reference_is_rejected(self):
        root = Path("dataset")
        with self.assertRaisesRegex(ValueError, "needs a labeled GOOD"):
            calibration_groups([root / "other/SLOUCH1.png"], root)


if __name__ == "__main__":
    unittest.main()
