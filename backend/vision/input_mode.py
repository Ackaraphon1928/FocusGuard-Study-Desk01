"""Exclusive, temporary browser camera ownership with native camera restoration.

The token stays in memory and is returned only to the activating client. Camera
frames are consumed by the canonical Python service; this coordinator never
stores images or accepts client-computed posture labels.
"""
from __future__ import annotations

import asyncio
from copy import deepcopy
import logging
import secrets
import time


logger = logging.getLogger("focusguard.vision")


class InputModeCoordinator:
    CONNECT_TIMEOUT = 45.0
    IDLE_TIMEOUT = 10.0

    def __init__(self, runtime):
        self.runtime = runtime
        self._token: str | None = None
        self._profile: dict | None = None
        self._connected = False
        self._restoring = False
        self._deadline = 0.0
        self._watchdog: asyncio.Task | None = None

    @property
    def active(self):
        return self._token is not None

    def owns(self, token):
        return bool(self._token and isinstance(token, str) and secrets.compare_digest(self._token, token))

    def snapshot(self):
        snapshot = self.runtime.vision.snapshot()
        snapshot["inputMode"] = "pc_camera" if self.active else "python_backend"
        if self._restoring:
            snapshot.update(status="loading", message="Restoring the Python backend camera profile.", observation=None, fps=0.0)
        return snapshot

    def _select_engine_input(self, mode):
        setter = getattr(self.runtime.engine, "set_vision_input", None)
        if setter is not None:
            setter(mode, time.time())

    def _clear(self):
        self._token = None
        self._profile = None
        self._connected = False
        task, self._watchdog = self._watchdog, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def activate(self, view="front"):
        """Called with Runtime.vision_controls held, before browser permission."""
        if self.runtime.engine.mode != "demo":
            raise RuntimeError("PC camera input is available only in demo mode")
        if self.active:
            raise RuntimeError("Another PC camera session is active; close it before starting a new one")
        capture = getattr(self.runtime.vision, "capture_state", self.runtime.vision.snapshot)
        profile = deepcopy(capture())
        # Invalidate the old callback owner before releasing its native camera.
        await asyncio.to_thread(self.runtime.stop_vision)
        self._profile = profile
        self._token = secrets.token_urlsafe(32)
        self._deadline = time.monotonic() + self.CONNECT_TIMEOUT
        try:
            self._select_engine_input("pc_camera")
            self.runtime.engine.set_vision_source("pc_camera", time.time())
            self.runtime.camera_mode = self.runtime.engine.mode
            await asyncio.to_thread(self.runtime.vision.set_preview, False)
            await asyncio.to_thread(self.runtime.vision.start_browser, view=view)
        except BaseException:
            await self.restore(reason="PC camera startup failed")
            raise
        self._watchdog = asyncio.create_task(self._watch(), name="focusguard-pc-camera-lease")
        snapshot = self.snapshot()
        snapshot["browserToken"] = self._token
        logger.info("Vision input selected input=pc_camera view=%s; native camera released", view)
        return snapshot

    def attach(self, token):
        if not self.owns(token) or self._connected:
            return False
        self._connected = True
        self.touch()
        return True

    def touch(self, timeout=None):
        self._deadline = time.monotonic() + (self.IDLE_TIMEOUT if timeout is None else timeout)

    async def cancel(self):
        """Explicit global stop/mode change: invalidate lease without restart."""
        if self.active:
            self._clear()
            self._select_engine_input("python_backend")

    async def restore(self, *, reason="PC camera mode disabled"):
        """Restore exactly the previous native profile, including its idle state."""
        if not self.active:
            return self.snapshot()
        profile = self._profile or {}
        self._restoring = True
        self._clear()
        resume = profile.get("status") in {"loading", "running"}
        try:
            await asyncio.to_thread(self.runtime.stop_vision)
            self._select_engine_input("python_backend")
            # An explicit workspace mode change must never reopen a camera behind it.
            if self.runtime.engine.mode != "demo":
                return self.snapshot()
            if resume:
                self.runtime.camera_mode = self.runtime.engine.mode
                await asyncio.to_thread(
                    self.runtime.vision.start, camera_index=profile.get("cameraIndex", 0),
                    view=profile.get("view", "front"), calibration=profile.get("calibration"),
                    restore_persisted=(profile.get("status") == "loading" and profile.get("calibration") is None),
                )
                await asyncio.to_thread(self.runtime.vision.set_preview, bool(profile.get("previewEnabled")))
            else:
                restore_idle = getattr(self.runtime.vision, "restore_idle", None)
                if restore_idle is not None:
                    await asyncio.to_thread(restore_idle, profile)
                else:
                    await asyncio.to_thread(self.runtime.vision.set_view, profile.get("view", "front"))
                    await asyncio.to_thread(self.runtime.vision.set_preview, bool(profile.get("previewEnabled")))
        except Exception:
            self.runtime.camera_mode = None
            logger.exception("Native camera profile could not be restored; restart the backend camera explicitly")
        finally:
            self._restoring = False
        logger.info("Vision input selected input=python_backend resume=%s reason=%s", resume, reason)
        return self.snapshot()

    async def _watch(self):
        try:
            while self.active:
                await asyncio.sleep(max(.01, min(1.0, self._deadline - time.monotonic())))
                if self.active and time.monotonic() >= self._deadline:
                    async with self.runtime.vision_controls:
                        if self.active and time.monotonic() >= self._deadline:
                            await self.restore(reason="PC camera connection timed out")
                            await self.runtime.process_events()
                    return
        except asyncio.CancelledError:
            return
