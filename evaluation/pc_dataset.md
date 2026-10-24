# Local PC posture tuning evidence

[The frontend test fixture](../frontend/src/test/fixtures/pc-dataset.landmarks.json) contains real numeric Pose Landmarker output for the seven user-provided `IMG_dataset/*.png` files. It includes file SHA256s, dimensions, all 33 normalized/world landmarks, visibility/presence scores, upper-body diagnostics, and inference settings. Keeping this fixture inside `frontend/` lets standalone frontend/Docker builds typecheck the same tests without depending on a parent directory. It is not imported by application code or copied into the production assets. Source images stay local, remain ignored by Git, and are excluded from Docker context and browser assets; they are not uploaded to an inference service.

This is a **tuning fixture**, with one GOOD reference and six labeled posture examples. The same examples guide the heuristic changes and their regression checks. Passing those checks measures agreement on these examples, not accuracy on new people, independent camera trials, or medical posture assessment.

## Reproduce on Windows

The recorded environment is Python 3.13.9 with native CPU MediaPipe Tasks **0.10.32**, the same release number as the browser SDK. Native CPU inference is not guaranteed to match browser GPU/WASM inference. The extractor verifies the exact Lite model SHA256 before inference:

```text
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
```

Prepare browser assets using the frontend's existing `npm run prepare:vision` if the model is missing. From the repository root:

```powershell
.\.venv\Scripts\python.exe -m venv .tools\vision-eval
.\.tools\vision-eval\Scripts\python.exe -m pip install -r evaluation\pc_dataset.requirements.txt
.\.tools\vision-eval\Scripts\python.exe evaluation\extract_pc_dataset.py --confidence 0.5 --video-frames 30
```

Each target is preceded by 30 repeated GOOD frames, followed by 30 repeated target frames at 67 ms timestamp intervals. The JSON stores the **last target frame**, without replacing missing detections or synthesizing points. It records every target-frame pose count and whether the last five counts are stable. All seven targets produced one pose on each of their 30 target frames in the recorded run. The Tasks API does not expose separate detector versus tracker invocation counts.

Repeated still frames are a tracking probe. They are not independent observations, real transitions, or a live video benchmark. The input contains browser screenshot overlays; those overlays remain part of the input pixels.

## Why the original classifier returned UNKNOWN

`pc_dataset.baseline.json` preserves independent IMAGE inference with the original `0.6` detection/presence/tracking thresholds. Six images yield a pose; every one has both hips outside the image with reliability below `0.016`. The original requirement for visible, reliable hips therefore rejects every detected example before posture classification. SLOUCH1 yields no pose in independent IMAGE mode at that setting.

The fix should use visible head/shoulder geometry for a desk webcam, retain reliability checks on the points actually used, and calibrate against a neutral upper-body reference. Inferred hips outside the image provide no reliable torso geometry.

Diagnostic IMAGE runs at 0.5 and 0.4 still miss SLOUCH1. Lowering to 0.3 also misses it and produces a second false pose in LEAN_FORWARD. Therefore a blanket reduction of thresholds is insufficient. The recorded VIDEO probe with 0.5 thresholds and a neutral warmup obtains tracked SLOUCH1 landmarks. Its weaker shoulder has visibility `0.952`, presence `0.570`; a strict `min(visibility, presence) >= 0.6` gate still discards that shoulder.

The final VIDEO 0.5 normalized facial pitch `(noseY - meanEyeY) / (meanMouthY - meanEyeY)` is:

| Image | Pitch ratio |
|---|---:|
| GOOD | 0.499 |
| LEAN_FORWARD | 0.608 |
| LEAN_FORWARD2 | 0.538 |
| LEAN_LEFT_RIGHT | 0.547 |
| LEAN_LEFT_RIGHT2 | 0.674 |
| SLOUCH1 | 0.634 |
| SLOUCH2 | 0.375 |

These overlapping values require other calibrated geometry and temporal evidence. SLOUCH1 shows a lowered head/rounded upper body; the user's SLOUCH2 example is reclined with a raised chin. In this demo the SLOUCH label follows those supplied head/neck deviation examples, rather than claiming that the cropped camera measures spinal curvature.

## Run the production classifier regression

```powershell
npm --prefix frontend run evaluate:posture
```

The command bundles and executes the actual TypeScript classifier, calibrates by replaying the one GOOD reference, then replays each extracted target through temporal stabilization. It writes `evaluation/results/pc-dataset/report.json`, including per-image predictions, confidence, feature values and a confusion matrix. The recorded tuned result agrees with all **7/7** supplied labels. The GOOD calibration image is also the GOOD regression sample; this is deliberately labeled a tuning regression, with no held-out accuracy claim.

The frontend tests additionally check mirrored coordinates, one-pixel jitter, uniform approach/recede without a posture change, missing core points, and upper/full-body tracking continuity. These controlled variations are regression checks, not additional independent labeled photographs.

Reproduce the original baseline separately:

```powershell
.\.tools\vision-eval\Scripts\python.exe evaluation\extract_pc_dataset.py --confidence 0.6 --video-frames 0 --output evaluation\pc_dataset.baseline.json
```

Official references: [MediaPipe 0.10.32 package](https://pypi.org/project/mediapipe/0.10.32/) and [Pose Landmarker Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python).
