"""Resolve the pinned local model; downloading is an explicit setup command only."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen


MODEL_SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = Path(__file__).resolve().parent / "models" / "pose_landmarker_lite.task"


def verify_model(path: Path) -> Path:
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Missing pose model: {path}. Run python -m backend.vision.model --download first.")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != MODEL_SHA256:
        raise ValueError(f"Pose model SHA256 mismatch: {path}; expected {MODEL_SHA256}.")
    return path


def ensure_model(path: str | Path | None = None, *, download: bool = False) -> Path:
    """Validate an explicit path or reuse an existing verified project model.

    Runtime callers never set download=True. The CLI is the deliberate network
    step; existing frontend/Pi assets can be reused without another download.
    """
    configured = path or os.getenv("POSE_MODEL")
    if configured:
        target = Path(configured).expanduser()
        if target.is_file() or not download:
            return verify_model(target)
    else:
        target = DEFAULT_MODEL
        for candidate in (target, ROOT / "raspberry_pi/models/pose_landmarker_lite.task",
                          ROOT / "frontend/public/vision/pose_landmarker_lite.task"):
            if candidate.is_file():
                return verify_model(candidate)
        if not download:
            return verify_model(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix="pose-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            with urlopen(MODEL_URL, timeout=60) as response:
                while block := response.read(1024 * 1024):
                    output.write(block)
        verify_model(temporary)
        temporary.replace(target)
        return verify_model(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Explicitly download the pinned model when missing.")
    parser.add_argument("--model", type=Path, help="Model path; overrides POSE_MODEL.")
    args = parser.parse_args()
    model = ensure_model(args.model, download=args.download)
    print(f"Verified local pose model: {model}\nSHA256 {MODEL_SHA256}")


if __name__ == "__main__":
    main()
