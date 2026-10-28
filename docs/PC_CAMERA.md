# Python camera and MediaPipe posture processing

MediaPipe landmark extraction, calibration, posture classification and temporal stabilization run in **Python on the backend machine**. Today that machine can be your PC; the same pipeline can run on a Raspberry Pi 5. The default **Python backend** input captures the camera attached to that machine. Optional **PC camera mode**, available in Demo workspace, captures the webcam of the computer opening the browser and transports its frames to Python.

The canonical classifier is `backend/vision/posture.py`. The standalone Pi gateway imports the same classifier rather than maintaining different posture rules. The frontend's `posture.ts` contains display types only. The browser's optional camera capture does not perform MediaPipe inference or classify posture; no browser SDK/WASM is needed.

**After the edge-case logic update, recalibrate upright once for each camera/person.** Previously saved v1 profiles remain readable, but profiles created before this update lack the new camera-relative levels and upper-body Z reference. These features become active after fresh calibration. Keep camera angle and chair height fixed.

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

MediaPipe supplies landmarks, not FocusGuard labels. Python combines personal upright calibration, reliable image geometry and optional 3D evidence. Front view can use a reliable nose and both shoulders when the desk hides the hips. Additional face points help distinguish head pitch and roll. SLOUCH can also be a lowered/reclined upper body whose face still looks upright.

The new `headLevelRatio` and `shoulderLevelRatio` measure vertical position relative to the image centre, divided by apparent shoulder width. Their changes from baseline catch that whole-body lowering. Uniform near/far projection about the image centre cancels in these ratios; image size alone does not imply poor posture. The image centre approximates the camera principal point. Changing camera angle, crop, chair height or the person's seating setup requires recalibration: one camera cannot conclusively separate those changes from body lowering.

Upper-body Z no longer requires visible hips. `neckDepthRatio` is shoulder-midpoint Z minus nose Z, divided by 3D shoulder span; `neckInclinationDeg` uses the relative Z/Y neck vector. Reliable world XYZ is preferred; normalized XYZ is a fallback with aspect-corrected Y. Source is recorded as `world|normalized`; different sources are never compared as one baseline. These are estimated relative geometry, not camera distance in metres. [MediaPipe's coordinate definitions](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python#handle_and_display_results) place both coordinate origins at the hips. Z changes had mixed signs in the supplied SLOUCH samples, so Z corroborates 2D evidence rather than acting as a standalone threshold. Forward lean retains approach/torso evidence and can use a large world neck-inclination change with raised shoulder level when apparent size changes with camera distance.

With background people, Python selects a desk subject only when its reliable head/shoulders clearly dominate (at least 1.5× the next valid shoulder span), or all other detections are small/cropped fragments. Similar-size competitors or a large in-frame person with unreliable core points stay `UNKNOWN`. This blocks handoff to a smaller background pose while the unreliable foreground body is still detected. Status keeps the raw detected-person count and a derived `subject` selection diagnostic. This is geometric foreground selection, not identity tracking: it cannot guarantee the same person if detections disappear or people exchange positions. Recalibrate for a different user.

For a pronounced head bow with unusable shoulders, a separate **Head only** fallback can report SLOUCH after personal calibration. It requires all seven nose/ear/eye/mouth points in frame with visibility and presence at least 0.75, plausible face shape, modest roll change and corroborating increases in nose/ear, eye/ear and mouth pitch. Measurements are projected relative to the ear line to remove in-plane roll. Normal body geometry takes precedence; the fallback never reports GOOD or LEAN_FORWARD or estimates a hidden torso. Its reason is `tracking_head_bow`, confidence is face reliability, and body/shoulder measurements are null. Uncertain face points, no face baseline, or ordinary upright/forward facial evidence remain UNKNOWN. This identifies a strongly bowed-head component rather than proving spinal curvature; faces alone cannot distinguish every possible forward posture.

| Label | Meaning |
|---|---|
| `GOOD` | Reliable geometry remains near the calibrated upright baseline. |
| `SLOUCH` | Relative head/neck collapse or whole upper-body lowering/reclining, including an upright-looking face. |
| `LEAN_FORWARD` | Relative approach/torso evidence, or corroborating large world neck change with raised shoulders at another apparent size. |
| `LEAN_LEFT_RIGHT` | Lateral head/shoulder or torso tilt; left and right are grouped. |
| `NO_PERSON` | No person detected in a frame; distinct from unavailable camera input. |
| `UNKNOWN` | Calibration incomplete, insufficient body/head-bow evidence, ambiguous competing people, or unusable geometry. Cropped hips alone do not block Front upper-body tracking. |

Upper-body points require visibility at least 0.6, presence at least 0.5 and combined reliability `sqrt(visibility × presence)` at least 0.6. MediaPipe detection/presence/tracking thresholds are 0.5. The classifier uses the frame's aspect ratio, a personal neutral baseline and short temporal stabilization. Reliability is not a measured classification accuracy percentage.

New labels need 600 ms of stable evidence. A bad frame always reports UNKNOWN. If a previously settled pose is interrupted by exactly one uncertain crop/tracking frame, two subsequent reliable matching observations may recover that same label within a 300–800 ms deadline, adapted to the observed frame interval and measured from the last confirmed frame. Further uncertainty, conflicting posture, absence, ambiguous people, reset/calibration or timestamp discontinuity clears recovery. A new posture never uses this shortcut.

Forward lean is relative geometry, not calibrated centimeters, absolute depth or spine curvature. Moving the camera/chair or changing zoom can resemble posture changes. One front camera cannot conclusively distinguish reclining from moving farther away. These labels do not identify a person, infer attention or diagnose health.

The current set contains **16 screenshots**, including `IMG_dataset/edge case/` and `edge case2/`. Filenames supply the labels; the GOOD overlays inside old screenshots are previous predictions. GOOD1/SLOUCH1 and GOOD2/SLOUCH2 show different people, so each uses its matched personal GOOD reference. Replay all current cases with:

```powershell
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture --input evaluation/fixtures/pc-dataset-edges.landmarks.json
```

Fresh native CPU extraction and replay now match **16/16** for original pixels and a 640×480/quality-70 JPEG approximation of browser input, versus 9/16 before the fix. The original `pc-dataset.landmarks.json` fixture remains unchanged and still matches 7/7; omitting `--input` replays that older fixture. See [the tuning report](../evaluation/pc_dataset.md) and [evaluation protocol](../evaluation/README.md). These are tuning/regression samples, not held-out accuracy or actual near/far video trials. A historical pre-update native-service probe matched 6/7 due to unreliable/cropped SLOUCH1 shoulders; that earlier result is retained separately in the tuning report. No rule bypasses required core-point reliability to force a supplied label.

## Terminal debugging

The `focusguard.vision` logger reports startup, requested/actual delegate, camera backend/index, calibration, posture/candidate/reason changes, FPS, inference milliseconds, selected subject/raw person count, Z source/neck angle, errors and resource release. INFO output includes periodic reports about every two seconds and rate-limited transitions; DEBUG adds numerical geometry, including the new level/depth ratios, without frames or landmark arrays.

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
