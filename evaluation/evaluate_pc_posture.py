"""Replay extracted tuning landmarks through the canonical Python classifier."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.vision.posture import PostureClassifier, extract_pose_geometry


def evaluate(dataset):
    neutral = next((image for image in dataset["images"] if image["label"] == "GOOD"), None)
    if neutral is None or len(neutral["landmarks"]) != 1:
        raise ValueError("Dataset needs one detected GOOD calibration reference")

    def frame(image, timestamp):
        return {key: image[key] for key in ("landmarks", "worldLandmarks", "width", "height")} | {"timestampMs": timestamp}

    rows = []
    for image in dataset["images"]:
        classifier = PostureClassifier(view="front")
        classifier.start_calibration()
        for i in range(30):
            classifier.update(frame(neutral, i * 100))
        for i in range(15):
            result = classifier.update(frame(image, 3000 + i * 100))
        geometry = extract_pose_geometry(image["landmarks"][0] if image["landmarks"] else [], image["width"], image["height"],
                                         "front", image["worldLandmarks"][0] if image["worldLandmarks"] else None)["geometry"]
        rows.append({"filename": image["filename"], "expected": image["label"], "predicted": result["posture"],
                     "pass": result["posture"] == image["label"], "reason": result["reason"], "confidence": result["confidence"],
                     "tracking_mode": geometry["trackingMode"] if geometry else None,
                     "upper_body": geometry.get("upperBody") if geometry else None})
    labels = ("GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT", "NO_PERSON", "UNKNOWN")
    return {
        "kind": "user_provided_tuning_regression_not_independent_accuracy",
        "classifier": "backend.vision.posture.PostureClassifier",
        "provenance": dataset["provenance"],
        "calibration": "Single GOOD reference replayed; the same reference is also a GOOD regression case.",
        "limitations": "Seven screenshots from one person, used for tuning. Repeated-still CPU VIDEO extraction is not live-camera validation. No held-out test data.",
        "matched": sum(row["pass"] for row in rows), "total": len(rows), "rows": rows,
        "confusion": {actual: {predicted: sum(row["expected"] == actual and row["predicted"] == predicted for row in rows) for predicted in labels} for actual in labels},
    }


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=root / "evaluation/fixtures/pc-dataset.landmarks.json")
    parser.add_argument("--output", type=Path, default=root / "evaluation/results/pc-dataset/report.json")
    args = parser.parse_args()
    report = evaluate(json.loads(args.input.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    for row in report["rows"]:
        print(f"{row['filename']:<26} expected={row['expected']:<16} predicted={row['predicted']:<16} reliability={row['confidence']:.3f} {'PASS' if row['pass'] else 'FAIL'}")
    print(f"Tuning regression: {report['matched']}/{report['total']}; report: {args.output}")
    raise SystemExit(0 if report["matched"] == report["total"] else 1)


if __name__ == "__main__":
    main()
