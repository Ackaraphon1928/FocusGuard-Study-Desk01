"""Fetch the versioned official model once; runtime needs no model download."""
from __future__ import annotations

import argparse
import hashlib
import io
import zipfile
from pathlib import Path
from urllib.request import urlopen

URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="raspberry_pi/models/pose_landmarker_lite.task")
    parser.add_argument("--sha256", default=SHA256, help="Expected SHA256; defaults to the reviewed version-1 lite model")
    args = parser.parse_args()
    path = Path(args.output)
    if path.exists():
        data = path.read_bytes()
    else:
        with urlopen(URL, timeout=60) as response:
            data = response.read(20_000_000)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) < 1_000_000 or not zipfile.is_zipfile(io.BytesIO(data)):
        raise SystemExit("Unexpected model artifact; refusing to write")
    if args.sha256 and digest != args.sha256.lower():
        raise SystemExit("SHA256 mismatch; refusing to write")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(data)
    print(f"Model: {path}\nSource: {URL}\nSHA256: {digest}")


if __name__ == "__main__":
    main()
