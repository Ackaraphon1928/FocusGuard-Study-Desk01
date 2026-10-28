"""Limited, calibrated head-bow evidence when shoulders are unavailable.

This module never returns a complete posture or a neutral/forward label. Face
landmarks can support a pronounced bow; they cannot reconstruct a hidden torso.
All measurements are projections in the ear-line coordinate frame, normalized
by its length, so image scale and in-plane head roll do not create pitch cues.
"""
from __future__ import annotations

import math


HEAD_BOW_FIELDS = ("noseEarPitchRatio", "eyeEarPitchRatio", "mouthPitchRatio", "headRollDeg", "noseOffsetRatio",
                   "eyeOffsetRatio", "mouthOffsetRatio", "eyeSpanRatio", "faceSpanRatio", "confidence")
MIN_NOSE_PITCH_CHANGE = .20
MIN_EYE_PITCH_CHANGE = .12
MIN_MOUTH_PITCH_CHANGE = .12
MAX_ROLL_CHANGE_DEG = 15


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_head_bow(payload):
    """Validate and copy numeric face evidence for optional saved calibration."""
    limits = {"noseEarPitchRatio": (-.5, 1.1), "eyeEarPitchRatio": (-.6, .7), "mouthPitchRatio": (.05, 1.2),
              "headRollDeg": (-90, 90), "noseOffsetRatio": (-.45, .45),
              "eyeOffsetRatio": (-.25, .25), "mouthOffsetRatio": (-.3, .3), "eyeSpanRatio": (.2, 1),
              "faceSpanRatio": (.025, 1.2), "confidence": (.75, 1)}
    if (not isinstance(payload, dict)
            or any(not _finite(payload.get(key)) or not low <= payload[key] <= high
                   for key, (low, high) in limits.items())):
        raise ValueError("Invalid calibrated head-bow face geometry")
    if not .01 <= payload["noseEarPitchRatio"] - payload["eyeEarPitchRatio"] <= .9:
        raise ValueError("Head-bow nose/eye geometry is inconsistent")
    return {key: payload[key] for key in HEAD_BOW_FIELDS}


def extract_head_bow(points, width, height):
    """Return reliable seven-point face geometry, without estimating shoulders."""
    if (not all(_finite(value) and value > 0 for value in (width, height))
            or not isinstance(points, (list, tuple)) or len(points) < 11):
        return None
    required = (0, 2, 5, 7, 8, 9, 10)
    qualities = []
    for index in required:
        point = points[index]
        if not isinstance(point, dict):
            return None
        x, y = point.get("x"), point.get("y")
        visibility, presence = point.get("visibility", 0), point.get("presence", 1)
        if (not all(_finite(value) for value in (x, y, visibility, presence))
                or not 0 <= x <= 1 or not 0 <= y <= 1
                or not .75 <= visibility <= 1 or not .75 <= presence <= 1
                or ("z" in point and not _finite(point["z"]))):
            return None
        qualities.append(min(visibility, presence))
    xy = lambda index: (points[index]["x"] * width, points[index]["y"] * height)
    first, second = sorted((xy(7), xy(8)))
    dx, dy = second[0] - first[0], second[1] - first[1]
    span = math.hypot(dx, dy)
    if span < max(8, width * .025):
        return None
    along, normal = (dx / span, dy / span), (-dy / span, dx / span)
    midpoint = ((first[0] + second[0]) / 2, (first[1] + second[1]) / 2)
    eye_midpoint = tuple((xy(2)[axis] + xy(5)[axis]) / 2 for axis in (0, 1))
    mouth_midpoint = tuple((xy(9)[axis] + xy(10)[axis]) / 2 for axis in (0, 1))
    def projection(point, axis):
        return sum((point[i] - midpoint[i]) * axis[i] for i in (0, 1)) / span
    nose_pitch, eye_pitch, mouth_pitch = (projection(point, normal) for point in (xy(0), eye_midpoint, mouth_midpoint))
    if (mouth_pitch - eye_pitch) * span <= height * .025:
        return None
    result = {"noseEarPitchRatio": nose_pitch,
              "eyeEarPitchRatio": eye_pitch,
              "mouthPitchRatio": (nose_pitch - eye_pitch) / (mouth_pitch - eye_pitch),
              "headRollDeg": math.degrees(math.atan2(dy, dx)),
              "noseOffsetRatio": projection(xy(0), along),
              "eyeOffsetRatio": projection(eye_midpoint, along),
              "mouthOffsetRatio": projection(mouth_midpoint, along),
              "eyeSpanRatio": math.dist(xy(2), xy(5)) / span,
              "faceSpanRatio": span / width, "confidence": min(qualities)}
    try:
        return validate_head_bow(result)
    except ValueError:
        return None


def pronounced_head_bow(current, baseline):
    """Require corroborating, personally relative face changes; never infer GOOD.

    Body geometry must take precedence at the caller. These signals identify a
    pronounced head-bow component, which by itself cannot distinguish every
    possible whole-body forward lean from a rounded seated posture.
    """
    try:
        current, baseline = validate_head_bow(current), validate_head_bow(baseline)
    except ValueError:
        return False
    return (abs(current["headRollDeg"] - baseline["headRollDeg"]) <= MAX_ROLL_CHANGE_DEG
            and current["noseEarPitchRatio"] - baseline["noseEarPitchRatio"] > MIN_NOSE_PITCH_CHANGE
            and current["eyeEarPitchRatio"] - baseline["eyeEarPitchRatio"] > MIN_EYE_PITCH_CHANGE
            and current["mouthPitchRatio"] - baseline["mouthPitchRatio"] > MIN_MOUTH_PITCH_CHANGE)
