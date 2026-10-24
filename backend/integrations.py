"""Optional adapters. Core monitoring never waits for cloud or time-series I/O."""

from collections import deque
from datetime import datetime
import json
import logging
import math
import os
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid

from .engine import TOPICS, iso

log = logging.getLogger("focusguard")


def enabled(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class MqttBridge:
    def __init__(self, engine):
        self.engine = engine
        self.status = "not_configured"
        self.client = None
        self.last_publish = 0
        self.last_control = None
        self.last_config = None
        self.last_ack = None
        self.error = None
        self.seen_events = {event["id"] for event in engine.store.events(200, mode="hardware")}

    def start(self):
        if not enabled("MQTT_ENABLED"):
            return
        try:
            import paho.mqtt.client as mqtt
            self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="focusguard-backend-" + uuid.uuid4().hex[:8])
            if os.getenv("MQTT_USERNAME"):
                self.client.username_pw_set(os.getenv("MQTT_USERNAME"), os.getenv("MQTT_PASSWORD"))
            if enabled("MQTT_TLS"):
                self.client.tls_set()
            self.client.on_connect = self._connected
            self.client.on_disconnect = self._disconnected
            self.client.on_connect_fail = lambda client, userdata: setattr(self, "status", "offline")
            self.client.on_message = self._message
            self.client.reconnect_delay_set(min_delay=1, max_delay=30)
            self.status = "connecting"
            self.client.connect_async(os.getenv("MQTT_HOST", "127.0.0.1"), int(os.getenv("MQTT_PORT", "1883")), 30)
            self.client.loop_start()
        except Exception as exc:
            self.status = "offline"
            self.error = type(exc).__name__
            log.warning("MQTT adapter unavailable: %s", type(exc).__name__)

    def _connected(self, client, userdata, flags, reason_code, properties):
        self.status = "connected" if reason_code == 0 else "offline"
        if self.status == "connected":
            for topic in TOPICS:
                client.subscribe(topic, qos=1)
            client.subscribe("focusguard/gateway/actuator_state", qos=1)
            self.last_config = None

    def _disconnected(self, client, userdata, flags, reason_code, properties):
        self.status = "offline"

    def _message(self, client, userdata, message):
        if self.engine.mode != "hardware":
            return
        try:
            if len(message.payload) > 8192:
                raise ValueError("Telemetry payload exceeds metadata size limit")
            payload = json.loads(message.payload)
            if message.topic == "focusguard/gateway/actuator_state":
                if isinstance(payload, dict):
                    self.last_ack = {"timestamp": iso(time.time()), "command_id": str(payload.get("command_id", ""))[:80], "lamp_percent": payload.get("lamp_percent"), "fan": payload.get("fan"), "buzzer": payload.get("buzzer")}
                return
            self.engine.ingest(message.topic, payload, time.time())
        except (ValueError, TypeError, UnicodeDecodeError):
            log.warning("Rejected invalid metadata on %s", message.topic)

    def publish(self, now):
        if self.status != "connected" or not self.client or self.engine.mode != "hardware":
            return
        with self.engine.lock:
            controls = dict(self.engine.actuators)
            config = {k: v for k, v in self.engine.settings.items() if k not in {"cloud_ai_consent"}}
        config_json = json.dumps(config, sort_keys=True)
        if config_json != self.last_config:
            self.client.publish("focusguard/config", config_json, qos=1, retain=True)
            self.last_config = config_json
        recent_events = self.engine.store.events(200, mode="hardware")
        for event in reversed(recent_events):
            if event["id"] not in self.seen_events:
                self.client.publish("focusguard/system/event", json.dumps(event), qos=1, retain=False)
        self.seen_events = {event["id"] for event in recent_events}
        signature = json.dumps(controls, sort_keys=True)
        if signature != self.last_control or now - self.last_publish >= 3:
            command = {**controls, "command_id": uuid.uuid4().hex[:16], "issued_at": iso(now), "expires_at": iso(now + 8)}
            self.client.publish("focusguard/actuator", json.dumps(command), qos=1, retain=False)
            self.last_publish = now
            self.last_control = signature

    def stop(self):
        if self.client:
            if self.status == "connected" and self.engine.mode == "hardware":
                self.client.publish("focusguard/actuator", json.dumps({"lamp_percent": 0, "fan": False, "buzzer": False, "command_id": uuid.uuid4().hex[:16], "expires_at": iso(time.time() + 8)}), qos=1, retain=False)
            self.client.disconnect()
            self.client.loop_stop()


class InfluxWriter:
    """Bounded retry queue; SQLite remains the durable source during outages."""
    def __init__(self):
        self.url = os.getenv("INFLUX_URL", "").rstrip("/")
        self.token = os.getenv("INFLUX_TOKEN", "")
        self.status = "not_configured"
        self.error = None
        self.pending = deque(maxlen=5000)
        self.lock = threading.Lock()
        self.shutdown = threading.Event()
        self.thread = None
        self.dropped = 0
        self.written = 0

    def start(self):
        if not self.url or not self.token:
            return
        self.status = "connecting"
        self.thread = threading.Thread(target=self._run, name="focusguard-influx", daemon=True)
        self.thread.start()

    def enqueue(self, point):
        if not self.thread:
            return
        with self.lock:
            if len(self.pending) == self.pending.maxlen:
                self.dropped += 1
            self.pending.append(point)

    def enqueue_event(self, event):
        self.enqueue({**event, "measurement": "desk_events"})

    @staticmethod
    def _quoted(value):
        # Influx line protocol records are newline delimited. Do not permit
        # event text to inject a second measurement or an unterminated string.
        return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\r", " ").replace("\n", " ") + '"'

    @staticmethod
    def _tag(value):
        return str(value).replace("\\", "\\\\").replace("\r", " ").replace("\n", " ").replace(",", "\\,").replace(" ", "\\ ").replace("=", "\\=")

    @staticmethod
    def event_line(event):
        mode = "hardware" if event.get("mode") == "hardware" else "demo"
        tags = ",".join(f"{key}={InfluxWriter._tag(value)}" for key, value in (
            ("mode", mode), ("event_type", event["event_type"]), ("severity", event.get("severity", "info")),
        ))
        fields = "message=" + InfluxWriter._quoted(event["message"])
        if event.get("vision_source") in {"simulated", "pc_camera", "gateway", "unknown"}:
            fields += ",vision_source=" + InfluxWriter._quoted(event["vision_source"])
        if event.get("vision_input") in {"python_backend", "pc_camera"}:
            fields += ",vision_input=" + InfluxWriter._quoted(event["vision_input"])
        if event.get("session_id"):
            fields += ",session_id=" + InfluxWriter._quoted(event["session_id"])
        timestamp = int(datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00")).timestamp() * 1000)
        return f"desk_events,{tags} {fields} {timestamp}"

    @staticmethod
    def line(point):
        if point.get("measurement") == "desk_events":
            return InfluxWriter.event_line(point)
        fields = []
        for key in ["score", "distance_cm", "lux", "noise_level", "temperature_c", "humidity_percent", "pressure_hpa", "seat_pressure", "fps", "vision_confidence", "lamp_percent", "session_seconds"]:
            value = point.get(key)
            if value is not None and isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value):
                fields.append(f"{key}={float(value)}")
        posture = str(point.get("posture", "UNKNOWN"))
        fields.extend(["posture=" + InfluxWriter._quoted(posture), "good_posture=" + str(posture == "GOOD").lower()])
        if point.get("vision_source") in {"simulated", "pc_camera", "gateway", "unknown"}:
            fields.append("vision_source=" + InfluxWriter._quoted(point["vision_source"]))
        if point.get("vision_input") in {"python_backend", "pc_camera"}:
            fields.append("vision_input=" + InfluxWriter._quoted(point["vision_input"]))
        for key in ["occupied", "seat_occupied", "motion", "person_detected", "vision_available", "fan", "buzzer", "session_active"]:
            value = point.get(key)
            if isinstance(value, bool):
                fields.append(f"{key}={str(value).lower()}")
        timestamp = int(datetime.fromisoformat(point["timestamp"].replace("Z", "+00:00")).timestamp() * 1000)
        mode = "hardware" if point.get("mode") == "hardware" else "demo"
        return f"desk_conditions,mode={mode} " + ",".join(fields) + f" {timestamp}"

    def _run(self):
        query = urlencode({"org": os.getenv("INFLUX_ORG", "focusguard"), "bucket": os.getenv("INFLUX_BUCKET", "focusguard"), "precision": "ms"})
        while True:
            with self.lock:
                batch = list(self.pending)[:100]
            if not batch:
                if self.shutdown.is_set():
                    break
                self.shutdown.wait(.5)
                continue
            try:
                request = Request(self.url + "/api/v2/write?" + query, data="\n".join(self.line(p) for p in batch).encode(), headers={"Authorization": "Token " + self.token, "Content-Type": "text/plain; charset=utf-8"}, method="POST")
                with urlopen(request, timeout=3) as response:
                    if response.status not in {200, 204}:
                        raise OSError("Influx write failed")
                with self.lock:
                    # Only remove points still at the queue head. Overflow is
                    # explicitly counted, and every original remains in SQLite.
                    for point in batch:
                        if self.pending and self.pending[0] is point:
                            self.pending.popleft()
                self.written += len(batch)
                self.status = "connected"
                self.error = None
            except Exception as exc:
                self.status = "offline"
                self.error = type(exc).__name__
                if self.shutdown.is_set():
                    break
                self.shutdown.wait(5)

    def stop(self):
        self.shutdown.set()
        if self.thread:
            self.thread.join(timeout=4)


class SummaryService:
    def __init__(self, engine):
        self.engine = engine
        self.model = os.getenv("BEDROCK_MODEL_ID", "")
        self.last_status = "not_configured" if not self.model else "configured"

    @staticmethod
    def local_summary(stats):
        duration = stats["session_minutes"]
        score = stats.get("study_condition_score")
        posture = stats.get("good_posture_percent")
        opening = f"You spent {duration:g} minutes at the desk. "
        opening += f"Your average Study Condition Score was {score:g}/100. " if score is not None else "There were not enough sensor observations to calculate a session score. "
        if posture is not None:
            opening += f"Good posture was observed for {posture:g}% of reliable pose observations. "
        suggestions = []
        if stats.get("too_close_events", 0):
            suggestions.append("Move the screen or chair to maintain your configured viewing distance.")
        if stats.get("slouch_events", 0):
            suggestions.append("Use posture reminders as a cue to adjust your position and take short movement breaks.")
        if stats.get("average_lux") is not None and stats["average_lux"] < 300:
            suggestions.append("Increase desk lighting for your next session.")
        if stats.get("noise_warning_minutes", 0) >= 1:
            suggestions.append("Consider a quieter study space when possible.")
        if stats.get("average_temperature") is not None and stats["average_temperature"] > 28:
            suggestions.append("A cooler desk environment may feel more comfortable.")
        if not stats.get("breaks") and duration >= 20:
            suggestions.append("Plan a short break during your next session.")
        if not suggestions:
            suggestions.append("Keep your desk setup consistent and take regular screen and movement breaks.")
        return opening + " ".join(suggestions[:3])

    def generate(self, session_id, now, allow_cloud=True):
        with self.engine.lock:
            session = self.engine.store.get_session(session_id)
            if not session:
                raise KeyError("Session not found")
            stats = self.engine.session_aggregates(session)
            consent = self.engine.settings["cloud_ai_consent"] and allow_cloud
        text = self.local_summary(stats)
        source = "local"
        sent = False
        reason = "Cloud sharing is off. Summary generated locally from aggregate statistics."
        if consent and not self.model:
            reason = "AWS Bedrock is not configured. Summary generated locally."
        elif consent and self.model:
            try:
                import boto3
                from botocore.config import Config
                client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"), config=Config(connect_timeout=3, read_timeout=20, retries={"total_max_attempts": 1}))
                # Consent is checked again immediately before the external call.
                with self.engine.lock:
                    if not self.engine.settings["cloud_ai_consent"]:
                        raise PermissionError("Consent revoked")
                sent = True
                result = client.converse(modelId=self.model, system=[{"text": "You are FocusGuard's study desk assistant. In at most 120 words, summarize only the supplied aggregate statistics and offer 2 practical ergonomic or environmental suggestions. Never infer mental focus or medical outcomes. Missing values are unknown. Do not invent measurements."}], messages=[{"role": "user", "content": [{"text": json.dumps(stats)}]}], inferenceConfig={"maxTokens": 250, "temperature": .2})
                generated = "\n".join(block["text"] for block in result["output"]["message"]["content"] if "text" in block).strip()
                if not generated:
                    raise ValueError("Empty Bedrock response")
                text = generated
                source = "aws_bedrock"
                reason = "AWS Bedrock received aggregate statistics only."
                self.last_status = "connected"
            except PermissionError:
                sent = False
                reason = "Cloud consent was revoked. Summary generated locally."
            except Exception as exc:
                self.last_status = "offline"
                reason = "AWS Bedrock was unavailable. Local summary generated; monitoring continues."
                log.warning("Bedrock fallback: %s", type(exc).__name__)
        with self.engine.lock:
            # Refresh the latest counters if a current session advanced while the
            # external model was answering; never overwrite them with old totals.
            latest = self.engine.store.get_session(session_id) or session
            latest.update(summary=text, summary_source=source, summary_generated_at=iso(now), summary_note=reason)
            self.engine.store.save_session(latest, latest.get("started_epoch", now))
            if self.engine.session and self.engine.session["id"] == session_id:
                self.engine.session.update(summary=text, summary_source=source, summary_generated_at=iso(now), summary_note=reason)
            self.engine.event("SUMMARY_CREATED", "Session summary created " + ("with AWS Bedrock." if source == "aws_bedrock" else "locally."), now, session_id=session_id, source=source, mode=session.get("mode", self.engine.mode), vision_source=session.get("vision_source", "unknown"), vision_input=session.get("vision_input"))
        return {"session_id": session_id, "summary": text, "summary_source": source, "source": source, "cloud_sent": sent, "aggregates": stats, "note": reason}
