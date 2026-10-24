"""FastAPI HTTP service and same-origin dashboard host."""

import asyncio
from contextlib import asynccontextmanager, suppress
import csv
import io
import logging
import os
from pathlib import Path
import time
from typing import Any, Literal
from urllib.parse import urlsplit

from anyio import CancelScope

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .engine import FocusGuardEngine
from .integrations import InfluxWriter, MqttBridge, SummaryService
from .storage import Store
from .logging_config import configure_logging
from .vision.service import LocalVisionService, unavailable_metadata
from .vision.input_mode import InputModeCoordinator

VISION_TOPIC = "focusguard/gateway/vision"

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("focusguard")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyRequest(StrictModel):
    pass


class ControlRequest(StrictModel):
    action: Literal["start", "pause", "resume", "end", "break", "finish_break"]


class DemoRequest(StrictModel):
    scenario: Literal["normal", "slouch", "too_close", "dark", "noisy", "hot", "away", "camera_offline", "occluded", "network_offline"]


class ModeRequest(StrictModel):
    mode: Literal["demo", "hardware"]


class VisionSourceRequest(StrictModel):
    source: Literal["simulated", "pc_camera"]


class PcVisionRequest(StrictModel):
    """The entire browser/server vision boundary; media is never accepted."""
    model_config = ConfigDict(extra="forbid", strict=True)

    person_detected: bool
    posture: Literal["GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT", "NO_PERSON", "UNKNOWN"]
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    fps: float = Field(ge=0, le=240, allow_inf_nan=False)
    vision_available: bool
    inference_ms: float = Field(default=0, ge=0, le=60000, allow_inf_nan=False)
    ambiguous_people: bool = False


class VisionStartRequest(StrictModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    camera_index: int = Field(default=0, ge=0, le=16)
    view: Literal["front", "side"] = "front"


class VisionViewRequest(StrictModel):
    view: Literal["front", "side"]


class VisionPreviewRequest(StrictModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool


class VisionInputRequest(StrictModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    mode: Literal["python_backend", "pc_camera"]
    view: Literal["front", "side"] | None = None
    token: str | None = Field(default=None, min_length=1, max_length=256)


class TelemetryRequest(StrictModel):
    topic: str
    payload: dict[str, Any]


class Runtime:
    def __init__(self, db_path=None, mode=None, vision_factory=None):
        self.store = Store(db_path or os.getenv("FOCUSGUARD_DB", str(ROOT / "backend" / "data" / "focusguard.sqlite3")))
        self.engine = FocusGuardEngine(self.store, mode=mode or os.getenv("FOCUSGUARD_MODE", "demo"), now=time.time())
        self.mqtt = MqttBridge(self.engine)
        self.influx = InfluxWriter()
        self.summary = SummaryService(self.engine)
        self.tick_count = 0
        self.last_error = None
        self.event_cursor = self.store.latest_event_cursor()
        self.summary_tasks = {}
        self.camera_mode = None
        self.vision_controls = asyncio.Lock()
        self.vision = (vision_factory or LocalVisionService)(self._receive_vision_metadata)
        self.vision_input = InputModeCoordinator(self)

    def _receive_vision_metadata(self, metadata):
        """Native worker -> engine; obsolete workers cannot cross mode boundaries."""
        with self.engine.lock:
            if self.camera_mode is None or self.camera_mode != self.engine.mode:
                return
            if self.engine.mode == "demo" and self.engine.vision_source != "pc_camera":
                return
            now = time.time()
            if self.engine.mode == "demo":
                self.engine.ingest_pc_vision(metadata, now)
            else:
                self.engine.ingest(VISION_TOPIC, metadata, now)
            point = self.engine.step(now)
            if point:
                self.influx.enqueue(point)

    def start_vision(self, camera_index=0, view="front"):
        if self.vision_input.active:
            raise RuntimeError("Close PC camera mode before starting the backend camera")
        snapshot = self.vision.snapshot()
        if snapshot["status"] in {"loading", "running"}:
            if snapshot["cameraIndex"] != camera_index or snapshot["view"] != view:
                raise RuntimeError("Stop the active camera before changing its camera index or initial view")
            return snapshot
        if self.engine.mode == "demo":
            self.engine.set_vision_source("pc_camera", time.time())
        self.camera_mode = self.engine.mode
        try:
            return self.vision.start(camera_index=camera_index, view=view)
        except Exception:
            self._receive_vision_metadata(unavailable_metadata())
            self.camera_mode = None
            raise

    def stop_vision(self):
        with self.engine.lock:
            owner = self.camera_mode
            self.camera_mode = None
            if owner == self.engine.mode and (owner == "hardware" or self.engine.vision_source == "pc_camera"):
                now = time.time()
                if owner == "demo":
                    self.engine.ingest_pc_vision(unavailable_metadata(), now)
                else:
                    self.engine.ingest(VISION_TOPIC, unavailable_metadata(), now)
                point = self.engine.step(now)
                if point:
                    self.influx.enqueue(point)
        return self.vision.stop()

    async def process_events(self):
        """Forward each newly persisted event once, and schedule ended summaries.

        An SQLite row cursor avoids dropping an event burst between API ticks.
        Cloud permission is captured when the session actually ends and checked
        again by the summary service immediately before a remote request.
        """
        for cursor, event in self.store.events_after(self.event_cursor):
            self.influx.enqueue_event(event)
            if event.get("event_type") == "SESSION_ENDED":
                session_id = event.get("session_id")
                session = self.store.get_session(session_id) if session_id else None
                if session and not session.get("summary") and session_id not in self.summary_tasks:
                    allow_cloud = bool(self.engine.settings["cloud_ai_consent"] and self.summary.model)
                    task = asyncio.create_task(self._automatic_summary(session_id, allow_cloud))
                    self.summary_tasks[session_id] = task
                    task.add_done_callback(lambda finished, key=session_id: self.summary_tasks.pop(key, None))
            self.event_cursor = cursor

    async def _automatic_summary(self, session_id, allow_cloud):
        try:
            return await asyncio.to_thread(self.summary.generate, session_id, time.time(), allow_cloud)
        except Exception:
            log.exception("Automatic session summary failed; saved statistics remain available")
            return None

    async def wait_summaries(self):
        """Drain pending summaries before closing their local SQLite store."""
        while self.summary_tasks:
            await asyncio.gather(*list(self.summary_tasks.values()), return_exceptions=True)

    def state(self):
        state = self.engine.state(time.time())
        state["health"].update(mqtt="demo" if self.engine.mode == "demo" else self.mqtt.status, influxdb=self.influx.status, ai="consent_required" if not self.engine.settings["cloud_ai_consent"] else self.summary.last_status, service="running" if not self.last_error else "degraded")
        state["health"]["influx_pending"] = len(self.influx.pending)
        state["health"]["influx_dropped"] = self.influx.dropped
        state["actuator_ack"] = self.mqtt.last_ack
        snapshot = self.vision_input.snapshot()
        state["vision_runtime"] = {key: snapshot[key] for key in ("status", "delegate", "cameraIndex", "view", "previewEnabled")}
        state["vision_runtime"]["inputMode"] = snapshot["inputMode"]
        return state

    async def loop(self):
        while True:
            try:
                point = self.engine.step(time.time())
                if point:
                    self.influx.enqueue(point)
                self.mqtt.publish(time.time())
                await self.process_events()
                self.tick_count += 1
                if self.tick_count % 3600 == 0:
                    self.store.prune(time.time() - 30 * 86400)
                self.last_error = None
            except Exception as exc:
                self.last_error = type(exc).__name__
                log.exception("Gateway tick failed; retrying next tick")
            await asyncio.sleep(.25)


def create_app(db_path=None, mode=None, background=True, frontend_dir=None, vision_factory=None):
    @asynccontextmanager
    async def lifespan(application):
        configure_logging()
        runtime = Runtime(db_path, mode, vision_factory)
        application.state.runtime = runtime
        runtime.mqtt.start()
        runtime.influx.start()
        point = runtime.engine.step(time.time())
        if point:
            runtime.influx.enqueue(point)
        task = asyncio.create_task(runtime.loop()) if background else None
        try:
            if os.getenv("VISION_AUTOSTART", "false").lower() == "true":
                if runtime.engine.mode != "hardware":
                    log.warning("VISION_AUTOSTART ignored in demo mode; start the camera explicitly from the dashboard")
                else:
                    runtime.start_vision(int(os.getenv("CAMERA_INDEX", "0")), os.getenv("CAMERA_VIEW", "front"))
            yield
        finally:
            # A disconnect/idle watchdog may already be restoring a native
            # camera. Finish that handoff before the final shutdown stop.
            async with runtime.vision_controls:
                await runtime.vision_input.cancel()
                await asyncio.to_thread(runtime.stop_vision)
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            runtime.mqtt.stop()
            await runtime.process_events()
            await runtime.wait_summaries()
            await runtime.process_events()
            runtime.influx.stop()
            runtime.store.close()

    application = FastAPI(title="FocusGuard", version="1.0.0", description="Local-first smart desk prototype. Engineering condition score; no mental-focus inference.", lifespan=lifespan)

    @application.middleware("http")
    async def local_boundary(request: Request, call_next):
        # Same-origin mutations prevent a random remote page from changing local
        # device controls. CLI/device clients without Origin remain supported.
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
                return JSONResponse(status_code=403, content={"detail": "Cross-origin device control is disabled"})
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > 16384):
                return JSONResponse(status_code=413, content={"detail": "Only small metadata requests are accepted"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    def runtime():
        return application.state.runtime

    @application.get("/api/vision/status")
    async def vision_status():
        return runtime().vision_input.snapshot()

    @application.post("/api/vision/input")
    async def vision_input(data: VisionInputRequest):
        owner = runtime()
        async with owner.vision_controls:
            if data.mode == "pc_camera":
                if data.token is not None:
                    raise HTTPException(422, "A token is only accepted when closing PC camera mode")
                try:
                    result = await owner.vision_input.activate(data.view or owner.vision.snapshot()["view"])
                except RuntimeError as exc:
                    raise HTTPException(409, str(exc))
            else:
                if owner.vision_input.active and not owner.vision_input.owns(data.token):
                    raise HTTPException(409, "Only the active PC camera client can restore its backend camera profile")
                result = await owner.vision_input.restore()
            await owner.process_events()
            return result

    @application.post("/api/vision/start")
    async def vision_start(data: VisionStartRequest):
        async with runtime().vision_controls:
            try:
                await asyncio.to_thread(runtime().start_vision, data.camera_index, data.view)
            except RuntimeError as exc:
                raise HTTPException(409, str(exc))
            await runtime().process_events()
            return runtime().vision_input.snapshot()

    @application.post("/api/vision/stop")
    async def vision_stop(data: EmptyRequest = EmptyRequest()):
        async with runtime().vision_controls:
            await runtime().vision_input.cancel()
            await asyncio.to_thread(runtime().stop_vision)
            await runtime().process_events()
            return runtime().vision_input.snapshot()

    @application.post("/api/vision/calibrate")
    async def vision_calibrate(data: EmptyRequest = EmptyRequest()):
        async with runtime().vision_controls:
            try:
                runtime().vision.calibrate()
                return runtime().vision_input.snapshot()
            except RuntimeError as exc:
                raise HTTPException(409, str(exc))

    @application.post("/api/vision/view")
    async def vision_view(data: VisionViewRequest):
        async with runtime().vision_controls:
            runtime().vision.set_view(data.view)
            return runtime().vision_input.snapshot()

    @application.post("/api/vision/preview")
    async def vision_preview(data: VisionPreviewRequest):
        async with runtime().vision_controls:
            runtime().vision.set_preview(data.enabled)
            return runtime().vision_input.snapshot()

    @application.get("/api/vision/preview.mjpeg", include_in_schema=False)
    async def vision_preview_stream(request: Request):
        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") == "cross-site" or (origin and origin.rstrip("/") != str(request.base_url).rstrip("/")):
            raise HTTPException(403, "Camera preview is restricted to this dashboard origin")
        if not runtime().vision.snapshot()["previewEnabled"]:
            raise HTTPException(409, "Enable the optional local camera preview first")

        async def frames():
            while not await request.is_disconnected():
                snapshot = runtime().vision.snapshot()
                if not snapshot["previewEnabled"] or snapshot["status"] not in {"loading", "running"}:
                    break
                jpeg = runtime().vision.preview_jpeg()
                if jpeg:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
                await asyncio.sleep(.1)
        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                                 headers={"Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin", "X-Accel-Buffering": "no"})

    @application.get("/api/state")
    async def state():
        return runtime().state()

    @application.get("/api/health")
    async def health():
        return runtime().state()["health"]

    @application.get("/api/history")
    async def history(minutes: float = Query(60, ge=1, le=43200), limit: int = Query(3600, ge=1, le=10000), mode: Literal["demo", "hardware"] | None = None):
        return runtime().store.history(time.time() - minutes * 60, limit, mode=mode)

    @application.get("/api/sessions")
    async def sessions(limit: int = Query(200, ge=1, le=1000), mode: Literal["demo", "hardware"] | None = None):
        return runtime().store.sessions(limit, mode=mode)

    @application.get("/api/sessions/{session_id}")
    async def session_detail(session_id: str):
        result = runtime().store.get_session(session_id)
        if not result:
            raise HTTPException(404, "Session not found")
        return result

    @application.get("/api/events")
    async def events(limit: int = Query(200, ge=1, le=5000), mode: Literal["demo", "hardware"] | None = None):
        return runtime().store.events(limit, mode=mode)

    @application.get("/api/settings")
    async def settings():
        return dict(runtime().engine.settings)

    @application.patch("/api/settings")
    async def patch_settings(changes: dict[str, Any]):
        return runtime().engine.patch_settings(changes, time.time())

    @application.post("/api/control")
    async def control(data: ControlRequest):
        result = runtime().engine.control(data.action, time.time())
        await runtime().process_events()
        return result

    @application.post("/api/actuators")
    async def actuators(changes: dict[str, Any]):
        result = runtime().engine.set_actuators(changes, time.time())
        runtime().mqtt.publish(time.time())
        return result

    @application.post("/api/demo")
    async def demo(data: DemoRequest):
        return runtime().engine.set_scenario(data.scenario, time.time())

    @application.post("/api/demo/vision-source")
    async def vision_source(data: VisionSourceRequest):
        if runtime().engine.mode != "demo":
            raise HTTPException(409, "PC camera demo requires demo mode")
        async with runtime().vision_controls:
            if data.source == "simulated":
                await runtime().vision_input.cancel()
                await asyncio.to_thread(runtime().stop_vision)
            result = runtime().engine.set_vision_source(data.source, time.time())
            await runtime().process_events()
            return result

    @application.post("/api/demo/vision", deprecated=True)
    async def pc_vision(data: PcVisionRequest):
        if runtime().vision.snapshot()["status"] in {"loading", "running"}:
            raise HTTPException(409, "The Python camera owns vision input; external posture updates are disabled")
        engine = runtime().engine
        if engine.mode != "demo" or engine.vision_source != "pc_camera":
            raise HTTPException(409, "Select PC camera vision in demo mode before sending pose metadata")
        now = time.time()
        result = engine.ingest_pc_vision(data.model_dump(), now)
        point = engine.step(now)
        if point:
            runtime().influx.enqueue(point)
        await runtime().process_events()
        return result

    @application.post("/api/mode")
    async def mode_change(data: ModeRequest):
        async with runtime().vision_controls:
            if data.mode != runtime().engine.mode:
                await runtime().vision_input.cancel()
                await asyncio.to_thread(runtime().stop_vision)
            # An explicit safe command clears physical outputs before demo mode.
            if runtime().engine.mode == "hardware" and data.mode == "demo":
                runtime().engine.actuators.update(lamp_percent=0, fan=False, buzzer=False)
                runtime().mqtt.publish(time.time())
            result = runtime().engine.set_mode(data.mode, time.time())
            await runtime().process_events()
            return result

    @application.post("/api/telemetry")
    async def telemetry(data: TelemetryRequest):
        if runtime().engine.mode != "hardware":
            raise HTTPException(409, "Switch to hardware mode before ingesting real telemetry")
        result = runtime().engine.ingest(data.topic, data.payload, time.time())
        point = runtime().engine.step(time.time())
        if point:
            runtime().influx.enqueue(point)
        return result

    @application.post("/api/sessions/{session_id}/summary")
    async def summary(session_id: str):
        try:
            pending = runtime().summary_tasks.get(session_id)
            if pending:
                await pending
            return await asyncio.to_thread(runtime().summary.generate, session_id, time.time())
        except KeyError:
            raise HTTPException(404, "Session not found")

    @application.get("/api/metrics")
    @application.get("/api/evaluation")
    async def metrics():
        return runtime().engine.observed_metrics()

    @application.get("/api/export")
    async def export(kind: Literal["history", "sessions", "events"] = "history", minutes: float = Query(1440, ge=1, le=43200), mode: Literal["demo", "hardware"] | None = None):
        rows = runtime().store.history(time.time() - minutes * 60, mode=mode) if kind == "history" else runtime().store.sessions(1000, mode=mode) if kind == "sessions" else runtime().store.events(5000, mode=mode)
        output = io.StringIO(newline="")
        keys = list(dict.fromkeys(key for row in rows for key in row))
        writer = csv.DictWriter(output, fieldnames=keys)
        if keys:
            writer.writeheader()
            for row in rows:
                # Prevent spreadsheet formula execution in imported strings.
                writer.writerow({key: ("'" + value if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"} else value) for key, value in row.items()})
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="focusguard-{kind}.csv"'})

    @application.websocket("/api/live")
    async def live(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        if origin and origin.rstrip("/").replace("https://", "").replace("http://", "") != websocket.headers.get("host"):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        try:
            while True:
                await websocket.send_json(runtime().state())
                await asyncio.sleep(1)
        except (WebSocketDisconnect, RuntimeError):
            pass

    @application.websocket("/api/vision/pc-camera")
    async def pc_camera_frames(websocket: WebSocket):
        # WebSocket does not pass through HTTP mutation middleware. The browser
        # token travels in a protocol header, never a logged URL query string.
        origin = urlsplit(websocket.headers.get("origin", ""))
        expected_scheme = "https" if websocket.url.scheme == "wss" else "http"
        protocols = [part.strip() for part in websocket.headers.get("sec-websocket-protocol", "").split(",")]
        same_origin = (origin.scheme == expected_scheme and origin.netloc == websocket.headers.get("host")
                       and origin.path in {"", "/"} and not origin.query and not origin.fragment)
        if (not same_origin or websocket.headers.get("sec-fetch-site") == "cross-site"
                or len(protocols) != 2 or protocols[0] != "focusguard-pc"):
            await websocket.close(code=1008)
            return
        token = protocols[1]
        owner = runtime()
        async with owner.vision_controls:
            if not owner.vision_input.attach(token):
                await websocket.close(code=1008)
                return
            input_session = owner.vision.session_identity()
        try:
            await websocket.accept(subprotocol="focusguard-pc")
            while owner.vision_input.owns(token):
                message = await asyncio.wait_for(websocket.receive(), timeout=owner.vision_input.IDLE_TIMEOUT)
                if message["type"] == "websocket.disconnect":
                    break
                if not owner.vision_input.owns(token):
                    break
                jpeg = message.get("bytes")
                if jpeg is None or not jpeg.startswith(b"\xff\xd8\xff"):
                    await websocket.close(code=1003, reason="Send one binary JPEG frame at a time")
                    break
                if len(jpeg) > 512 * 1024:
                    await websocket.close(code=1009, reason="Camera frame exceeds 512 KiB")
                    break
                inference_timeout = 45.0 if owner.vision.snapshot()["status"] == "loading" else 8.0
                owner.vision_input.touch(inference_timeout + 2)
                # Await one complete inference before acknowledging it. The
                # client sends its next frame only after this ACK (backpressure).
                snapshot = await asyncio.to_thread(owner.vision.process_browser_frame, jpeg, timeout=inference_timeout,
                                                  expected_session=input_session)
                if not owner.vision_input.owns(token):
                    break
                owner.vision_input.touch()
                snapshot["inputMode"] = "pc_camera"
                await websocket.send_json(snapshot)
        except WebSocketDisconnect:
            pass
        except asyncio.TimeoutError:
            with suppress(WebSocketDisconnect, RuntimeError):
                await websocket.close(code=1001, reason="Camera input timed out")
        except (RuntimeError, ValueError, OSError) as exc:
            if owner.vision_input.owns(token):
                log.warning("PC camera frame processing stopped error=%s", type(exc).__name__)
                with suppress(WebSocketDisconnect, RuntimeError):
                    snapshot = owner.vision_input.snapshot()
                    snapshot.update(status="error", error=str(exc), message="PC camera stopped; restoring the backend camera.")
                    await websocket.send_json(snapshot)
                    await websocket.close(code=1011, reason="Camera processing stopped")
        finally:
            # Shield device handoff from the disconnected ASGI session's cancel
            # scope. Otherwise a camera can remain between browser/native modes.
            with CancelScope(shield=True):
                async with owner.vision_controls:
                    if owner.vision_input.owns(token):
                        await owner.vision_input.restore(reason="PC camera connection closed")
                        await owner.process_events()
                with suppress(WebSocketDisconnect, RuntimeError, OSError):
                    await websocket.close(code=1000)

    frontend = Path(frontend_dir) if frontend_dir is not None else ROOT / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        application.mount("/", StaticFiles(directory=frontend, html=True), name="dashboard")
    else:
        @application.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def frontend_not_built():
            return HTMLResponse(
                "<!doctype html><html lang='en'><meta charset='utf-8'>"
                "<title>FocusGuard: build the frontend</title>"
                "<body><h1>FocusGuard frontend needs a build</h1>"
                "<p>Run <code>.\\start.ps1 -Install</code> from the project root, "
                "or use Node.js 24 LTS and run <code>cd frontend</code>, "
                "<code>npm ci</code>, then <code>npm run build</code>. "
                "Restart the API after building.</p>"
                "<p>The API remains available at <a href='/docs'>/docs</a>.</p></body></html>",
                status_code=503,
            )
    return application


app = create_app()
