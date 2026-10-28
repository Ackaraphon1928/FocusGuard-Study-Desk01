"""Conservative foreground selection for a single-user desk camera.

This is a geometric foreground policy, not person identification. Similar-size
or unreliable competing poses remain ambiguous. No labels or image identity
participate in selection; raw detection counts remain available to diagnostics.
"""
from __future__ import annotations

import math


MIN_SHOULDER_DOMINANCE = 1.5


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _core_point(point):
    if not isinstance(point, dict):
        return False
    x, y = point.get("x"), point.get("y")
    visibility, presence = point.get("visibility", 0), point.get("presence", 1)
    return (all(_finite(v) for v in (x, y, visibility, presence))
            and 0 <= x <= 1 and 0 <= y <= 1 and .6 <= visibility <= 1 and .5 <= presence <= 1
            and math.sqrt(visibility * presence) >= .6
            and ("z" not in point or _finite(point["z"])))


def _raw_core_span(points, width, height):
    """Recognize a competing visible body even when confidence has collapsed."""
    if not isinstance(points, (list, tuple)) or len(points) < 13:
        return None
    if not all(isinstance(points[index], dict)
               and all(_finite(points[index].get(k)) and 0 <= points[index][k] <= 1 for k in ("x", "y"))
               for index in (0, 11, 12)):
        return None
    nose, left, right = (points[index] for index in (0, 11, 12))
    span = math.hypot((left["x"] - right["x"]) * width, (left["y"] - right["y"]) * height)
    if span < max(12, width * .08) or span > width * 1.15:
        return None
    shoulder_x, shoulder_y = (left["x"] + right["x"]) / 2, (left["y"] + right["y"]) / 2
    head_height = (shoulder_y - nose["y"]) * height / span
    head_offset = (nose["x"] - shoulder_x) * width / span
    if not -.6 <= head_height <= 1.6 or abs(head_offset) > 1.5:
        return None
    return span


def _shoulder_span(points, width, height):
    if not isinstance(points, (list, tuple)) or len(points) < 13:
        return None
    if not all(_core_point(points[index]) for index in (0, 11, 12)):
        return None
    return _raw_core_span(points, width, height)


def select_subject(poses, width, height):
    """Choose only an unambiguous, reliable foreground upper body.

    A single pose is left to the classifier's full front/side geometry checks.
    With multiple detections, in-frame nose and both shoulders must be reliable.
    The largest valid pose wins only with a 1.5x shoulder-span margin; one valid
    pose can be selected when remaining detections are small or cropped. A large
    in-frame competitor with weak confidence blocks selection, preventing an
    occluded foreground subject from silently handing off to the background.
    """
    count = len(poses)
    if count == 0:
        return {"index": None, "ambiguous": False, "detected": 0, "reason": "no_person"}
    if count == 1:
        return {"index": 0, "ambiguous": False, "detected": 1, "reason": "single_person"}
    ambiguous = {"index": None, "ambiguous": True, "detected": count, "reason": "multiple_people"}
    if not all(_finite(v) and v > 0 for v in (width, height)):
        return ambiguous
    candidates = [(span, index) for index, points in enumerate(poses)
                  if (span := _shoulder_span(points, width, height)) is not None]
    if not candidates:
        return ambiguous
    candidates.sort(reverse=True)
    if len(candidates) == 1:
        reason = "sole_reliable_subject"
    elif candidates[0][0] >= candidates[1][0] * MIN_SHOULDER_DOMINANCE:
        reason = "dominant_foreground"
    else:
        return ambiguous
    selected_span, selected_index = candidates[0]
    for index, points in enumerate(poses):
        if index == selected_index or _shoulder_span(points, width, height) is not None:
            continue
        raw_span = _raw_core_span(points, width, height)
        if raw_span is not None and raw_span >= selected_span / MIN_SHOULDER_DOMINANCE:
            return {**ambiguous, "reason": "unreliable_competing_subject"}
    return {"index": selected_index, "ambiguous": False, "detected": count, "reason": reason}


def subject_ambiguous(result, detected_people):
    """Use explicit selection ambiguity, with compatibility for older adapters."""
    subject = result.get("subject")
    if isinstance(subject, dict) and isinstance(subject.get("ambiguous"), bool):
        return subject["ambiguous"]
    return detected_people > 1
