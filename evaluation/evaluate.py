"""Compute metrics from your labeled observation CSV using the Python standard library."""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from statistics import mean, pstdev


def number(row: dict, name: str) -> float | None:
    value = row.get(name, "")
    if value is None or not str(value).strip():
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} contains non-finite value")
    return result


def summary(values: list[float]) -> dict | None:
    if not values:
        return None
    ordered = sorted(values)
    # Linear interpolation: the same convention as numpy.percentile's default.
    index = (len(ordered) - 1) * 0.95
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    p95 = ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
    return {"samples": len(values), "mean": mean(values), "std_population": pstdev(values), "p95": p95}


def evaluate(rows: list[dict], calibration=None) -> dict:
    allowed_labels = {"GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT", "NO_PERSON", "UNKNOWN"}
    pairs = []
    distances = []
    latencies = []
    inference_times = []
    timestamps = []
    for row_number, row in enumerate(rows, start=2):
        try:
            expected = row.get("expected_posture", "").strip().upper()
            predicted = row.get("predicted_posture", "").strip().upper()
            if expected and not predicted and calibration:
                from raspberry_pi.posture import classify
                feature = {key: number(row, key) for key in ("torso_angle", "shoulder_angle", "neck_offset", "head_height")}
                if any(value is None for value in feature.values()):
                    raise ValueError("Missing geometry for prediction")
                predicted = classify(feature, calibration)
            if expected:
                if expected not in allowed_labels or predicted not in allowed_labels:
                    raise ValueError("Unknown/missing posture label; supply prediction or --calibration with geometry")
                pairs.append((expected, predicted))
            reference, distance = number(row, "distance_reference_cm"), number(row, "distance_cm")
            if reference is not None and distance is not None:
                if reference < 0 or distance < 0:
                    raise ValueError("Distances must be nonnegative")
                distances.append(abs(reference - distance))
            latency = number(row, "latency_ms")
            if latency is not None:
                if latency < 0:
                    raise ValueError("Negative latency")
                latencies.append(latency)
            inference = number(row, "inference_ms")
            if inference is not None:
                if inference < 0:
                    raise ValueError("Negative inference time")
                inference_times.append(inference)
            timestamp = number(row, "frame_timestamp")
            if timestamp is not None:
                timestamps.append(timestamp)
        except (ValueError, TypeError) as error:
            raise ValueError(f"CSV row {row_number}: {error}") from error
    classification = None
    if pairs:
        labels = sorted({label for pair in pairs for label in pair})
        confusion = {label: {prediction: 0 for prediction in labels} for label in labels}
        for expected, predicted in pairs:
            confusion[expected][predicted] += 1
        per_class = {}
        for label in labels:
            true_positive = confusion[label][label]
            support = sum(confusion[label].values())
            predicted_count = sum(confusion[actual][label] for actual in labels)
            precision = true_positive / predicted_count if predicted_count else 0.0
            recall = true_positive / support if support else 0.0
            f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
            per_class[label] = {"precision": precision, "recall": recall, "f1": f1, "support": support}
        classification = {
            "samples": len(pairs), "accuracy": sum(actual == predicted for actual, predicted in pairs) / len(pairs),
            "macro_precision": mean(item["precision"] for item in per_class.values()),
            "macro_recall": mean(item["recall"] for item in per_class.values()),
            "macro_f1": mean(item["f1"] for item in per_class.values()),
            "per_class": per_class, "confusion_rows_actual_columns_predicted": confusion,
        }
    if len(timestamps) > 1 and any(right <= left for left, right in zip(timestamps, timestamps[1:])):
        raise ValueError("frame_timestamp must be strictly increasing within one capture; do not combine runs")
    return {
        "rows": len(rows), "classification": classification,
        "distance": {"samples": len(distances), "mae_cm": mean(distances)} if distances else None,
        "latency_ms": summary(latencies), "inference_ms": summary(inference_times),
        "capture_fps": (len(timestamps) - 1) / (timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else None,
        "capture_frames": len(timestamps),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--calibration", type=Path, help="Predict from numeric geometry instead of precomputed labels")
    parser.add_argument("--allow-synthetic", action="store_true", help="Allow fixture data; report remains marked synthetic")
    args = parser.parse_args()
    with args.csv_file.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        parser.error("CSV contains no observations")
    synthetic = any(row.get("provenance", "").lower() == "synthetic" for row in rows)
    if synthetic and not args.allow_synthetic:
        parser.error("This CSV is a synthetic format example. Use your recorded data or --allow-synthetic for tool validation.")
    calibration = None
    if args.calibration:
        from raspberry_pi.posture import Calibration
        calibration = Calibration.load(str(args.calibration))
    try:
        result = evaluate(rows, calibration)
    except ValueError as error:
        parser.error(str(error))
    result["data_kind"] = "synthetic_fixture_not_hardware_results" if synthetic else "user_supplied_observations_not_independently_verified"
    result["source_file"] = str(args.csv_file)
    content = json.dumps(result, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content + "\n", encoding="utf-8")
    print(content)


if __name__ == "__main__":
    main()
