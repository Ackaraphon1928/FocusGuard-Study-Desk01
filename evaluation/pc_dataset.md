# Local posture tuning and edge-case regression

The production PC backend and Raspberry Pi gateway share `backend/vision/posture.py`. Evaluation replays actual numeric MediaPipe observations through that classifier; it does not maintain a separate label implementation. Source images remain local under ignored `IMG_dataset/`, are excluded from Docker context, and are never embedded in the application or uploaded by this workflow.

The supplied **filename is the ground-truth label**. Some screenshots still display an old `GOOD` overlay even though their filename is `SLOUCH`; that previous application prediction is part of the source pixels, not an annotation to trust. Original images are not cropped, repainted or otherwise changed to make the tests pass.

## Recorded results on 28 October 2026

| Input evidence | Before the edge-case changes | Current classifier |
|---|---|---|
| Preserved original seven-image landmark fixture | 7/7 | **7/7** |
| Fresh native CPU extraction of all 16 supplied images | 9/16 | **16/16** |
| Separate 640×480 / JPEG-quality-70 input approximation, all 16 images | 9/16 | **16/16** |
| Every-native-frame calibration/temporal probe, fresh model per target | Not run | **16/16** final labels; uncertain individual frames still abstain |

The original fixture is [pc-dataset.landmarks.json](fixtures/pc-dataset.landmarks.json). It is unchanged. The new [pc-dataset-edges.landmarks.json](fixtures/pc-dataset-edges.landmarks.json) records all 16 source-image hashes, dimensions, normalized/world landmarks, confidence values, pose counts, diagnostics and extraction settings. The separate browser-JPEG observations and before/after reports are generated under ignored `evaluation/results/pc-dataset/`.

These images were supplied to guide the changes. Agreement is a **tuning regression**, not held-out accuracy, independent video trials, live webcam performance, Raspberry Pi throughput or a medical assessment. Replaying the GOOD calibration image as a target also contributes a GOOD regression case; it is not an independent successful trial. Before reports use the preceding committed classifier on the same extracted observations, without changing annotations or replacing missing landmarks.

## Personal calibration pairing

The [reference manifest](fixtures/pc-dataset-edges.references.json) records the personal reference for every image:

| Image group | GOOD reference | Targets |
|---|---|---|
| `IMG_dataset/` | `GOOD.png` | Original seven images |
| `IMG_dataset/edge case/`, nearer subject | `GOOD1.png` | `GOOD1.png`, `SLOUCH1.png` |
| `IMG_dataset/edge case/`, farther subject | `GOOD2.png` | `GOOD2.png`, `SLOUCH2.png` |
| `IMG_dataset/edge case2/` | `GOOD.png` | `GOOD.png`, `SLOUCH1.png` through `SLOUCH4.png` |

`edge case/GOOD1` and `GOOD2` show different people at different distances. Their slouch examples must use the matching person's baseline. Combining both GOOD images into one baseline, or presenting cross-person calibration as proof of near/far invariance, would be misleading. The dataset covers different apparent sizes; controlled same-person distance validation remains separate work.

The extractor stores `calibration_group` and `calibration_reference` on each schema-2 image. It rejects a group with no GOOD reference and requires explicit pairing when a folder contains multiple GOOD references. The evaluator also rejects references from another group. A reference with missing or ambiguous observations remains a failed calibration case; no landmark coordinates are invented to obtain a label.

## Reproduce the classifier replay

From the repository root, with only Python's standard library required for frozen-landmark replay:

```powershell
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture --input evaluation/fixtures/pc-dataset-edges.landmarks.json --output evaluation/results/pc-dataset/edges.report.json
```

The first command checks the preserved original seven examples. The second checks all 16 with their recorded personal references. For each target, the CLI calibrates with 30 repeated reference observations at 100 ms intervals, then replays 15 target observations through temporal stabilization. The report includes the reference, calibration readiness, source pose counts, prediction, reason, reliability, geometry and confusion matrix. Repeated observations test deterministic behavior; they do not create extra independent samples.

## Extract fresh native observations

The recorded desktop stack is Windows x64, Python 3.13.9, MediaPipe Tasks `0.10.32`, OpenCV `5.0.0.93` and NumPy `2.5.4`. Set up the optional stack and explicitly verify/download the model:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-vision.txt
.\.venv\Scripts\python.exe -m backend.vision.model --download
.\.venv\Scripts\python.exe -m evaluation.extract_pc_dataset --recursive --references evaluation/fixtures/pc-dataset-edges.references.json --confidence 0.5 --video-frames 30 --output evaluation/results/pc-dataset/edges.fresh.landmarks.json
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture --input evaluation/results/pc-dataset/edges.fresh.landmarks.json --output evaluation/results/pc-dataset/edges.fresh.report.json
```

Separate output paths preserve both committed fixtures. Omitting `--recursive` keeps the original top-level seven-image extraction behavior. The extractor's default output is the original fixture path, so pass `--output` when investigating new inputs. The pinned Lite-model SHA256 is `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`; no implicit runtime model download occurs.

Extraction uses CPU VIDEO mode, two possible poses and 0.5 detection/presence/tracking thresholds. Each target receives 30 repeated frames of its matched GOOD reference followed by 30 target frames, at 67 ms timestamp intervals. The fixture retains the last target observation and all target pose counts; failed detections are not replaced with synthesized points. Tracking history, SDK/platform and sequencing can change a fresh extraction even with identical source files.

Approximate the browser transport separately, without writing resized image files:

```powershell
.\.venv\Scripts\python.exe -m evaluation.extract_pc_dataset --recursive --references evaluation/fixtures/pc-dataset-edges.references.json --browser-jpeg --confidence 0.5 --video-frames 30 --output evaluation/results/pc-dataset/edges.browser-jpeg.landmarks.json
.\.venv\Scripts\python.exe -m evaluation.evaluate_pc_posture --input evaluation/results/pc-dataset/edges.browser-jpeg.landmarks.json --output evaluation/results/pc-dataset/edges.browser-jpeg.report.json
```

`--browser-jpeg` fits each source within 640×480, uses OpenCV bilinear resizing, encodes JPEG at quality 70 and decodes it entirely in memory before MediaPipe inference. It approximates the PC-mode canvas transport; browser encoders and real webcam exposures may differ. It is not a browser permission test or actual camera capture. The raw-pixel and JPEG paths remain separate evidence.

## Probe every native frame through calibration and temporal filtering

Frozen-landmark replay repeats one final extracted observation. To check the stronger native path, infer every input frame and immediately feed its actual landmarks to the production classifier:

```powershell
.\.venv\Scripts\python.exe -m evaluation.probe_pc_pipeline --output evaluation/results/pc-dataset/native-stream.report.json
```

This starts a fresh CPU `_MediaPipeInference` for each of the 16 matched targets, then feeds 75 personal GOOD frames and 45 target frames through native inference and `PostureClassifier.update`. It uses the in-memory 640×480/JPEG-70 approximation and 67 ms synthetic video timestamps. Every early unstable, cropped, missing or ambiguous result is included; no matching observation is selected. All 16 personal calibrations became ready during the neutral stage, at frame 30. The final run processed **1,920 frames** and matched **16/16 final labels**, including **all nine new edge images**. This is agreement at the predetermined end of each target sequence, not a claim that every intermediate frame has the expected settled label.

Before the limited face-evidence fallback, original `SLOUCH1.png` ended `UNKNOWN` with `cropped_pose`. That report is preserved as `native-stream.before-head-bow.report.json`. Its 45 target frames contained 33 SLOUCH candidates, three LEAN_FORWARD candidates and nine UNKNOWN candidates; usable upper-body tracking covered 36 frames, cropped pose eight and unreliable landmarks one.

The strict face-evidence fallback alone improved usable observations but still matched **15/16** final labels; this intermediate report is preserved as `native-stream.before-recovery.report.json`. On extreme SLOUCH1, strict face evidence recovers six of the nine previously rejected-body frames. Target reasons are upper-body tracking on 36 frames, `tracking_head_bow` on six, cropped pose on two and unreliable landmarks on one. Candidates are SLOUCH on 39, LEAN_FORWARD on three and UNKNOWN on three. Before bounded recovery, temporal outputs were GOOD on 27, UNKNOWN on 16 and SLOUCH on two: frame 43 correctly abstained, then frames 44 and 45 could not rebuild the full 600 ms new-label interval.

The final implementation preserves that abstention while allowing bounded recovery of an already confirmed label after one uncertain frame. In this sequence, frames 41–42 are settled SLOUCH, frame 43 remains UNKNOWN, frame 44 remains UNKNOWN awaiting confirmation, and frame 45 returns SLOUCH after the second matching reliable observation. A new label still needs 600 ms. The recovery window is limited by observed frame spacing to 300–800 ms; repeated uncertainty, absence, ambiguous people, a conflicting candidate, a large timestamp gap or a reset clears it. It does not label an uncertain frame or bridge a change of person. Public head-only observations also mask any previously retained non-SLOUCH label to UNKNOWN during settling, so the limited face path never displays GOOD or forward lean. The final SLOUCH1 output counts are GOOD on 25 body-tracked frames, UNKNOWN on 17 and SLOUCH on three. Native detections, facial/body quality thresholds and candidate/reason counts are unchanged from the intermediate run.

After that final public-output guard, only SLOUCH1 required re-inference: it was the only row containing `tracking_head_bow` in either phase. Its complete 75-reference/45-target native sequence was rerun and replaced in the aggregate report, with the other 15 rows retained unchanged. The report records this targeted refresh; `native-stream.masked-slouch1.report.json` retains the separate result. To repeat it without losing its personal reference lookup, use `python -m evaluation.probe_pc_pipeline --only SLOUCH1.png --output evaluation/results/pc-dataset/native-stream.masked-slouch1.report.json`. Running the default command above always recomputes all 16 rows.

The report stores only labels, candidates, reasons, detection/selection counts, calibration status, hashes and inference timings, with no images or landmark arrays. Synthetic timestamp spacing is not measured webcam FPS. This still-image probe is stronger temporal evidence than the 16/16 fixed-observation regression, but remains distinct from actual webcam/Pi trials. Cropped-frame abstentions and settling delays remain visible; the final-label score does not erase them.

## What the edge cases changed

The previous upper-body rules mostly compared nose-to-shoulder height and facial pitch against calibration. Several supplied slouches lower the head and shoulders together while preserving those ratios, so they were classified GOOD. Their normalized/world Z changes have **mixed signs**: increasing Z alone cannot separate all the supplied labels.

The current classifier retains those neck/pitch and lateral-tilt features and adds calibrated head and shoulder levels relative to the image centre, each divided by apparent shoulder width. Uniform scaling nearer/farther around that camera principal-centre approximation cancels in this ratio. A head/shoulder drop can therefore provide evidence of the whole upper body sinking relative to the personal baseline. Forward-approach and lateral-tilt evidence retain their own rules so shrinking or enlarging an otherwise unchanged body is not itself a slouch label.

This feature assumes a **fixed camera, framing and seat setup**. Moving or tilting the camera, changing crop, or changing seat height can resemble a body-level change and requires recalibration. The supplied different-person photos do not prove robustness to every possible change of distance or perspective; synthetic scale regressions also remain controlled transformations rather than new people.

Shoulder-relative 3D neck depth/height/inclination adds corroborating evidence when reliable. World landmarks can be used with reliable head/shoulders even when hips are hidden; normalized Z is a separately tagged fallback with image-aspect correction. Current and baseline depth values are compared only when their coordinate source matches. Z is not treated as camera-to-person distance, calibrated centimeters, or a decisive standalone slouch measurement. Missing/unreliable depth keeps the supported 2D path available.

The farther reference also exposes a background-person case: MediaPipe may detect two poses although one desk subject is clearly dominant. The shared Python subject selector accepts a sufficiently dominant foreground subject when the competing pose is clearly smaller or lacks a competing visible upper body. Similarly sized people and large in-frame competitors with unreliable confidence remain ambiguous; the system does not identify a person or silently choose between comparable subjects. Selection uses apparent size and reliability, rather than measuring physical separation or identifying occlusion.

When reliable body geometry is unavailable, a narrowly scoped face path can support only a pronounced SLOUCH/head-bow component. It requires a ready personal facial baseline plus seven visible, high-confidence nose/eye/ear/mouth points. Nose-to-ear, eye-to-ear and mouth pitch changes must all corroborate the bow in the ear-line coordinate frame, with bounded roll and plausible geometry. This emits `trackingMode: head_only` with absent torso/shoulder angles, rather than inventing hidden body geometry. An upright visible face with missing shoulders remains UNKNOWN; the face path never produces GOOD, forward-lean or side-lean labels. Missing or weak face evidence still abstains, and temporal stabilization remains active. Older calibrations without this optional facial baseline require a new upright calibration to enable it.

Calibration still requires at least 30 stable reliable frames over 1.2 seconds, with bounded tolerance for brief tracking interruptions. Reliable points, temporal stabilization and abstention remain in force. Python tests cover the dataset labels, calibration pairing, mirrored/jittered/scaled observations, optional/unreliable depth, background versus ambiguous subjects and saved-baseline validation. They are regression evidence, not additional photographic trials.

## Earlier migration evidence

Before these edge-case changes, the Python migration matched the archived TypeScript classifier on 6,300 frame outputs across 60 deterministic sequences at `1e-12` numeric tolerance. That result establishes equivalence of the earlier migration, not an assertion that the new classifier remains numerically identical after deliberate feature changes.

A separate earlier native `LocalVisionService` probe on the original seven still images matched 6/7; extreme SLOUCH1 became UNKNOWN when newly extracted required shoulders were cropped/unreliable. That historical service probe used different frame timing/tracking from the committed fixtures and is not superseded by a claim of new live-camera accuracy. The original IMAGE/0.6 extraction failures are preserved in `pc_dataset.baseline.json`.

The Pi-supported ARM64 stack uses MediaPipe `0.10.18` and needs its own target-device validation. No physical webcam, Pi, GPU or independent-person benchmark is established by these still-image checks. See [the collection protocol](README.md), [camera guide](../docs/PC_CAMERA.md), [hardware setup](../docs/HARDWARE.md), and the [MediaPipe Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python).
