# FocusGuard React frontend

The dashboard uses React 19, strict TypeScript 6, Tailwind CSS 4 and Vite 8. Node.js **24 LTS, version 24.15 or newer**, and npm are required to build or develop it. The verified project runtime is Node 24.22.1; `.node-version` records it. Dependencies use exact versions and `package-lock.json` records the complete resolved graph.

Install the official Node.js 24 LTS distribution from [nodejs.org](https://nodejs.org/en/download). This workspace also has an ignored portable runtime at `../.tools/node-v24.22.1-win-x64/` for local verification; it is not committed. `../start.ps1` finds that runtime automatically when present.

On Windows, use `npm.cmd` in place of `npm` if PowerShell's execution policy blocks `npm.ps1`.

## Production build

From the project root, run `./start.ps1 -Install`. The launcher installs Python and frontend dependencies, builds the frontend, then serves the application at <http://127.0.0.1:8000>. Later starts rebuild automatically when frontend source files are newer than `dist/index.html`. Use `./start.ps1 -Build` to force a rebuild.

To build manually, from this directory:

```powershell
npm ci
npm run build
```

Start the Python API from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

FastAPI serves only the generated `dist/` directory. If the build is absent, `/` returns an actionable HTTP 503 page while the API remains available. TypeScript files, `node_modules`, and source configuration are not served by the production API. Hash-based routes allow page navigation without a catch-all API route. Build output is ignored in Git and generated during Docker builds.

## Development

Run the Python API above in one terminal, then run these commands from `frontend/` in another:

```powershell
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite provides hot module replacement. Its `/api` proxy forwards REST and WebSocket traffic to port 8000; `/docs` and `/openapi.json` also proxy to the API. The proxy preserves the browser's Host and Origin so the API's same-origin mutation and WebSocket checks continue to work. Both services bind to loopback. Keep the API on port 8000 while using the default Vite configuration.

For the portable runtime in PowerShell, prepend its directory once in the terminal before running npm:

```powershell
$env:Path = "$((Resolve-Path '..\.tools\node-v24.22.1-win-x64').Path);$env:Path"
```

`npm run preview` previews the built static assets at port 4173. Use the production API or development proxy for the working application; the standalone preview does not proxy API requests.

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Vitest and React Testing Library verify behavior in jsdom. Browser layout and hardware behavior require their own verification; DOM tests do not establish those results.

## Code organization

`src/lib/` holds the typed API contract, HTTP client, live-data hooks and formatting helpers. `src/components/` holds shared UI components, and `src/pages/` holds feature screens. TanStack Query manages server state, React Router handles navigation, Recharts renders data trends, and React Hook Form with Zod validates settings. Tailwind theme tokens and shared styles are in `src/index.css`.

The **Python camera · pose lab** on Overview controls the Python backend. `src/lib/vision/usePcCamera.ts` polls `/api/vision/status` and sends input, start, stop, calibration, view and preview controls. `posture.ts` and `protocol.ts` contain display/API types, label text and tracking guidance. MediaPipe inference, calibration and all posture logic live in `backend/vision/`.

Default capture uses the camera attached to the backend machine, including when the dashboard is opened remotely. Demo-only **PC camera mode** requests browser webcam permission and sends JPEG frames to that Python pipeline over `/api/vision/pc-camera` WebSocket, using `['focusguard-pc', browserToken]` subprotocols. No token appears in status or URLs. The browser performs no pose inference. Capture is at most 640×480/10 FPS with one frame waiting for a JSON acknowledgement. Its video preview stays in the browser; frames sent to Python stay in memory and are not recorded or sent to cloud AI.

Disabling PC mode, permission failure, navigation/hiding or disconnection releases tracks and restores the previous native camera profile and calibration. It resumes only if previously running/loading. Explicit workspace/simulation/global-stop actions cancel capture without reopening the previous camera. The default status response has derived metadata and no body landmark arrays. **Enable local debug preview** explicitly enables a server-rendered MJPEG stream with the skeleton; it is off by default. A native capture started from this panel stops on navigation/hiding, while a pre-existing headless pipeline remains running.

From the project root, use `./start.ps1 -Install -Vision` to provision the optional Python camera dependencies and verified local model. Node/npm builds only the React UI; no browser MediaPipe SDK, WASM/model asset download or generated pose worker is involved. Frontend hot reload works normally. See [the Python camera guide](../docs/PC_CAMERA.md) for calibration, labels, terminal logs, PC/Pi deployment and limitations.

Keep API credentials and cloud configuration on the server: all `VITE_*` environment variables are public frontend assets.
