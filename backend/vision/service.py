"""One local camera/inference owner. Frames stay in memory on this machine."""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
import logging
import math
import os
from queue import Empty, SimpleQueue
from threading import Event, RLock, Thread, current_thread
import time
from typing import Callable, Any

from .model import ensure_model
from .calibration import load_calibration, save_calibration
from .posture import PostureClassifier


logger = logging.getLogger("focusguard.vision")
_CONNECTIONS = ((0, 7), (0, 8), (7, 11), (8, 12), (11, 12), (11, 13),
                (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
                (23, 25), (25, 27), (24, 26), (26, 28))


def unavailable_metadata() -> dict:
    return {"person_detected": False, "posture": "UNKNOWN", "confidence": 0.0,
            "fps": 0.0, "vision_available": False, "inference_ms": 0.0, "ambiguous_people": False}


def _bounded(value: Any, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(maximum, number)) if math.isfinite(number) else 0.0


def observation_metadata(observation: dict) -> dict:
    result = observation["result"]
    reliable = (result["calibration"]["status"] == "ready" and observation["people"] == 1
                and result["posture"] not in ("UNKNOWN", "NO_PERSON"))
    return {"person_detected": bool(result["personDetected"]), "posture": result["posture"],
            "confidence": _bounded(result["confidence"], 1) if reliable else 0.0,
            "fps": _bounded(observation["fps"], 240), "vision_available": True,
            "inference_ms": _bounded(observation["inferenceMs"], 60000),
            "ambiguous_people": observation["people"] > 1}


class _OpenCVCamera:
    def __init__(self, index: int):
        import cv2
        self.capture = cv2.VideoCapture(index)
        try:
            self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, int(os.getenv("CAMERA_WIDTH", "640")))
            self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, int(os.getenv("CAMERA_HEIGHT", "480")))
            self.capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not self.capture.isOpened():
                raise OSError(f"Camera {index} could not be opened. Check the index, OS permission and other apps using it.")
        except BaseException:
            self.capture.release()
            raise

    def read(self):
        return self.capture.read()

    def release(self):
        self.capture.release()


class _PiCamera:
    def __init__(self, index: int):
        from picamera2 import Picamera2
        self.capture = Picamera2(index)
        try:
            self.capture.configure(self.capture.create_video_configuration(main={
                "size": (int(os.getenv("CAMERA_WIDTH", "640")), int(os.getenv("CAMERA_HEIGHT", "480"))),
                "format": "RGB888",  # Picamera2 RGB888 produces OpenCV-compatible BGR bytes.
            }))
            self.capture.start()
        except BaseException:
            self.capture.close()
            raise

    def read(self):
        return True, self.capture.capture_array()

    def release(self):
        try:
            self.capture.stop()
        finally:
            self.capture.close()


def _camera_factory(index: int, backend: str):
    if backend == "opencv":
        return _OpenCVCamera(index)
    if backend == "picamera2":
        return _PiCamera(index)
    raise ValueError("CAMERA_BACKEND must be opencv or picamera2.")


class _MediaPipeInference:
    def __init__(self, model_path, delegate: str):
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        self.mp = mp
        self.delegate = delegate
        options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(model_path),
                                            delegate=getattr(python.BaseOptions.Delegate, delegate)),
            running_mode=vision.RunningMode.VIDEO, num_poses=2,
            min_pose_detection_confidence=.5, min_pose_presence_confidence=.5,
            min_tracking_confidence=.5, output_segmentation_masks=False)
        self.landmarker = vision.PoseLandmarker.create_from_options(options)

    def detect(self, frame, timestamp_ms: int) -> dict:
        import cv2
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        pose = self.landmarker.detect_for_video(image, timestamp_ms)
        def points(poses):
            return [[{name: float(getattr(point, name)) for name in ("x", "y", "z", "visibility", "presence")
                      if getattr(point, name, None) is not None} for point in person] for person in poses]
        return {"landmarks": points(pose.pose_landmarks), "worldLandmarks": points(pose.pose_world_landmarks)}

    def close(self):
        self.landmarker.close()


def _render_preview(frame, landmarks: list, posture: str, fps: float) -> bytes:
    import cv2
    rendered = frame.copy()
    height, width = rendered.shape[:2]
    color = (100, 220, 100) if posture == "GOOD" else (0, 180, 255)
    for pose in landmarks:
        points = {index: (round(point["x"] * width), round(point["y"] * height))
                  for index, point in enumerate(pose) if min(point.get("visibility", 0), point.get("presence", 1)) >= .5
                  and 0 <= point["x"] <= 1 and 0 <= point["y"] <= 1}
        for left, right in _CONNECTIONS:
            if left in points and right in points:
                cv2.line(rendered, points[left], points[right], color, 2, cv2.LINE_AA)
        for index in {vertex for link in _CONNECTIONS for vertex in link}:
            if index in points:
                cv2.circle(rendered, points[index], 3, color, -1, cv2.LINE_AA)
    cv2.putText(rendered, f"{posture} | {fps:.1f} FPS", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, .65, color, 2)
    success, jpeg = cv2.imencode(".jpg", rendered, [cv2.IMWRITE_JPEG_QUALITY, 75])
    if not success:
        raise RuntimeError("Could not encode camera preview.")
    return jpeg.tobytes()


class LocalVisionService:
    """Thread-safe controls; camera, inference and classifier remain on one thread.

    Dependency factories are lazy and injectable. Constructing this object opens
    no camera, imports no native CV dependencies, and downloads nothing.
    """
    def __init__(self, on_metadata: Callable[[dict], None], on_unavailable: Callable[[], None] | None = None,
                 *, camera_factory=None, inference_factory=None):
        self._on_metadata = on_metadata
        self._on_unavailable = on_unavailable
        self._camera_factory = camera_factory or _camera_factory
        self._inference_factory = inference_factory or _MediaPipeInference
        self._lock = RLock()
        self._stop = Event()
        self._commands: SimpleQueue = SimpleQueue()
        self._generation = 0
        self._thread: Thread | None = None
        self._preview = False
        self._jpeg: bytes | None = None
        self._state = {"status": "idle", "error": None, "message": "Start the backend camera to begin local processing.",
                       "delegate": None, "cameraIndex": 0, "view": "front", "observation": None,
                       "fps": 0.0, "inferenceMs": 0.0, "frames": 0, "updatedAt": None,
                       "previewEnabled": False}

    def snapshot(self) -> dict:
        with self._lock:
            return deepcopy(self._state)

    def _update(self, **changes):
        with self._lock:
            self._state.update(changes)

    def start(self, camera_index: int = 0, view: str = "front") -> dict:
        if isinstance(camera_index, bool) or not isinstance(camera_index, int) or not 0 <= camera_index <= 16:
            raise ValueError("camera_index must be an integer between 0 and 16.")
        if view not in ("front", "side"):
            raise ValueError("view must be front or side.")
        backend = os.getenv("CAMERA_BACKEND", "opencv").lower()
        delegate = os.getenv("VISION_DELEGATE", "cpu").lower()
        if backend not in ("opencv", "picamera2"):
            raise ValueError("CAMERA_BACKEND must be opencv or picamera2.")
        if delegate not in ("cpu", "gpu", "auto"):
            raise ValueError("VISION_DELEGATE must be cpu, gpu or auto.")
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                if self._state["status"] in ("loading", "running") and camera_index == self._state["cameraIndex"] and view == self._state["view"]:
                    return deepcopy(self._state)
                raise RuntimeError("The previous camera worker is still active. Stop it before changing its configuration.")
            self._stop = Event()
            self._commands = SimpleQueue()
            self._generation = 0
            self._jpeg = None
            self._state.update(status="loading", error=None, message="Opening the camera and loading the local pose model.",
                               delegate=None, cameraIndex=camera_index, view=view, observation=None,
                               fps=0.0, inferenceMs=0.0, frames=0, updatedAt=None)
            self._thread = Thread(target=self._run, args=(camera_index, view, backend, delegate), name="focusguard-vision", daemon=True)
            self._thread.start()
            return deepcopy(self._state)

    def stop(self) -> dict:
        with self._lock:
            worker = self._thread
            self._stop.set()
            self._jpeg = None
        if worker is not None and worker is not current_thread():
            worker.join(timeout=3)
        with self._lock:
            if worker is not None and worker.is_alive():
                self._state.update(status="error", error="Camera worker is still stopping; a second camera will not be opened.",
                                   message="Waiting for the camera driver to return.", observation=None, fps=0.0)
            elif self._state["status"] != "error":
                self._state.update(status="stopped", message="Camera stopped. No simulated vision was selected.", observation=None, fps=0.0)
            return deepcopy(self._state)

    def close(self):
        return self.stop()

    def calibrate(self) -> dict:
        with self._lock:
            if self._state["status"] != "running":
                raise RuntimeError("Start the camera before calibration.")
            self._commands.put(("calibrate", None))
            self._generation += 1
            self._state.update(observation=None, message="Hold a neutral upright posture while calibration collects samples.")
            return deepcopy(self._state)

    def set_view(self, view: str) -> dict:
        if view not in ("front", "side"):
            raise ValueError("view must be front or side.")
        with self._lock:
            if self._state["view"] != view:
                self._commands.put(("view", view))
                self._generation += 1
                self._state.update(view=view, observation=None, message="Camera view changed; calibrate again in a neutral posture.")
            return deepcopy(self._state)

    def set_preview(self, enabled: bool):
        with self._lock:
            self._preview = bool(enabled)
            self._state["previewEnabled"] = self._preview
            if not enabled:
                self._jpeg = None
            return deepcopy(self._state)

    def preview_jpeg(self) -> bytes | None:
        with self._lock:
            return self._jpeg if self._preview else None

    def _notify_unavailable(self):
        try:
            if self._on_unavailable is not None:
                self._on_unavailable()
            else:
                self._on_metadata(unavailable_metadata())
        except Exception:
            logger.exception("Could not publish unavailable camera metadata")

    def _run(self, index: int, view: str, backend: str, requested_delegate: str):
        camera = inference = None
        failed = False
        try:
            model = ensure_model()
            if self._stop.is_set():
                return
            # CPU is explicit/default. Native GPU availability depends on the
            # installed Tasks build and graphics driver, including on Pi 5.
            delegate = "CPU" if requested_delegate == "cpu" else "GPU"
            fallback_reason = ""
            try:
                inference = self._inference_factory(model, delegate)
            except Exception as error:
                if delegate != "GPU":
                    raise
                fallback_reason = f"GPU initialization unavailable ({type(error).__name__}: {error}); using CPU."
                logger.warning("%s", fallback_reason)
                delegate = "CPU"
                inference = self._inference_factory(model, delegate)
            if self._stop.is_set():
                return
            camera = self._camera_factory(index, backend)
            if self._stop.is_set():
                return
            classifier = PostureClassifier(view=view)
            calibration_file = os.getenv("CALIBRATION_FILE", "").strip()
            previous_calibration_status = "needed"
            if calibration_file:
                try:
                    load_calibration(classifier, calibration_file)
                    previous_calibration_status = "ready"
                    logger.info("Calibration restored view=%s path=%s; keep the camera/person setup unchanged", view, calibration_file)
                except (OSError, ValueError, TypeError, KeyError) as error:
                    logger.warning("Calibration not restored view=%s path=%s detail=%s; explicit upright calibration is required", view, calibration_file, error)
            times: deque[float] = deque(maxlen=60)
            timestamp = -1
            last_publish = last_log = 0.0
            previous_transition = None
            calibration_message = ("Saved upright calibration restored for this view." if previous_calibration_status == "ready"
                                   else "Calibrate while sitting upright.")
            self._update(status="running", delegate=delegate,
                         message=" ".join(filter(None, (fallback_reason, f"Local Python camera processing on {delegate}.", calibration_message))))
            logger.info("Camera started index=%s backend=%s requested_delegate=%s actual_delegate=%s view=%s", index, backend, requested_delegate, delegate, view)
            while not self._stop.is_set():
                with self._lock:
                    commands = []
                    while True:
                        try:
                            commands.append(self._commands.get_nowait())
                        except Empty:
                            break
                    generation = self._generation
                for command, value in commands:
                    if command == "calibrate":
                        classifier.start_calibration()
                        previous_calibration_status = "collecting"
                        logger.info("Calibration requested view=%s", self.snapshot()["view"])
                    elif command == "view":
                        classifier.set_view(value)
                        previous_calibration_status = "needed"
                        logger.info("Camera view changed view=%s; calibration reset", value)
                    self._notify_unavailable()
                success, frame = camera.read()
                if not success or frame is None:
                    raise OSError("Camera frame read failed or the camera was disconnected. Stop other camera apps and restart the camera.")
                if self._stop.is_set():
                    break
                captured = time.monotonic()
                timestamp = max(timestamp + 1, int(captured * 1000))
                started = time.perf_counter()
                pose = inference.detect(frame, timestamp)
                elapsed = (time.perf_counter() - started) * 1000
                if self._stop.is_set():
                    break
                # A calibration/view command may arrive during native inference.
                # Discard that old observation before processing the queued control.
                with self._lock:
                    if generation != self._generation:
                        continue
                height, width = frame.shape[:2]
                result = classifier.update({"landmarks": pose["landmarks"], "worldLandmarks": pose.get("worldLandmarks", []),
                                            "timestampMs": timestamp, "width": width, "height": height})
                times.append(captured)
                while len(times) > 1 and captured - times[0] > 3:
                    times.popleft()
                fps = (len(times) - 1) / (times[-1] - times[0]) if len(times) > 1 and times[-1] > times[0] else 0.0
                observation = {"type": "result", "result": result, "landmarks": [], "people": len(pose["landmarks"]),
                               "fps": round(fps, 2), "inferenceMs": round(elapsed, 2), "width": width, "height": height}
                with self._lock:
                    self._state.update(observation=observation, fps=observation["fps"], inferenceMs=observation["inferenceMs"],
                                       frames=self._state["frames"] + 1, updatedAt=datetime.now(timezone.utc).isoformat())
                    preview = self._preview
                if preview:
                    jpeg = _render_preview(frame, pose["landmarks"], result["posture"], fps)
                    with self._lock:
                        if self._preview and not self._stop.is_set():
                            self._jpeg = jpeg
                if captured - last_publish >= .2:
                    self._on_metadata(observation_metadata(observation))
                    last_publish = captured
                calibration = result["calibration"]
                if calibration_file and calibration["status"] == "ready" and previous_calibration_status != "ready":
                    try:
                        save_calibration(classifier, calibration_file)
                        logger.info("Calibration saved view=%s path=%s; numeric neutral geometry only", self.snapshot()["view"], calibration_file)
                    except (OSError, ValueError, TypeError, KeyError) as error:
                        logger.warning("Calibration could not be saved path=%s detail=%s; the in-memory baseline remains active", calibration_file, error)
                previous_calibration_status = calibration["status"]
                geometry = result.get("geometry") or {}
                transition = (result["posture"], result["candidate"], result["reason"], calibration["status"], geometry.get("trackingMode"))
                if (transition != previous_transition and captured - last_log >= .5) or captured - last_log >= 2:
                    logger.info("Pose posture=%s candidate=%s reason=%s confidence=%.3f calibration=%s:%s/%s mode=%s fps=%.1f inference_ms=%.1f",
                                result["posture"], result["candidate"], result["reason"], result["confidence"],
                                calibration["status"], calibration["frames"], calibration["required"], geometry.get("trackingMode", "none"), fps, elapsed)
                    previous_transition, last_log = transition, captured
                logger.debug("Pose geometry=%s", geometry)
        except Exception as error:
            failed = True
            self._update(status="error", error=str(error), message="Local camera processing failed. Check the terminal, then restart the camera.", observation=None, fps=0.0)
            logger.exception("Local camera processing failed")
        finally:
            for resource in (camera, inference):
                if resource is not None:
                    try:
                        (resource.release if resource is camera else resource.close)()
                    except Exception:
                        logger.exception("Could not release local vision resource")
            with self._lock:
                self._jpeg = None
                if not failed and self._state["status"] != "error":
                    self._state.update(status="stopped", message="Camera stopped. No simulated vision was selected.", observation=None, fps=0.0)
            self._notify_unavailable()
            logger.info("Camera stopped index=%s failed=%s", index, failed)
