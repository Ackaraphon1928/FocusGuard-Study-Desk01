"""Canonical posture rules shared by the PC backend and Raspberry Pi gateway.

Python port of the accepted, personally calibrated webcam rules. Landmark
confidence describes detection reliability, never clinical accuracy. This
module deliberately depends only on the standard library.
"""
from __future__ import annotations

import math
from copy import deepcopy
from statistics import median

MIN_VISIBILITY = 0.6
MAX_FRAME_GAP_MS = 1_500
MIN_CALIBRATION_MS = 1_200
CALIBRATION_GRACE_MS = 700


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _point(points, index):
    return points[index] if index < len(points) else None


def _reliability(point):
    if not point:
        return 0.0
    values = [point.get("visibility", 0), point.get("presence", 1)]
    return min(values) if all(_finite(v) and 0 <= v <= 1 for v in values) else 0.0


def _in_frame(point, upper=False):
    margin = 0 if upper else 0.015
    return bool(point and _finite(point.get("x")) and _finite(point.get("y"))
                and margin <= point["x"] <= 1 - margin and margin <= point["y"] <= 1 - margin
                and ("z" not in point or _finite(point["z"])))


def _upper_reliability(point):
    visibility, presence = point.get("visibility", 0), point.get("presence", 1)
    if (not all(_finite(v) and 0 <= v <= 1 for v in (visibility, presence))
            or visibility < MIN_VISIBILITY or presence < 0.5):
        return 0.0
    return math.sqrt(visibility * presence)


def _midpoint(a, b):
    return {k: (a[k] + b[k]) / 2 for k in ("x", "y", "z")}


def _image(point, width, height):
    return {"x": point["x"] * width, "y": point["y"] * height, "z": 0.0}


def _divide(numerator, denominator):
    # Degenerate observations are rejected below. Preserve the source numeric
    # behavior while calculating the diagnostics used by those same gates.
    if denominator == 0:
        return math.nan if numerator == 0 else math.copysign(math.inf, numerator)
    return numerator / denominator


def _world_point(point):
    return bool(point and all(_finite(point.get(k)) and abs(point[k]) < 3 for k in ("x", "y", "z"))
                and _reliability(point) >= MIN_VISIBILITY)


def _upper_geometry(points, width, height):
    required = (0, 11, 12)
    if not all(_in_frame(_point(points, i), upper=True) and _upper_reliability(points[i]) >= MIN_VISIBILITY for i in required):
        return None
    nose, left, right = (_image(points[i], width, height) for i in required)
    shoulder = _midpoint(left, right)
    span = math.hypot(left["x"] - right["x"], left["y"] - right["y"])
    head_height = _divide(shoulder["y"] - nose["y"], span)
    head_offset = _divide(nose["x"] - shoulder["x"], span)
    if (span < max(12, width * 0.08) or span > width * 1.15
            or head_height < -0.6 or head_height > 1.6 or abs(head_offset) > 1.5):
        return None
    face_span_ratio = face_reference = head_roll = head_pitch = face_pitch = None
    for a, b, reference in ((7, 8, "ears"), (2, 5, "eyes")):
        if not all(_in_frame(_point(points, i)) and _reliability(points[i]) >= MIN_VISIBILITY for i in (a, b)):
            continue
        first, second = (_image(points[i], width, height) for i in (a, b))
        face_span = math.hypot(first["x"] - second["x"], first["y"] - second["y"])
        if face_span < width * 0.025 or face_span > span * 1.2:
            continue
        face_span_ratio, face_reference = face_span / width, reference
        image_left, image_right = sorted((first, second), key=lambda p: p["x"])
        head_roll = math.degrees(math.atan2(image_right["y"] - image_left["y"], image_right["x"] - image_left["x"]))
        head_pitch = (nose["y"] - (first["y"] + second["y"]) / 2) / face_span
        break
    if all(_in_frame(_point(points, i), upper=True) and _upper_reliability(points[i]) >= MIN_VISIBILITY for i in (2, 5, 9, 10)):
        eye_y = (points[2]["y"] + points[5]["y"]) / 2 * height
        mouth_y = (points[9]["y"] + points[10]["y"]) / 2 * height
        if mouth_y - eye_y > height * 0.025:
            face_pitch = (nose["y"] - eye_y) / (mouth_y - eye_y)
    return {
        "shoulderSpanRatio": span / width, "faceSpanRatio": face_span_ratio, "faceReference": face_reference,
        "headHeightRatio": head_height, "headOffsetRatio": head_offset,
        "shoulderAngleDeg": math.degrees(math.atan2(left["y"] - right["y"], abs(left["x"] - right["x"]))),
        "headRollDeg": head_roll, "headPitchRatio": head_pitch, "facePitchRatio": face_pitch,
        "confidence": min(_upper_reliability(points[i]) for i in required),
    }


def extract_pose_geometry(landmarks, width, height, view="front", world_landmarks=None):
    """Extract reliable, aspect-corrected geometry; do not invent cropped hips."""
    if not _finite(width) or not _finite(height) or width <= 0 or height <= 0:
        return {"geometry": None, "reason": "invalid_frame"}
    if len(landmarks) < 13:
        return {"geometry": None, "reason": "unreliable_landmarks"}
    upper = _upper_geometry(landmarks, width, height)

    def upper_fallback():
        if upper is None:
            return {"geometry": None, "reason": "invalid_geometry"}
        return {"geometry": {
            "trackingMode": "upper_body", "upperBody": upper,
            "headHeightRatio": upper["headHeightRatio"], "headOffsetRatio": upper["headOffsetRatio"],
            "torsoAngleDeg": 0, "shoulderAngleDeg": upper["shoulderAngleDeg"],
            "forwardRatio": None, "neckForwardRatio": None, "confidence": upper["confidence"],
            "forwardSource": "image-plane",
        }, "reason": "reliable_upper_body"}

    sides = ((0, 11, 23), (0, 12, 24))
    side = max(sides, key=lambda ids: min(_reliability(_point(landmarks, i)) for i in ids))
    required = (0, 11, 12) if view == "front" else side
    if any(not _in_frame(_point(landmarks, i), upper=view == "front") for i in required):
        return {"geometry": None, "reason": "cropped_pose"}
    confidence = min((_upper_reliability if view == "front" else _reliability)(landmarks[i]) for i in required)
    if confidence < MIN_VISIBILITY:
        return {"geometry": None, "reason": "unreliable_landmarks"}
    if view == "front" and not all(_in_frame(_point(landmarks, i)) and _reliability(landmarks[i]) >= MIN_VISIBILITY for i in (23, 24)):
        return upper_fallback()
    if view == "front":
        confidence = min(confidence, _reliability(landmarks[23]), _reliability(landmarks[24]))
    nose = _image(landmarks[0], width, height)
    visible_shoulder = landmarks[side[1]]
    left = _image(_point(landmarks, 11) or visible_shoulder, width, height)
    right = _image(_point(landmarks, 12) or visible_shoulder, width, height)
    shoulder = _midpoint(left, right) if view == "front" else _image(landmarks[side[1]], width, height)
    hip = (_midpoint(_image(landmarks[23], width, height), _image(landmarks[24], width, height)) if view == "front"
           else _image(landmarks[side[2]], width, height))
    torso = math.hypot(shoulder["x"] - hip["x"], shoulder["y"] - hip["y"])
    shoulder_span = math.hypot(left["x"] - right["x"], left["y"] - right["y"])
    head_height = _divide(shoulder["y"] - nose["y"], torso)
    if (torso < height * 0.12 or hip["y"] - shoulder["y"] < height * 0.08
            or head_height < -0.05 or head_height > 1.5
            or (view == "front" and not 0.25 <= _divide(shoulder_span, torso) <= 2.2)):
        return upper_fallback() if view == "front" else {"geometry": None, "reason": "invalid_geometry"}
    torso_angle = math.degrees(math.atan2(shoulder["x"] - hip["x"], hip["y"] - shoulder["y"]))
    if abs(torso_angle) > 65:
        return upper_fallback() if view == "front" else {"geometry": None, "reason": "invalid_geometry"}
    both_shoulders = all(_in_frame(_point(landmarks, i)) and _reliability(landmarks[i]) >= MIN_VISIBILITY for i in (11, 12))
    shoulder_angle = (math.degrees(math.atan2(left["y"] - right["y"], abs(left["x"] - right["x"])))
                      if both_shoulders and shoulder_span > height * 0.03 else 0)
    forward = neck_forward = None
    world_indices = (0, 11, 12, 23, 24) if view == "front" else side
    if world_landmarks and all(_world_point(_point(world_landmarks, i)) for i in world_indices):
        world_nose = world_landmarks[0]
        world_shoulder = _midpoint(world_landmarks[11], world_landmarks[12]) if view == "front" else world_landmarks[side[1]]
        world_hip = _midpoint(world_landmarks[23], world_landmarks[24]) if view == "front" else world_landmarks[side[2]]
        world_torso = math.sqrt(sum((world_shoulder[k] - world_hip[k]) ** 2 for k in ("x", "y", "z")))
        if 0.12 <= world_torso <= 1.2 and world_hip["y"] - world_shoulder["y"] > 0.05:
            forward = (world_hip["z"] - world_shoulder["z"]) / world_torso
            neck_forward = (world_shoulder["z"] - world_nose["z"]) / world_torso
            if abs(neck_forward) > 1.5:
                forward = neck_forward = None
            else:
                confidence = min(confidence, *(_reliability(world_landmarks[i]) for i in world_indices))
    geometry = {
        "trackingMode": "full_body", "headHeightRatio": head_height,
        "headOffsetRatio": (nose["x"] - shoulder["x"]) / torso,
        "torsoAngleDeg": torso_angle, "shoulderAngleDeg": shoulder_angle,
        "forwardRatio": forward, "neckForwardRatio": neck_forward, "confidence": confidence,
        "forwardSource": "image-plane" if view == "side" else "unavailable" if forward is None else "world",
    }
    if upper is not None:
        geometry["upperBody"] = upper
    return {"geometry": geometry, "reason": "reliable_geometry"}


class TemporalPosture:
    """Debounce known labels while immediately clearing absent/uncertain evidence."""

    def __init__(self, settle_ms=600):
        self.settle_ms = settle_ms
        self.reset()

    def reset(self):
        self.candidate = self.current = "UNKNOWN"
        self.started_at = 0
        self.last_at = None

    def update(self, label, timestamp_ms):
        if not _finite(timestamp_ms):
            self.reset()
            return "UNKNOWN"
        if self.last_at is not None and (timestamp_ms < self.last_at or timestamp_ms - self.last_at > MAX_FRAME_GAP_MS):
            self.reset()
        self.last_at = timestamp_ms
        if label in ("UNKNOWN", "NO_PERSON"):
            self.current = self.candidate = label
            self.started_at = timestamp_ms
            return label
        if self.current == "NO_PERSON":
            self.current = "UNKNOWN"
        if label != self.candidate:
            self.candidate = label
            self.started_at = timestamp_ms
        if timestamp_ms - self.started_at >= self.settle_ms:
            self.current = label
        return self.current


def _upper_baseline(samples):
    if not samples:
        return None
    result = {k: median(s[k] for s in samples) for k in ("shoulderSpanRatio", "headHeightRatio", "headOffsetRatio", "shoulderAngleDeg", "confidence")}
    reference = next((r for r in ("ears", "eyes") if sum(s["faceReference"] == r for s in samples) >= len(samples) * 0.8), None)
    face_samples = [s for s in samples if s["faceReference"] == reference] if reference else []
    result["faceReference"] = reference
    for key in ("faceSpanRatio", "headRollDeg", "headPitchRatio", "facePitchRatio"):
        source = samples if key == "facePitchRatio" else face_samples
        values = [s[key] for s in source if s[key] is not None]
        result[key] = median(values) if len(values) >= len(samples) * 0.8 else None
    return result


def _baseline_from(samples):
    result = {k: median(s[k] for s in samples) for k in ("headHeightRatio", "headOffsetRatio", "torsoAngleDeg", "shoulderAngleDeg", "confidence")}
    for key in ("forwardRatio", "neckForwardRatio"):
        values = [s[key] for s in samples if s[key] is not None]
        result[key] = median(values) if len(values) >= len(samples) * 0.8 else None
    result["trackingMode"] = "full_body" if sum(s["trackingMode"] == "full_body" for s in samples) >= len(samples) * 0.8 else "upper_body"
    upper = _upper_baseline([s["upperBody"] for s in samples if s.get("upperBody")])
    if upper is not None:
        result["upperBody"] = upper
    result["forwardSource"] = samples[0]["forwardSource"]
    return result


def _stable_against(sample, baseline):
    if sample.get("upperBody") and baseline.get("upperBody"):
        a, b = sample["upperBody"], baseline["upperBody"]
        return (abs(a["shoulderAngleDeg"] - b["shoulderAngleDeg"]) <= 8
                and abs(a["headHeightRatio"] - b["headHeightRatio"]) <= 0.12
                and abs(a["headOffsetRatio"] - b["headOffsetRatio"]) <= 0.12
                and abs(a["shoulderSpanRatio"] / b["shoulderSpanRatio"] - 1) <= 0.12
                and (a["facePitchRatio"] is None or b["facePitchRatio"] is None or abs(a["facePitchRatio"] - b["facePitchRatio"]) <= 0.15))
    return (abs(sample["torsoAngleDeg"] - baseline["torsoAngleDeg"]) <= 8
            and abs(sample["shoulderAngleDeg"] - baseline["shoulderAngleDeg"]) <= 8
            and abs(sample["headHeightRatio"] - baseline["headHeightRatio"]) <= 0.12
            and abs(sample["headOffsetRatio"] - baseline["headOffsetRatio"]) <= 0.12
            and all(sample[k] is None or baseline[k] is None or abs(sample[k] - baseline[k]) <= 0.12 for k in ("forwardRatio", "neckForwardRatio")))


def _classify_upper(current, baseline):
    shoulder_scale = current["shoulderSpanRatio"] / baseline["shoulderSpanRatio"]
    height_drop = baseline["headHeightRatio"] - current["headHeightRatio"]
    comparable = current["faceReference"] is not None and current["faceReference"] == baseline["faceReference"]
    face_scale = (current["faceSpanRatio"] / baseline["faceSpanRatio"] if comparable and current["faceSpanRatio"] is not None and baseline["faceSpanRatio"] is not None else 1)
    pitch_change = (current["facePitchRatio"] - baseline["facePitchRatio"] if current["facePitchRatio"] is not None and baseline["facePitchRatio"] is not None else None)
    ear_pitch_change = (current["headPitchRatio"] - baseline["headPitchRatio"] if comparable and current["headPitchRatio"] is not None and baseline["headPitchRatio"] is not None else None)
    roll_change = (abs(current["headRollDeg"] - baseline["headRollDeg"]) if comparable and current["headRollDeg"] is not None and baseline["headRollDeg"] is not None else 0)
    if (abs(current["shoulderAngleDeg"] - baseline["shoulderAngleDeg"]) > 12
            or (roll_change > 18 and abs(current["headOffsetRatio"] - baseline["headOffsetRatio"]) > 0.18)):
        return "LEAN_LEFT_RIGHT"
    if ((pitch_change is not None and pitch_change > 0.14 and height_drop > 0.12)
            or (ear_pitch_change is not None and ear_pitch_change > 0.27 and height_drop > 0.18)
            or current["headHeightRatio"] < min(0.08, baseline["headHeightRatio"] * 0.2)):
        return "SLOUCH"
    if (shoulder_scale < 0.9 and current["headHeightRatio"] - baseline["headHeightRatio"] > 0.09
            and pitch_change is not None and pitch_change < -0.06):
        return "SLOUCH"
    if height_drop > max(0.1, baseline["headHeightRatio"] * 0.22) and (shoulder_scale > 1.12 or face_scale > 1.18):
        return "LEAN_FORWARD"
    if height_drop > 0.16 or (pitch_change is not None and pitch_change > 0.17):
        return "SLOUCH"
    return "GOOD"


class PostureClassifier:
    """Personal calibration, geometry rules and temporal smoothing in one place.

    Frame/result dictionaries retain the dashboard's camelCase wire protocol.
    Call ``start_calibration`` only while deliberately sitting upright.
    """

    def __init__(self, view="front", calibration_frames=30, settle_ms=600):
        if view not in ("front", "side"):
            raise ValueError("view must be front or side")
        self.view = view
        self.required_frames = max(30, math.floor(calibration_frames)) if _finite(calibration_frames) else 30
        self.temporal = TemporalPosture(settle_ms)
        self.reset()

    def reset(self):
        self.calibration_status = "needed"
        self.samples = []
        self.baseline = None
        self.calibration_started_at = self.last_timestamp = self.last_reliable_at = None
        self.collection_interrupted = False
        self.temporal.reset()

    def start_calibration(self):
        self.reset()
        self.calibration_status = "collecting"

    def set_view(self, view):
        if view not in ("front", "side"):
            raise ValueError("view must be front or side")
        if view != self.view:
            self.view = view
            self.reset()

    def export_calibration(self):
        """Return only numeric neutral geometry, never images or landmarks."""
        if self.calibration_status != "ready" or self.baseline is None:
            raise ValueError("Calibration is not ready")
        return {"schema": "focusguard.pose-calibration.v1", "view": self.view,
                "observations": max(self.required_frames, len(self.samples)), "baseline": deepcopy(self.baseline)}

    def load_calibration(self, payload):
        """Restore a validated baseline for an unchanged camera/person setup.

        Legacy Pi ear-based calibrations are intentionally incompatible. A new
        setup must collect a fresh upright baseline rather than silently reuse
        geometry computed by different rules.
        """
        if not isinstance(payload, dict) or payload.get("schema") != "focusguard.pose-calibration.v1" or payload.get("view") != self.view:
            raise ValueError("Calibration schema/view mismatch; recalibrate upright")
        baseline = payload.get("baseline")
        numeric = ("headHeightRatio", "headOffsetRatio", "torsoAngleDeg", "shoulderAngleDeg", "confidence")
        optional = ("forwardRatio", "neckForwardRatio")
        if not isinstance(baseline, dict) or not all(_finite(baseline.get(k)) for k in numeric):
            raise ValueError("Calibration has missing or nonfinite geometry")
        if not all(k in baseline and (baseline[k] is None or _finite(baseline[k])) for k in optional):
            raise ValueError("Calibration has invalid depth geometry")
        if (baseline.get("trackingMode") not in ("full_body", "upper_body")
                or baseline.get("forwardSource") not in ("world", "image-plane", "unavailable")
                or not MIN_VISIBILITY <= baseline["confidence"] <= 1):
            raise ValueError("Calibration has invalid tracking metadata")
        clean = {k: baseline[k] for k in (*numeric, *optional, "trackingMode", "forwardSource")}
        upper = baseline.get("upperBody")
        if upper is not None:
            required = ("shoulderSpanRatio", "headHeightRatio", "headOffsetRatio", "shoulderAngleDeg", "confidence")
            optional_upper = ("faceSpanRatio", "headRollDeg", "headPitchRatio", "facePitchRatio")
            if (not isinstance(upper, dict) or not all(_finite(upper.get(k)) for k in required)
                    or upper["shoulderSpanRatio"] <= 0 or not MIN_VISIBILITY <= upper["confidence"] <= 1
                    or upper.get("faceReference") not in (None, "ears", "eyes")
                    or not all(k in upper and (upper[k] is None or _finite(upper[k])) for k in optional_upper)
                    or (upper["faceSpanRatio"] is not None and upper["faceSpanRatio"] <= 0)):
                raise ValueError("Calibration has invalid upper-body geometry")
            clean["upperBody"] = {k: upper[k] for k in (*required, *optional_upper, "faceReference")}
        if clean["trackingMode"] == "upper_body" and "upperBody" not in clean:
            raise ValueError("Upper-body calibration requires upper-body geometry")
        self.reset()
        self.baseline = clean
        self.calibration_status = "ready"

    def _result(self, candidate, frame, geometry, reason):
        return {
            "posture": self.temporal.update(candidate, frame["timestampMs"]), "candidate": candidate,
            "personDetected": len(frame["landmarks"]) > 0,
            "confidence": 0 if candidate in ("UNKNOWN", "NO_PERSON") else geometry["confidence"] if geometry else 0,
            "geometry": geometry,
            "calibration": {"status": self.calibration_status, "frames": len(self.samples), "required": self.required_frames},
            "reason": reason,
        }

    def _clear_collection(self):
        if self.calibration_status == "collecting":
            self.samples = []
            self.calibration_started_at = self.last_reliable_at = None
            self.collection_interrupted = False

    def update(self, frame):
        timestamp = frame["timestampMs"]
        if not _finite(timestamp):
            self._clear_collection()
            return self._result("UNKNOWN", frame, None, "invalid_frame")
        gap = self.last_timestamp is not None and (timestamp <= self.last_timestamp or timestamp - self.last_timestamp > MAX_FRAME_GAP_MS)
        self.last_timestamp = timestamp
        if gap:
            self._clear_collection()
        if not frame["landmarks"]:
            self.collection_interrupted = True
            if self.last_reliable_at is None or timestamp - self.last_reliable_at > CALIBRATION_GRACE_MS:
                self._clear_collection()
            return self._result("NO_PERSON", frame, None, "no_person")
        if len(frame["landmarks"]) != 1:
            self._clear_collection()
            return self._result("UNKNOWN", frame, None, "multiple_people")
        worlds = frame.get("worldLandmarks") or []
        extracted = extract_pose_geometry(frame["landmarks"][0], frame["width"], frame["height"], self.view, worlds[0] if worlds else None)
        geometry, reason = extracted["geometry"], extracted["reason"]
        if geometry is None:
            self.collection_interrupted = True
            if self.last_reliable_at is None or timestamp - self.last_reliable_at > CALIBRATION_GRACE_MS:
                self._clear_collection()
            return self._result("UNKNOWN", frame, None, reason)
        if self.calibration_status == "needed":
            return self._result("UNKNOWN", frame, geometry, "calibration_needed")
        if self.calibration_status == "collecting":
            if self.collection_interrupted and self.last_reliable_at is not None and timestamp - self.last_reliable_at > CALIBRATION_GRACE_MS:
                self._clear_collection()
            self.collection_interrupted = False
            unstable = bool(self.samples and not _stable_against(geometry, _baseline_from(self.samples)))
            if unstable:
                self._clear_collection()
            if self.calibration_started_at is None:
                self.calibration_started_at = timestamp
            self.last_reliable_at = timestamp
            self.samples.append(geometry)
            if len(self.samples) >= self.required_frames and timestamp - self.calibration_started_at >= MIN_CALIBRATION_MS:
                self.baseline = _baseline_from(self.samples)
                self.calibration_status = "ready"
            reason = "calibration_unstable" if unstable else "calibration_complete" if self.baseline else "calibrating"
            return self._result("UNKNOWN", frame, geometry, reason)
        baseline = self.baseline
        if (self.view == "front" and (geometry["trackingMode"] == "upper_body" or baseline["trackingMode"] == "upper_body")
                and geometry.get("upperBody") and baseline.get("upperBody")):
            return self._result(_classify_upper(geometry["upperBody"], baseline["upperBody"]), frame, geometry, "tracking_upper_body")
        candidate = "GOOD"
        if self.view == "front" and (abs(geometry["torsoAngleDeg"] - baseline["torsoAngleDeg"]) > 12 or abs(geometry["shoulderAngleDeg"] - baseline["shoulderAngleDeg"]) > 12):
            candidate = "LEAN_LEFT_RIGHT"
        elif (self.view == "front" and baseline["forwardRatio"] is not None and geometry["forwardRatio"] is not None
              and geometry["forwardRatio"] - baseline["forwardRatio"] > 0.22):
            candidate = "LEAN_FORWARD"
        elif self.view == "side" and abs(geometry["torsoAngleDeg"] - baseline["torsoAngleDeg"]) > 18:
            direction = 1 if baseline["headOffsetRatio"] > 0 else -1 if baseline["headOffsetRatio"] < 0 else 0
            if abs(baseline["headOffsetRatio"]) < 0.05 or (geometry["torsoAngleDeg"] - baseline["torsoAngleDeg"]) * direction < 0:
                return self._result("UNKNOWN", frame, geometry, "backward_lean_unsupported")
            candidate = "LEAN_FORWARD"
        elif (baseline["headHeightRatio"] - geometry["headHeightRatio"] > 0.15
              or (self.view == "side" and abs(geometry["headOffsetRatio"] - baseline["headOffsetRatio"]) > 0.22)
              or (baseline["neckForwardRatio"] is not None and geometry["neckForwardRatio"] is not None and geometry["neckForwardRatio"] - baseline["neckForwardRatio"] > 0.2)):
            candidate = "SLOUCH"
        return self._result(candidate, frame, geometry, "tracking_2d" if geometry["forwardSource"] == "unavailable" else "tracking")
