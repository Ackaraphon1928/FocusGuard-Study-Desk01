"""Run from repository root: python -m raspberry_pi.gateway."""
from __future__ import annotations

import argparse
import logging
import signal
import threading

from dotenv import load_dotenv

from .actuators import Actuators
from .mqtt_client import GatewayMQTT
from .sensors import run_sensors
from .vision import run_vision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-vision", action="store_true")
    parser.add_argument("--no-sensors", action="store_true")
    parser.add_argument("--no-actuators", action="store_true")
    parser.add_argument("--preview", action="store_true", help="Local display only; no recording or web stream")
    parser.add_argument("--calibrate", action="store_true", help="Sit neutrally for at least 30 reliable frames and 1.2 seconds")
    parser.add_argument("--metrics-csv", help="Write local numeric timing/geometry metadata; no raw imagery")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_dotenv("raspberry_pi/.env")
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    mqtt = GatewayMQTT()
    tasks = []
    if not args.no_actuators:
        actuators = Actuators(mqtt)
        tasks.append(("actuators", lambda: actuators.run(stop)))
    if not args.no_sensors:
        tasks.append(("sensors", lambda: run_sensors(mqtt, stop)))
    if not args.no_vision:
        tasks.append(("vision", lambda: run_vision(mqtt, stop, preview=args.preview, recalibrate=args.calibrate, metrics_csv=args.metrics_csv)))
    if not tasks:
        parser.error("Enable at least one gateway component")

    def worker(name, function):
        try:
            function()
        except Exception:
            logging.exception("%s worker failed; other components continue", name)
            mqtt.publish("focusguard/gateway/health", {"component": name, "healthy": False})

    threads = [threading.Thread(target=worker, args=task, name=task[0], daemon=True) for task in tasks]
    mqtt.start()
    try:
        for thread in threads:
            thread.start()
        while not stop.wait(0.5):
            if not any(thread.is_alive() for thread in threads):
                raise RuntimeError("All gateway workers stopped; inspect component errors")
    finally:
        stop.set()
        for thread in threads:
            thread.join(timeout=5)
        mqtt.close()


if __name__ == "__main__":
    main()
