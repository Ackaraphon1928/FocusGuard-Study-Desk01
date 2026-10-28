"""Pi-local MediaPipe inference using the same Python rules as the PC backend.

Only derived metadata goes to MQTT. Optional preview is on the Pi display;
no publisher, recorder or web stream is created for camera frames.
"""
from __future__ import annotations

from collections import deque
import csv
import json
import logging
import os
from pathlib import Path
from threading import Event
import time

from backend.vision.posture import PostureClassifier
from backend.vision.subject import subject_ambiguous

LOGGER = logging.getLogger("focusguard.vision.pi")


def landmark_dict(point):
    """Adapt MediaPipe 0.10.18/0.10.32 objects to the shared dictionary protocol."""
    return {field: float(getattr(point, field)) for field in ("x", "y", "z", "visibility", "presence")
            if getattr(point, field, None) is not None}


def _load_classifier(filename, view, recalibrate):
    classifier = PostureClassifier(view=view)
    if not recalibrate and Path(filename).is_file():
        try:
            classifier.load_calibration(json.loads(Path(filename).read_text(encoding="utf-8")))
            LOGGER.info("camera=pi event=calibration_restored view=%s path=%s", view, filename)
            return classifier
        except (ValueError, TypeError, KeyError, OSError) as error:
            LOGGER.warning("camera=pi event=calibration_invalid detail=%s; collecting a fresh upright baseline", error)
    classifier.start_calibration()
    LOGGER.info("camera=pi event=calibration_started view=%s required=%d interval_ms=1200; sit upright and keep still",
                view, classifier.required_frames)
    return classifier


def _save_calibration(classifier, filename):
    target = Path(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(classifier.export_calibration(), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(target)


def run_vision(mqtt, stop: Event, *, preview=False, recalibrate=False, metrics_csv=None):
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    model = os.getenv("POSE_MODEL", "raspberry_pi/models/pose_landmarker_lite.task")
    if not Path(model).is_file():
        raise FileNotFoundError(f"Missing {model}. Run python -m raspberry_pi.download_model first")
    # The supported ARM Python runtime uses CPU. VideoCore hardware does not
    # imply a supported MediaPipe Python GPU delegate.
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=model, delegate=python.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO, num_poses=2,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5, output_segmentation_masks=False,
    )
    view = os.getenv("CAMERA_VIEW", "front")
    calibration_file = os.getenv("CALIBRATION_FILE", "raspberry_pi/calibration.json")
    classifier = _load_classifier(calibration_file, view, recalibrate)
    baseline_saved = classifier.calibration_status == "ready"
    frame_times = deque(maxlen=60)
    last_publish = last_log = 0.0
    last_log_state = None
    last_timestamp = -1
    period = 1 / max(0.1, float(os.getenv("VISION_PUBLISH_HZ", "5")))
    log_period = max(0.2, float(os.getenv("VISION_LOG_INTERVAL_SECONDS", "2")))
    width, height = int(os.getenv("CAMERA_WIDTH", "640")), int(os.getenv("CAMERA_HEIGHT", "480"))
    camera = metrics_file = writer = None
    if metrics_csv:
        metrics_file = open(metrics_csv, "w", newline="", encoding="utf-8")
        writer = csv.DictWriter(metrics_file, fieldnames=["frame_timestamp", "predicted_posture", "inference_ms", "fps",
                                                         "torso_angle", "shoulder_angle", "neck_offset", "head_height", "confidence"])
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

    def unavailable():
        mqtt.publish("focusguard/gateway/vision", {"vision_available": False, "person_detected": False,
                                                   "posture": "UNKNOWN", "confidence": 0.0, "fps": 0.0})

    LOGGER.info("camera=pi event=starting delegate=CPU view=%s backend=%s resolution=%dx%d classifier=backend.vision.posture",
                view, os.getenv("CAMERA_BACKEND", "opencv"), width, height)
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
                    # Picamera2 RGB888 exposes B,G,R bytes in OpenCV convention.
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                except (OSError, RuntimeError) as error:
                    LOGGER.warning("camera=pi event=unavailable reason=%s retry_seconds=2", error)
                    release_camera()
                    frame_times.clear()
                    classifier.temporal.reset()
                    unavailable()
                    stop.wait(2)
                    continue

                captured = time.monotonic()
                timestamp = max(last_timestamp + 1, int(captured * 1000))
                last_timestamp = timestamp
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                started = time.perf_counter()
                detected = landmarker.detect_for_video(image, timestamp)
                inference_ms = (time.perf_counter() - started) * 1000
                frame_times.append(captured)
                fps = (len(frame_times) - 1) / (frame_times[-1] - frame_times[0]) if len(frame_times) > 1 else 0.0
                people = len(detected.pose_landmarks)
                result = classifier.update({
                    "landmarks": [[landmark_dict(p) for p in points] for points in detected.pose_landmarks],
                    "worldLandmarks": [[landmark_dict(p) for p in points] for points in detected.pose_world_landmarks],
                    "timestampMs": timestamp, "width": frame.shape[1], "height": frame.shape[0],
                })
                calibration = result["calibration"]
                if calibration["status"] == "ready" and not baseline_saved:
                    try:
                        _save_calibration(classifier, calibration_file)
                        baseline_saved = True
                        LOGGER.info("camera=pi event=calibration_saved view=%s path=%s", view, calibration_file)
                    except OSError as error:
                        if captured - last_log >= log_period:
                            LOGGER.warning("camera=pi event=calibration_save_failed reason=%s", error)
                posture, geometry = result["posture"], result["geometry"] or {}
                subject = result.get("subject", {})
                if captured - last_publish >= period:
                    last_publish = captured
                    mqtt.publish("focusguard/gateway/vision", {
                        "vision_available": True, "person_detected": result["personDetected"],
                        "posture": posture, "confidence": round(result["confidence"], 4),
                        "fps": round(fps, 2), "inference_ms": round(inference_ms, 2),
                        "calibrating": calibration["status"] != "ready", "ambiguous_people": subject_ambiguous(result, people),
                    })
                log_state = (posture, result["candidate"], result["reason"], calibration["status"], subject.get("reason"))
                if log_state != last_log_state or captured - last_log >= log_period:
                    last_log, last_log_state = captured, log_state
                    LOGGER.info("camera=pi posture=%s candidate=%s reason=%s people=%d confidence=%.3f fps=%.1f inference_ms=%.1f calibration=%s:%d/%d tracking=%s subject=%s selection=%s",
                                posture, result["candidate"], result["reason"], people, result["confidence"], fps, inference_ms,
                                calibration["status"], calibration["frames"], calibration["required"], geometry.get("trackingMode", "unavailable"), subject.get("index"), subject.get("reason", "unavailable"))
                LOGGER.debug("camera=pi geometry=%s", geometry)
                if writer:
                    writer.writerow({"frame_timestamp": captured, "predicted_posture": posture, "inference_ms": inference_ms,
                                     "fps": fps, "torso_angle": geometry.get("torsoAngleDeg"), "shoulder_angle": geometry.get("shoulderAngleDeg"),
                                     "neck_offset": geometry.get("headOffsetRatio"), "head_height": geometry.get("headHeightRatio"),
                                     "confidence": result["confidence"]})
                    metrics_file.flush()
                if preview:
                    links = ((7, 11), (8, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
                             (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28))
                    color = (100, 220, 100) if posture == "GOOD" else (0, 180, 255)
                    preview_poses = ([detected.pose_landmarks[subject["index"]]] if subject.get("index") is not None else detected.pose_landmarks)
                    for points in preview_poses:
                        visible = {i: (int(p.x * frame.shape[1]), int(p.y * frame.shape[0]))
                                   for i, p in enumerate(points) if p.visibility >= 0.55 and 0 <= p.x <= 1 and 0 <= p.y <= 1}
                        for left, right in links:
                            if left in visible and right in visible:
                                cv2.line(frame, visible[left], visible[right], color, 2, cv2.LINE_AA)
                        for i in {vertex for link in links for vertex in link}:
                            if i in visible:
                                cv2.circle(frame, visible[i], 4, color, -1, cv2.LINE_AA)
                    text = f"{posture} | {fps:.1f} FPS | {calibration['status']} {calibration['frames']}/{calibration['required']}"
                    cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 180), 2)
                    cv2.imshow("FocusGuard - local preview only", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        stop.set()
    finally:
        release_camera()
        unavailable()
        if metrics_file:
            metrics_file.close()
        if preview:
            cv2.destroyAllWindows()
        LOGGER.info("camera=pi event=stopped")
