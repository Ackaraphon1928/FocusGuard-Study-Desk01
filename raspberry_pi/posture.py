"""Explainable image-plane geometry; thresholds are personal, not clinical."""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import median


@dataclass
class Calibration:
    torso_angle: float = 0.0
    shoulder_angle: float = 0.0
    neck_offset: float = 0.0
    head_height: float = 0.45
    lean_degrees: float = 22.0
    lateral_degrees: float = 12.0
    neck_delta: float = 0.22
    head_drop: float = 0.15
    view: str = "side"

    @classmethod
    def load(cls, path: str) -> "Calibration":
        return cls(**json.loads(Path(path).read_text(encoding="utf-8")))

    def save(self, path: str) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")


def features(landmarks, width: int, height: int, min_visibility: float = 0.55) -> dict | None:
    """Use the better visible body side; coordinates are corrected for aspect ratio."""
    if len(landmarks) < 25:
        return None
    sides = [(7, 11, 23), (8, 12, 24)]  # ear, shoulder, hip
    ear_index, shoulder_index, hip_index = max(sides, key=lambda ids: min(landmarks[i].visibility for i in ids))
    indices = (ear_index, shoulder_index, hip_index)
    confidence = min(float(landmarks[i].visibility) for i in indices)
    if confidence < min_visibility:
        return None
    def xy(index):
        return landmarks[index].x * width, landmarks[index].y * height
    ear, shoulder, hip = (xy(i) for i in indices)
    torso = math.dist(shoulder, hip)
    if torso < 25 or shoulder[1] >= hip[1]:
        return None  # cropped/severely unreliable geometry
    torso_angle = math.degrees(math.atan2(shoulder[0] - hip[0], hip[1] - shoulder[1]))
    left, right = xy(11), xy(12)
    shoulder_visible = min(landmarks[11].visibility, landmarks[12].visibility) >= min_visibility
    shoulder_angle = math.degrees(math.atan2(left[1] - right[1], abs(left[0] - right[0]))) if shoulder_visible else 0.0
    return {
        "torso_angle": torso_angle,
        "shoulder_angle": shoulder_angle,
        "neck_offset": (ear[0] - shoulder[0]) / torso,
        "head_height": (shoulder[1] - ear[1]) / torso,
        "confidence": confidence,
    }


def calibrate(samples: list[dict], view: str = "side") -> Calibration:
    if len(samples) < 20:
        raise ValueError("Calibration requires at least 20 reliable neutral-pose frames")
    result = Calibration(view=view)
    for key in ("torso_angle", "shoulder_angle", "neck_offset", "head_height"):
        setattr(result, key, median(sample[key] for sample in samples))
    return result


def classify(feature: dict, baseline: Calibration) -> str:
    torso_delta = abs(feature["torso_angle"] - baseline.torso_angle)
    if baseline.view == "front":
        if torso_delta > baseline.lateral_degrees or abs(feature["shoulder_angle"] - baseline.shoulder_angle) > baseline.lateral_degrees:
            return "LEAN_LEFT_RIGHT"
    elif torso_delta > baseline.lean_degrees:
        return "LEAN_FORWARD"
    if abs(feature["neck_offset"] - baseline.neck_offset) > baseline.neck_delta or baseline.head_height - feature["head_height"] > baseline.head_drop:
        return "SLOUCH"
    return "GOOD"


class TemporalPosture:
    """Require a stable label for a short debounce; backend applies alert durations."""
    def __init__(self, dwell_seconds: float = 0.6):
        self.dwell = dwell_seconds
        self.candidate = "UNKNOWN"
        self.started_at = 0.0
        self.current = "UNKNOWN"

    def update(self, label: str, now: float) -> str:
        if label in ("UNKNOWN", "NO_PERSON"):
            self.current = label
        if label != self.candidate:
            self.candidate = label
            self.started_at = now
        if now - self.started_at >= self.dwell:
            self.current = label
        return self.current
