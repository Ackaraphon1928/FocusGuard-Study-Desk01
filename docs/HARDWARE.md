# FocusGuard hardware and local deployment

The browser prototype runs with simulated telemetry until real devices are connected. Hardware mode consumes actual MQTT observations. Firmware, Pi services, InfluxDB and Grafana below implement the document's physical system; their wiring, sensing performance and camera FPS must be checked on the team's own hardware.

## Selected stack and hardware

- Two **ESP32 DevKit / ESP32-WROOM-32** boards running Arduino via pinned PlatformIO `espressif32@6.10.0`.
- Node A: **VL53L0X** I2C range sensor and **FSR** voltage divider. VL53L1X needs its own driver and is not interchangeable in this firmware.
- Node B: **HC-SR501 PIR** and a **3.3 V analog microphone amplifier** with waveform output, such as MAX4466. A sound module with an envelope-only output needs a different amplitude calculation; RMS in this firmware expects an AC waveform around a DC bias.
- **Raspberry Pi 4/5, 64-bit Raspberry Pi OS Bookworm, Python 3.11**, USB camera or Pi CSI camera, BME280 and BH1750.
- A low-voltage LED lamp with a 3.3 V logic-compatible MOSFET driver, active buzzer with transistor driver, and optional low-voltage fan with MOSFET and flyback diode.
- **Mosquitto 2, FastAPI, SQLite, InfluxDB 2.7 and Grafana 11** hosted locally. SQLite retains sessions/settings during time-series outages. AWS Bedrock is an optional summary provider after the dashboard's aggregate-sharing setting is enabled.

This is a single-desk prototype. GPIO drivers are active-high. Software does not switch mains appliances. Lamp, fan and buzzer loads use their own suitably rated power supply and driver; connect driver and Pi grounds. Never power motors or a lamp directly from a GPIO pin. Keep all ESP32 ADC inputs at 0–3.3 V.

## Wiring

| Device | Signal | Connection |
|---|---|---|
| Node A VL53L0X | SDA / SCL | ESP32 GPIO21 / GPIO22 |
| Node A VL53L0X | VIN / GND | Breakout-compatible 3.3 V / GND |
| Node A FSR | Analog divider junction | ESP32 GPIO34 (ADC1) |
| Node A FSR divider | FSR high side / 10 kΩ resistor low side | 3.3 V / GND |
| Node B PIR | OUT | ESP32 GPIO27 |
| Node B PIR | VCC / GND | Module-rated supply / common GND; verify OUT is 3.3 V |
| Node B analog microphone | OUT | ESP32 GPIO35 (ADC1) |
| Node B microphone | VCC / GND | 3.3 V / GND |
| Pi BME280 and BH1750 | SDA / SCL | BCM2 physical pin 3 / BCM3 physical pin 5 |
| Pi I2C sensors | VCC / GND | 3.3 V physical pin 1 / GND physical pin 6 |
| Lamp MOSFET driver | Gate/control | Pi BCM18 physical pin 12 |
| Fan MOSFET driver | Gate/control | Pi BCM23 physical pin 16 |
| Active buzzer driver | Control | Pi BCM24 physical pin 18 |

Use MOSFET gate resistors/pull-downs appropriate to the selected driver. FSR divider orientation here causes ADC readings to increase under pressure. Firmware uses different on/off thresholds to prevent chatter. I2C defaults: VL53L0X `0x29`, BME280 `0x76` (some boards use `0x77`), BH1750 `0x23` (or `0x5c`). Enable Pi I2C using `sudo raspi-config` and confirm sensor addresses using `i2cdetect -y 1`. The Pi user needs `gpio`, `i2c` and `video` group access.

The ToF sensor must point at the user's torso from a fixed screen/desk mounting position. It measures the return target's distance to the sensor, not eye-to-screen distance. Mount the camera steadily with ear, shoulder and hip visible. A side view supports forward lean; a front view supports lateral lean. A single image-plane camera cannot reliably distinguish every 3D direction at once. Select `CAMERA_VIEW=side` or `front` and disclose this in evaluation.

## Start the complete local server

Install Docker with Compose, then from the repository root:

```powershell
python infrastructure/setup.py
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml config --quiet
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up --build -d
```

Open the application at **http://localhost:8000**, Grafana at **http://localhost:3001**, and InfluxDB at **http://localhost:8086**. Grafana and InfluxDB usernames are `focusguard`; generated passwords and the Influx token are in the ignored `infrastructure/.env`. No fixed passwords are committed. The dashboard provisioned under Grafana's FocusGuard folder reads the `desk_conditions` measurement. Choose **demo** for simulated data or **hardware** for MQTT observations; they use separate tags.

The first run initializes persistent volumes. The setup script keeps existing credentials unchanged. Changing an initialization password in `.env` does not rotate an existing InfluxDB/Grafana volume's password. Use those applications' account settings for rotation. Stop without deleting history using:

```powershell
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml down
```

The API defaults to demo mode. Switch to Hardware in the dashboard once devices are online, or set `FOCUSGUARD_MODE=hardware` in `infrastructure/.env` before starting. Physical actuator commands are produced only in hardware mode. Backend data lives at `/app/data/focusguard.sqlite3` in a named Docker volume; InfluxDB/Grafana have separate named volumes. Ports are bound to loopback by default. The anonymous MQTT default is usable for local development; it is not reachable from ESP32 boards until LAN access is configured below.

The model and Docker images require an initial download. After installation, core acquisition, rules, alerts, storage, dashboard and GPIO control run on the local network without an AI/cloud connection. Keep the API/rule service running on the Pi or local server for automatic actuation.

## Connect ESP32 boards

Install PlatformIO Core or the VS Code PlatformIO extension. Copy `esp32/shared/config.example.h` to `esp32/shared/config.h` and set the Wi-Fi SSID/password, server LAN address and each board's MQTT credentials. This ignored file is the only place firmware credentials belong. Build/upload each board independently:

```powershell
pio run -d esp32/node_a
pio run -d esp32/node_a -t upload --upload-port COM5
pio device monitor -p COM5 -b 115200
pio run -d esp32/node_b
pio run -d esp32/node_b -t upload --upload-port COM6
```

Use the actual serial ports on your system. ADC1 pins are chosen because ESP32 Wi-Fi conflicts with ADC2 sampling. Calibrate `FSR_ON_THRESHOLD` and `FSR_OFF_THRESHOLD` using empty/seated serial readings, ensuring on > off. Adjust the microphone gain and `SOUND_RMS_FULL_SCALE` to match repeatable quiet/noisy test conditions. `noise_level` is normalized AC RMS, **not calibrated dB**. No audio buffers or speech are published. PIR ignores motion during its initial 60-second stabilization period. Node A sends `distance_cm: null` if range sensing is invalid rather than inventing a distance.

Firmware sends current readings once per second, retries Wi-Fi/MQTT with bounded exponential reconnect delays, and publishes retained online/offline status with MQTT Last Will. Sensor values are not retained. NTP gives UTC timestamps when available; unsynchronized devices send null timestamps and the backend uses receive time. Do not use those packets to claim a synchronized sensor-to-actuator latency measurement.

## Run the Raspberry Pi gateway

On 64-bit Bookworm/Python 3.11 from the cloned repository root:

```bash
sudo apt update
sudo apt install python3-venv libgl1 libglib2.0-0 i2c-tools
python3 -m venv .venv-pi
source .venv-pi/bin/activate
python -m pip install -r raspberry_pi/requirements.txt
cp raspberry_pi/.env.example raspberry_pi/.env
python -m raspberry_pi.download_model
python -m raspberry_pi.gateway --calibrate --preview
```

Set `MQTT_HOST` in `raspberry_pi/.env` to the broker's LAN address if it is on another computer. Set gateway credentials when broker authentication is enabled. Use `CAMERA_SOURCE=0` for the first USB camera, or a device path such as `/dev/video0`. A local `--preview` window is optional and never streamed. Run without it on a headless Pi.

For a Pi CSI camera, install `python3-picamera2` using apt, recreate the venv with `python3 -m venv --system-site-packages .venv-pi`, install requirements, and set `CAMERA_BACKEND=picamera2`. USB cameras use OpenCV's capture interface. Frames stay in process memory and are discarded after inference. The optional metrics CSV contains numeric geometry and timing only.

The pinned `mediapipe==0.10.18` has an official CPython 3.11 Linux ARM64 wheel. Versions `0.10.21` and `0.10.32` lack that wheel, so blindly upgrading can break Pi installation. The implementation uses **MediaPipe Tasks PoseLandmarker**, not the deprecated `mp.solutions.pose` API. The official versioned lite `.task` model is downloaded once and checked against the pinned SHA256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. `--sha256 HASH` can select another reviewed artifact hash; record it with your deployment.

For calibration, sit in a neutral posture with ear, shoulder and hip visible during the first 90 reliable frames. The median torso angle, shoulder angle, ear displacement and head height become a personal baseline in `raspberry_pi/calibration.json`. `--calibrate` replaces it deliberately; otherwise it is loaded at startup. Calibrate again after moving the camera. Geometry is aspect-ratio corrected; thresholds in that local JSON are engineering parameters requiring your own validation, not medical criteria.

```bash
# Record numeric metadata for later manual ground-truth labeling.
python -m raspberry_pi.gateway --metrics-csv evaluation/capture.csv
# Bring up one component at a time.
python -m raspberry_pi.gateway --no-vision --no-actuators
python -m raspberry_pi.gateway --no-sensors --no-actuators --preview
```

Sensor read errors trigger independent retries. An unplugged camera publishes `vision_available=false, posture=UNKNOWN` and retries capture every two seconds. Low-confidence, cropped and multi-person observations become UNKNOWN, not healthy posture. Short stable-label filtering precedes the backend's sustained-warning duration. Loss of a component leaves other components running and reports its failed health state; inspect startup logs if all workers exit.

GPIO commands require an ID, a timezone-aware `expires_at`, finite `lamp_percent` within 0–100, and boolean `fan`/`buzzer`. The Pi rejects retained, duplicate, malformed and expired commands. A beep lasts about 180 ms with a local five-second minimum gap. The backend refreshes commands every three seconds. If commands stop for ten seconds, all GPIO outputs switch off; shutdown also switches them off. An acknowledgement is published after GPIO application, so the UI and evaluation can distinguish a command from a hardware acknowledgement.

## MQTT topics

| Topic | Source | Metadata |
|---|---|---|
| `focusguard/nodeA/user` | ESP32 A | distance_cm, seat_pressure, seat_occupied, diagnostic flags |
| `focusguard/nodeB/environment` | ESP32 B | motion, noise_level, noise_state, PIR/sample diagnostics |
| `focusguard/gateway/environment` | Pi | temperature_c, humidity_percent, pressure_hpa, lux, sensor_status |
| `focusguard/gateway/vision` | Pi | person_detected, posture, confidence, fps, inference_ms, vision_available, calibration/ambiguity flags |
| `focusguard/actuator` | Local rule service | lamp_percent, fan, buzzer, command_id, expires_at |
| `focusguard/gateway/actuator_state` | Pi | applied outputs, command_id, watchdog state |
| `focusguard/system/event` | Local rule service | warning/session event metadata |
| `focusguard/config` | Local rule service | persisted dashboard rule thresholds; retained for subscribers |
| `focusguard/{nodeA,nodeB,gateway}/status` | Devices | retained online/offline availability |

Commands are QoS 1 without retain; snapshots are current QoS 0 metadata; availability uses retained Last Will. Acknowledgements confirm GPIO software application, not a light meter's confirmation that a lamp actually emitted light. Document that distinction in the physical demonstration.

## Authenticated LAN setup

Keep ports local for software-only use. Before connecting real boards over LAN:

1. Create `infrastructure/secrets/` and a Mosquitto password file with users `gateway`, `nodeA`, `nodeB`, `backend`. The supplied ACL restricts each publisher. Use Mosquitto's interactive password utility; passwords never appear in shell arguments:

   ```powershell
   New-Item -ItemType Directory -Force infrastructure/secrets
   docker run --rm -it -v "${PWD}/infrastructure/secrets:/secrets" eclipse-mosquitto:2.0.20 mosquitto_passwd -c /secrets/mosquitto-passwords gateway
   docker run --rm -it -v "${PWD}/infrastructure/secrets:/secrets" eclipse-mosquitto:2.0.20 mosquitto_passwd /secrets/mosquitto-passwords nodeA
   docker run --rm -it -v "${PWD}/infrastructure/secrets:/secrets" eclipse-mosquitto:2.0.20 mosquitto_passwd /secrets/mosquitto-passwords nodeB
   docker run --rm -it -v "${PWD}/infrastructure/secrets:/secrets" eclipse-mosquitto:2.0.20 mosquitto_passwd /secrets/mosquitto-passwords backend
   ```

2. Set `MQTT_USERNAME=backend`, its password and `MQTT_BIND_ADDRESS=0.0.0.0` in ignored `infrastructure/.env`. Keep the API on loopback unless LAN browser access is needed. If exposing it for a classroom demo, set `API_BIND_ADDRESS=0.0.0.0` on the trusted demo LAN; the prototype API has no multi-user authentication.
3. Start the authenticated override:

   ```powershell
   docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml -f infrastructure/compose.auth.yaml up --build -d
   ```

4. Set matching per-device credentials in Pi `.env` and ESP32 `config.h` and reflash. Permit inbound TCP1883 only from the intended LAN devices using the host firewall. For a broker outside a trusted local network, configure a TLS listener/certificates and use TLS-capable firmware transport; this ESP32 firmware's `WiFiClient` transport is intended for the local prototype network.

AWS Bedrock is optional: set `BEDROCK_MODEL_ID`, `AWS_REGION` and an AWS credential chain with permission to invoke that model. Docker can receive temporary AWS environment credentials from your local environment; do not commit them. Enable aggregate sharing in the dashboard and request a session summary. A local summary remains available if credentials, model access or internet fail. Raw imagery/audio is not part of the summary request.

## Verification and known boundaries

Use [the evaluation protocol](../evaluation/README.md) for posture labels, distance reference measurements, actual FPS and command-to-ack latency. Verify the full physical path by inducing a sustained pose violation, observing its event, seeing an actuator command and matching acknowledgement, and recording the buzzer/lamp response. Also test camera unplug/reconnect, covered light sensor, stationary user, out-of-range ToF, ambiguous second person, MQTT outage and unavailable AI.

The browser can demonstrate all rules with simulated values. That does not establish sensor accuracy, posture accuracy, Pi throughput or physical actuation. No measured hardware performance results are supplied. Thresholds and score weights remain configurable prototype heuristics. OTA firmware, multi-desk identity, calibrated sound-pressure measurement and facial identity are outside this implementation.

## Primary implementation references

- [Google MediaPipe Tasks Pose Landmarker Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python) and [official MediaPipe 0.10.18 release files](https://pypi.org/project/mediapipe/0.10.18/#files).
- [Adafruit BME280 driver](https://docs.circuitpython.org/projects/bme280/en/latest/) and [BH1750 driver](https://docs.circuitpython.org/projects/bh1750/en/latest/).
- [Adafruit VL53L0X Arduino library](https://github.com/adafruit/Adafruit_VL53L0X), [PubSubClient](https://github.com/knolleary/pubsubclient), [PlatformIO ESP32 platform](https://registry.platformio.org/platforms/platformio/espressif32).
- [Paho MQTT client API](https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html), [GPIO Zero output devices](https://gpiozero.readthedocs.io/en/stable/api_output.html), [InfluxDB Docker Compose setup](https://docs.influxdata.com/influxdb/v2/install/use-docker-compose/).
