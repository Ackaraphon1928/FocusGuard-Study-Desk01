# Local posture tuning and Python migration evidence

[The canonical fixture](fixtures/pc-dataset.landmarks.json) contains real numeric MediaPipe observations extracted from seven user-provided `IMG_dataset/*.png` screenshots. It records file SHA256s, dimensions, 33 normalized/world landmarks, visibility/presence, diagnostics and inference settings. It is used only by Python regression tests/evaluation, and is excluded from production assets. Source images remain local, ignored by Git and excluded from Docker context.

There is one GOOD reference and six posture examples from one person. These examples guided the accepted heuristics; the GOOD calibration image is also the GOOD regression sample. Agreement on them is a **tuning regression**, not held-out accuracy, a live-camera benchmark or medical posture assessment.

## Run the canonical classifier regression

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture
```

The CLI imports the production `backend/vision/posture.py` classifier. It calibrates with 30 replays of the GOOD reference, then replays each target through temporal stabilization. The default output is `evaluation/results/pc-dataset/report.json`, with predictions, reliability, geometry and a confusion matrix. `--input` and `--output` select alternate files. This replay needs only Python's standard library; it does not open a camera or run MediaPipe inference.

The frozen fixture retains **7/7** supplied labels after the Python migration. The canonical Python rules matched the archived accepted TypeScript implementation on **6,300 frame outputs across 60 deterministic sequences**, including full/upper body, world depth, view changes, jitter, absence and ambiguity; numeric tolerance was `1e-12`. No thresholds were retuned for the migration.

`tests/test_posture.py` has **87 passing tests** covering the classifier, dataset/mirroring/jitter/scale checks, calibration persistence and mocked Pi runtime. These controlled checks are not additional independent photographs or hardware trials. Both the PC backend and actual Pi gateway import this same classifier; the frontend retains display types only.

## Extract fresh native MediaPipe observations

The recorded desktop environment is Windows x64, Python 3.13.9, MediaPipe Tasks `0.10.32`, OpenCV `5.0.0.93` and NumPy `2.5.4`. Install the optional native stack into the existing application venv and deliberately verify/download the model:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-vision.txt
.\.venv\Scripts\python.exe -m backend.vision.model --download
.\.venv\Scripts\python.exe -m evaluation.extract_pc_dataset --confidence 0.5 --video-frames 30 --output evaluation/results/pc-dataset/fresh.landmarks.json
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture --input evaluation/results/pc-dataset/fresh.landmarks.json --output evaluation/results/pc-dataset/fresh.report.json
```

The separate output preserves the frozen regression fixture. The extractor defaults to the canonical fixture path when `--output` is omitted, so replace it only deliberately. `backend.vision.model.ensure_model` resolves a verified backend/Pi model; no frontend WASM/worker preparation is required. The pinned Lite model SHA256 is:

```text
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
```

Each target is preceded by 30 repeated GOOD frames, followed by 30 repeated target frames at 67 ms timestamp intervals. The JSON retains the last target observation without replacing failed detections or inventing points, plus target pose counts. All seven targets yielded one pose on all 30 target frames in the original frozen extraction. Tracking state, package/platform and input sequencing can change newly extracted observations; fresh extraction is distinct from replaying the saved coordinates.

Repeated stills are tracking probes, not independent trials or real posture transitions. Input screenshots include browser overlays, which remain part of the pixels. The extractor deliberately pins the desktop SDK; the Pi's supported ARM64 stack uses MediaPipe `0.10.18` and needs separate target-device validation. See [hardware setup](../docs/HARDWARE.md).

## Actual native service probe

A separate Windows CPU probe exercised `LocalVisionService` and native VIDEO inference with an injected image camera: GOOD calibration to ready, one second of GOOD before each target, then 3.5 seconds of that target with a 67 ms artificial read delay. This tested the native service path without accessing a physical webcam.

| Screenshot | Expected | Native service result |
|---|---|---|
| GOOD | GOOD | GOOD |
| LEAN_FORWARD | LEAN_FORWARD | LEAN_FORWARD |
| LEAN_FORWARD2 | LEAN_FORWARD | LEAN_FORWARD |
| LEAN_LEFT_RIGHT | LEAN_LEFT_RIGHT | LEAN_LEFT_RIGHT |
| LEAN_LEFT_RIGHT2 | LEAN_LEFT_RIGHT | LEAN_LEFT_RIGHT |
| SLOUCH1 | SLOUCH | UNKNOWN (`cropped_pose`) |
| SLOUCH2 | SLOUCH | SLOUCH |

That run matched **6/7**. Fresh native tracking placed required shoulders at the bottom edge with low presence in extreme SLOUCH1. A follow-up of 60 target frames produced 33 rejected observations (`cropped_pose`/`unreliable_landmarks`); valid candidates were intermittent, so none met continuous temporal evidence. The accepted rules retain UNKNOWN when required evidence is unreliable. They were not relaxed to force the label.

The service's normal observation carried no landmark arrays, and the injected camera was released at stop. Probe FPS included artificial input delay and is not a device performance result. Neither the 7/7 frozen replay nor the 6/7 native probe establishes accuracy on new people, live webcam behavior, Pi throughput or GPU acceleration. No new physical camera/Pi tests were performed during this migration.

## Why the original logic returned UNKNOWN

`pc_dataset.baseline.json` preserves independent IMAGE inference with the original `0.6` detection/presence/tracking thresholds. Six images yielded a pose, all with both hips outside the image and reliability below `0.016`; the original visible-hip gate rejected them. SLOUCH1 yielded no pose at that setting. Diagnostic IMAGE runs at 0.5/0.4 still missed SLOUCH1; 0.3 also missed it while adding a false second pose elsewhere. Lowering detector thresholds alone was insufficient.

The accepted Front rules instead use reliable head/shoulders, a personal upright baseline and additional facial pitch/roll when available. Upper-body points require visibility at least 0.6, presence at least 0.5 and `sqrt(visibility × presence)` at least 0.6. Inferred off-frame hips do not veto that evidence. Calibration requires 30 stable reliable observations over at least 1.2 seconds, tolerates brief interruptions up to 700 ms, and uses median geometry. Known label changes require 600 ms of continuous evidence; absence/uncertainty clears retained labels immediately.

SLOUCH1 represents lowered head/rounded upper body; the user's SLOUCH2 example is reclined with a raised chin. The demo labels follow these supplied relative head/neck examples; they do not measure spinal curvature. Test these distinctions on independent people and camera placements using [the evaluation protocol](README.md).

To reproduce the original IMAGE baseline separately:

```powershell
.\.venv\Scripts\python.exe -m evaluation.extract_pc_dataset --confidence 0.6 --video-frames 0 --output evaluation/results/pc-dataset/image-baseline.json
```

References: [MediaPipe Pose Landmarker Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python), [desktop SDK release](https://pypi.org/project/mediapipe/0.10.32/) and [Pi ARM64 SDK release files](https://pypi.org/project/mediapipe/0.10.18/#files).
