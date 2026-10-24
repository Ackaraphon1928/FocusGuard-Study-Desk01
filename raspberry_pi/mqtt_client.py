"""A single bounded, reconnecting MQTT connection. Payloads contain no media."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Callable

import paho.mqtt.client as mqtt


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GatewayMQTT:
    def __init__(self) -> None:
        self.handlers: dict[str, Callable[[dict], None]] = {}
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="focusguard-pi")
        self.client.max_queued_messages_set(50)
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        username = os.getenv("MQTT_USERNAME", "")
        if username:
            self.client.username_pw_set(username, os.getenv("MQTT_PASSWORD", ""))
        if os.getenv("MQTT_TLS", "false").lower() == "true":
            self.client.tls_set(ca_certs=os.getenv("MQTT_CA_CERT") or None)
        self.client.will_set("focusguard/gateway/status", "offline", qos=1, retain=True)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            logging.error("MQTT connection refused: %s", reason_code)
            return
        client.publish("focusguard/gateway/status", "online", qos=1, retain=True)
        for topic in self.handlers:
            client.subscribe(topic, qos=1)

    def _on_message(self, client, userdata, message) -> None:
        # Commands are never retained; do not replay an old beep on reconnection.
        if message.retain or len(message.payload) > 4096:
            return
        handler = self.handlers.get(message.topic)
        if handler:
            try:
                payload = json.loads(message.payload)
                if not isinstance(payload, dict):
                    raise ValueError("Expected JSON object")
                handler(payload)
            except (ValueError, TypeError, KeyError) as error:
                logging.warning("Rejected MQTT command: %s", error)

    def start(self) -> None:
        self.client.connect_async(os.getenv("MQTT_HOST", "127.0.0.1"), int(os.getenv("MQTT_PORT", "1883")), 20)
        self.client.loop_start()

    def publish(self, topic: str, payload: dict) -> None:
        if not self.client.is_connected():
            return  # Current observations supersede old ones; never replay stale sensor values.
        payload = {"device_id": "gateway", "timestamp": utc_now(), **payload}
        self.client.publish(topic, json.dumps(payload, allow_nan=False), qos=0, retain=False)

    def close(self) -> None:
        if self.client.is_connected():
            self.client.publish("focusguard/gateway/status", "offline", qos=1, retain=True).wait_for_publish(timeout=1)
        self.client.disconnect()
        self.client.loop_stop()
