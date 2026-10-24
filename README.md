# FocusGuard

A local-first smart study desk prototype based on [the project design](FocusGuard_Privacy_Aware_Smart_Study_Desk.md). It combines posture, viewing distance, occupancy, lighting, relative noise, temperature, and humidity into explainable feedback and automated desk controls.

The application runs immediately with a sensor simulator. The same decision engine accepts real MQTT telemetry from the included ESP32 firmware and Raspberry Pi gateway. Simulated values are visibly labeled and kept separate from hardware readings. No camera frames or recorded audio are sent to the backend.

## Run it

Python 3.11 or newer is required for the dashboard/backend. From this folder in PowerShell:

```powershell
.\start.ps1 -Install
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)**. Subsequent starts need only ` .\start.ps1`. If your PowerShell policy prevents running scripts, use:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Linux/macOS, use `.venv/bin/python` in place of `.venv\Scripts\python.exe`. Press Ctrl+C to stop. The demo does not require Docker, a broker, hardware, Node.js, or cloud credentials. Sessions, settings, events, and timestamped readings persist in the ignored `backend/data/` SQLite database. Set `FOCUSGUARD_DB` to use a different local database. An exact dependency snapshot for the verified Windows/Python 3.13 environment is in `backend/requirements.lock.txt`; the main requirements file supports platform-appropriate dependency resolution.

## Try the complete flow

1. The overview starts a simulated session automatically when occupancy is detected.
2. Select **Try a scenario**, then **Enable fast rules** for a presentation. Try **Lights down**, **Leaning too close**, **A little slouch**, **A noisy room**, and **Feeling the heat**. The simulator changes inputs; the actual rules produce warnings and actuator states.
3. Try **Step away**, **Camera disconnected**, **An uncertain pose**, and **Sensor network offline**. Sensor freshness and confidence determine which inputs remain usable.
4. Pause, resume, or take a movement break. End the session to save its statistics, then generate its reflection in **Session history**.
5. Inspect trends, the posture timeline, and warning heatmap in **Analytics**. Download timestamped CSV data with **Export data**.
6. Tune thresholds, weights, reminders, and lamp/fan overrides in **Rules & settings**. Cloud summaries are opt-in. Fast demo timing persists until you change it.

The desk illustration displays a categorical posture state; it is explicitly **not a live camera feed**. The real camera preview runs locally on the Raspberry Pi.

## Technology choices

| Layer | Implementation | Purpose |
|---|---|---|
| Dashboard | HTML, CSS, native JavaScript modules, SVG charts | Responsive interface, no frontend build or third-party runtime required |
| Local service | Python, FastAPI, Pydantic, Uvicorn | Validated HTTP API, WebSocket feed, deterministic decision engine |
| Local journal | SQLite with timestamped records | Zero-service demo, settings/sessions/history persistence |
| IoT transport | Mosquitto MQTT 3.1.1, Paho, PubSubClient | Distributed sensor metadata, events, configuration, expiring actuator commands |
| Sensor nodes | ESP32, PlatformIO/Arduino | VL53L0X + FSR; PIR + relative sound amplitude |
| Edge gateway | Python 3.11, OpenCV, MediaPipe Tasks, Blinka, gpiozero | Local pose inference, BME280/BH1750 sensing, PWM lamp, buzzer, fan |
| Time-series stack | InfluxDB v2 + provisioned Grafana dashboard | Local time-series storage and course-required historical monitoring |
| Optional AI | AWS Bedrock Converse via boto3 | Aggregate-only session interpretation, with local fallback |
| Evaluation | Standard-library Python CLI + unittest | Classification metrics, FPS, distance MAE, latency analysis |

FastAPI replaces the document's optional Node-RED layer. The dedicated dashboard supplements Grafana. SQLite makes the standalone demo practical; the Docker stack enables InfluxDB and Grafana for the integrated IoT prototype. Lifecycle and storage integration follow the [FastAPI documentation](https://fastapi.tiangolo.com/advanced/events/) and [InfluxDB v2 write API](https://docs.influxdata.com/influxdb/v2/api/write/).

## Hardware and full local stack

See **[Hardware and deployment guide](docs/HARDWARE.md)** for the pin map, wiring, drivers, network credentials, and camera calibration. The Pi vision environment specifically targets **64-bit Raspberry Pi OS, Python 3.11, and MediaPipe 0.10.18**, which has an ARM64 wheel. This is a separate environment from the backend.

To start Mosquitto, InfluxDB, Grafana, and the app with Docker:

```powershell
python infrastructure/setup.py
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up --build -d
```

Generated credentials stay in ignored files. The app is at port **8000**, Grafana at **3001**, and InfluxDB at **8086**. Stop the standalone app first to free port 8000. All services bind to loopback by default. Follow the hardware guide's authenticated LAN instructions to connect physical nodes.

After wiring and configuring the gateway on the Pi:

```bash
python3.11 -m venv .venv-pi
.venv-pi/bin/python -m pip install -r raspberry_pi/requirements.txt
.venv-pi/bin/python -m raspberry_pi.download_model
.venv-pi/bin/python -m raspberry_pi.gateway --calibrate --preview
```

Switch **Devices & network → Data source → Real hardware**, or start with ` .\start.ps1 -Mode hardware`. Hardware mode never fills missing sensors with demo data. GPIO actuation requires a running local service; expired commands drive outputs to a safe off state when that connection fails.

## Privacy and failure behavior

- Video inference and optional preview stay on the Pi; only derived posture metadata is published. The sound sensor sends amplitude, not speech.
- Low-confidence or stale vision is excluded from posture warnings. Independent environment sensors continue when the camera fails.
- Rules use sustained conditions and cooldowns. No actuator depends on a cloud AI response.
- Cloud AI is disabled by default. Configure `BEDROCK_MODEL_ID` and AWS credentials on the server, then enable consent in settings. Session summaries send an allowlisted aggregate object. Failed or unconfigured AI falls back to an explicitly labeled local summary.
- The dashboard and API are intended for a trusted local network. Keep the default loopback binding or put authenticated access in front of a shared deployment. The MQTT authentication overlay is included.

The Study Condition Score is a configurable engineering heuristic, not a clinical measure or inference of mental focus. Noise is relative amplitude, not calibrated decibels. Camera placement and occlusion affect posture geometry.

## Verify and evaluate

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall -q backend raspberry_pi evaluation infrastructure
```

Tests exercise rule timing, cooldowns, occupancy, staleness, sensor fusion, break/session accounting, persistence, controls, input validation, privacy boundaries, AI failure, and pure gateway logic. They use isolated stores and controlled time.

The delivered version passes **54 software tests** and both ESP32 firmware builds. See the **[verification record](docs/VERIFICATION.md)** for the exact checks and limits, including the unavailable browser and stopped Docker engine.

Use **[evaluation/README.md](evaluation/README.md)** to collect and report real data. Its CLI computes posture precision/recall/F1/confusion matrix, observed FPS, ToF MAE, and latency statistics. The included CSV is marked synthetic and requires an explicit flag; it does not represent measured performance.

The software demo and integrations are implemented. Physical sensor accuracy, Raspberry Pi inference speed, lamp/buzzer behavior, and end-to-end hardware latency must be verified on the assembled desk. No physical measurements are claimed here.

## Project map

```text
frontend/           Dashboard, illustrations, charts, controls
backend/            API, decision engine, persistence, MQTT/Influx/Bedrock adapters
esp32/              Node A and B firmware + shared configuration
raspberry_pi/       Local camera model, calibration, I2C sensors, GPIO outputs
infrastructure/     Compose stack, credentials setup, MQTT, Grafana provisioning
evaluation/         Metrics CLI, synthetic example, latency capture, protocol
tests/              Deterministic behavior and integration checks
docs/               Hardware guide, requirements mapping, demo walkthrough
```

Start with the **[architecture and design](docs/ARCHITECTURE.md)**, **[demo walkthrough](docs/DEMO.md)**, **[requirements traceability](docs/REQUIREMENTS.md)**, and **[API reference](backend/API.md)**. Optional stretch ideas such as multi-desk identity, mobile notifications, OTA updates, cloud synchronization, and a trained advanced classifier are documented as future work. Presentation assets and a recording require the assembled hardware and real experimental evidence.
