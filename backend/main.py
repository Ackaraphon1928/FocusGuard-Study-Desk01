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

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from .engine import FocusGuardEngine
from .integrations import InfluxWriter, MqttBridge, SummaryService
from .storage import Store

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("focusguard")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ControlRequest(StrictModel):
    action: Literal["start", "pause", "resume", "end", "break", "finish_break"]


class DemoRequest(StrictModel):
    scenario: Literal["normal", "slouch", "too_close", "dark", "noisy", "hot", "away", "camera_offline", "occluded", "network_offline"]


class ModeRequest(StrictModel):
    mode: Literal["demo", "hardware"]


class TelemetryRequest(StrictModel):
    topic: str
    payload: dict[str, Any]


class Runtime:
    def __init__(self, db_path=None, mode=None):
        self.store = Store(db_path or os.getenv("FOCUSGUARD_DB", str(ROOT / "backend" / "data" / "focusguard.sqlite3")))
        self.engine = FocusGuardEngine(self.store, mode=mode or os.getenv("FOCUSGUARD_MODE", "demo"), now=time.time())
        self.mqtt = MqttBridge(self.engine)
        self.influx = InfluxWriter()
        self.summary = SummaryService(self.engine)
        self.tick_count = 0
        self.last_error = None
        self.event_cursor = self.store.latest_event_cursor()
        self.summary_tasks = {}

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


def create_app(db_path=None, mode=None, background=True):
    @asynccontextmanager
    async def lifespan(application):
        runtime = Runtime(db_path, mode)
        application.state.runtime = runtime
        runtime.mqtt.start()
        runtime.influx.start()
        point = runtime.engine.step(time.time())
        if point:
            runtime.influx.enqueue(point)
        task = asyncio.create_task(runtime.loop()) if background else None
        try:
            yield
        finally:
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

    @application.post("/api/mode")
    async def mode_change(data: ModeRequest):
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

    frontend = ROOT / "frontend"
    if frontend.exists():
        application.mount("/", StaticFiles(directory=frontend, html=True), name="dashboard")
    return application


app = create_app()
