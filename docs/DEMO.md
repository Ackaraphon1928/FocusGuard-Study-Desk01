# FocusGuard demo and acceptance walkthrough

## Start the local prototype

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. The root `start.ps1` script is a convenient alternative when provided. The frontend is served by FastAPI and does not require a Node.js build. The default local store persists timestamped data and sessions between restarts. Use `FOCUSGUARD_DB` to choose a separate database for a clean demonstration instead of deleting a working dataset.

The dashboard starts in clearly labeled **demo** mode. Its sensor readings and pose illustration are synthetic. The illustration is not a camera stream or evidence that a vision model ran. Real vision is a separate local camera process; keep its preview on the Raspberry Pi.

## Demonstrate the decision flow

Use the **Demo lab** and enable the demo timing preset when a short presentation needs shorter rule intervals. The dashboard's Rules & settings page shows the effective values. Normal defaults intentionally require sustained violations, so do not interpret a short delay as a broken feature.

| Step | Action | Check |
|---|---|---|
| 1 | Choose a normal desk scenario. | Presence is detected, the session becomes active, desk readings appear, and history begins to accumulate. |
| 2 | Choose dark room. | Lux falls and automatic lamp brightness increases while a person is present. View the actuator state and rule explanation. |
| 3 | Choose too close / forward lean. | Distance and pose agree; after the configured duration a warning event appears and a short buzzer command is generated. |
| 4 | Choose slouch. | A sustained posture violation creates a warning. Switch briefly to normal and back to demonstrate that an isolated bad sample is insufficient. Leave slouch active to show the cooldown suppressing an alert every frame. |
| 5 | Choose a noisy or warm environment. | Noise status follows its duration threshold; temperature changes the fan command when automatic control is enabled. Noise is a relative level, not calibrated dB. |
| 6 | Keep the session active for the shortened break interval. | Sitting and screen-break reminders are visible. Taking a break updates session timing. |
| 7 | Adjust lamp/fan manually, then restore automatic mode. | Controls affect command state immediately and automatic rules resume when the override is cleared. Manual overrides persist until explicitly restored or the operating mode changes. |
| 8 | Choose away / empty desk. | The session pauses, absence is visible, and unattended automatic lighting turns off. No posture warning should be produced for an empty desk. |
| 9 | Demonstrate a vision failure / low-confidence case. | Vision becomes unavailable or uncertain. Other sensors continue to update and stale pose data does not create a new posture warning. |
| 10 | End the session. | Session history retains its duration, condition statistics, events, and summary. |

Names in the Demo lab are the authoritative scenario names. Changing scenarios does not alter the distinction between simulated telemetry and physical sensors.

## Inspect history and privacy

Open **Session history**, select a completed session, and inspect its summary. Without configured AI credentials the prototype generates an explicit local explanation. With the optional provider configured, the server sends only structured session aggregates; camera frames, landmark streams, and audio are not part of that request. A failed provider request must not interrupt current monitoring.

Open **Analytics** to inspect trends, the posture/session timeline, and warning counts by time. Export telemetry or session statistics where offered and check that units/timestamps are preserved. A blank history or heatmap is valid when no corresponding observations have been collected; it must not be populated with fabricated measurements.

Open **Devices & network** to inspect the six MQTT topic roles and source freshness. Demo mode can exercise application rules without a running broker. A diagram of broker topics is not proof that a broker connection exists; use the reported connection state and actual incoming hardware data for that claim.

## Switch to real hardware

Follow [HARDWARE.md](HARDWARE.md) for the wiring, PlatformIO configuration, and Raspberry Pi requirements. The Pi vision adapter targets 64-bit Python 3.11 and requires the downloaded MediaPipe model. Its preview stays local. Useful entry points are:

```powershell
python infrastructure/setup.py
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up --build -d
pio run -d esp32/node_a
pio run -d esp32/node_b
```

The PlatformIO commands compile the configured firmware; flash it to the corresponding ESP32 using the hardware guide. On the Raspberry Pi, after installing its dependencies and configuring its environment:

```bash
python -m raspberry_pi.download_model
python -m raspberry_pi.gateway --calibrate --preview --metrics-csv evaluation/capture.csv
```

The local stack exposes the app at port 8000, Grafana at port 3001, and InfluxDB at port 8086. Broker/API ports initially bind to loopback; follow the guide's authenticated LAN setup before connecting remote nodes. Start the broker, configure the backend integration, flash both ESP32 publishers, then run gateway environment acquisition, pose estimation, and the actuator adapter. Keep broker credentials out of committed files.

Switch to **hardware** mode before evaluating real devices. Confirm each source reports fresh data. Then repeat steps 1–10 above with a seated participant, covered BH1750, measured ToF distances, deliberate posture changes, and actual departure from the chair. Observe physical lamp/buzzer/fan output as well as the dashboard command state.

Unplug the camera for a failure case. Verify the vision source becomes unavailable after the configured freshness interval, existing posture stops influencing warnings, and independent environment sensing continues. Disconnect the Internet or leave the AI provider unconfigured; local rules must remain usable. Disconnect one ESP32 and verify its data becomes stale instead of remaining silently current.

## Automated software verification

From the repository root, run the test suite:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The deterministic tests use an isolated store and explicit timestamps. They target behavior such as duration filtering, cooldowns, sensor freshness, session timing, score bounds, manual controls, privacy boundaries, and input validation. Consult the actual test output for the final coverage and pass count.

## Gather project evidence

Record actual data before claiming quantitative results. Use [evaluation/README.md](../evaluation/README.md) and its tooling. At a minimum, report the five-class confusion matrix and accuracy/F1, FPS on the exact Raspberry Pi/camera/model configuration, repeated ToF distance trials and MAE, and detection-to-physical-actuation latency over multiple trials. Include sample counts and at least one failure case. `evaluation/latency_capture.py` observes broker-command-to-gateway-ack latency on one clock; it is not the complete physical-violation-to-actuation interval. Report that distinction when using its output.

For a five-minute video, allocate roughly 30 seconds to the problem, 45 seconds to hardware, 45 seconds to architecture, 90 seconds to sensor/vision/actuator scenarios, 45 seconds to historical views, 25 seconds to session interpretation, and 20 seconds to measured results, limitations, and SDG 3/4/9 motivations. The source design also calls for a commercial comparison; research current products and cite the evidence rather than asserting that no comparable products exist.

The final presentation should distinguish: the runnable local software demo, configured external integrations, and measurements obtained from the assembled desk. See [REQUIREMENTS.md](REQUIREMENTS.md) for the scope mapping and remaining stretch features.
