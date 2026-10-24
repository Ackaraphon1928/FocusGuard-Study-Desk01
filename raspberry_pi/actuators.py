"""Expiring commands, deduplication, bounded beeps, and fail-off on gateway loss."""
from __future__ import annotations

import logging
import math
import os
import queue
import time
from collections import deque
from datetime import datetime, timezone
from threading import Event


def validate_command(payload: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    expiry = datetime.fromisoformat(str(payload["expires_at"]).replace("Z", "+00:00"))
    if expiry.tzinfo is None or not 0 < (expiry - now).total_seconds() <= 30:
        raise ValueError("Command expired, too far in the future, or lacks timezone")
    command_id = str(payload["command_id"])
    if not command_id or len(command_id) > 128:
        raise ValueError("Invalid command id")
    lamp = payload.get("lamp_percent", 0)
    if isinstance(lamp, bool) or not isinstance(lamp, (int, float)) or not math.isfinite(lamp) or not 0 <= lamp <= 100:
        raise ValueError("lamp_percent must be finite in 0..100")
    if type(payload.get("fan", False)) is not bool or type(payload.get("buzzer", False)) is not bool:
        raise ValueError("fan and buzzer must be boolean")
    return {"command_id": command_id, "expires_at": expiry, "lamp_percent": float(lamp), "fan": payload.get("fan", False), "buzzer": payload.get("buzzer", False)}


class Actuators:
    def __init__(self, mqtt):
        self.mqtt = mqtt
        self.commands: queue.Queue = queue.Queue(maxsize=32)
        mqtt.handlers["focusguard/actuator"] = self.enqueue

    def enqueue(self, payload: dict) -> None:
        # Validate in callback as well as at application time after queue delay.
        validate_command(payload)
        try:
            self.commands.put_nowait(payload)
        except queue.Full:
            logging.warning("Actuator queue full; dropped command")

    def run(self, stop: Event) -> None:
        from gpiozero import Buzzer, DigitalOutputDevice, PWMOutputDevice
        lamp = PWMOutputDevice(int(os.getenv("LAMP_GPIO", "18")), initial_value=0, frequency=500)
        fan = DigitalOutputDevice(int(os.getenv("FAN_GPIO", "23")), initial_value=False)
        buzzer = Buzzer(int(os.getenv("BUZZER_GPIO", "24")), initial_value=False)
        last_command = time.monotonic()
        last_beep = -float("inf")
        beep_until = 0.0
        seen: deque[str] = deque(maxlen=128)
        watchdog = float(os.getenv("ACTUATOR_WATCHDOG_SECONDS", "10"))
        timed_out = False
        try:
            while not stop.is_set():
                now = time.monotonic()
                if beep_until and now >= beep_until:
                    buzzer.off()
                    beep_until = 0.0
                try:
                    raw = self.commands.get(timeout=0.1)
                    command = validate_command(raw)
                    if command["command_id"] in seen:
                        continue
                    seen.append(command["command_id"])
                    lamp.value = command["lamp_percent"] / 100
                    fan.value = int(command["fan"])
                    last_command = now
                    timed_out = False
                    if command["buzzer"] and now - last_beep >= 5:
                        buzzer.on()
                        beep_until = now + 0.18
                        last_beep = now
                    self.mqtt.publish("focusguard/gateway/actuator_state", {
                        "command_id": command["command_id"], "lamp_percent": command["lamp_percent"],
                        "fan": command["fan"], "buzzer": bool(buzzer.value), "watchdog": False,
                    })
                except queue.Empty:
                    pass
                except (ValueError, KeyError, TypeError) as error:
                    logging.warning("Command rejected before application: %s", error)
                if now - last_command > watchdog and not timed_out:
                    lamp.off(); fan.off(); buzzer.off()
                    timed_out = True
                    self.mqtt.publish("focusguard/gateway/actuator_state", {"lamp_percent": 0, "fan": False, "buzzer": False, "watchdog": True})
        finally:
            for output in (lamp, fan, buzzer):
                output.off()
                output.close()
