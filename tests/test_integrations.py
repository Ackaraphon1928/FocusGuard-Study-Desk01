"""Adapter contracts using mocks only; no broker or time-series service is started."""

import json
import unittest
from unittest.mock import Mock

from backend.engine import FocusGuardEngine
from backend.integrations import InfluxWriter, MqttBridge
from backend.storage import Store


class MqttBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.engine = FocusGuardEngine(self.store, mode="demo", now=1000)
        self.bridge = MqttBridge(self.engine)
        self.bridge.client = Mock()
        self.bridge.status = "connected"

    def tearDown(self):
        self.store.close()

    def published(self, topic):
        return [json.loads(call.args[1]) for call in self.bridge.client.publish.call_args_list if call.args[0] == topic]

    def test_demo_never_publishes_actuator_commands_or_replays_events_into_hardware(self):
        self.engine.set_scenario("slouch", 1000)
        self.engine.step(1031)
        self.assertTrue(any(event["mode"] == "demo" for event in self.store.events()))
        self.bridge.publish(1031)
        self.bridge.client.publish.assert_not_called()
        self.engine.set_mode("hardware", 1032)
        self.bridge.publish(1032)
        events = self.published("focusguard/system/event")
        self.assertTrue(events)
        self.assertTrue(all(event["mode"] == "hardware" for event in events))
        self.assertFalse(any(event["event_type"] == "POSTURE_WARNING" for event in events))
        commands = self.published("focusguard/actuator")
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0]["lamp_percent"], 0)
        self.assertFalse(commands[0]["buzzer"])

    def test_each_new_hardware_event_is_forwarded_once_without_retention(self):
        self.engine.set_mode("hardware", 1000)
        event = self.engine.event("POSTURE_WARNING", "A test violation.", 1001)
        self.bridge.publish(1001)
        self.bridge.publish(1001.1)
        sent = [row for row in self.published("focusguard/system/event") if row["id"] == event["id"]]
        self.assertEqual(len(sent), 1)
        for call in self.bridge.client.publish.call_args_list:
            if call.args[0] in {"focusguard/system/event", "focusguard/actuator"}:
                self.assertFalse(call.kwargs["retain"])
        settings = self.published("focusguard/config")[0]
        self.assertNotIn("cloud_ai_consent", settings)


class InfluxContractTests(unittest.TestCase):
    def test_conditions_have_numeric_and_boolean_fields_without_unknown_or_nan_values(self):
        point = {
            "timestamp": "2026-10-24T00:00:00Z", "mode": "hardware",
            "score": float("nan"), "lux": None, "distance_cm": 60,
            "pressure_hpa": 1009, "seat_pressure": 720, "lamp_percent": 35,
            "session_seconds": 75, "posture": "GOOD", "occupied": True,
            "seat_occupied": True, "motion": False, "person_detected": True,
            "vision_available": True, "fan": False, "buzzer": True, "session_active": True,
        }
        line = InfluxWriter.line(point)
        self.assertTrue(line.startswith("desk_conditions,mode=hardware "))
        for field in ("distance_cm=60.0", "pressure_hpa=1009.0", "seat_pressure=720.0", "lamp_percent=35.0", "session_seconds=75.0"):
            self.assertIn(field, line)
        for field in ("seat_occupied=true", "motion=false", "person_detected=true", "vision_available=true", "fan=false", "buzzer=true", "session_active=true", "good_posture=true"):
            self.assertIn(field, line)
        self.assertNotIn("score=", line)
        self.assertNotIn("lux=", line)
        self.assertNotIn("nan", line.lower())
        self.assertNotIn('fan="', line)

    def test_event_line_escapes_tags_strings_and_newlines(self):
        event = {
            "measurement": "desk_events", "timestamp": "2026-10-24T00:00:00Z", "mode": "hardware",
            "event_type": "TEST EVENT,tag=value", "severity": "warning",
            "message": 'A "quoted" message\\path\nsecond line', "session_id": 'session"id',
        }
        line = InfluxWriter.line(event)
        self.assertTrue(line.startswith("desk_events,mode=hardware,"))
        self.assertIn("event_type=TEST\\ EVENT\\,tag\\=value", line)
        self.assertIn('message="', line)
        self.assertIn('\\"quoted\\"', line)
        self.assertNotIn("\n", line)
        self.assertNotIn("\r", line)


if __name__ == "__main__":
    unittest.main()
