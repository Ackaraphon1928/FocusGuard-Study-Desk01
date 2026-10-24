"""Pure gateway safeguards; these tests do not import a camera or GPIO driver."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest

from raspberry_pi.actuators import validate_command
from raspberry_pi.posture import Calibration, TemporalPosture, calibrate, features


class GatewaySafetyTests(unittest.TestCase):
    def test_camera_debounce_does_not_turn_one_bad_frame_into_stable_posture(self):
        filter_ = TemporalPosture(.6)
        self.assertEqual(filter_.update("GOOD", 10), "UNKNOWN")
        self.assertEqual(filter_.update("GOOD", 10.7), "GOOD")
        self.assertEqual(filter_.update("SLOUCH", 10.8), "GOOD")
        self.assertEqual(filter_.update("GOOD", 10.9), "GOOD")
        self.assertEqual(filter_.update("SLOUCH", 11), "GOOD")
        self.assertEqual(filter_.update("SLOUCH", 11.7), "SLOUCH")
        self.assertEqual(filter_.update("UNKNOWN", 11.8), "UNKNOWN")
        self.assertEqual(filter_.update("NO_PERSON", 11.9), "NO_PERSON")

    def test_unreliable_or_degenerate_landmarks_are_not_scored_as_good_posture(self):
        self.assertIsNone(features([], 640, 480))
        landmarks = [SimpleNamespace(x=.5, y=.5, visibility=.1) for _ in range(33)]
        self.assertIsNone(features(landmarks, 640, 480))
        for point in landmarks:
            point.visibility = .99
        self.assertIsNone(features(landmarks, 640, 480))

    def test_calibration_requires_observations_and_uses_robust_baseline(self):
        neutral = {"torso_angle": 2, "shoulder_angle": 1, "neck_offset": .1, "head_height": .5}
        with self.assertRaises(ValueError):
            calibrate([neutral] * 19)
        outlier = {"torso_angle": 80, "shoulder_angle": 70, "neck_offset": 5, "head_height": -2}
        baseline = calibrate([neutral] * 20 + [outlier], view="front")
        self.assertIsInstance(baseline, Calibration)
        self.assertEqual(baseline.torso_angle, 2)
        self.assertEqual(baseline.head_height, .5)
        self.assertEqual(baseline.view, "front")

    def command(self, **changes):
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        payload = {"command_id": "demo-001", "expires_at": (now + timedelta(seconds=5)).isoformat(), "lamp_percent": 65, "fan": True, "buzzer": False}
        payload.update(changes)
        return now, payload

    def test_fresh_bounded_actuator_command_can_be_applied(self):
        now, payload = self.command()
        command = validate_command(payload, now)
        self.assertEqual(command["lamp_percent"], 65)
        self.assertTrue(command["fan"])
        self.assertFalse(command["buzzer"])
        self.assertGreater(command["expires_at"], now)

    def test_delayed_or_retained_commands_cannot_reactivate_outputs(self):
        now, payload = self.command()
        for expires in [now - timedelta(seconds=1), now, now + timedelta(seconds=31)]:
            with self.subTest(expires=expires), self.assertRaises(ValueError):
                validate_command({**payload, "expires_at": expires.isoformat()}, now)
        with self.assertRaises(ValueError):
            validate_command({**payload, "expires_at": "2026-10-24T00:00:05"}, now)

    def test_malformed_command_levels_and_boolean_fields_are_rejected(self):
        for changes in [{"lamp_percent": -1}, {"lamp_percent": 101}, {"lamp_percent": float("nan")}, {"lamp_percent": True}, {"fan": 1}, {"buzzer": "yes"}, {"command_id": ""}]:
            now, payload = self.command(**changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_command(payload, now)


if __name__ == "__main__":
    unittest.main()
