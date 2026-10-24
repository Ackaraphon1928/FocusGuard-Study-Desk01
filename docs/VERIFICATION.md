# Verification record

Checked on 24 October 2026 in the supplied Windows workspace. The current frontend is React / TypeScript / Tailwind, built with Node.js 24 LTS and Vite.

## Current migration checks

| Check | Result |
|---|---|
| Node runtime | Official Node.js **24.22.1** Windows x64 archive downloaded; SHA256 matched the official `SHASUMS256.txt` entry |
| Frontend dependency installation | Clean `npm ci` passed; `npm ls --depth=0` reported the pinned dependencies without missing or extraneous packages |
| Frontend runtime advisories | `npm audit --omit=dev` reported zero known vulnerabilities on the verification date |
| Python behavioral/integration suite | **55 tests passed**, using isolated stores and controlled time |
| React behavior and validation suite | **47 tests passed** in 8 Vitest files: five-page navigation, native dialogs, session controls, demo scenarios, summaries, mode switching, unknown inputs, settings edits during polling, manual actuator requests, API errors, and schema validation |
| Production static boundary | Tests cover compiled HTML serving, HTTP 503 instructions when the build is absent, HTTP 404 for raw frontend source, and API availability without a frontend build |
| Frontend typecheck and production build | Strict TypeScript project build and Vite production build passed; compiled React pages and hashed assets generated |
| PowerShell launcher | Parser validation passed; actual `start.ps1 -Port 8011` detected changed source, rebuilt the dashboard, and served the application using an isolated test database |
| Production HTTP and live metadata | Root, three referenced compiled JS/CSS assets, `/docs`, `/openapi.json`, `/api/health` and `/api/state` returned HTTP 200; same-origin WebSocket received demo metadata |
| Runtime source isolation | Raw entry source, package manifest, `node_modules`, and legacy JavaScript/CSS paths returned HTTP 404 |
| Vite development proxy | Development server on port 5173 served the React entry; REST metadata, same-origin mutation validation, and WebSocket metadata passed through to the API on port 8000 |

The verified Node archive SHA256 is `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5`. The portable runtime is in ignored `.tools/`; it is a local verification aid rather than a committed dependency. Frontend dependency versions were checked against the official npm registry and locked in `frontend/package-lock.json`.

TypeScript 6.0.3 is pinned because it is supported by the chosen TypeScript ESLint parser. React Hook Form resolvers 5.9.2 is pinned because the initial resolvers 6 optional-peer graph conflicted with an upstream Effect dependency. The final lock installed successfully with default peer checks; no force or legacy-peer-dependency option was used.

## Earlier implementation checks

The previous prototype verification established the following baseline. The React migration does not imply these hardware or deployment checks were repeated:

| Check | Recorded result |
|---|---|
| Python syntax across backend, Pi adapters, infrastructure and evaluation | Passed |
| Backend dependency compatibility | `pip check` passed |
| Session persistence and reflection | Local HTTP flow ended/saved a simulated session, created a local summary with cloud consent off, then started a new session |
| ESP32 Node A firmware | PlatformIO build succeeded for `esp32dev` |
| ESP32 Node B firmware | PlatformIO build succeeded for `esp32dev` |
| Docker Compose | Base and authenticated configurations validated; backend lock resolved for Linux/Python 3.11 |
| Model asset | Official MediaPipe lite model downloaded and checked against its pinned SHA256 |

React behavior tests run in jsdom. These do not establish browser layout, mobile rendering, or a completed visual review. No connected browser was available for this migration, so a real browser pass remains necessary.

The Docker engine was stopped during the earlier implementation. The new Dockerfile builds the frontend in a Node stage and copies compiled assets into the Python runtime; the containers, live InfluxDB queries, and Grafana runtime still require deployment verification. MQTT behavior and external AI boundaries are tested with controlled adapters.

No physical ESP32, Pi, camera, sensors, or actuators were attached. Compiled firmware does not establish successful flashing, electrical behavior, sensor accuracy, camera inference speed, or physical latency. Follow [HARDWARE.md](HARDWARE.md), then collect actual results with [the evaluation protocol](../evaluation/README.md).

Re-run checks from the project root after installing dependencies:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

The running demo produces clearly labeled synthetic readings. It does not contain claimed hardware benchmark results.
