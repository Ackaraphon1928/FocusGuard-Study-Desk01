# FocusGuard

A local-first smart study desk prototype based on [the project design](FocusGuard_Privacy_Aware_Smart_Study_Desk.md). It combines posture, viewing distance, occupancy, lighting, relative noise, temperature, and humidity into explainable feedback and automated desk controls.

The application runs immediately with a sensor simulator. The same decision engine accepts real MQTT telemetry from the included ESP32 firmware and Raspberry Pi gateway. Simulated values are visibly labeled and kept separate from hardware readings. Python performs MediaPipe inference, calibration and all posture logic on the backend PC or Raspberry Pi. The default input captures a camera attached to that backend. An optional **PC camera mode** captures the browser computer's webcam for demos and sends bounded JPEG frames to the same Python pipeline. Frames are not recorded or sent to cloud AI; backend debug preview is off by default.

## Run it

Install **Node.js 24 LTS (24.15 or newer)** and **Python 3.11 or newer**. From this folder in PowerShell:

```powershell
.\start.ps1 -Install
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)**. The launcher installs locked frontend dependencies, builds React, and starts the local API. Subsequent starts need only ` .\start.ps1`; changed frontend sources rebuild automatically. Force a rebuild with ` .\start.ps1 -Build`. If your PowerShell policy prevents running scripts, use:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Linux/macOS, use `.venv/bin/python` in place of `.venv\Scripts\python.exe`. Press Ctrl+C to stop. Node.js builds the frontend; the compiled dashboard is served by FastAPI at runtime. The demo does not require Docker, a broker, hardware, or cloud credentials. Sessions, settings, events, and timestamped readings persist in the ignored `backend/data/` SQLite database. Set `FOCUSGUARD_DB` to use a different local database. An exact backend dependency snapshot for the verified Windows/Python 3.13 environment is in `backend/requirements.lock.txt`; the main requirements file supports platform-appropriate dependency resolution.

For frontend development, keep the API running at port 8000 and run `npm --prefix frontend run dev` in another terminal. Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)** for Vite hot reload. REST and WebSocket requests use the same-origin Vite proxy. See [frontend/README.md](frontend/README.md) for build, development, and quality-check commands.

## Try the complete flow

1. The overview starts a simulated session automatically when occupancy is detected.
2. Select **Try a scenario**, then **Enable fast rules** for a presentation. Try **Lights down**, **Leaning too close**, **A little slouch**, **A noisy room**, and **Feeling the heat**. The simulator changes inputs; the actual rules produce warnings and actuator states.
3. Try **Step away**, **Camera disconnected**, **An uncertain pose**, and **Sensor network offline**. Sensor freshness and confidence determine which inputs remain usable.
4. Pause, resume, or take a movement break. End the session to save its statistics, then generate its reflection in **Session history**.
5. Inspect trends, the posture timeline, and warning heatmap in **Analytics**. Download timestamped CSV data with **Export data**.
6. Tune thresholds, weights, reminders, and lamp/fan overrides in **Rules & settings**. Cloud summaries are opt-in. Fast demo timing persists until you change it.

The desk illustration displays a categorical posture state. For real camera processing, provision the optional Python vision dependencies and verified model:

```powershell
.\start.ps1 -Install -Vision
```

Then open **Overview → Python camera · pose lab → Start backend camera**, select the backend camera index and Front/Side, sit upright, and choose **Calibrate upright posture**. Front view supports a reliable head and both shoulders above a desk; hips are optional. Python logs posture/reason/FPS in the terminal. **Enable local debug preview** optionally streams a skeleton image without recording.

For testing in Demo workspace, enable **PC camera mode** and allow browser camera permission. The browser sends frames to Python for processing and shows a local webcam preview. Calibrate this input separately. **Turn PC camera mode off** to restore the previous Python backend camera index, view, preview and numeric calibration; it resumes if previously running, or stays idle if it was idle. Permission failure or connection loss also releases PC capture and restores the prior backend selection. The remaining demo sensors stay simulated. **Use simulated vision** explicitly selects generated posture. See the [camera guide](docs/PC_CAMERA.md) for setup, debugging and Pi deployment.
## Technology choices

| Layer | Implementation | Purpose |
|---|---|---|
| Dashboard | React 19, strict TypeScript 6, Tailwind CSS 4 | Typed component-based interface and responsive styling |
| Frontend tooling | Node.js 24 LTS, npm lockfile, Vite 8, ESLint | Reproducible builds, hot reload, static analysis |
| Frontend data and forms | TanStack Query 5, React Router 7, React Hook Form + Zod | Server-state caching, live updates, navigation and validated settings |
| Charts and UI | Recharts 3, Lucide React | Time-series charts and consistent icons |
| Camera processing | Python MediaPipe Tasks, OpenCV / Picamera2, shared calibrated classifier | Capture, inference, posture labels and terminal diagnostics on backend PC or Pi |
| Local service | Python, FastAPI, Pydantic, Uvicorn | Validated HTTP API, WebSocket feed, deterministic decision engine |
| Local journal | SQLite with timestamped records | Zero-service demo, settings/sessions/history persistence |
| IoT transport | Mosquitto MQTT 3.1.1, Paho, PubSubClient | Distributed sensor metadata, events, configuration, expiring actuator commands |
| Sensor nodes | ESP32, PlatformIO/Arduino | VL53L0X + FSR; PIR + relative sound amplitude |
| Edge gateway | Python 3.11, OpenCV, MediaPipe Tasks, Blinka, gpiozero | Local pose inference, BME280/BH1750 sensing, PWM lamp, buzzer, fan |
| Time-series stack | InfluxDB v2 + provisioned Grafana dashboard | Local time-series storage and course-required historical monitoring |
| Optional AI | AWS Bedrock Converse via boto3 | Aggregate-only session interpretation, with local fallback |
| Evaluation | Standard-library Python CLI + unittest | Classification metrics, FPS, distance MAE, latency analysis |

Node.js provides the standard frontend development and build runtime. FastAPI keeps the rules, sensor integration, and hardware-facing API in Python alongside the Raspberry Pi code, and replaces the document's optional Node-RED layer. The dedicated React dashboard supplements Grafana. SQLite makes the standalone demo practical; the Docker stack enables InfluxDB and Grafana for the integrated IoT prototype. The production API exposes only `frontend/dist/`; a missing build returns setup instructions with HTTP 503. Docker builds the frontend in a Node stage and copies only compiled assets into the Python runtime image.

## Hardware and full local stack

See **[Hardware and deployment guide](docs/HARDWARE.md)** for the pin map, wiring, drivers, network credentials, and camera calibration. The Pi vision environment specifically targets **64-bit Raspberry Pi OS, Python 3.11, and MediaPipe 0.10.18**, which has an ARM64 wheel. Desktop vision uses the optional `backend/requirements-vision.txt`; Pi deployment uses platform-specific dependency pins. Both share `backend.vision.posture` and can run the direct-backend camera service.

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

- Python processes camera frames and body landmarks locally. Dashboard status contains derived labels/diagnostics; the optional local MJPEG debug preview sends images only while explicitly enabled. No camera recording or landmark arrays enter SQLite, Influx, CSV or cloud summaries. The sound sensor sends amplitude, not speech. See [PC_CAMERA.md](docs/PC_CAMERA.md) for model provenance and SDK privacy scope.
- Low-confidence or stale vision is excluded from posture warnings. Independent environment sensors continue when the camera fails.
- Rules use sustained conditions and cooldowns. No actuator depends on a cloud AI response.
- Cloud AI is disabled by default. Configure `BEDROCK_MODEL_ID` and AWS credentials on the server, then enable consent in settings. Session summaries send an allowlisted aggregate object. Failed or unconfigured AI falls back to an explicitly labeled local summary.
- The dashboard and API are intended for a trusted local network. Keep the default loopback binding or put authenticated access in front of a shared deployment. The MQTT authentication overlay is included.

The Study Condition Score is a configurable engineering heuristic, not a clinical measure or inference of mental focus. Noise is relative amplitude, not calibrated decibels. Camera placement and occlusion affect posture geometry.

## Verify and evaluate

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall -q backend raspberry_pi evaluation infrastructure
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

Tests exercise rule timing, cooldowns, occupancy, staleness, sensor fusion, break/session accounting, persistence, backend camera lifecycle, Python posture classification, controls, input validation, privacy boundaries, AI failure, and gateway logic. They use isolated stores and controlled time.

See the **[verification record](docs/VERIFICATION.md)** for the software checks and their limits. React behavior tests use Vitest, React Testing Library, and jsdom; Python tests cover backend and hardware-adapter behavior. Browser layout, real services, and physical hardware require separate validation.

Use **[evaluation/README.md](evaluation/README.md)** to collect and report real data. Its CLI computes posture precision/recall/F1/confusion matrix, observed FPS, ToF MAE, and latency statistics. The included CSV is marked synthetic and requires an explicit flag; it does not represent measured performance.

The software demo and integrations are implemented. Physical sensor accuracy, Raspberry Pi inference speed, lamp/buzzer behavior, and end-to-end hardware latency must be verified on the assembled desk. No physical measurements are claimed here.

## Project map

```text
frontend/           React / TypeScript / Tailwind dashboard, Node build, component tests
backend/            API, shared Python vision, rules, journal, MQTT/Influx/Bedrock
esp32/              Node A and B firmware + shared configuration
raspberry_pi/       Shared-vision gateway adapter, I2C sensors, GPIO outputs
infrastructure/     Compose stack, credentials setup, MQTT, Grafana provisioning
evaluation/         Metrics CLI, synthetic example, latency capture, protocol
tests/              Deterministic behavior and integration checks
docs/               Hardware guide, requirements mapping, demo walkthrough
```

Start with the **[architecture and design](docs/ARCHITECTURE.md)**, **[demo walkthrough](docs/DEMO.md)**, **[requirements traceability](docs/REQUIREMENTS.md)**, and **[API reference](backend/API.md)**. Optional stretch ideas such as multi-desk identity, mobile notifications, OTA updates, cloud synchronization, and a trained advanced classifier are documented as future work. Presentation assets and a recording require the assembled hardware and real experimental evidence.
