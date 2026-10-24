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

All request bodies are JSON. Unknown values, invalid ranges, unsupported topics,
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
person_detected, vision_available, mode, occupied, fps, vision_confidence,
lamp_percent, fan, buzzer, session_active, session_seconds`.
Timestamps are ISO 8601 UTC, not the browser's display timezone. History is sampled
at most once per second and retained locally for 30 days. Events and sessions stay
available until the local database is removed by its owner. The CSV routes cap
exports to 10000 history points, 1000 sessions, or 5000 events per request.
History, sessions, events and CSV export accept an optional `mode=demo|hardware`
query to filter at the database boundary. Every new event carries its source mode;
legacy events with no source label are returned as `mode:unknown` and are excluded
from mode-filtered queries. `/api/state` includes only current-mode events.

## State shape

```json
{
  "mode": "demo",
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
string field `posture`, and boolean fields `occupied,good_posture,seat_occupied,
motion,person_detected,vision_available,fan,buzzer,session_active` with millisecond
precision. Null measurements are omitted rather than written as false or zero.
New local events also write measurement `desk_events`, tags `mode,event_type,
severity` and string fields `message,session_id` (session ID when available).
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
another supported Python/platform. Hardware vision dependencies are separate.

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
