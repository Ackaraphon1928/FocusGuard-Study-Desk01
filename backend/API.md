# FocusGuard local API and decision rules

The backend runs on Python 3.11+ (verified here on Python 3.13) with FastAPI,
SQLite, Paho MQTT and optional AWS Bedrock. The dashboard is served at `/` from
`frontend/dist/`; interactive API documentation is at `/docs`. Build the React frontend with Node.js 24 LTS and `npm --prefix frontend ci` followed by `npm --prefix frontend run build`, or use `.\start.ps1 -Install`. If compiled assets are missing, `/` returns HTTP 503 with build instructions; the API remains available.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Linux/macOS: replace `.\.venv\Scripts\python.exe` with `.venv/bin/python`.
The default is **demo mode**, with explicitly simulated readings generated live.
There are no fabricated past sessions or benchmark measurements. Switch to hardware
mode in the dashboard or set `FOCUSGUARD_MODE=hardware` to accept actual telemetry.
Never run two API processes against the same physical actuators: use one Uvicorn worker.

## Routes

HTTP request bodies are JSON. The dedicated PC-camera WebSocket accepts binary JPEG frames as described below. Unknown values, invalid ranges, unsupported topics,
raw image/audio fields, invalid booleans, and nonfinite numbers are rejected with
HTTP 422. Unknown sessions return 404. Telemetry submitted in demo mode returns
409. Browser controls require the same origin as the API (cross-origin writes 403).
No authentication is configured in this prototype; use the loopback default or
a trusted LAN with an authenticated reverse proxy. Broker credentials stay server-side.

| Method | Path | Request / response |
| --- | --- | --- |
| GET | `/api/state` | Current state described below |
| GET | `/api/history?minutes=60&limit=3600` | Time-ordered live points, `minutes` 1–43200, `limit` 1–10000 |
| GET | `/api/sessions?limit=200` | Newest sessions first, including active session snapshot; limit max 1000 |
| GET | `/api/sessions/{id}` | One stored session |
| GET | `/api/events?limit=200` | Newest events first; limit max 5000 |
| GET | `/api/settings` | Flat settings object |
| PATCH | `/api/settings` | Partial flat settings; validates and persists atomically |
| POST | `/api/control` | `{ "action": "start" \| "pause" \| "resume" \| "end" \| "break" \| "finish_break" }` |
| POST | `/api/actuators` | Partial `{ "lamp_mode": "auto" \| "manual", "lamp_percent": 0..100, "fan_mode": "auto" \| "manual", "fan": true }`; specify manual mode for explicit levels |
| POST | `/api/demo` | `{ "scenario": "normal" \| "slouch" \| "too_close" \| "dark" \| "noisy" \| "hot" \| "away" \| "camera_offline" \| "occluded" \| "network_offline" }` |
| POST | `/api/demo/vision-source` | `{ "source": "simulated" \| "pc_camera" }`; demo only, returns current state |
| POST | `/api/demo/vision` | Deprecated metadata-only compatibility input; blocked while Python owns vision |
| GET | `/api/vision/status` | Python camera snapshot, derived observation and runtime diagnostics |
| POST | `/api/vision/input` | `{ "mode": "pc_camera", "view": "front" }` activates browser demo capture and returns a private `browserToken`; `{ "mode": "python_backend", "token": "..." }` restores prior backend profile |
| WebSocket | `/api/vision/pc-camera` | Same-origin binary JPEG input; protocols `['focusguard-pc', browserToken]`, JSON snapshot acknowledgement per frame |
| POST | `/api/vision/start` | `{ "camera_index": 0, "view": "front" }`; starts the camera attached to the backend |
| POST | `/api/vision/stop` | `{}`; stops capture and clears vision availability without selecting fake vision |
| POST | `/api/vision/calibrate` | `{}`; requests neutral calibration; 409 unless running |
| POST | `/api/vision/view` | `{ "view": "front" \| "side" }`; resets the neutral baseline when changed |
| POST | `/api/vision/preview` | `{ "enabled": true }`; explicit opt-in for local debug images, default false |
| GET | `/api/vision/preview.mjpeg` | Optional in-memory MJPEG stream; 409 while preview disabled; same-origin only |
| POST | `/api/mode` | `{ "mode": "demo" \| "hardware" }`; ends current session and clears source readings |
| POST | `/api/telemetry` | `{ "topic": "focusguard/...", "payload": { ...derived metadata... } }`; hardware mode only |
| POST | `/api/sessions/{id}/summary` | `{session_id,summary,summary_source,source,cloud_sent,aggregates,note}`; local fallback unless consent and Bedrock configured |
| GET | `/api/health` | Adapter health strings and pending Influx point count |
| GET | `/api/metrics` | Actual observed FPS, telemetry/rejected-message counts, publisher-to-gateway latency mean/p95, warning counts; unknown accuracy/MAE remain null |
| GET | `/api/evaluation` | Alias of `/api/metrics`; ground truth metrics come from evaluation tools |
| GET | `/api/export?kind=history&minutes=1440` | CSV download; `kind=history\|sessions\|events`; spreadsheet formula text escaped |
| WebSocket | `/api/live` | State snapshot every second; same-origin browser connections |

History rows contain `timestamp, score, distance_cm, seat_pressure, seat_occupied,
motion, lux, noise_level, temperature_c, humidity_percent, pressure_hpa, posture,
person_detected, vision_available, mode, vision_source, occupied, fps, vision_confidence,
lamp_percent, fan, buzzer, session_active, session_seconds`.
Timestamps are ISO 8601 UTC, not the browser's display timezone. History is sampled
at most once per second and retained locally for 30 days. Events and sessions stay
available until the local database is removed by its owner. The CSV routes cap
exports to 10000 history points, 1000 sessions, or 5000 events per request.
History, sessions, events and CSV export accept an optional `mode=demo|hardware`
query to filter at the database boundary. Every new event carries its source mode;
legacy events with no source label are returned as `mode:unknown` and are excluded
from mode-filtered queries. `/api/state` includes only current-mode events.
New history points, sessions and events also contain `vision_source` and `vision_input` (`python_backend|pc_camera`, null for simulation). Camera input changes split live-camera sessions and clear sustained evidence. Legacy records may omit these fields;
do not interpret an absent source as a verified PC-camera observation.

## Python camera processing

The browser controls and views a Python pipeline. Default input captures the camera attached to the
backend machine. Optional demo PC-camera input transports the browser webcam's JPEG frames to Python. Python runs MediaPipe, calibrates and classifies posture, then feeds
derived metadata directly into the engine. No Web Worker or frontend posture calculation is involved. Install the optional
`backend/requirements-vision.txt` and verify the model with
`python -m backend.vision.model --download`, or use `./start.ps1 -Install -Vision`.
Native dependencies are imported lazily; the normal simulator works without them.

`POST /api/vision/start` accepts an integer `camera_index` from 0 through 16
(default 0) and `view: front|side` (default front). It returns a snapshot while
startup can continue asynchronously; poll status to observe running or error.
Starting an already active identical configuration is idempotent. Stop before
changing the camera index; a conflicting owner/configuration returns 409. Control
operations are serialized and camera/model/classifier resources have one worker
owner. Native initialization failures appear in the snapshot and terminal logs.

In demo mode, Start selects `pc_camera`; environment, ToF, presence signals and
outputs remain explicitly simulated. Simulated FSR/PIR presence follows fresh
reliable camera presence, rather than manufacturing occupancy from unavailable
vision. In hardware mode, direct Python camera observations feed `gateway` vision
alongside real sensors. A mode change stops the old capture and clears evidence.
Do not also run an independent gateway camera owner against the same device.

`GET /api/vision/status` and every successful camera control return this shape:

```json
{
  "status": "running",
  "error": null,
  "message": "Local Python camera processing on CPU. Calibrate while sitting upright.",
  "delegate": "CPU",
  "inputMode": "python_backend",
  "cameraIndex": 0,
  "view": "front",
  "fps": 14.7,
  "inferenceMs": 22.5,
  "frames": 120,
  "updatedAt": "2026-10-24T01:00:00+00:00",
  "previewEnabled": false,
  "observation": {
    "type": "result",
    "landmarks": [],
    "people": 1,
    "fps": 14.7,
    "inferenceMs": 22.5,
    "width": 640,
    "height": 480,
    "result": {
      "posture": "GOOD",
      "candidate": "GOOD",
      "personDetected": true,
      "confidence": 0.92,
      "geometry": {},
      "calibration": {"status": "ready", "frames": 30, "required": 30},
      "reason": "tracking_upper_body"
    }
  }
}
```

Status is `idle|loading|running|stopped|error`. Delegate is the actual `CPU|GPU` or
null before initialization. Observation is null when no current result exists;
geometry is null when unusable, otherwise a derived numerical diagnostic object.
No raw normalized/world landmark arrays are exposed (`landmarks` is always empty).
The panel polls at 500 ms; inference and engine updates do not wait for a browser.
Calibration runs in Python over at least 30 reliable frames. Changing view resets
that baseline. Confidence measures landmark reliability, not benchmark accuracy.

### Browser PC-camera input and restoration

`POST /api/vision/input` with `mode:pc_camera` is demo-only (409 in hardware workspace). It releases native capture before browser permission is requested and reserves an exclusive in-memory lease. The response contains `browserToken`; normal status/state never exposes it. `view` is optional, defaulting to the current view. Another activation returns 409 while a lease exists.

Connect `/api/vision/pc-camera` with WebSocket subprotocols `['focusguard-pc', browserToken]`; the server selects `focusguard-pc`. No query token is accepted. Origin must exactly match the dashboard host and HTTP/HTTPS scheme. Send complete binary JPEG frames only, maximum 512 KiB and 1280×960/1,228,800 pixels. Headers/dimensions are checked before native decode. Each accepted frame receives a derived `VisionSnapshot` JSON acknowledgement. The frontend keeps one frame in flight; Python also bounds the input queue. Client timestamps, labels and landmark arrays are not accepted. Invalid input closes the connection and restores native input.

`POST /api/vision/input` with `mode:python_backend` and the owning `token` stops browser capture and restores the previous native camera index, view, preview and numeric calibration. Native capture resumes only if previously loading/running. A previous idle/stopped selection stays idle. Browser calibration is separate and never overwrites native `CALIBRATION_FILE`. A wrong/missing token returns 409 while PC mode is active; repeated off after restoration is harmless. Permission failure, browser cleanup and socket disconnect use the same restoration path. An unattached lease expires after 45 seconds; an attached idle socket after 10 seconds. First model initialization gets a bounded longer inference wait.

Explicit `/api/vision/stop`, workspace changes or selecting simulated vision cancel the lease without reopening the prior camera. Starting native capture directly during an active browser lease returns 409. `inputMode` is `python_backend|pc_camera`; both routes retain all inference/calibration in Python. Frame transport is memory-only and is never written to SQLite/Influx/logs or cloud AI. State privacy fields report `video_upload:true` and `camera_frame_transport:browser_to_python` during PC transport, with `cloud_video_upload:false` in both modes.

The optional preview is a separate privacy boundary. `POST /api/vision/preview`
with `enabled:true` enables server-rendered JPEG frames with skeleton/label text.
Only then can `GET /api/vision/preview.mjpeg` return the local stream. It is
same-origin restricted, no-store, and ends when capture stops or preview is
disabled. Frames are held in memory and are not persisted or forwarded to cloud
AI. Default monitoring needs only metadata. A camera started by the dashboard is
stopped when it leaves/hides; observing an existing headless pipeline does not
make navigation stop it. Hardware-only `VISION_AUTOSTART` supports continuous
capture independently of any browser.

Stop makes camera input unavailable and never silently resumes generated vision.
In demo mode, `POST /api/demo/vision-source` with `source:simulated` explicitly
stops local capture and restores simulation. Source changes split sessions;
history, sessions, events and CSV preserve `vision_source`. With PC vision
selected, scenario inputs are limited to `normal`, `dark`, `noisy`, `hot`, and
`network_offline` so synthetic postures cannot overwrite observed camera data.
Stopped/expired input yields `UNKNOWN` and null engine FPS. Explicit available
`NO_PERSON` remains distinct from unavailability. `sensor_stale_seconds` controls
engine freshness (default 15 seconds).

The old `POST /api/demo/vision` remains a **deprecated compatibility/testing seam**.
It requires demo mode and selected `pc_camera`, and returns 409 while the Python
service is loading/running. Its allowlist is `person_detected` (boolean), `posture`
(six-label enum), `confidence` (0–1), `fps` (0–240), `vision_available` (boolean),
optional `inference_ms` (0–60000) and `ambiguous_people` (boolean). The first five
are required. Raw frames, image/audio fields, keypoints and arbitrary geometry
return 422. The React app does not call this route. The response is
`{accepted,topic,timestamp}`; the internal topic is not evidence of MQTT delivery.

See [PC_CAMERA.md](../docs/PC_CAMERA.md) for installation, labels, terminal logs,
model provenance and PC/Pi limitations.
## State shape

```json
{
  "mode": "demo",
  "vision_source": "simulated",
  "vision_last_seen": "2026-10-24T01:00:00Z",
  "now": "2026-10-24T01:00:00Z",
  "running": true,
  "scenario": "normal",
  "occupancy": "USER_PRESENT",
  "sensors": {
    "distance_cm": 57.5, "seat_pressure": 718, "seat_occupied": true,
    "motion": true, "noise_level": 0.24, "noise_state": "QUIET",
    "temperature_c": 25.4, "humidity_percent": 53,
    "pressure_hpa": 1009.8, "lux": 460,
    "person_detected": true, "posture": "GOOD",
    "confidence": 0.94, "fps": 18.8, "vision_available": true
  },
  "score": {
    "total": 100, "status": "GOOD", "coverage_percent": 100,
    "components": {"lighting": 100, "noise": 100, "thermal": 100, "posture": 100, "distance": 100}
  },
  "session": {"id": "example", "state": "ACTIVE", "elapsed_seconds": 0,
    "sitting_seconds": 0, "breaks": 0, "good_posture_percent": null, "average_score": null},
  "actuators": {"lamp_percent": 0, "fan": false, "buzzer": false, "lamp_mode": "auto", "fan_mode": "auto"},
  "devices": [{"id": "nodeA", "name": "Seat & distance", "status": "online", "last_seen": "2026-10-24T01:00:00Z", "topic": "focusguard/nodeA/user", "simulated": true}],
  "events": [{"id": "example", "event_type": "SESSION_STARTED", "severity": "info", "message": "Study session started.", "timestamp": "2026-10-24T01:00:00Z"}],
  "settings": {}, "rules": [],
  "privacy": {"video_upload": false, "audio_recording": false, "cloud_ai_consent": false},
  "health": {"mqtt": "demo", "influxdb": "not_configured", "ai": "consent_required", "storage": "local_sqlite", "vision": "online", "service": "running"}
}
```

`session` is null when no session exists. Session states are `ACTIVE`, `PAUSED`,
`BREAK`, and historical `ENDED`. Additional statistics include `started_at`,
`ended_at`, `mode`, `continuous_sitting_seconds`, `wall_seconds`,
`duration_seconds` (active elapsed time), `sample_count`, `average_lux`,
`average_temperature`, `slouch_events`, `too_close_events`, `summary`,
`summary_source`, plus weighted integrals used for accurate session aggregation.
Active snapshots also expose break and eye-break countdowns.
`vision_source` is `simulated`, `pc_camera` or `gateway`; `vision_last_seen` is
the latest vision receipt timestamp or null. Vision device entries also expose
`source`, and their `simulated` flag is false for a PC camera. Metrics report the
current `vision_source` and measured camera FPS separately from synthetic inputs. `/api/state` also contains `vision_runtime` with camera status, actual delegate, camera index, view and preview-enabled state.

Missing or stale numeric values are **null**, never fabricated zeros. Missing
posture is `UNKNOWN`. Low pose confidence does not count as healthy posture.
Score components are 0–100, weighted by configured weights; absent components are
excluded and remaining weights renormalized. `coverage_percent` reports the known
weight, so a partial environmental score is distinguishable from full observation.
All components missing produces `total:null` and coverage zero.

## Default settings

| Key | Default | Accepted range |
| --- | ---: | --- |
| distance_min_cm | 40 | 10–150 |
| distance_max_cm | 80 | 20–250, greater than minimum |
| posture_warning_seconds | 30 | 1–600 |
| distance_warning_seconds | 5 | 1–300 |
| noise_warning_seconds | 10 | 1–600 |
| warning_cooldown_seconds | 60 | 1–3600 |
| break_interval_minutes | 45 | 0.1–180 |
| eye_break_interval_minutes | 20 | 0.1–120 |
| break_duration_seconds | 120 | 5–1800 |
| occupancy_pause_seconds | 15 | 1–300 |
| occupancy_end_minutes | 15 | 0.5–240 |
| sensor_stale_seconds | 15 | 2–300 |
| light_target_lux | 400 | 50–2000 |
| temperature_fan_c | 28 | 18–40 |
| noise_threshold | 0.65 | 0.05–1 |
| confidence_min | 0.6 | 0.1–1 |
| auto_session | true | boolean |
| adaptive_reminders | true | boolean |
| buzzer_enabled | true | boolean |
| cloud_ai_consent | false | boolean |

`weights` requires all five keys and must sum to one:
`{"lighting":0.15,"noise":0.15,"thermal":0.15,"posture":0.30,"distance":0.25}`.

Posture, distance and noise warnings require continuous observed conditions,
an active session, and fused presence. Each rule has an independent cooldown and
triggers a one-second bounded buzzer pulse. The rules array exposes elapsed,
threshold and cooldown seconds to explain the behavior. A stale camera or long
unobserved hardware tick gap resets posture evidence.

Two agreeing fresh signals among FSR, confident camera person detection and PIR
establish occupancy. Seat plus camera works while the user is still. Seat plus
PIR supports camera failure. A lone signal is insufficient for automatic session
start. Absence turns automatic outputs off immediately, pauses after the absence
grace, resumes an automatically paused session on return, and ends after the
configured absence timeout. Manual pause remains paused. Manual end suppresses a
new automatic session until the user leaves or explicitly starts another.

Active seated time excludes pauses, breaks, and unobserved stale intervals.
Movement-break completion resets continuous sitting only after the configured
duration; ending early does not create a fictitious restorative break. A long
actual absence also resets sitting and screen counters. Eye breaks use a separate
screen timer. When enabled, adaptation brings a movement reminder 20% earlier
while the current project score is below 60.

Automatic lamp brightness is proportional to the shortfall below target lux and
requires presence and an active session. Fan automation uses the configured
temperature threshold with a 1°C hysteresis. Missing environmental readings turn
the corresponding automatic output off. Manual overrides are explicit, remain
until returned to auto, and are cleared on mode changes. These are configurable
engineering rules, not universal medical thresholds or a measure of mental focus.

## Hardware, database and AI configuration

| Environment variable | Default / purpose |
| --- | --- |
| FOCUSGUARD_MODE | `demo` or `hardware` |
| FOCUSGUARD_DB | `backend/data/focusguard.sqlite3`; use `/app/data/focusguard.sqlite3` in Docker |
| VISION_AUTOSTART | `false`; true starts direct camera capture at startup in hardware mode only |
| CALIBRATION_FILE | Optional local numeric baseline file. Restore only when schema/view validate; save atomically after explicit calibration completes. Absent means memory-only calibration |
| CAMERA_BACKEND | `opencv` for USB/default camera, or `picamera2` for the configured CSI stack |
| CAMERA_INDEX / CAMERA_VIEW | `0` / `front` for headless autostart; dashboard Start supplies its own choices |
| CAMERA_WIDTH / CAMERA_HEIGHT | `640` / `480` capture request; actual dimensions depend on the driver |
| VISION_DELEGATE | `cpu` default; `gpu` or `auto` attempts GPU with logged CPU fallback |
| POSE_MODEL | Optional local model path; checked against the pinned SHA256 |
| FOCUSGUARD_LOG_LEVEL | `INFO`; `DEBUG` adds derived geometry; also accepts WARNING, ERROR, CRITICAL |
| MQTT_ENABLED | `false`; true enables optional broker bridge |
| MQTT_HOST / MQTT_PORT | `127.0.0.1` / `1883` |
| MQTT_USERNAME / MQTT_PASSWORD | Optional broker credentials; never returned to browser |
| MQTT_TLS | `false`; true uses system trusted certificates |
| INFLUX_URL | Empty disables adapter; local stack uses `http://localhost:8086` |
| INFLUX_TOKEN | Server-side write token; required for adapter |
| INFLUX_ORG / INFLUX_BUCKET | `focusguard` / `focusguard` |
| BEDROCK_MODEL_ID | Empty disables cloud generation; exact model or inference profile accessible in your account |
| AWS_REGION | `us-east-1`; use model's enabled region |
| AWS_PROFILE or standard AWS credential variables | Boto3 standard credential chain, server-side only |

Subscriptions: `focusguard/nodeA/user`, `focusguard/nodeB/environment`,
`focusguard/gateway/environment`, `focusguard/gateway/vision`, and
`focusguard/gateway/actuator_state`. Source payload schemas follow the original
design. Common `device_id`, `timestamp` and `sequence` metadata are accepted. A
timestamp must include a timezone; null timestamps use gateway receipt time and
do not contribute a hardware latency measurement. Out-of-order captures are
rejected. Captures over 30 seconds ahead are rejected; synchronized clocks are
required for meaningful latency. Null sensor readings remain unavailable.

Known firmware diagnostics (`uptime_ms`, `rssi_dbm`, `distance_valid`, `tof_status`,
`pir_warming_up`, `sample_count`, `sensor_status`, `calibrating`,
`ambiguous_people`, `inference_ms`) are validated and discarded from sensor values.
Other metadata keys are rejected at the ingest boundary. Raw video and speech are
never accepted, persisted, forwarded to Influx, or included in the AI request.

The backend publishes:

- `focusguard/actuator` QoS 1, **not retained**, containing `lamp_percent`, `fan`,
  `buzzer`, modes, `command_id`, `issued_at`, and `expires_at`. A heartbeat arrives
  every three seconds, commands expire after eight seconds. Run the included
  gateway watchdog so network/service failure turns physical outputs off.
- `focusguard/config` QoS 1 retained, containing validated settings (excluding
  cloud consent and credentials). Firmware applies keys it supports.
- `focusguard/system/event` QoS 1, not retained, containing newly recorded local
  events, including warnings and session changes. Recent events retained in SQLite
  during broker interruption are delivered on reconnect; this is a bounded recent
  event bridge rather than an unbounded durable MQTT outbox.

SQLite records every local sampled point. Optional InfluxDB v2 writes use
`POST /api/v2/write`, measurement `desk_conditions`, tag `mode=demo|hardware`, and
numeric fields `score,distance_cm,lux,noise_level,temperature_c,humidity_percent,
pressure_hpa,seat_pressure,fps,vision_confidence,lamp_percent,session_seconds`,
string fields `posture,vision_source`, and boolean fields `occupied,good_posture,seat_occupied,
motion,person_detected,vision_available,fan,buzzer,session_active` with millisecond
precision. Null measurements are omitted rather than written as false or zero.
New local events also write measurement `desk_events`, tags `mode,event_type,
severity` and string fields `message,session_id,vision_source` (session ID when available).
Event strings and tags are escaped; an SQLite row cursor forwards each newly
recorded event once per running process. MQTT's physical event bridge forwards
hardware events only, so changing from demo never replays simulator warnings to
the physical network. Writes run
in a separate worker, retry during outages and buffer up to 5000 points. Overflow
is visible as `health.influx_dropped`; originals remain in SQLite. The retry queue
is in memory and is not replayed into Influx after process restart. SQLite remains
the durable history for every sensor point and event during adapter failure.

The session-summary route always supports a clearly labeled local statistical
summary. Session end (manual end, automatic absence timeout, or a mode change)
also schedules a summary in a separate worker so monitoring and actuation continue
without waiting for the model. Pending summaries are drained on normal shutdown;
the dashboard endpoint remains available to regenerate one explicitly.
**Cloud AI is opt-in and sends an allowlist of nine aggregate statistics
only**: session minutes, average score, good-posture percentage, slouch count,
too-close count, breaks, average lux, noisy minutes and average temperature.
No user/session identifier, source samples, event timeline or media enters the
Bedrock prompt. Bedrock uses the server-side Boto3 Converse API; timeout/error or
missing configuration returns a labeled local summary while monitoring continues.
AWS credentials and paid model access must be configured by the operator; the
prototype does not invent an external AI response.

`requirements.lock.txt` records the exact verified backend dependency closure
(including Uvicorn standard extras, excluding unrelated development tools).
Install it with `python -m pip install -r backend/requirements.lock.txt` to repeat
that environment, or use the smaller direct-dependency `requirements.txt` for
another supported Python/platform. Optional Python camera dependencies are in `requirements-vision.txt`; Pi hardware deployment has platform-specific pins. Terminal vision INFO logs show lifecycle, actual delegate, calibration, transitions and approximately two-second performance reports. DEBUG adds derived geometry without media.

## Deterministic testing seam

```python
from backend.engine import FocusGuardEngine
from backend.storage import Store

engine = FocusGuardEngine(Store(":memory:"), mode="hardware", now=1000)
engine.step(1001, {
    "focusguard/nodeA/user": {"distance_cm": 55, "seat_occupied": True},
    "focusguard/gateway/vision": {
        "person_detected": True, "posture": "GOOD", "confidence": .95, "fps": 18
    }
})
assert engine.state(1001)["session"]["state"] == "ACTIVE"
```

Every engine operation accepts injected UTC epoch seconds. The engine uses no
wall clock, GPIO or network. `step` rejects clock regressions. API tests can use
`create_app(db_path=":memory:", mode="hardware", background=False)` and FastAPI's
TestClient; the runtime is at `app.state.runtime` after entering its lifespan.

Official API references used for implementation:
[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/),
[Eclipse Paho Python](https://eclipse.dev/paho/clients/python/docs/),
[InfluxDB v2 HTTP writes](https://docs.influxdata.com/influxdb/v2/write-data/developer-tools/api/),
[AWS Boto3 Converse](https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-runtime/client/converse.html).
