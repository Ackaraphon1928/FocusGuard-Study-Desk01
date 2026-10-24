# Verification record

Checked on 24 October 2026 in the supplied Windows workspace. The current frontend is React / TypeScript / Tailwind, built with Node.js 24 LTS and Vite.

## PC camera / MediaPipe checks

The browser-camera implementation was checked after the React migration on the same date:

| Check | Result |
|---|---|
| Python behavioral/integration suite | **76 tests passed**; includes strict PC metadata, source guards, fresh/stale observations, unknown/multiple-person inputs, no fake fallback, sustained warnings, session splitting and CSV/event/Influx provenance |
| React / TypeScript suite | **109 tests passed** in 11 Vitest files; includes 33 calibrated geometry/temporal classifier cases, metadata allowlist/bounds, fake-camera permission/worker/frame lifecycle, late startup cancellation, device loss, Stop, unmount and hidden-tab cleanup |
| Typecheck and production build | Strict TypeScript and Vite production build passed; the classic worker is built separately and model/WASM copied into `dist/vision/` |
| Dependency and model setup | Clean `npm ci` passed; source-absent Docker-style install prepared the official model and deferred worker bundling until source is available. This is a dependency-stage check, not a running-container test |
| Model integrity | Local and served model is **5,777,746 bytes**; SHA256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` matched |
| Classic worker compatibility | Both prepared and compiled **143,157-byte** worker artifacts parse as classic JavaScript via Node `vm.Script`; the pinned WASM loader's `importScripts` path is present |
| HTTP assets and live metadata | **21 checks passed** across production port 8000 and Vite port 5173: root, model, both WASM runtime/loader pairs, manifest hashes, WASM MIME type, worker, REST state and same-origin WebSocket metadata; raw source remains hidden in production |
| Mutation boundaries | Actual HTTP checks rejected a PC-source request containing frame fields with 422 on both origins, and foreign-origin writes with 403; the selected source was unchanged |
| Launcher | PowerShell parser passed; `start.ps1` launched the updated API with compiled dashboard successfully |
| Real webcam inference and visual review | **Not exercised**: no controllable browser was connected in this session. jsdom tests use fake camera/worker objects; they do not execute MediaPipe WASM, verify actual camera permissions, establish image accuracy or measure real FPS |

Run the [PC camera guide](PC_CAMERA.md) in a desktop browser to verify actual capture, model initialization, upright calibration, all posture labels, low light, cropped hips, multiple people and camera shutdown. The default source is simulated; selecting PC vision uses actual webcam labels with clearly labeled synthetic environment/ToF inputs. No real-world posture benchmark is claimed.

## Earlier React migration checks

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

No physical ESP32/Pi sensor or actuator integration was exercised, and real PC camera inference remains unverified in this session. Compiled firmware does not establish successful flashing, electrical behavior, sensor accuracy, camera inference speed, or physical latency. Follow [HARDWARE.md](HARDWARE.md), then collect actual results with [the evaluation protocol](../evaluation/README.md).

Re-run checks from the project root after installing dependencies:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

The default demo produces clearly labeled synthetic readings. Its optional PC camera input is recorded separately from synthetic vision; the remaining demo sensors stay simulated. Neither mode contains claimed hardware benchmark results.
