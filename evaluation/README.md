# Evaluation with real observations

No hardware measurements are claimed in this repository. `example.synthetic.csv` is a labeled format fixture for checking the metric calculations. It is explicitly synthetic and the CLI refuses it unless `--allow-synthetic` is supplied. Its output must never be presented as project performance.

## Collect and label posture observations

1. Record the Pi model, 64-bit OS, Python/package versions, camera resolution, camera placement/view, model SHA256, room light and calibration JSON with each experiment. Obtain participant agreement before any local image review. The gateway does not record video or upload frames.
2. Calibrate on neutral posture using `python -m raspberry_pi.gateway --calibrate`. Keep calibration data separate from the final test set; do not tune on the reported test samples.
3. Collect numeric metadata with `python -m raspberry_pi.gateway --metrics-csv evaluation/capture.csv`. It records one row per processed frame, actual monotonic frame timestamps, inference time, predicted labels and local geometry. It contains no imagery.
4. Independently label the instructed or observed trials using a synchronized trial log or in-person observer. Add `expected_posture` to the CSV. Use GOOD, SLOUCH, LEAN_FORWARD, LEAN_LEFT_RIGHT, NO_PERSON. UNKNOWN is a valid abstention/prediction under unreliable visibility; count those against the correct expected class rather than silently discarding failures.
5. Include multiple people/sessions/body types and conditions. A suggested minimum protocol is 20 independent trials per supported posture class, spread across three consenting participants, with normal light, low light, occlusion and a second-person condition. These are collection targets, not measured achievements. Sample independent trial observations when reporting classification, and explain if you also report correlated frame-level results. Do not treat adjacent video frames as independent people/trials.
6. A side camera and a front camera have different observable geometry: side view detects forward lean; front view detects lateral lean. Test and report the supported classes for each view. A single plane cannot reliably separate every posture in 3D.

Evaluate a labeled capture:

```bash
python -m evaluation.evaluate evaluation/labeled_capture.csv --output evaluation/results/posture.json
```

The report includes accuracy, per-class precision/recall/F1/support, macro precision/recall/F1, and a confusion matrix with actual labels as rows and predicted labels as columns. Macro averaging includes the union of actual and predicted labels; undefined precision/recall is zero. UNKNOWN predictions therefore remain visible in the report.

If your CSV has manually labeled geometry instead of predictions, supply columns `expected_posture,torso_angle,shoulder_angle,neck_offset,head_height` and use:

```bash
python -m evaluation.evaluate evaluation/labeled_features.csv --calibration raspberry_pi/calibration.json --output evaluation/results/geometry.json
```

Geometry evaluation runs the real project classifier. It does not run pose inference on images; evaluate the complete camera pipeline using actual gateway captures as above.

## Distance accuracy

At several measured target distances (for example 25, 35, 50, 75 and 100 cm), compare the ToF value against a ruler/tape reference from the sensor plane to the target. Record at least ten actual repeats at each distance, including target surface and lighting. Measure the torso target rather than claiming eye-to-screen ground truth. Add `distance_reference_cm,distance_cm` columns. The evaluator reports mean absolute error in centimeters from valid paired readings. Separately report invalid-reading rate; do not silently remove failed target detections from the qualitative result.

```bash
python -m evaluation.evaluate evaluation/distance_trials.csv --output evaluation/results/distance.json
```

Optional CSV columns may be blank or omitted. Missing readings are unknown; they are never replaced with zeros. The CLI rejects negative distance, non-finite numeric data and invalid labels.

## FPS and inference time

Use a continuous capture after warm-up at a documented resolution/model, and report the run duration and frame count. `frame_timestamp` must be strictly increasing within one run. Measured capture FPS is `(frames - 1)/(last_timestamp - first_timestamp)`, not the camera's advertised frame rate. Inference duration is measured around `PoseLandmarker.detect_for_video`; it excludes capture and MQTT time. The report gives inference mean, population standard deviation and interpolated p95. Do not combine runs with independently reset clocks into one CSV.

## Real command-to-ack latency

With the real gateway and backend running in hardware mode, the passive collector subscribes to commands and applied-state acknowledgements. It does not send commands or change outputs:

```bash
python -m evaluation.latency_capture --seconds 60 --output evaluation/latency.csv
python -m evaluation.evaluate evaluation/latency.csv --output evaluation/results/latency.json
```

Install `paho-mqtt`/`python-dotenv` or use the Pi venv. It loads `raspberry_pi/.env`; use an account allowed to read both topics (the supplied `backend` ACL allows this). Measurements are based on matching `command_id` and one collector's monotonic clock, avoiding cross-machine clock subtraction. The scope is **the collector observing a broker command to observing the Pi's GPIO acknowledgement**. Network scheduling at the collector can affect this estimate. It does not include upstream sensing/pose inference, sustained-alert dwell, or physical lamp/buzzer response time. Commands with no matching ack are not latency samples; record their count and investigate them rather than interpreting missing pairs as zero delay.

For complete end-to-end measurement, use a visible physical stimulus and a camera/logic analyzer sharing one clock, or timestamp sensor publication and physical response with synchronized devices. Document clock synchronization error, configured temporal debounce and deliberate warning duration. Report command transport latency separately from intentionally sustained rule thresholds. A GPIO ack confirms the software output was applied; physically inspect the response too.

## Success and failure protocol

| Case | Expected behavior | Evidence to capture |
|---|---|---|
| Sit down, reliable vision + FSR | Active session, occupancy established | Sensor messages + session timeline |
| Cover BH1750 during presence | Lamp brightness increases | Lux series, command, ack, visible light |
| Sustained bad posture | Warning after configured dwell, short buzzer | Predicted label, event, command/ack, physical beep |
| Lean forward and approach ToF | Fused high-confidence distance alert | Independent distance reference + both metadata sources |
| Leave chair | Pause after configured grace; lamp off | FSR/camera absence and state timeline |
| Motionless seated user | FSR/vision preserve occupancy despite quiet PIR | All three presence channels |
| Camera unplugged/covered | UNKNOWN or unavailable; no fabricated healthy posture | Availability diagnostic and recovery |
| Two people/cropped hips | UNKNOWN/ambiguous instead of confident ergonomics | Metadata plus observer log |
| ToF target missing/out of range | Null reading, confidence/coverage reflects missing data | Raw metadata diagnostics and failure count |
| MQTT lost | Reconnect; Pi watchdog switches outputs off | Broker logs, physical outputs, recovered messages |
| Bedrock unavailable/consent off | Local summary; monitoring continues | Summary source/fallback note |
| Invalid/expired/retained command | GPIO unchanged, command rejected | Local log and applied-state observation |

For every trial record actual versus expected, delay, pass/fail and likely cause. Keep failure demonstrations in the report. A successful simulation validates rules and interfaces; actual sensor accuracy, FPS and physical behavior require the hardware trials.

## Validate the tool without hardware

```bash
python -m evaluation.evaluate evaluation/example.synthetic.csv --allow-synthetic
```

That report is marked `synthetic_fixture_not_hardware_results`. Replace it with observed data before reporting project metrics.
