"""Known small observations verify the metrics tools, not hardware performance."""

import json
from pathlib import Path
import subprocess
import sys
import unittest

from evaluation.evaluate import evaluate, summary


class EvaluationTests(unittest.TestCase):
    def test_confusion_and_macro_scores_include_missed_classes_and_abstentions(self):
        pairs = [("GOOD", "GOOD"), ("GOOD", "GOOD"), ("SLOUCH", "GOOD"), ("LEAN_FORWARD", "UNKNOWN")]
        report = evaluate([{"expected_posture": actual, "predicted_posture": predicted} for actual, predicted in pairs])["classification"]
        self.assertEqual(report["accuracy"], .5)
        self.assertEqual(report["confusion_rows_actual_columns_predicted"]["LEAN_FORWARD"]["UNKNOWN"], 1)
        self.assertAlmostEqual(report["per_class"]["GOOD"]["precision"], 2 / 3)
        self.assertEqual(report["per_class"]["GOOD"]["recall"], 1)
        self.assertEqual(report["per_class"]["SLOUCH"]["recall"], 0)
        self.assertAlmostEqual(report["macro_f1"], .2)

    def test_distance_mae_uses_valid_reference_pairs_and_missing_data_stays_unknown(self):
        report = evaluate([
            {"distance_reference_cm": "30", "distance_cm": "33"},
            {"distance_reference_cm": "40", "distance_cm": "38"},
            {"distance_reference_cm": "50", "distance_cm": "51"},
            {"distance_reference_cm": "60", "distance_cm": ""},
        ])
        self.assertEqual(report["distance"], {"samples": 3, "mae_cm": 2})
        missing = evaluate([{}])
        for metric in ("classification", "distance", "latency_ms", "inference_ms", "capture_fps"):
            self.assertIsNone(missing[metric])

    def test_capture_fps_uses_frame_intervals_and_rejects_unsorted_or_duplicate_time(self):
        self.assertEqual(evaluate([{"frame_timestamp": stamp} for stamp in (0, .5, 1)])["capture_fps"], 2)
        for stamps in ((0, 0, 1), (0, 1, .5)):
            with self.subTest(stamps=stamps), self.assertRaises(ValueError):
                evaluate([{"frame_timestamp": stamp} for stamp in stamps])

    def test_latency_percentile_and_invalid_physical_measurements(self):
        report = summary([10, 20, 30, 40])
        self.assertEqual(report["samples"], 4)
        self.assertEqual(report["mean"], 25)
        self.assertAlmostEqual(report["p95"], 38.5)
        for row in ({"latency_ms": "-1"}, {"latency_ms": "nan"}, {"distance_cm": "inf"}, {"distance_reference_cm": "30", "distance_cm": "-1"}):
            with self.subTest(row=row), self.assertRaises(ValueError):
                evaluate([row])

    def test_synthetic_example_cannot_silently_be_reported_as_hardware_evidence(self):
        root = Path(__file__).resolve().parents[1]
        command = [sys.executable, "-m", "evaluation.evaluate", "evaluation/example.synthetic.csv"]
        rejected = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("synthetic", rejected.stderr.lower())
        allowed = subprocess.run(command + ["--allow-synthetic"], cwd=root, capture_output=True, text=True, timeout=15)
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertEqual(json.loads(allowed.stdout)["data_kind"], "synthetic_fixture_not_hardware_results")


if __name__ == "__main__":
    unittest.main()
