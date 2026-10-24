# Python camera and MediaPipe posture processing

MediaPipe landmark extraction, calibration, posture classification and temporal stabilization run in **Python on the backend machine**. Today that machine can be your PC; the same pipeline can run on a Raspberry Pi 5. The default **Python backend** input captures the camera attached to that machine. Optional **PC camera mode**, available in Demo workspace, captures the webcam of the computer opening the browser and transports its frames to Python.

The canonical classifier is `backend/vision/posture.py`. The standalone Pi gateway imports the same classifier rather than maintaining different posture rules. The frontend's `posture.ts` contains display types only. The browser's optional camera capture does not perform MediaPipe inference or classify posture; no browser SDK/WASM is needed.

## Install and start on the PC

From the project root in PowerShell:

```powershell
.\start.ps1 -Install -Vision
```

This provisions the normal application and optional Python vision dependencies. Subsequent starts can use ` .\start.ps1 -Vision`. A sensor-only simulator still works without the optional vision dependencies. To set up vision manually in an existing application environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-vision.txt
.\.venv\Scripts\python.exe -m backend.vision.model --download
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Linux, substitute `.venv/bin/python`. No camera opens during dependency installation or model verification. The first explicit model download needs network access; runtime inference uses a verified local model and never downloads one implicitly.

## Start and calibrate

1. Open <http://127.0.0.1:8000/#/overview> and find **Python camera · pose lab**. Choose the **Backend camera index**, normally Camera 0, and **Front** or **Side**. Close other applications that hold that camera. The camera must be attached to the backend PC or Pi.
2. Click **Start backend camera**. Python opens the device and loads MediaPipe. No browser camera permission is needed. The panel reports the actual CPU/GPU delegate, FPS and inference time received from Python.
3. In Front view, frame one person with the **head and both shoulders visible**. Hips may stay behind the desk. A Side view benefits from a visible shoulder and hip. Keep the camera fixed with even lighting.
4. Sit upright at your usual desk distance, look ahead and click **Calibrate upright posture**. Hold still until **Calibrated** appears. Python requires at least 30 reliable frames over an observation interval; short tracking interruptions need not discard all progress. Recalibrate after changing the view, camera position or normal seating position.
5. Try sustained lateral tilt, moving your upper body forward, lowering your head and reclining. **Python tracking diagnostics** shows the candidate, reason code, upper/full-body tracking, processed frame count and reliability. The backend terminal provides the same state transitions and performance details.
6. Optionally enable **Enable local debug preview** to see an MJPEG image with a skeleton drawn by Python. The preview is **off by default**. Without it, the dashboard receives labels and derived diagnostics without camera images or body landmark arrays. Mirror preview changes display orientation only.
7. Click **Stop camera** to release it. A capture started from this panel also stops when the page is hidden or left. A pre-existing headless Python pipeline is only observed and is not stopped merely by leaving this dashboard. Stopping does not silently replace observed vision with generated posture; in demo mode, use **Use simulated vision** explicitly.

In **Demo workspace**, the camera replaces vision only. Environment, ToF distance, seat/motion signals and outputs remain simulated. Simulated presence follows fresh reliable camera presence; this is not an independent physical sensor measurement. In **Real hardware**, Python camera metadata joins actual gateway sensors and missing sensor values remain unavailable. Switching mode stops the previous camera owner and clears its evidence.

## PC camera mode for tests and demos

1. In **Demo workspace**, enable **PC camera mode** in the camera panel. Python first releases its native camera, then the browser asks for webcam permission. Use the loopback URL above or an HTTPS deployment for browser camera access. No microphone is requested.
2. Allow camera permission, select Front/Side and calibrate upright. The video preview is local to the browser; the resulting pose labels, diagnostics and calibration progress come from Python. The browser sends JPEG frames at up to 640×480 and 10 FPS, with only one frame awaiting a Python response.
3. Disable **PC camera mode** or stop PC capture to release browser tracks and restore the previous backend camera profile. Camera index, view, debug preview and numeric calibration are preserved independently. A previously running/loading backend camera resumes; a previously idle backend selection stays idle. Browser calibration never overwrites the backend's persisted calibration file.
4. Permission denial, unplugging the browser webcam, hiding/leaving the panel, or losing its WebSocket also closes PC capture and restores the prior backend input. A connection that never attaches expires after 45 seconds; an attached idle connection expires after 10 seconds. Native model startup may take longer for the first result. If reopening the native camera fails, the panel reports its error and the terminal explains it; restart that camera explicitly.

Only one browser PC-camera lease can own the pipeline. A second tab cannot replace it or disable it with another token. A restored native pipeline is backend-managed and continues after navigation; subsequent browser cleanup does not stop it. Switching workspace, explicitly selecting simulation, or the global API Stop cancels the lease without restarting native capture behind the new selection. PC camera mode is disabled in Real hardware workspace; direct Python/Pi capture remains available there.

Camera input changes split sessions and clear posture timers so observations from different cameras are not combined. `inputMode` identifies the current transport; stored live-camera metadata includes `vision_input: python_backend|pc_camera` in addition to the existing `vision_source`. Turning PC mode off selects backend camera input, rather than generated posture.

## Labels and limits


For unattended restarts, set `CALIBRATION_FILE=backend/data/vision-calibration.json`
before starting the API, calibrate once through the dashboard and leave the camera
fixed. Python atomically saves numeric baseline geometry after calibration is
ready. With `VISION_AUTOSTART=true` in hardware mode, the service can restore that
validated baseline for the selected view. Missing, legacy or wrong-view files
log a warning and require calibration; the service never learns an arbitrary
startup posture automatically. Without `CALIBRATION_FILE`, calibration remains
in memory and no baseline file is written. Recalibrate after changing the person,
camera, zoom or seating position.

MediaPipe supplies landmarks, not FocusGuard labels. Python applies the existing calibrated geometry and confidence checks, including the upper-body improvements tuned with the supplied screenshots. Front view can use a reliable nose and both shoulders when the desk hides the hips. Additional face points help distinguish head pitch and roll, and reliable torso/world geometry supplies extra evidence when available.

| Label | Meaning |
|---|---|
| `GOOD` | Reliable geometry remains near the calibrated upright baseline. |
| `SLOUCH` | Calibrated head/neck collapse or rounded/reclined, chin-up posture consistent with the demo examples. |
| `LEAN_FORWARD` | Estimated approach relative to the baseline from size and head/shoulder changes or reliable torso geometry. |
| `LEAN_LEFT_RIGHT` | Lateral head/shoulder or torso tilt; left and right are grouped. |
| `NO_PERSON` | No person detected in a frame; distinct from unavailable camera input. |
| `UNKNOWN` | Calibration incomplete, required head/shoulders cropped or unreliable, multiple people, or unusable geometry. Cropped hips alone do not block Front upper-body tracking. |

Upper-body points require visibility at least 0.6, presence at least 0.5 and combined reliability `sqrt(visibility × presence)` at least 0.6. MediaPipe detection/presence/tracking thresholds are 0.5. The classifier uses the frame's aspect ratio, a personal neutral baseline and short temporal stabilization. Reliability is not a measured classification accuracy percentage.

Forward lean is relative geometry, not calibrated centimeters, absolute depth or spine curvature. Moving the camera/chair or changing zoom can resemble posture changes. One front camera cannot conclusively distinguish reclining from moving farther away. These labels do not identify a person, infer attention or diagnose health.

The seven screenshots in `IMG_dataset/` are tuning/regression examples from one person, not an independent accuracy benchmark. Replay their extracted landmarks through the Python classifier with:

```powershell
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture
```

The fixture is `evaluation/fixtures/pc-dataset.landmarks.json`; the default report is `evaluation/results/pc-dataset/report.json`. See [the tuning report](../evaluation/pc_dataset.md) and [evaluation protocol](../evaluation/README.md). The frozen-landmark fixture remains a 7/7 classifier regression. A separate native CPU pipeline probe on the seven screenshots matched 6/7: the extreme SLOUCH1 example remained UNKNOWN because its newly extracted head/shoulder evidence was unreliable/cropped. The accepted posture logic was preserved rather than retuned for that probe. Neither result is a live-webcam or independent-person accuracy benchmark. Passing replay tests does not establish live camera speed or accuracy on new people.

## Terminal debugging

The `focusguard.vision` logger reports startup, requested/actual delegate, camera backend/index, calibration, posture/candidate/reason changes, FPS, inference milliseconds, errors and resource release. INFO output includes periodic reports about every two seconds and rate-limited transitions; DEBUG adds numerical geometry without frames or landmark arrays.

```powershell
$env:FOCUSGUARD_LOG_LEVEL = 'DEBUG'
.\start.ps1 -Vision
```

Return to `INFO` for normal use. Check the terminal when the panel reports a camera, missing dependency, model, or GPU initialization failure. An unavailable GPU falls back to CPU and reports that actual delegate; a GPU-equipped machine alone is not proof that the MediaPipe build uses it.

## Raspberry Pi 5 deployment

Raspberry Pi 5 has a VideoCore VII GPU, but MediaPipe delegate availability depends on its package build and graphics stack. CPU is the standard default. Set `VISION_DELEGATE=gpu` or `auto` to attempt GPU initialization with a logged CPU fallback; inspect the reported actual delegate and measure on the target Pi. See [Pi 5 specifications](https://www.raspberrypi.com/products/raspberry-pi-5/) and [MediaPipe's Python Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python).

Use the project-supported 64-bit Raspberry Pi OS / Python 3.11 environment and platform dependency pins. USB cameras use `CAMERA_BACKEND=opencv`; CSI cameras use `CAMERA_BACKEND=picamera2` with the OS-provided Picamera2/libcamera stack. The general Python setup supports Raspberry Pi OS 64-bit; package/wheel compatibility still needs the target environment. See [MediaPipe Python setup](https://developers.google.com/edge/mediapipe/solutions/setup_python) and [HARDWARE.md](HARDWARE.md) for installation and GPIO deployment.

For headless direct-backend capture, configure `FOCUSGUARD_MODE=hardware`, `VISION_AUTOSTART=true`, `CAMERA_INDEX=0` and `CAMERA_VIEW=front` before starting the API. Autostart is ignored in demo mode. This avoids requiring an open dashboard to keep camera processing running. Use one camera owner: do not run the standalone Pi gateway camera and direct-backend camera against the same device simultaneously.

## Model and privacy

`python -m backend.vision.model --download` validates/reuses a project model or explicitly downloads the [official version-1 lite pose bundle](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task). The SHA256 is `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. Existing verified Pi/model files can be reused. `POSE_MODEL` selects another local path, which must match the pinned artifact. A mismatch fails rather than silently substituting a model.

Raw frames and landmarks exist in memory for inference; the normal status JSON contains `landmarks: []` and derived geometry/labels only. **PC camera mode sends browser JPEG frames to the configured local Python backend**, including over the local network when the browser and backend are on different machines. Its dedicated same-origin, token-bound WebSocket accepts complete JPEGs only, capped at 512 KiB and 1280×960 before native decoding. Frames are not saved, logged or forwarded to cloud AI. Keep the backend on your local machine/trusted local deployment. The explicitly enabled backend MJPEG preview transmits images in the opposite direction without saving them. Stop or disable preview to end that stream. SQLite, Influx, CSV and optional Bedrock summaries contain derived/aggregate metadata, never image recordings, audio or landmark arrays. No microphone is opened. This project does not add analytics; Google's [MediaPipe Tasks privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice) describes SDK metrics and on-device inputs. Review SDK behavior when upgrading.

MediaPipe and the BlazePose GHUM model are Apache-2.0; see the [official model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) for the model family and limitations.

## Troubleshooting

| Symptom | Action |
|---|---|
| Camera cannot open / device busy | Check backend camera index, connect the camera to the backend machine, close other camera applications, and check OS camera privacy permissions for Python/desktop apps. |
| Browser is on another PC | Default controls operate the backend machine's camera. Enable PC camera mode in Demo workspace to use the browser computer's webcam; camera access requires a secure browser context. |
| PC camera permission denied / connection lost | Allow browser camera permission and check the API connection. The previous backend profile is restored automatically; verify its status/terminal before retrying. |
| Missing `mediapipe`, `cv2` or model | Install `backend/requirements-vision.txt`, run the explicit model setup command, then restart camera processing. The simulator remains usable without these extras. |
| GPU initialization fails | Read the fallback reason in the terminal. Use CPU for compatibility and benchmark the target Pi separately. |
| UNKNOWN / calibration never completes | Keep the head and both shoulders visible in Front view, improve lighting and hold still while calibrating. Check reason/candidate and reliable-frame progress. |
| Panel detects a label but desk posture is UNKNOWN | Check engine confidence threshold, source/mode, staleness and API connection. Reliability must meet configured settings. |
| Preview is blank | Start the Python camera, enable the local debug preview, and check the terminal. Preview is unavailable by default and does not control inference. |
| Camera stopped after changing tabs | A camera started by this panel intentionally stops when hidden. Return and start it again, or use hardware-only headless autostart for continuous deployment. |
