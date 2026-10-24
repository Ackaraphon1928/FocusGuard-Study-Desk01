"""Bounded, in-memory JPEG input for the browser camera transport.

Header checks run before OpenCV's native decoder. No frame is written to disk,
and browser-supplied labels, landmarks or timestamps are never accepted here.
"""
from __future__ import annotations

from io import BytesIO
import warnings


MAX_JPEG_BYTES = 512 * 1024
MAX_WIDTH = 1280
MAX_HEIGHT = 960
MAX_PIXELS = MAX_WIDTH * MAX_HEIGHT


def validate_jpeg(data: bytes) -> tuple[int, int]:
    """Return JPEG header dimensions without decoding a raster."""
    if not isinstance(data, bytes):
        raise ValueError("A binary JPEG frame is required.")
    if not 4 <= len(data) <= MAX_JPEG_BYTES:
        raise ValueError(f"JPEG frames must be at most {MAX_JPEG_BYTES} bytes.")
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ValueError("Only complete JPEG camera frames are accepted.")
    from PIL import Image, UnidentifiedImageError
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != "JPEG":
                    raise ValueError("Only JPEG camera frames are accepted.")
                width, height = image.size
                if (width <= 0 or height <= 0 or width > MAX_WIDTH or height > MAX_HEIGHT
                        or width * height > MAX_PIXELS):
                    raise ValueError(f"Camera frames must fit within {MAX_WIDTH}x{MAX_HEIGHT} pixels.")
                image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise ValueError("The camera frame is not a valid JPEG.") from error
    return width, height


def decode_jpeg(data: bytes, dimensions: tuple[int, int]):
    """Decode an already checked frame to the canonical OpenCV BGR array."""
    import cv2
    import numpy as np
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if frame is None or frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("The camera JPEG could not be decoded.")
    height, width = frame.shape[:2]
    if (width, height) != dimensions or width > MAX_WIDTH or height > MAX_HEIGHT or width * height > MAX_PIXELS:
        raise ValueError("Decoded camera frame dimensions differ from the bounded JPEG header.")
    return frame
