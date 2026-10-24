"""Explainable, deterministic decision engine. All time enters through ``now``.

No media, cloud client, network, or GPIO is used here. Hardware adapters publish
metadata; the same rules run in both simulator and hardware modes.
"""

from copy import deepcopy
from datetime import datetime, timezone
import math
import logging
import threading
import uuid

from .storage import Store


TOPICS = {
    "focusguard/nodeA/user": ("nodeA", "Seat & distance", {
        "distance_cm": (0, 500), "seat_pressure": (0, 65535), "seat_occupied": bool}),
    "focusguard/nodeB/environment": ("nodeB", "Motion & sound", {
        "motion": bool, "noise_level": (0, 1), "noise_state": {"QUIET", "MODERATE", "NOISY"}}),
    "focusguard/gateway/environment": ("environment", "Environment gateway", {
        "temperature_c": (-40, 85), "humidity_percent": (0, 100), "pressure_hpa": (300, 1200), "lux": (0, 100000)}),
    "focusguard/gateway/vision": ("vision", "Local pose camera", {
        "person_detected": bool, "posture": {"GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT", "NO_PERSON", "UNKNOWN"},
        "confidence": (0, 1), "fps": (0, 240), "vision_available": bool}),
}

DEFAULT_SETTINGS = {
    "distance_min_cm": 40.0, "distance_max_cm": 80.0,
    "posture_warning_seconds": 30.0, "distance_warning_seconds": 5.0,
    "noise_warning_seconds": 10.0, "warning_cooldown_seconds": 60.0,
    "break_interval_minutes": 45.0, "eye_break_interval_minutes": 20.0,
    "break_duration_seconds": 120.0, "occupancy_pause_seconds": 15.0,
    "occupancy_end_minutes": 15.0, "sensor_stale_seconds": 15.0,
    "light_target_lux": 400.0, "temperature_fan_c": 28.0,
    "noise_threshold": 0.65, "confidence_min": 0.6,
    "auto_session": True, "adaptive_reminders": True,
    "buzzer_enabled": True, "cloud_ai_consent": False,
    "weights": {"lighting": .15, "noise": .15, "thermal": .15, "posture": .30, "distance": .25},
}

RANGES = {
    "distance_min_cm": (10, 150), "distance_max_cm": (20, 250),
    "posture_warning_seconds": (1, 600), "distance_warning_seconds": (1, 300),
    "noise_warning_seconds": (1, 600), "warning_cooldown_seconds": (1, 3600),
    "break_interval_minutes": (.1, 180), "eye_break_interval_minutes": (.1, 120),
    "break_duration_seconds": (5, 1800), "occupancy_pause_seconds": (1, 300),
    "occupancy_end_minutes": (.5, 240), "sensor_stale_seconds": (2, 300),
    "light_target_lux": (50, 2000), "temperature_fan_c": (18, 40),
    "noise_threshold": (.05, 1), "confidence_min": (.1, 1),
}

SCENARIOS = {"normal", "slouch", "too_close", "dark", "noisy", "hot", "away", "camera_offline", "occluded", "network_offline"}
VISION_TOPIC = "focusguard/gateway/vision"
PC_CAMERA_SCENARIOS = {"normal", "dark", "noisy", "hot", "network_offline"}
PC_VISION_FIELDS = set(TOPICS[VISION_TOPIC][2]) | {"inference_ms", "ambiguous_people"}

# Metadata diagnostics emitted by the included hardware firmware. They are
# validated and discarded from sensor values instead of accepting arbitrary
# payload keys (which could silently admit raw image or audio content).
DIAGNOSTICS = {
    "focusguard/nodeA/user": {"uptime_ms": (0, 2**64), "rssi_dbm": (-150, 0), "distance_valid": bool, "tof_status": (0, 255), "sample_count": (0, 1000000)},
    "focusguard/nodeB/environment": {"uptime_ms": (0, 2**64), "rssi_dbm": (-150, 0), "pir_warming_up": bool, "sample_count": (0, 1000000)},
    "focusguard/gateway/environment": {"sensor_status": "sensor_status"},
    "focusguard/gateway/vision": {"calibrating": bool, "ambiguous_people": bool, "inference_ms": (0, 60000)},
}


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def clip(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class FocusGuardEngine:
    def __init__(self, store=None, mode="demo", now=0.0):
        if mode not in {"demo", "hardware"}:
            raise ValueError("Mode must be demo or hardware")
        self.store = store or Store()
        self.lock = threading.RLock()
        self.settings = deepcopy(DEFAULT_SETTINGS)
        saved = self.store.settings()
        if saved:
            self.settings.update(saved)
        self.mode = mode
        # Camera selection is deliberately runtime-only. Restarting never turns
        # on a browser camera or resumes a previous person's observations.
        self.vision_source = "simulated" if mode == "demo" else "gateway"
        self.vision_input = "python_backend"
        self.scenario = "normal"
        self.last_step = now
        self.last_sample = None
        self.observation_valid_until = now
        self.sources = {}
        self.session = None
        self.auto_suppressed = False
        self.occupancy = "EMPTY"
        self.present = False
        self.absent_since = None
        self.condition_since = {}
        self.last_warning = {}
        self.rules = []
        self.buzzer_until = 0.0
        self.actuators = {"lamp_percent": 0, "fan": False, "buzzer": False, "lamp_mode": "auto", "fan_mode": "auto"}
        self.sensors = self._empty_sensors()
        self.score = {"total": None, "components": {key: None for key in DEFAULT_SETTINGS["weights"]}, "coverage_percent": 0}
        self.metrics = {"telemetry_messages": 0, "invalid_messages": 0, "clock_regressions": 0, "latencies_ms": [], "warning_counts": {}}
        self.last_error = None
        self._recover_sessions(now)

    def _recover_sessions(self, now):
        # A process restart cannot reconstruct an uninterrupted sitting interval.
        for old in self.store.sessions():
            if old.get("state") in {"ACTIVE", "PAUSED", "BREAK"}:
                old.update(state="ENDED", ended_at=iso(now), end_reason="gateway_restart")
                self.store.save_session(old, now)

    @staticmethod
    def _empty_sensors():
        result = {key: None for _, _, fields in TOPICS.values() for key in fields}
        result.update(posture="UNKNOWN", noise_state="UNKNOWN", vision_available=False)
        return result

    def event(self, event_type, message, now, severity="info", **metadata):
        vision_source = metadata.pop("vision_source", self.vision_source)
        if vision_source not in {"simulated", "pc_camera", "gateway", "unknown"}:
            raise ValueError("Invalid event vision source")
        vision_input = metadata.pop("vision_input", self._effective_vision_input(vision_source))
        if vision_input not in {None, "python_backend", "pc_camera"}:
            raise ValueError("Invalid event vision input")
        data = {"id": uuid.uuid4().hex, "event_type": event_type, "severity": severity, "message": message, "timestamp": iso(now), "mode": self.mode, "vision_source": vision_source, "vision_input": vision_input, **metadata}
        self.store.save_event(data, now)
        logger = logging.getLogger("focusguard.engine")
        logger.log(logging.WARNING if severity in {"warning", "critical"} else logging.INFO,
                   "event=%s mode=%s vision=%s input=%s session=%s message=%s", event_type, self.mode,
                   vision_source, vision_input or "-", metadata.get("session_id", "-"), message)
        return data

    def ingest(self, topic, payload, now):
        with self.lock:
            try:
                return self._ingest(topic, payload, now)
            except (ValueError, TypeError) as exc:
                self.metrics["invalid_messages"] += 1
                self.last_error = str(exc)
                raise ValueError(str(exc)) from exc

    def _ingest(self, topic, payload, now):
        if topic not in TOPICS:
            raise ValueError("Unsupported telemetry topic")
        if not isinstance(payload, dict):
            raise ValueError("Telemetry must be a JSON object")
        sensor_fields = TOPICS[topic][2]
        fields = {**sensor_fields, **DIAGNOSTICS.get(topic, {})}
        unexpected = set(payload) - set(fields) - {"device_id", "timestamp", "sequence"}
        if unexpected:
            raise ValueError("Only derived sensor metadata is accepted; unsupported fields: " + ", ".join(sorted(unexpected)))
        data = {}
        for key, value in payload.items():
            if key not in fields:
                continue
            schema = fields[key]
            if schema == "sensor_status":
                if not isinstance(value, dict) or set(value) - {"bme280", "bh1750"} or any(not isinstance(v, bool) for v in value.values()):
                    raise ValueError("sensor_status must contain bme280/bh1750 booleans")
            elif value is None:
                data[key] = None
            elif schema is bool:
                if not isinstance(value, bool):
                    raise ValueError(f"{key} must be boolean")
                data[key] = value
            elif isinstance(schema, set):
                if not isinstance(value, str) or value not in schema:
                    raise ValueError(f"Invalid {key}")
                data[key] = value
            else:
                if not numeric(value) or not schema[0] <= value <= schema[1]:
                    raise ValueError(f"{key} must be finite and between {schema[0]} and {schema[1]}")
                data[key] = float(value)
        if not data and "sensor_status" not in payload:
            raise ValueError("Telemetry contains no sensor metadata")
        captured = now
        if payload.get("timestamp") is not None:
            stamp = payload["timestamp"]
            try:
                if not isinstance(stamp, str):
                    raise ValueError()
                parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError()
                captured = parsed.timestamp()
            except (ValueError, TypeError):
                raise ValueError("timestamp must be an ISO 8601 string with a timezone")
            if captured > now + 30:
                raise ValueError("Telemetry timestamp is too far in the future")
            self.metrics["latencies_ms"].append(max(0.0, (now - captured) * 1000))
            self.metrics["latencies_ms"] = self.metrics["latencies_ms"][-1000:]
        previous = self.sources.get(topic)
        if previous and captured < previous["captured"]:
            raise ValueError("Out-of-order telemetry rejected")
        # Payloads are snapshots. Omitted fields become unknown instead of leaving
        # an old numeric reading artificially fresh after a sensor fails.
        sensor_data = {key: value for key, value in data.items() if key in sensor_fields}
        if not sensor_data and "sensor_status" not in payload:
            raise ValueError("Telemetry contains no sensor metadata")
        self.sources[topic] = {"data": sensor_data, "seen": now, "captured": captured,
                               "diagnostics": {key: data[key] for key in DIAGNOSTICS.get(topic, {}) if key in data}}
        self.metrics["telemetry_messages"] += 1
        return {"accepted": True, "topic": topic, "timestamp": iso(now)}

    def patch_settings(self, changes, now):
        with self.lock:
            if not isinstance(changes, dict) or not changes:
                raise ValueError("Provide a nonempty settings object")
            unknown = set(changes) - set(DEFAULT_SETTINGS)
            if unknown:
                raise ValueError("Unknown settings: " + ", ".join(sorted(unknown)))
            merged = deepcopy(self.settings)
            for key, value in changes.items():
                if key in RANGES:
                    low, high = RANGES[key]
                    if not numeric(value) or not low <= value <= high:
                        raise ValueError(f"{key} must be between {low} and {high}")
                    merged[key] = float(value)
                elif key == "weights":
                    if not isinstance(value, dict) or set(value) != set(DEFAULT_SETTINGS["weights"]):
                        raise ValueError("weights requires lighting, noise, thermal, posture and distance")
                    if any(not numeric(v) or not 0 <= v <= 1 for v in value.values()) or not math.isclose(sum(value.values()), 1.0, abs_tol=.001):
                        raise ValueError("Score weights must be between 0 and 1 and sum to 1")
                    merged[key] = deepcopy(value)
                else:
                    if not isinstance(value, bool):
                        raise ValueError(f"{key} must be boolean")
                    merged[key] = value
            if merged["distance_max_cm"] <= merged["distance_min_cm"]:
                raise ValueError("distance_max_cm must exceed distance_min_cm")
            self.settings = merged
            self.store.save_settings(merged)
            self.event("SETTINGS_UPDATED", "Desk preferences updated locally.", now, changed=list(changes))
            return deepcopy(merged)

    def set_scenario(self, scenario, now):
        with self.lock:
            if self.mode != "demo":
                raise ValueError("Demo scenarios require demo mode")
            if scenario not in SCENARIOS:
                raise ValueError("Unknown demo scenario")
            if self.vision_source == "pc_camera" and scenario not in PC_CAMERA_SCENARIOS:
                raise ValueError("This scenario simulates vision; choose Use simulated vision before selecting it")
            self.scenario = scenario
            self.condition_since.clear()
            self.event("DEMO_SCENARIO", f"Simulator scenario: {scenario.replace('_', ' ')}.", now, scenario=scenario)
            self.step(now)
            return self.state(now)

    def set_vision_source(self, source, now):
        """Choose simulated pose or Python-computed camera metadata in demo mode."""
        with self.lock:
            if self.mode != "demo":
                raise ValueError("PC camera demo requires demo mode")
            if source not in {"simulated", "pc_camera"}:
                raise ValueError("Vision source must be simulated or pc_camera")
            if source == self.vision_source:
                return self.state(now)
            # Keep a session's aggregate posture statistics within one source.
            # A source change also clears sustained-evidence timers and pulses.
            self.step(now)
            if self.session:
                self._end_session(now, "vision_source_changed")
            self.vision_source = source
            self.sources.pop(VISION_TOPIC, None)
            self.condition_since.clear()
            self.last_warning.clear()
            self.buzzer_until = 0.0
            self.present = False
            self.occupancy = "EMPTY"
            self.absent_since = None
            self.auto_suppressed = False
            if source == "pc_camera" and self.scenario not in PC_CAMERA_SCENARIOS:
                self.scenario = "normal"
            self.last_sample = None
            self.event("VISION_SOURCE_CHANGED", f"Demo vision source: {source}.", now, vision_source=source)
            self.step(now)
            return self.state(now)

    def _effective_vision_input(self, source=None):
        source = self.vision_source if source is None else source
        if source == "pc_camera":
            return self.vision_input
        return "python_backend" if source == "gateway" else None

    def set_vision_input(self, mode, now):
        """Separate evidence and sessions when the physical camera input changes."""
        if mode not in {"python_backend", "pc_camera"}:
            raise ValueError("Vision input must be python_backend or pc_camera")
        with self.lock:
            if self.mode != "demo" and mode == "pc_camera":
                raise ValueError("Browser PC camera requires demo mode")
            if self.vision_input == mode:
                return self.state(now)
            if self.vision_source == "pc_camera":
                self.step(now)
                if self.session:
                    self._end_session(now, "vision_input_changed")
                self.sources.pop(VISION_TOPIC, None)
                self.condition_since.clear()
                self.last_warning.clear()
                self.buzzer_until = 0.0
                self.present = False
                self.occupancy = "EMPTY"
                self.absent_since = None
                self.auto_suppressed = False
                self.last_sample = None
            self.vision_input = mode
            self.event("VISION_INPUT_CHANGED", f"Python vision input: {mode}.", now,
                       vision_input=mode)
            self.step(now)
            return self.state(now)

    def ingest_pc_vision(self, payload, now):
        """Accept only derived labels, never a frame or landmark coordinates."""
        with self.lock:
            if self.mode != "demo" or self.vision_source != "pc_camera":
                raise ValueError("Select PC camera vision in demo mode before sending pose metadata")
            if not isinstance(payload, dict) or set(payload) - PC_VISION_FIELDS:
                raise ValueError("Only derived PC camera posture metadata is accepted")
            if not set(TOPICS[VISION_TOPIC][2]).issubset(payload):
                raise ValueError("PC camera metadata requires person_detected, posture, confidence, fps and vision_available")
            return self.ingest(VISION_TOPIC, payload, now)

    def _pc_camera_present(self, now):
        source = self.sources.get(VISION_TOPIC)
        if not source:
            return False
        stale = self.settings["sensor_stale_seconds"]
        data = source["data"]
        return (now - source["seen"] <= stale and now - source["captured"] <= stale
                and data.get("vision_available") is True and data.get("person_detected") is True
                and (data.get("confidence") or 0) >= self.settings["confidence_min"]
                and not source.get("diagnostics", {}).get("ambiguous_people"))

    def set_mode(self, mode, now):
        with self.lock:
            if mode not in {"demo", "hardware"}:
                raise ValueError("Mode must be demo or hardware")
            if mode == self.mode:
                return self.state(now)
            if self.session:
                self._end_session(now, "mode_changed")
            self.mode = mode
            self.vision_source = "simulated" if mode == "demo" else "gateway"
            self.vision_input = "python_backend"
            self.scenario = "normal"
            self.sources.clear()
            self.condition_since.clear()
            self.last_warning.clear()
            self.sensors = self._empty_sensors()
            self.present = False
            self.occupancy = "EMPTY"
            self.absent_since = None
            self.auto_suppressed = False
            self.metrics = {"telemetry_messages": 0, "invalid_messages": 0, "clock_regressions": 0, "latencies_ms": [], "warning_counts": {}}
            self.actuators.update(lamp_percent=0, fan=False, buzzer=False, lamp_mode="auto", fan_mode="auto")
            self.event("MODE_CHANGED", f"Switched to {mode} mode.", now)
            self.step(now)
            return self.state(now)

    def _simulate(self, now):
        if self.scenario == "network_offline":
            return
        wave = math.sin(now / 7)
        topic_data = {
            "focusguard/nodeA/user": {"distance_cm": round(57 + wave * 2, 1), "seat_pressure": 718 + int(wave * 12), "seat_occupied": True},
            "focusguard/nodeB/environment": {"motion": True, "noise_level": round(.22 + abs(wave) * .04, 2), "noise_state": "QUIET"},
            "focusguard/gateway/environment": {"temperature_c": round(25.4 + wave * .2, 1), "humidity_percent": round(53 + wave, 1), "pressure_hpa": 1009.8, "lux": round(460 + wave * 15, 1)},
            "focusguard/gateway/vision": {"person_detected": True, "posture": "GOOD", "confidence": .94, "fps": round(18.8 + wave * .4, 1), "vision_available": True},
        }
        if self.scenario == "slouch":
            topic_data["focusguard/gateway/vision"].update(posture="SLOUCH", confidence=.92)
        elif self.scenario == "too_close":
            topic_data["focusguard/nodeA/user"]["distance_cm"] = 28 + wave
            topic_data["focusguard/gateway/vision"].update(posture="LEAN_FORWARD", confidence=.95)
        elif self.scenario == "dark":
            topic_data["focusguard/gateway/environment"]["lux"] = 65 + wave * 5
        elif self.scenario == "noisy":
            topic_data["focusguard/nodeB/environment"].update(noise_level=.84, noise_state="NOISY")
        elif self.scenario == "hot":
            topic_data["focusguard/gateway/environment"].update(temperature_c=31.4, humidity_percent=72)
        elif self.scenario == "away":
            topic_data["focusguard/nodeA/user"].update(seat_occupied=False, seat_pressure=0, distance_cm=130)
            topic_data["focusguard/nodeB/environment"]["motion"] = False
            topic_data["focusguard/gateway/vision"].update(person_detected=False, posture="NO_PERSON", confidence=.96)
        elif self.scenario == "occluded":
            topic_data["focusguard/gateway/vision"].update(posture="UNKNOWN", confidence=.24)
        elif self.scenario == "camera_offline":
            topic_data["focusguard/gateway/vision"] = {"vision_available": False, "posture": "UNKNOWN", "person_detected": None, "confidence": 0, "fps": 0}
        if self.vision_source == "pc_camera":
            # Other desk measurements, including centimetres, remain simulated.
            # Synthetic occupancy must follow the real camera instead of the
            # always-occupied simulator bypassing normal presence fusion.
            detected = self._pc_camera_present(now)
            topic_data.pop(VISION_TOPIC)
            topic_data["focusguard/nodeA/user"].update(seat_occupied=detected, seat_pressure=718 + int(wave * 12) if detected else 0)
            topic_data["focusguard/nodeB/environment"]["motion"] = detected
        for topic, data in topic_data.items():
            self.ingest(topic, data, now)

    def _refresh_sensors(self, now):
        sensors = self._empty_sensors()
        stale = self.settings["sensor_stale_seconds"]
        for topic, source in self.sources.items():
            if now - source["captured"] <= stale and now - source["seen"] <= stale:
                sensors.update(source["data"])
                if topic.endswith("/vision") and "vision_available" not in source["data"]:
                    sensors["vision_available"] = True
        if not sensors["vision_available"]:
            sensors.update(posture="UNKNOWN", person_detected=None, confidence=None, fps=None)
        elif ((sensors.get("confidence") or 0) < self.settings["confidence_min"]
              and not (sensors["person_detected"] is False and sensors["posture"] == "NO_PERSON")):
            # With no detected person there is no landmark confidence to score.
            # Keep that explicit label; uncertain visible poses remain unknown.
            sensors["posture"] = "UNKNOWN"
        vision = self.sources.get(VISION_TOPIC)
        if vision and vision.get("diagnostics", {}).get("ambiguous_people"):
            sensors["posture"] = "UNKNOWN"
        if self.vision_source == "pc_camera" and not self._pc_camera_present(now):
            # Also applies when the environmental simulator is paused by the
            # network-offline scenario. Old synthetic votes cannot outlive pose.
            sensors.update(seat_occupied=False, seat_pressure=0, motion=False)
        if sensors["noise_level"] is not None:
            sensors["noise_state"] = "NOISY" if sensors["noise_level"] >= self.settings["noise_threshold"] else ("MODERATE" if sensors["noise_level"] >= .4 else "QUIET")
        self.sensors = sensors

    def _fuse_presence(self):
        s = self.sensors
        seat = s["seat_occupied"] is True
        camera = s["person_detected"] is True and (s.get("confidence") or 0) >= self.settings["confidence_min"]
        motion = s["motion"] is True
        # A still person is present when seat and camera agree. A camera outage
        # can fall back to seat plus PIR, never to a stale last camera frame.
        return (seat and camera) or (seat and motion) or (camera and motion)

    def _compute_score(self):
        s = self.sensors
        st = self.settings
        values = {key: None for key in st["weights"]}
        if s["lux"] is not None:
            target = st["light_target_lux"]
            values["lighting"] = 100 * clip(s["lux"] / target) if s["lux"] <= target else 100 * clip(1 - max(0, s["lux"] - 1000) / 1500)
        if s["noise_level"] is not None:
            values["noise"] = 100 * clip(1 - max(0, s["noise_level"] - .25) / .65)
        if s["temperature_c"] is not None and s["humidity_percent"] is not None:
            temp_penalty = max(0, abs(s["temperature_c"] - 25) - 2) / 9
            humidity_penalty = max(0, abs(s["humidity_percent"] - 50) - 15) / 50
            values["thermal"] = 100 * clip(1 - temp_penalty - humidity_penalty)
        if s["posture"] in {"GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT"} and self.present:
            values["posture"] = {"GOOD": 100, "SLOUCH": 25, "LEAN_FORWARD": 40, "LEAN_LEFT_RIGHT": 45}[s["posture"]]
        if s["distance_cm"] is not None and self.present:
            distance = s["distance_cm"]
            low, high = st["distance_min_cm"], st["distance_max_cm"]
            values["distance"] = 100 * (clip(distance / low) if distance < low else clip(1 - max(0, distance - high) / high))
        coverage = sum(st["weights"][k] for k, v in values.items() if v is not None)
        # Missing sensors do not silently become perfect or zero measurements.
        total = sum(st["weights"][k] * v for k, v in values.items() if v is not None) / coverage if coverage else None
        self.score = {"total": round(total, 1) if total is not None else None, "components": {k: round(v, 1) if v is not None else None for k, v in values.items()}, "coverage_percent": round(coverage * 100), "status": "UNAVAILABLE" if total is None else "GOOD" if total >= 80 else "FAIR" if total >= 60 else "NEEDS ATTENTION"}

    def _start_session(self, now):
        self.session = {"id": uuid.uuid4().hex[:12], "started_at": iso(now), "started_epoch": now, "state": "ACTIVE", "mode": self.mode, "vision_source": self.vision_source, "elapsed_seconds": 0.0, "sitting_seconds": 0.0, "continuous_sitting_seconds": 0.0, "screen_seconds": 0.0, "breaks": 0, "good_posture_seconds": 0.0, "observed_posture_seconds": 0.0, "score_integral": 0.0, "score_seconds": 0.0, "good_posture_percent": None, "average_score": None, "slouch_events": 0, "too_close_events": 0, "noise_warning_seconds": 0.0, "lux_integral": 0.0, "lux_seconds": 0.0, "temperature_integral": 0.0, "temperature_seconds": 0.0, "summary": None, "pause_reason": None, "sample_count": 0}
        self.auto_suppressed = False
        self.session["vision_input"] = self._effective_vision_input()
        self.event("SESSION_STARTED", "Study session started.", now)

    def _end_session(self, now, reason="user"):
        if not self.session:
            raise ValueError("No current session")
        self.session.update(state="ENDED", ended_at=iso(now), end_reason=reason)
        self._persist_session(now)
        ended = deepcopy(self.session)
        self.session = None
        self.condition_since.clear()
        self.auto_suppressed = True
        self._actuate(now)
        self.event("SESSION_ENDED", "Session saved. Your aggregate summary is ready.", now, session_id=ended["id"])
        return ended

    def _persist_session(self, now):
        if not self.session:
            return
        s = self.session
        s["duration_seconds"] = round(s["elapsed_seconds"], 1)
        s["wall_seconds"] = max(0, now - s["started_epoch"])
        s["good_posture_percent"] = round(s["good_posture_seconds"] / s["observed_posture_seconds"] * 100, 1) if s["observed_posture_seconds"] else None
        s["average_score"] = round(s["score_integral"] / s["score_seconds"], 1) if s["score_seconds"] else None
        s["average_lux"] = round(s["lux_integral"] / s["lux_seconds"], 1) if s["lux_seconds"] else None
        s["average_temperature"] = round(s["temperature_integral"] / s["temperature_seconds"], 1) if s["temperature_seconds"] else None
        self.store.save_session(deepcopy(s), s["started_epoch"])

    def _account(self, dt):
        if not self.session:
            return
        s = self.session
        if s["state"] == "ACTIVE" and self.present:
            s["elapsed_seconds"] += dt
            s["sitting_seconds"] += dt
            s["continuous_sitting_seconds"] += dt
            s["screen_seconds"] += dt
            if self.score["total"] is not None:
                s["score_integral"] += self.score["total"] * dt
                s["score_seconds"] += dt
            if self.sensors["posture"] in {"GOOD", "SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT"}:
                s["observed_posture_seconds"] += dt
                if self.sensors["posture"] == "GOOD":
                    s["good_posture_seconds"] += dt
            if self.sensors["noise_state"] == "NOISY":
                s["noise_warning_seconds"] += dt
            for reading, integral, seconds in [("lux", "lux_integral", "lux_seconds"), ("temperature_c", "temperature_integral", "temperature_seconds")]:
                if self.sensors[reading] is not None:
                    s[integral] += self.sensors[reading] * dt
                    s[seconds] += dt

    def control(self, action, now):
        with self.lock:
            if action not in {"start", "pause", "resume", "end", "break", "finish_break"}:
                raise ValueError("Unknown session action")
            self.step(now)
            if action == "start":
                if self.session:
                    raise ValueError("A session already exists")
                self._start_session(now)
            elif action == "end":
                return {"session": self._end_session(now)}
            elif not self.session:
                raise ValueError("No current session")
            elif action == "pause":
                if self.session["state"] != "ACTIVE":
                    raise ValueError("Only an active session can be paused")
                self.session.update(state="PAUSED", pause_reason="manual")
                self.event("SESSION_PAUSED", "Session paused.", now)
            elif action == "resume":
                if self.session["state"] != "PAUSED":
                    raise ValueError("Only a paused session can be resumed")
                self.session.update(state="ACTIVE", pause_reason=None)
                self.event("SESSION_RESUMED", "Session resumed.", now)
            elif action == "break":
                if self.session["state"] != "ACTIVE":
                    raise ValueError("Start a break from an active session")
                self.session.update(state="BREAK", break_started=now)
                self.session["breaks"] += 1
                self.event("BREAK_STARTED", "Take a moment away from your screen.", now)
            elif action == "finish_break":
                if self.session["state"] != "BREAK":
                    raise ValueError("No break is in progress")
                actual = max(0, now - self.session["break_started"])
                self.session.update(state="ACTIVE", pause_reason=None, screen_seconds=0.0)
                if actual >= self.settings["break_duration_seconds"]:
                    self.session["continuous_sitting_seconds"] = 0.0
                self.event("BREAK_FINISHED", f"Break completed ({round(actual)} seconds).", now, restorative=actual >= self.settings["break_duration_seconds"])
            self.condition_since.clear()
            self._persist_session(now)
            self._actuate(now)
            return self.state(now)

    def set_actuators(self, changes, now):
        with self.lock:
            allowed = {"lamp_mode", "lamp_percent", "fan_mode", "fan"}
            if not isinstance(changes, dict) or not changes or set(changes) - allowed:
                raise ValueError("Unknown or empty actuator control")
            proposed = {**self.actuators, **changes}
            if proposed["lamp_mode"] not in {"auto", "manual"} or proposed["fan_mode"] not in {"auto", "manual"}:
                raise ValueError("Actuator modes must be auto or manual")
            if not numeric(proposed["lamp_percent"]) or not 0 <= proposed["lamp_percent"] <= 100:
                raise ValueError("lamp_percent must be between 0 and 100")
            if not isinstance(proposed["fan"], bool):
                raise ValueError("fan must be boolean")
            if "lamp_percent" in changes and proposed["lamp_mode"] != "manual":
                raise ValueError("Set lamp_mode=manual to override brightness")
            if "fan" in changes and proposed["fan_mode"] != "manual":
                raise ValueError("Set fan_mode=manual to override the fan")
            self.actuators = proposed
            self._actuate(now)
            self.event("ACTUATOR_OVERRIDE", "Desk actuator controls updated.", now)
            return deepcopy(self.actuators)

    def _warn(self, key, condition, duration, now, message, severity="warning"):
        if not condition:
            self.condition_since.pop(key, None)
            elapsed = 0.0
        else:
            elapsed = now - self.condition_since.setdefault(key, now)
        self.rules.append({"id": key, "active": bool(condition), "elapsed_seconds": round(elapsed, 1), "threshold_seconds": round(duration, 1), "cooldown_remaining_seconds": max(0, round(self.settings["warning_cooldown_seconds"] - (now - self.last_warning.get(key, -1e20)), 1))})
        if not condition or elapsed < duration or now - self.last_warning.get(key, -1e20) < self.settings["warning_cooldown_seconds"]:
            return
        self.last_warning[key] = now
        self.buzzer_until = now + 1.0
        self.event(key, message, now, severity, session_id=self.session["id"] if self.session else None)
        self.metrics["warning_counts"][key] = self.metrics["warning_counts"].get(key, 0) + 1
        if self.session:
            if key == "POSTURE_WARNING":
                self.session["slouch_events"] += 1
            elif key == "DISTANCE_WARNING":
                self.session["too_close_events"] += 1

    def _actuate(self, now):
        active = self.present and self.session is not None and self.session["state"] == "ACTIVE"
        if self.actuators["lamp_mode"] == "auto":
            lux = self.sensors["lux"]
            self.actuators["lamp_percent"] = round(clip(1 - lux / self.settings["light_target_lux"]) * 100) if active and lux is not None else 0
        if self.actuators["fan_mode"] == "auto":
            temp = self.sensors["temperature_c"]
            # Hysteresis avoids rapid relay changes near the configured threshold.
            threshold = self.settings["temperature_fan_c"] - (1.0 if self.actuators["fan"] else 0)
            self.actuators["fan"] = bool(active and temp is not None and temp > threshold)
        self.actuators["buzzer"] = bool(self.settings["buzzer_enabled"] and active and now < self.buzzer_until)

    def step(self, now, telemetry=None):
        """Process one tick at UTC epoch seconds; safe to call with an injected clock."""
        with self.lock:
            if now < self.last_step:
                self.metrics["clock_regressions"] += 1
                raise ValueError("Engine clock must not move backwards")
            dt = now - self.last_step
            # Account only the previous observed state. Missing hardware does not
            # fabricate hours of successful sitting after a network outage.
            if self.mode == "hardware" or self.vision_source == "pc_camera":
                self._account(min(dt, max(0, self.observation_valid_until - self.last_step)))
                if dt > self.settings["sensor_stale_seconds"]:
                    self.condition_since.clear()
            else:
                self._account(dt)
            self.last_step = now
            if self.mode == "demo":
                self._simulate(now)
            if telemetry:
                for topic, payload in telemetry.items():
                    self.ingest(topic, payload, now)
            previous_vision = self.sensors["vision_available"]
            self._refresh_sensors(now)
            expiries = [min(source["captured"], source["seen"]) + self.settings["sensor_stale_seconds"] for source in self.sources.values() if now - min(source["captured"], source["seen"]) <= self.settings["sensor_stale_seconds"]]
            self.observation_valid_until = min(expiries) if expiries else now
            self.present = self._fuse_presence()
            if self.present:
                self.occupancy = "USER_PRESENT"
                self.absent_since = None
                if self.settings["auto_session"] and not self.session and not self.auto_suppressed:
                    self._start_session(now)
                if self.session and self.session["state"] == "PAUSED" and self.session.get("pause_reason") == "away":
                    self.session.update(state="ACTIVE", pause_reason=None)
                    self.event("SESSION_RESUMED", "Welcome back. Session resumed automatically.", now)
            else:
                self.absent_since = now if self.absent_since is None else self.absent_since
                self.occupancy = "TEMPORARILY_AWAY" if self.session else "EMPTY"
                if self.session and self.session["state"] == "ACTIVE" and now - self.absent_since >= self.settings["occupancy_pause_seconds"]:
                    self.session.update(state="PAUSED", pause_reason="away")
                    self.event("SESSION_PAUSED", "Desk unoccupied. Session paused automatically.", now)
                if self.session and now - self.absent_since >= self.settings["occupancy_end_minutes"] * 60:
                    self._end_session(now, "absence_timeout")
                    self.occupancy = "EMPTY"
                if now - self.absent_since >= self.settings["break_duration_seconds"] and self.session:
                    self.session["continuous_sitting_seconds"] = 0.0
                    self.session["screen_seconds"] = 0.0
                self.auto_suppressed = False
            if previous_vision and not self.sensors["vision_available"]:
                self.event("VISION_OFFLINE", "Vision unavailable. Seat, distance and environmental sensing continue.", now, "warning")
            elif not previous_vision and self.sensors["vision_available"]:
                self.event("VISION_ONLINE", "Local pose metadata is available.", now)
            self._compute_score()
            active = self.session is not None and self.session["state"] == "ACTIVE" and self.present
            self.rules = []
            bad_posture = self.sensors["posture"] in {"SLOUCH", "LEAN_FORWARD", "LEAN_LEFT_RIGHT"}
            close = self.sensors["distance_cm"] is not None and self.sensors["distance_cm"] < self.settings["distance_min_cm"]
            self._warn("POSTURE_WARNING", active and bad_posture, self.settings["posture_warning_seconds"], now, "Your posture has drifted. Reset your shoulders and sit comfortably upright.")
            fusion = self.sensors["posture"] == "LEAN_FORWARD"
            self._warn("DISTANCE_WARNING", active and close, self.settings["distance_warning_seconds"], now, "You are close to the screen. Move back to your configured viewing range." + (" Distance and forward-lean signals agree." if fusion else " Distance sensor measurement."))
            self._warn("NOISE_WARNING", active and self.sensors["noise_state"] == "NOISY", self.settings["noise_warning_seconds"], now, "Sustained noise may make studying less comfortable. Consider a quieter spot.")
            adaptation = .8 if self.settings["adaptive_reminders"] and self.score["total"] is not None and self.score["total"] < 60 else 1.0
            if self.session:
                break_due = active and self.session["continuous_sitting_seconds"] >= self.settings["break_interval_minutes"] * 60 * adaptation
                eye_due = active and self.session["screen_seconds"] >= self.settings["eye_break_interval_minutes"] * 60
                self._warn("BREAK_REMINDER", break_due, 0, now, "Time for a short movement break. Stand up and stretch comfortably.")
                self._warn("EYE_BREAK_REMINDER", eye_due, 0, now, "Give your eyes a screen break. Look at something farther away for a moment.")
            self._actuate(now)
            if self.last_sample is None or now - self.last_sample >= 1:
                self.last_sample = now
                point = {
                    "timestamp": iso(now), "mode": self.mode, "vision_source": self.vision_source,
                    "vision_input": self._effective_vision_input(),
                    "score": self.score["total"], "occupied": self.present,
                    "vision_confidence": self.sensors["confidence"],
                    **{key: self.sensors[key] for key in (
                        "distance_cm", "seat_pressure", "seat_occupied", "motion",
                        "lux", "noise_level", "temperature_c", "humidity_percent",
                        "pressure_hpa", "posture", "person_detected", "vision_available", "fps",
                    )},
                    **{key: self.actuators[key] for key in ("lamp_percent", "fan", "buzzer")},
                    "session_active": active,
                    "session_seconds": round(self.session["elapsed_seconds"], 2) if self.session else 0.0,
                }
                self.store.sample(now, self.mode, self.session["id"] if self.session else None, point)
                if self.session:
                    self.session["sample_count"] += 1
                self._persist_session(now)
                return point
            self._persist_session(now)
            return None

    def state(self, now):
        with self.lock:
            devices = []
            for topic, (device_id, name, _) in TOPICS.items():
                source = self.sources.get(topic)
                fresh = source is not None and now - source["seen"] <= self.settings["sensor_stale_seconds"] and now - source["captured"] <= self.settings["sensor_stale_seconds"]
                available = fresh and (device_id != "vision" or self.sensors["vision_available"])
                devices.append({"id": device_id, "name": ("PC browser camera · Python MediaPipe" if self.vision_input == "pc_camera" else "Backend camera · Python MediaPipe") if device_id == "vision" and self.vision_source == "pc_camera" else name,
                                "status": "online" if available else "offline", "last_seen": iso(source["seen"]) if source else None,
                                "topic": topic, "simulated": self.mode == "demo" and (device_id != "vision" or self.vision_source == "simulated"),
                                **({"source": self.vision_source} if device_id == "vision" else {})})
            session = deepcopy(self.session)
            if session:
                session["wall_seconds"] = max(0, now - session["started_epoch"])
                session["break_remaining_seconds"] = max(0, self.settings["break_duration_seconds"] - (now - session["break_started"])) if session["state"] == "BREAK" else 0
                adaptation = .8 if self.settings["adaptive_reminders"] and self.score["total"] is not None and self.score["total"] < 60 else 1.0
                session["break_due_in_seconds"] = max(0, self.settings["break_interval_minutes"] * 60 * adaptation - session["continuous_sitting_seconds"])
                session["break_interval_effective_seconds"] = self.settings["break_interval_minutes"] * 60 * adaptation
                session["eye_break_due_in_seconds"] = max(0, self.settings["eye_break_interval_minutes"] * 60 - session["screen_seconds"])
            vision = self.sources.get(VISION_TOPIC)
            return {"mode": self.mode, "vision_source": self.vision_source, "vision_input": self._effective_vision_input(), "vision_last_seen": iso(vision["seen"]) if vision else None, "now": iso(now), "running": bool(session and session["state"] == "ACTIVE"), "scenario": self.scenario, "occupancy": self.occupancy, "sensors": deepcopy(self.sensors), "score": deepcopy(self.score), "session": session, "actuators": deepcopy(self.actuators), "devices": devices, "events": self.store.events(30, mode=self.mode), "settings": deepcopy(self.settings), "rules": deepcopy(self.rules), "privacy": {"video_upload": self.vision_source == "pc_camera" and self.vision_input == "pc_camera", "camera_frame_transport": "browser_to_python" if self.vision_source == "pc_camera" and self.vision_input == "pc_camera" else "backend_local", "cloud_video_upload": False, "audio_recording": False, "cloud_ai_consent": self.settings["cloud_ai_consent"], "stored_data": "Derived sensor metadata and aggregate session statistics only"}, "health": {"mqtt": "demo" if self.mode == "demo" else "not_configured", "influxdb": "not_configured", "ai": "consent_required" if not self.settings["cloud_ai_consent"] else "not_configured", "storage": "local_sqlite", "vision": "online" if self.sensors["vision_available"] else "offline"}}

    def session_aggregates(self, session):
        # Deliberate allowlist is the entire cloud boundary. No samples, event
        # timeline, frame, audio, identifiers, or occupancy history are included.
        return {"session_minutes": round(session.get("elapsed_seconds", 0) / 60, 1), "study_condition_score": session.get("average_score"), "good_posture_percent": session.get("good_posture_percent"), "slouch_events": session.get("slouch_events", 0), "too_close_events": session.get("too_close_events", 0), "breaks": session.get("breaks", 0), "average_lux": session.get("average_lux"), "noise_warning_minutes": round(session.get("noise_warning_seconds", 0) / 60, 1), "average_temperature": session.get("average_temperature")}

    def observed_metrics(self):
        with self.lock:
            latencies = sorted(self.metrics["latencies_ms"])
            return {"telemetry_messages": self.metrics["telemetry_messages"], "invalid_messages": self.metrics["invalid_messages"], "observed_fps": self.sensors["fps"], "vision_source": self.vision_source, "vision_input": self._effective_vision_input(), "vision_confidence": self.sensors["confidence"], "ingestion_latency_ms": {"mean": round(sum(latencies) / len(latencies), 2) if latencies else None, "p95": round(latencies[max(0, math.ceil(.95 * len(latencies)) - 1)], 2) if latencies else None, "samples": len(latencies), "note": "Publisher timestamp to gateway receipt; synchronized clocks required. Simulator has no measured hardware latency."}, "warning_counts": deepcopy(self.metrics["warning_counts"]), "posture_accuracy": None, "distance_mae_cm": None, "note": ("PC camera FPS is measured by the Python backend; environment, seat, motion and distance remain simulated. " if self.vision_source == "pc_camera" else "") + "Accuracy and MAE require labeled ground truth; no benchmark values are fabricated.", "mode": self.mode}
