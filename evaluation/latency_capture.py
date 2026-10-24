"""Passively measure command-to-ack transport/application latency on one clock."""
from __future__ import annotations

import argparse
import csv
import json
import os
import time
from collections import OrderedDict


def main() -> None:
    import paho.mqtt.client as mqtt
    from dotenv import load_dotenv
    load_dotenv("raspberry_pi/.env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--output", default="evaluation/latency.csv")
    args = parser.parse_args()
    pending = OrderedDict()
    with open(args.output, "w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["command_id", "latency_ms", "scope"])
        writer.writeheader()
        def on_connect(client, userdata, flags, reason_code, properties):
            if not reason_code.is_failure:
                client.subscribe([("focusguard/actuator", 1), ("focusguard/gateway/actuator_state", 1)])
        def on_message(client, userdata, message):
            try:
                payload = json.loads(message.payload)
                command_id = payload.get("command_id")
                if message.retain or not command_id:
                    return
                now = time.perf_counter()
                if message.topic == "focusguard/actuator":
                    pending[command_id] = now
                    if len(pending) > 1000:
                        pending.popitem(last=False)
                elif command_id in pending:
                    writer.writerow({"command_id": command_id, "latency_ms": (now - pending.pop(command_id)) * 1000, "scope": "broker_command_to_gpio_ack_observed_on_one_client"})
                    stream.flush()
            except (ValueError, TypeError, AttributeError):
                return
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="focusguard-evaluation")
        if os.getenv("MQTT_USERNAME"):
            client.username_pw_set(os.getenv("MQTT_USERNAME"), os.getenv("MQTT_PASSWORD"))
        if os.getenv("MQTT_TLS", "false").lower() == "true":
            client.tls_set(ca_certs=os.getenv("MQTT_CA_CERT") or None)
        client.on_connect, client.on_message = on_connect, on_message
        client.connect(os.getenv("MQTT_HOST", "127.0.0.1"), int(os.getenv("MQTT_PORT", "1883")))
        client.loop_start()
        try:
            deadline = time.monotonic() + max(1, args.seconds)
            while time.monotonic() < deadline:
                time.sleep(min(0.2, max(0.001, deadline - time.monotonic())))
        except KeyboardInterrupt:
            pass
        finally:
            client.disconnect()
            client.loop_stop()
    print(f"Saved actual observed command/ack pairs to {args.output}; no commands were sent.")


if __name__ == "__main__":
    main()
