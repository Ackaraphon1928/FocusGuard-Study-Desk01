"""Extract local, reproducible MediaPipe evidence without uploading source images.

The Python Tasks SDK is pinned to the same 0.10.32 release as the browser SDK,
but native CPU/image inference is not a browser GPU/video equivalence claim.
See pc_dataset.md for setup and evaluation limits.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform


MODEL_SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
SDK_VERSION = "0.10.32"
NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner",
    "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
    "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
    "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel",
    "right_heel", "left_foot_index", "right_foot_index",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def label_for(path: Path) -> str:
    name = path.stem.upper().rstrip("0123456789")
    if name not in {"GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT"}:
        raise ValueError(f"Unrecognized labeled dataset filename: {path.name}")
    return name


def point_json(point) -> dict:
    return {
        field: float(getattr(point, field))
        for field in ("x", "y", "z", "visibility", "presence")
        if getattr(point, field, None) is not None
    }


def diagnostics(points: list[dict], world: list[dict], width: int, height: int) -> dict:
    if len(points) < 33:
        return {"reason": "no_pose"}
    required = [0, 11, 12, 23, 24]
    quality = lambda p: min(p.get("visibility", 0), p.get("presence", 1))
    in_frame = lambda p: 0.015 <= p["x"] <= 0.985 and 0.015 <= p["y"] <= 0.985
    selected = [0, 2, 5, 7, 8, 9, 10, 11, 12, 23, 24]
    keypoints = {
        NAMES[index]: {
            "index": index,
            "in_frame": in_frame(points[index]),
            **points[index],
            "world": world[index] if len(world) > index else None,
        }
        for index in selected
    }
    def xy(index):
        return (points[index]["x"] * width, points[index]["y"] * height)
    left, right, nose = xy(11), xy(12), xy(0)
    shoulder = tuple((a + b) / 2 for a, b in zip(left, right))
    shoulder_width = math.dist(left, right)
    upper = {}
    if shoulder_width > 0:
        ear_left, ear_right = xy(7), xy(8)
        eyes = tuple((a + b) / 2 for a, b in zip(xy(2), xy(5)))
        mouth = tuple((a + b) / 2 for a, b in zip(xy(9), xy(10)))
        upper = {
            "shoulder_width_pixels": shoulder_width,
            "shoulder_width_normalized": shoulder_width / width,
            "head_height_per_shoulder_width": (shoulder[1] - nose[1]) / shoulder_width,
            "head_offset_per_shoulder_width": (nose[0] - shoulder[0]) / shoulder_width,
            "shoulder_angle_deg": math.degrees(math.atan2(left[1] - right[1], abs(left[0] - right[0]))),
            "nose_eye_drop_per_shoulder_width": (nose[1] - eyes[1]) / shoulder_width,
            "mouth_nose_drop_per_shoulder_width": (mouth[1] - nose[1]) / shoulder_width,
            "face_pitch_ratio": (nose[1] - eyes[1]) / (mouth[1] - eyes[1]) if abs(mouth[1] - eyes[1]) > 1 else None,
            "ear_span_per_shoulder_width": math.dist(ear_left, ear_right) / shoulder_width,
            "nose_to_shoulder_pixels": math.dist(nose, shoulder),
        }
    return {
        "old_front_gate": {
            "cropped": [NAMES[i] for i in required if not in_frame(points[i])],
            "unreliable_below_0_6": [NAMES[i] for i in required if quality(points[i]) < 0.6],
            "minimum_required_reliability": min(quality(points[i]) for i in required),
        },
        "upper_body_features": upper,
        "keypoints": keypoints,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent.parent
    parser.add_argument("--dataset", type=Path, default=root / "IMG_dataset")
    parser.add_argument("--model", type=Path, help="Verified local model; defaults to backend/Pi model resolution.")
    parser.add_argument("--output", type=Path, default=root / "evaluation/fixtures/pc-dataset.landmarks.json")
    parser.add_argument("--confidence", type=float, default=0.5, help="Detection, presence and tracking threshold; default matches the Python camera service.")
    parser.add_argument("--video-frames", type=int, default=30, help="Use VIDEO mode with this many repeated frames per image, warmed by GOOD first. Zero selects independent IMAGE inference.")
    args = parser.parse_args()
    if not 0 < args.confidence <= 1:
        parser.error("--confidence must be greater than zero and at most one")
    if args.video_frames < 0:
        parser.error("--video-frames must be nonnegative")
    if importlib.metadata.version("mediapipe") != SDK_VERSION:
        raise RuntimeError(f"Expected mediapipe=={SDK_VERSION}; use pc_dataset.requirements.txt")
    from backend.vision.model import ensure_model
    args.model = ensure_model(args.model)
    model_hash = sha256(args.model)
    if model_hash != MODEL_SHA256:
        raise RuntimeError(f"Unexpected MediaPipe model SHA256: {model_hash}")

    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(args.model), delegate=python.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO if args.video_frames else vision.RunningMode.IMAGE,
        num_poses=2,
        min_pose_detection_confidence=args.confidence,
        min_pose_presence_confidence=args.confidence,
        min_tracking_confidence=args.confidence,
        output_segmentation_masks=False,
    )
    images = []
    timestamp = 0
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for path in sorted(args.dataset.glob("*.png")):
            image = mp.Image.create_from_file(str(path))
            target_pose_counts = []
            if args.video_frames:
                # This probes repeated stills/tracking, not independent video trials.
                neutral = mp.Image.create_from_file(str(args.dataset / "GOOD.png"))
                for _ in range(args.video_frames):
                    timestamp += 67
                    landmarker.detect_for_video(neutral, timestamp)
                for _ in range(args.video_frames):
                    timestamp += 67
                    result = landmarker.detect_for_video(image, timestamp)
                    target_pose_counts.append(len(result.pose_landmarks))
            else:
                result = landmarker.detect(image)
                target_pose_counts.append(len(result.pose_landmarks))
            normalized = [[point_json(point) for point in pose] for pose in result.pose_landmarks]
            world = [[point_json(point) for point in pose] for pose in result.pose_world_landmarks]
            item = {
                "filename": path.name,
                "label": label_for(path),
                "sha256": sha256(path),
                "width": image.width,
                "height": image.height,
                "landmarks": normalized,
                "worldLandmarks": world,
                "inference_probe": {
                    "target_frames": len(target_pose_counts),
                    "frames_with_pose": sum(count > 0 for count in target_pose_counts),
                    "frames_without_pose": sum(count == 0 for count in target_pose_counts),
                    "frames_with_multiple_poses": sum(count > 1 for count in target_pose_counts),
                    "first_pose_frame": next((index + 1 for index, count in enumerate(target_pose_counts) if count > 0), None),
                    "pose_counts": target_pose_counts,
                    "last_five_counts_stable": len(set(target_pose_counts[-5:])) == 1,
                    "selected_observation": "last target frame; no replacement or synthesized points",
                    "note": "Tasks API does not expose separate detector versus tracker invocation counts.",
                },
                "diagnostics": diagnostics(normalized[0], world[0], image.width, image.height) if normalized else {"reason": "no_pose"},
            }
            images.append(item)
            print(f"{path.name}: {len(normalized)} pose(s), {json.dumps(item['diagnostics'].get('old_front_gate', {}))}", flush=True)
    output = {
        "schema_version": 1,
        "provenance": {
            "dataset": "IMG_dataset",
            "sdk": "mediapipe Python Tasks",
            "sdk_version": SDK_VERSION,
            "python": platform.python_version(),
            "delegate": "CPU",
            "running_mode": "VIDEO" if args.video_frames else "IMAGE",
            "repeated_still_frames": args.video_frames,
            "neutral_warmup": "GOOD.png" if args.video_frames else None,
            "num_poses": 2,
            "min_pose_detection_confidence": args.confidence,
            "min_pose_presence_confidence": args.confidence,
            "min_tracking_confidence": args.confidence,
            "model": args.model.name,
            "model_sha256": model_hash,
            "limitations": "Seven user-labeled tuning images, one GOOD reference. Native CPU inference on still images (including repeated-still VIDEO mode) is not browser GPU VIDEO accuracy or live tracking validation. Raw images are not embedded or uploaded.",
        },
        "images": images,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(images)} observations to {args.output}")


if __name__ == "__main__":
    main()
