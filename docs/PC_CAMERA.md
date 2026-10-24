# PC camera and MediaPipe posture demo

This demo uses the webcam attached to the computer running the browser. MediaPipe Tasks Vision **0.10.32** detects body landmarks in a local browser worker; FocusGuard derives posture labels from landmark geometry relative to an upright calibration. Use a current desktop Chrome or Edge with WebAssembly and OffscreenCanvas support. It does not require a Raspberry Pi, Python MediaPipe installation, Docker or a cloud account.

## Start and calibrate

1. Run `./start.ps1 -Install` from the project root on the first run, or `./start.ps1 -Build` after updating this checkout. Open <http://127.0.0.1:8000>. For development, run the API at port 8000 and `npm --prefix frontend run dev`, then open <http://127.0.0.1:5173>.
2. Keep **demo mode** selected. On Overview, find **PC camera · pose lab** and choose **Front** or **Side** to match the camera position. A front view is useful for lateral lean; a side view is more useful for forward lean. Keep the camera fixed and frame one person with the head, shoulders and hips visible. Bright, even light helps tracking.
3. Click **Start PC camera**, then allow the browser's camera permission. The camera is requested only after this click; audio is not requested. Initialization loads the local WASM runtime and lite pose model.
4. Sit upright, look ahead, and click **Calibrate upright posture**. Keep still while reliable neutral samples are collected. Recalibrate after changing the view, camera position or seating position. The preview shows the skeleton, current posture label and observed processing rate.
5. Try a sustained lateral lean in Front view, then calibrate in Side view and try leaning forward or lowering your head. Watch the label first; dashboard warnings use the existing sustained-duration rules and cooldowns. Low visibility, multiple people, a cropped body or an uncalibrated view can produce **UNKNOWN** rather than a healthy posture reading.
6. Click **Stop camera** to release the webcam. Navigation away from Overview or hiding the tab also stops capture. Start it explicitly again when returning. Stopping leaves PC vision selected and marks vision unavailable; **Use simulated vision** explicitly restores generated demo postures.

The camera replaces the **vision input only**. Lighting, noise, temperature, humidity, seat/motion signals and distance remain simulated. Simulated FSR/PIR presence follows fresh, reliable PC-camera presence: an empty frame, unreliable tracking, missing calibration or a stopped camera does not manufacture an occupied desk. These signals are not measurements from real seat or motion sensors. Distance is not estimated as calibrated centimeters from the webcam. Hardware mode continues to use the Pi/MQTT path documented in [HARDWARE.md](HARDWARE.md).

## Labels and limits

MediaPipe provides keypoints, not FocusGuard's posture labels. The classifier applies aspect-ratio-corrected geometry, confidence checks, personal calibration and short temporal stabilization. These are prototype rules, not a trained ergonomic diagnosis. One camera view cannot reliably resolve all 3D movements; a front view is especially limited for forward lean. Desk occlusion, camera tilt, distance, lighting and clothing can change results. The labels do not infer attention, identify a person, recognize a phone or diagnose health conditions. No real-world accuracy or camera FPS benchmark is claimed by the software tests.

| Label | Interpretation |
|---|---|
| `GOOD` | Reliable geometry remains close to the calibrated upright baseline. |
| `SLOUCH` | Relative head height or head/neck position differs from the upright baseline. |
| `LEAN_FORWARD` | Forward torso displacement relative to baseline, using the selected view's available geometry. |
| `LEAN_LEFT_RIGHT` | Lateral torso/shoulder tilt in Front view; left and right are grouped. |
| `NO_PERSON` | No person detected in the current frame; this is separate from the simulated desk occupancy sensor. |
| `UNKNOWN` | Calibration is missing/in progress, the body is occluded/cropped, multiple people appear, or evidence is unreliable. |

To evaluate, compare labels against manually annotated trials and record the actual FPS displayed on your PC. Repeat trials after moving the camera and include occlusion, leaving the frame and a second person. The existing [evaluation guide](../evaluation/README.md) describes classification reporting and the distinction between synthetic and measured data.

## Asset setup and reproducibility

`npm ci` runs `scripts/prepare-vision-assets.mjs`. The same setup runs before `npm run dev` and `npm run build`. It:

- Copies the SIMD and non-SIMD WASM loader/runtime pairs from the exact locked `@mediapipe/tasks-vision@0.10.32` npm package into `frontend/public/vision/wasm/`.
- Reuses the verified `raspberry_pi/models/pose_landmarker_lite.task` if available. Otherwise it downloads the [official float16 version-1 lite bundle](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) at setup time. Every run checks the expected size **5,777,746 bytes** and SHA256 **`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`** before using it.
- Bundles `src/workers/pose.worker.ts` to a standalone classic worker at `/vision/pose.worker.js`. This is necessary because the pinned runtime's WASM loader uses `importScripts`; the same artifact works during Vite development and production.
- Writes `/vision/assets.json` with artifact versions and hashes. Generated binaries, model and worker are ignored in Git; clean Docker builds prepare them before creating the production frontend.

First-time installation needs access to npm and `storage.googleapis.com`. Once installed, runtime inference loads the model, worker and WASM from the same FocusGuard origin, without a CDN dependency. To provision without a model download, place the exact hash-verified `.task` file at `raspberry_pi/models/pose_landmarker_lite.task` before `npm ci`. Run `npm --prefix frontend run prepare:vision` to retry setup. A hash mismatch deliberately fails setup; replace the offending file with the reviewed artifact rather than changing the expected hash.

Changes to the worker or its classifier imports require restarting `npm run dev` to rebuild the classic worker. React UI changes retain normal Vite hot reload.

## Privacy and licenses

Frames and raw landmarks remain in browser memory; the preview is not recorded. When PC vision is selected, the application sends derived posture/confidence/health metadata to the local FocusGuard API. Stored sessions and exports can therefore contain posture metadata, but not images or recordings. Camera permission can be revoked in browser site settings; browser permission prompts and device availability remain under the user's control.

Google's [general MediaPipe privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice) permits performance and usage metrics while keeping input data on device. In a [June 10, 2026 clarification](https://github.com/google-ai-edge/mediapipe/issues/6306), a Google maintainer stated that the Web SDK at that time contained no telemetry. This project pins the earlier 0.10.32 Web release, serves its assets locally and does not add analytics. Review privacy behavior and worker compatibility before upgrading the SDK; this is not a blanket privacy claim about future MediaPipe versions.

MediaPipe and the BlazePose GHUM model use Apache-2.0. The official [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) covers the lite/full/heavy model family and its limitations. Distributions include [LICENSE-MEDIAPIPE.txt](../frontend/public/vision/LICENSE-MEDIAPIPE.txt) and [NOTICE.txt](../frontend/public/vision/NOTICE.txt), also served under `/vision/`.

## Troubleshooting

| Symptom | Action |
|---|---|
| Camera permission denied | Allow camera access for the localhost site in browser settings, then click Start again. |
| No camera found or device busy | Connect a webcam and close another application using it. Check Windows camera privacy access for the browser. |
| Camera unavailable over a LAN URL | Use `http://localhost` / `http://127.0.0.1` on the camera PC, or serve HTTPS. Browsers require a secure context for camera access; plain LAN HTTP is insufficient. |
| Model or WASM load error | Run `npm --prefix frontend run prepare:vision`, restart development, or run `./start.ps1 -Build`. Check `/vision/assets.json` is available. |
| UNKNOWN or calibration never completes | Frame one person including head, shoulders and hips, improve lighting, keep still and use the view matching the camera position. |
| Labels seem wrong after moving the camera | Choose Front/Side appropriately and recalibrate upright posture. |
| Vision becomes unavailable after switching tabs | Return to Overview and click Start PC camera. Capture intentionally stops when hidden. |

