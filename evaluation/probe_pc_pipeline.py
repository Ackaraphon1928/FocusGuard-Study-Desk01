"""Probe every native CPU frame and temporal classifier on local labeled stills.

Unlike frozen-landmark replay, every calibration/target frame is re-inferred and
fed directly to the production classifier, including early tracking failures.
No physical camera is opened, and no frames or landmark arrays are written.
"""
from __future__ import annotations

import argparse
from collections import Counter
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import time

from backend.vision.model import MODEL_SHA256, ensure_model
from backend.vision.posture import PostureClassifier
from backend.vision.service import _MediaPipeInference
from evaluation.extract_pc_dataset import calibration_groups, calibration_reference, dataset_images, label_for, sha256


def browser_frame(path):
    """Approximate canvas fit-to-640x480 JPEG q70, without writing an image."""
    import cv2
    frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError(f"Cannot read source image: {path}")
    height, width = frame.shape[:2]
    scale = min(1.0, 640 / width, 480 / height)
    frame = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))),
                       interpolation=cv2.INTER_LINEAR)
    success, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not success:
        raise ValueError(f"Cannot encode source image: {path}")
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError(f"Cannot decode source image: {path}")
    return decoded


def _counts():
    return {key: Counter() for key in ("postures", "candidates", "reasons", "detected_people", "subject_reasons")}


def probe(dataset: Path, references_path: Path, model: Path, *, neutral_frames=75, target_frames=45, interval_ms=67,
          only: set[str] | None = None):
    paths = dataset_images(dataset, True)
    groups = calibration_groups(paths, dataset)
    if only:
        known = {path.relative_to(dataset).as_posix() for path in paths}
        if only - known:
            raise ValueError("Unknown target filename(s): " + ", ".join(sorted(only - known)))
        # Resolve references against the full group before narrowing targets.
        paths = [path for path in paths if path.relative_to(dataset).as_posix() in only]
    manifest = json.loads(references_path.read_text(encoding="utf-8"))
    references = manifest["references"]
    rows = []
    for index, path in enumerate(paths):
        neutral_path = calibration_reference(path, dataset, groups, references)
        neutral, target = browser_frame(neutral_path), browser_frame(path)
        classifier = PostureClassifier(view="front")
        classifier.start_calibration()
        inference = _MediaPipeInference(model, "CPU")
        stages = {"neutral": _counts(), "target": _counts()}
        timestamp = 0
        first_ready = None
        durations = []
        result = None
        try:
            for stage, image, count in (("neutral", neutral, neutral_frames), ("target", target, target_frames)):
                height, width = image.shape[:2]
                for frame_index in range(count):
                    timestamp += interval_ms
                    started = time.perf_counter()
                    pose = inference.detect(image, timestamp)
                    durations.append((time.perf_counter() - started) * 1000)
                    result = classifier.update({**pose, "width": width, "height": height, "timestampMs": timestamp})
                    counts = stages[stage]
                    counts["postures"][result["posture"]] += 1
                    counts["candidates"][result["candidate"]] += 1
                    counts["reasons"][result["reason"]] += 1
                    counts["detected_people"][str(len(pose["landmarks"]))] += 1
                    counts["subject_reasons"][result["subject"]["reason"]] += 1
                    if first_ready is None and classifier.calibration_status == "ready":
                        first_ready = {"stage": stage, "frame": frame_index + 1, "timestamp_ms": timestamp}
        finally:
            inference.close()
        ordered = sorted(durations)
        rank = .95 * (len(ordered) - 1)
        low = math.floor(rank)
        high = math.ceil(rank)
        row = {"filename": path.relative_to(dataset).as_posix(),
               "reference": neutral_path.relative_to(dataset).as_posix(),
               "source_sha256": sha256(path), "reference_sha256": sha256(neutral_path),
               "expected": label_for(path), "predicted": result["posture"],
               "pass": result["posture"] == label_for(path) and first_ready is not None and first_ready["stage"] == "neutral",
               "reason": result["reason"],
               "calibration": result["calibration"], "first_calibration_ready": first_ready,
               "width": target.shape[1], "height": target.shape[0],
               "stages": {stage: {key: dict(value) for key, value in counts.items()} for stage, counts in stages.items()},
               "inference_ms": {"mean": sum(durations) / len(durations),
                                "p95": ordered[low] + (ordered[high] - ordered[low]) * (rank - low), "max": ordered[-1]}}
        rows.append(row)
        print(f"[{index + 1}/{len(paths)}] {row['filename']}: expected={row['expected']} final={row['predicted']} "
              f"calibration={row['calibration']['status']} target_labels={dict(stages['target']['postures'])} "
              f"reasons={dict(stages['target']['reasons'])}", flush=True)
    return {"kind": "native_cpu_repeated_still_temporal_probe_not_live_camera_accuracy",
            "classifier": "backend.vision.posture.PostureClassifier",
            "inference": "backend.vision.service._MediaPipeInference",
            "provenance": {"sdk": "mediapipe Python Tasks", "sdk_version": importlib.metadata.version("mediapipe"),
                           "python": platform.python_version(), "delegate": "CPU", "model_sha256": MODEL_SHA256,
                           "fresh_native_model_per_target": True, "neutral_frames": neutral_frames,
                           "target_frames": target_frames, "timestamp_interval_ms": interval_ms,
                           "target_filter": sorted(only) if only else None,
                           "input_transform": "OpenCV bilinear fit within640x480, JPEG quality70, in-memory decode",
                           "personal_reference_note": manifest.get("note")},
            "limitations": "User-labeled tuning images replayed as repeated stills. Every native result enters calibration/temporal logic; no selected matching frame or fabricated points. Artificial timestamp intervals are not measured live-camera FPS. No webcam, Pi or GPU was exercised. Frames and landmark coordinates are not saved in this report.",
            "matched": sum(row["pass"] for row in rows), "total": len(rows), "rows": rows}


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=root / "IMG_dataset")
    parser.add_argument("--references", type=Path, default=root / "evaluation/fixtures/pc-dataset-edges.references.json")
    parser.add_argument("--model", type=Path)
    parser.add_argument("--neutral-frames", type=int, default=75)
    parser.add_argument("--target-frames", type=int, default=45)
    parser.add_argument("--interval-ms", type=int, default=67)
    parser.add_argument("--only", action="append", help="Probe this relative target filename only; repeat to select several. Personal references still resolve from the full dataset.")
    parser.add_argument("--output", type=Path, default=root / "evaluation/results/pc-dataset/native-stream.report.json")
    args = parser.parse_args()
    if min(args.neutral_frames, args.target_frames, args.interval_ms) <= 0:
        parser.error("Frame counts and interval must be positive")
    report = probe(args.dataset, args.references, ensure_model(args.model), neutral_frames=args.neutral_frames,
                   target_frames=args.target_frames, interval_ms=args.interval_ms, only=set(args.only) if args.only else None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Native temporal probe: {report['matched']}/{report['total']}; report: {args.output}")
    raise SystemExit(0 if report["matched"] == report["total"] else 1)


if __name__ == "__main__":
    main()
