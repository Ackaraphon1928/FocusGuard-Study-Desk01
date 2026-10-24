"""Independent I2C recovery: one failed sensor does not suppress the other."""
from __future__ import annotations

import logging
import os
import time
from threading import Event


def run_sensors(mqtt, stop: Event) -> None:
    import board
    import adafruit_bh1750
    from adafruit_bme280 import basic as adafruit_bme280

    i2c = board.I2C()
    devices: dict = {"bme280": None, "bh1750": None}
    retry_at = {name: 0.0 for name in devices}
    interval = max(0.5, float(os.getenv("SENSOR_INTERVAL_SECONDS", "2")))
    try:
        while not stop.is_set():
            values = {}
            for name in devices:
                if devices[name] is None and time.monotonic() < retry_at[name]:
                    continue
                try:
                    if name == "bme280":
                        if devices[name] is None:
                            devices[name] = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=int(os.getenv("BME280_ADDRESS", "0x76"), 0))
                        values.update(temperature_c=round(devices[name].temperature, 2), humidity_percent=round(devices[name].relative_humidity, 2), pressure_hpa=round(devices[name].pressure, 2))
                    else:
                        if devices[name] is None:
                            devices[name] = adafruit_bh1750.BH1750(i2c, address=int(os.getenv("BH1750_ADDRESS", "0x23"), 0))
                        values["lux"] = round(devices[name].lux, 2)
                except (OSError, RuntimeError, ValueError) as error:
                    logging.warning("%s unavailable: %s", name, error)
                    devices[name] = None
                    retry_at[name] = time.monotonic() + 10
            values["sensor_status"] = {name: devices[name] is not None for name in devices}
            mqtt.publish("focusguard/gateway/environment", values)
            stop.wait(interval)
    finally:
        i2c.deinit()
