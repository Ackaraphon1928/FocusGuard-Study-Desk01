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

The optional **PC camera · pose lab** on Overview processes webcam frames locally in a MediaPipe Web Worker, overlays the skeleton and derives calibrated posture labels. In Front view, a reliable head and both shoulders are enough; hips may remain behind the desk. Start the camera, sit upright at your normal desk distance, and explicitly calibrate until the status becomes Calibrated. Local diagnostics show upper-body/full-body tracking and why a frame is UNKNOWN. A side/profile view benefits from a visible shoulder and hip.

Front-view forward lean uses calibrated size and head-to-shoulder changes as a posture proxy; it does not measure absolute depth or spine curvature. Slouch includes head collapse and the supplied reclined/chin-up examples. The seven `IMG_dataset/` screenshots are a small tuning/regression set from one person, not an accuracy benchmark. The backend receives derived metadata only; camera frames are not uploaded or recorded, and audio is not requested. See [PC camera setup and limitations](../docs/PC_CAMERA.md). Keep API credentials and cloud configuration on the server: all `VITE_*` environment variables are public frontend assets.

`npm ci`, `npm run dev` and `npm run build` prepare the pinned MediaPipe 0.10.32 WASM and hash-verified lite pose model under `public/vision/`. The first installation needs network access for the official model unless the verified Pi model already exists. Runtime uses same-origin assets. The generated classic pose worker is rebuilt on startup/build; restart the dev server after changing `src/workers/pose.worker.ts` or its classifier imports. React UI changes still hot reload. Run `npm run prepare:vision` to retry asset setup; license and provenance notices are in `public/vision/`.
