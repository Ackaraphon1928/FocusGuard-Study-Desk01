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

The **Python camera · pose lab** on Overview is a presentation and control panel for the Python backend. `src/lib/vision/usePcCamera.ts` polls `/api/vision/status` and sends start, stop, calibration, view and preview controls. `posture.ts` and `protocol.ts` contain display/API types, label text and tracking guidance. All camera capture, MediaPipe inference, calibration and posture logic live in `backend/vision/`; no browser camera API or client-side classifier is used.

The camera is attached to the backend machine, including when the dashboard is opened remotely. The default status response contains derived metadata and no body landmark arrays. **Enable local debug preview** explicitly enables a server-rendered MJPEG stream with the skeleton; it is off by default and is not recorded. A capture started from this panel stops on navigation/hiding, while a pre-existing headless pipeline remains running.

From the project root, use `./start.ps1 -Install -Vision` to provision the optional Python camera dependencies and verified local model. Node/npm builds only the React UI; no browser MediaPipe SDK, WASM/model asset download or generated pose worker is involved. Frontend hot reload works normally. See [the Python camera guide](../docs/PC_CAMERA.md) for calibration, labels, terminal logs, PC/Pi deployment and limitations.

Keep API credentials and cloud configuration on the server: all `VITE_*` environment variables are public frontend assets.
