"""Local MediaPipe Tasks inference. No frame publisher, recorder or web stream."""
from __future__ import annotations

import csv
import logging
import os
import time
from collections import deque
from pathlib import Path
from threading import Event

from .posture import Calibration, TemporalPosture, calibrate, classify, features


def run_vision(mqtt, stop: Event, *, preview: bool = False, recalibrate: bool = False, metrics_csv: str | None = None) -> None:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    model = os.getenv("POSE_MODEL", "raspberry_pi/models/pose_landmarker_lite.task")
    if not Path(model).is_file():
        raise FileNotFoundError(f"Missing {model}. Run python -m raspberry_pi.download_model first")
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=2,  # Reject ambiguous multi-person frames.
        min_pose_detection_confidence=0.6,
        min_pose_presence_confidence=0.6,
        min_tracking_confidence=0.6,
        output_segmentation_masks=False,
    )
    calibration_file = os.getenv("CALIBRATION_FILE", "raspberry_pi/calibration.json")
    baseline = Calibration.load(calibration_file) if Path(calibration_file).exists() and not recalibrate else None
    samples: list[dict] = []
    filter_ = TemporalPosture()
    frame_times: deque[float] = deque(maxlen=60)
    last_publish = 0.0
    last_timestamp_ms = -1
    period = 1.0 / max(0.1, float(os.getenv("VISION_PUBLISH_HZ", "5")))
    width, height = int(os.getenv("CAMERA_WIDTH", "640")), int(os.getenv("CAMERA_HEIGHT", "480"))
    camera = None
    metrics_file = None
    writer = None
    if metrics_csv:
        metrics_file = open(metrics_csv, "w", newline="", encoding="utf-8")
        writer = csv.DictWriter(metrics_file, fieldnames=["frame_timestamp", "predicted_posture", "inference_ms", "fps", "torso_angle", "shoulder_angle", "neck_offset", "head_height", "confidence"])
        writer.writeheader()

    def release_camera():
        nonlocal camera
        if camera is not None:
            try:
                if os.getenv("CAMERA_BACKEND", "opencv") == "picamera2":
                    camera.stop()
                    camera.close()
                else:
                    camera.release()
            finally:
                camera = None

    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            while not stop.is_set():
                try:
                    if camera is None:
                        if os.getenv("CAMERA_BACKEND", "opencv") == "picamera2":
                            from picamera2 import Picamera2
                            camera = Picamera2()
                            camera.configure(camera.create_video_configuration(main={"size": (width, height), "format": "RGB888"}))
                            camera.start()
                        else:
                            source = os.getenv("CAMERA_SOURCE", "0")
                            camera = cv2.VideoCapture(int(source) if source.isdigit() else source)
                            camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
                            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
                            camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                            if not camera.isOpened():
                                raise OSError("Camera could not be opened")
                    if os.getenv("CAMERA_BACKEND", "opencv") == "picamera2":
                        frame = camera.capture_array()
                    else:
                        success, frame = camera.read()
                        if not success:
                            raise OSError("Camera frame read failed")
                    # Picamera2 RGB888 stores B,G,R bytes for OpenCV convention.
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                except (OSError, RuntimeError) as error:
                    logging.warning("Camera unavailable; retrying: %s", error)
                    release_camera()
                    frame_times.clear()
                    filter_.update("UNKNOWN", time.monotonic())
                    mqtt.publish("focusguard/gateway/vision", {"vision_available": False, "person_detected": False, "posture": "UNKNOWN", "confidence": 0.0, "fps": 0.0})
                    stop.wait(2)
                    continue

                captured = time.monotonic()
                timestamp_ms = max(last_timestamp_ms + 1, int(captured * 1000))
                last_timestamp_ms = timestamp_ms
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                started = time.perf_counter()
                result = landmarker.detect_for_video(image, timestamp_ms)
                inference_ms = (time.perf_counter() - started) * 1000
                frame_times.append(captured)
                fps = (len(frame_times) - 1) / (frame_times[-1] - frame_times[0]) if len(frame_times) > 1 else 0.0
                people = len(result.pose_landmarks)
                feature = features(result.pose_landmarks[0], frame.shape[1], frame.shape[0]) if people == 1 else None
                label = "NO_PERSON" if people == 0 else "UNKNOWN"
                if feature:
                    if baseline is None:
                        samples.append(feature)
                        # A deliberate initial calibration: sit neutral and stay still.
                        if len(samples) >= 90:
                            baseline = calibrate(samples, os.getenv("CAMERA_VIEW", "side"))
                            baseline.save(calibration_file)
                            logging.info("Saved neutral calibration to %s", calibration_file)
                    if baseline is not None:
                        label = classify(feature, baseline)
                elif baseline is None:
                    samples.clear()  # Calibration needs consecutive reliable frames.
                posture = filter_.update(label, captured)
                if captured - last_publish >= period:
                    last_publish = captured
                    mqtt.publish("focusguard/gateway/vision", {
                        "vision_available": True,
                        "person_detected": people > 0,
                        "posture": posture,
                        "confidence": round(feature["confidence"], 4) if feature else 0.0,
                        "fps": round(fps, 2), "inference_ms": round(inference_ms, 2),
                        "calibrating": baseline is None, "ambiguous_people": people > 1,
                    })
                if writer:
                    writer.writerow({"frame_timestamp": captured, "predicted_posture": posture, "inference_ms": inference_ms, "fps": fps, **(feature or {})})
                    metrics_file.flush()
                if preview:
                    # Curated Tasks landmark connections; no legacy mp.solutions API.
                    # Draw only locally, after inference and metadata publication.
                    links = ((7, 11), (8, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
                             (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28))
                    color = (100, 220, 100) if posture == "GOOD" else (0, 180, 255)
                    for pose in result.pose_landmarks:
                        points = {index: (int(point.x * frame.shape[1]), int(point.y * frame.shape[0]))
                                  for index, point in enumerate(pose) if point.visibility >= 0.55}
                        for left, right in links:
                            if left in points and right in points:
                                cv2.line(frame, points[left], points[right], color, 2, cv2.LINE_AA)
                        for index in {vertex for link in links for vertex in link}:
                            if index in points:
                                cv2.circle(frame, points[index], 4, color, -1, cv2.LINE_AA)
                    cv2.putText(frame, f"{posture} | {fps:.1f} FPS | calibration {min(len(samples), 90)}/90", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 180), 2)
                    cv2.imshow("FocusGuard - local preview only", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        stop.set()
    finally:
        release_camera()
        if metrics_file:
            metrics_file.close()
        if preview:
            cv2.destroyAllWindows()

