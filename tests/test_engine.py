"""Behavioral checks for the local rules, with no devices, network, or wall clock."""

from copy import deepcopy
import unittest

from backend.engine import FocusGuardEngine, iso
from backend.storage import Store


NODE_A = "focusguard/nodeA/user"
NODE_B = "focusguard/nodeB/environment"
ENVIRONMENT = "focusguard/gateway/environment"
VISION = "focusguard/gateway/vision"


def observed_desk(**changes):
    """A fully observed desk; overrides are sensor fields, not simulator states."""
    telemetry = {
        NODE_A: {"distance_cm": 60, "seat_pressure": 720, "seat_occupied": True},
        NODE_B: {"motion": False, "noise_level": .2},
        ENVIRONMENT: {"temperature_c": 25, "humidity_percent": 50, "pressure_hpa": 1010, "lux": 400},
        VISION: {"person_detected": True, "posture": "GOOD", "confidence": .95, "fps": 18, "vision_available": True},
    }
    for key, value in changes.items():
        matches = [payload for payload in telemetry.values() if key in payload]
        if len(matches) != 1:
            raise AssertionError(f"Unknown or ambiguous fixture field: {key}")
        matches[0][key] = value
    return telemetry


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.now = 1_000.0
        self.engine = FocusGuardEngine(self.store, mode="hardware", now=self.now)
        self.engine.patch_settings({
            "posture_warning_seconds": 3, "distance_warning_seconds": 2,
            "noise_warning_seconds": 3, "warning_cooldown_seconds": 10,
            "occupancy_pause_seconds": 3, "break_duration_seconds": 5,
            "break_interval_minutes": .1, "eye_break_interval_minutes": .1,
            "adaptive_reminders": False,
        }, self.now)

    def tearDown(self):
        self.store.close()

    def observe(self, seconds=1, **changes):
        for _ in range(seconds):
            self.now += 1
            self.engine.step(self.now, observed_desk(**changes))
        return self.engine.state(self.now)

    def events(self, event_type):
        return [e for e in self.store.events(10000) if e["event_type"] == event_type]

    def test_normal_desk_starts_session_without_motion(self):
        state = self.observe()
        self.assertEqual(state["occupancy"], "USER_PRESENT")
        self.assertEqual(state["session"]["state"], "ACTIVE")
        self.assertEqual(state["score"]["total"], 100)
        self.assertEqual(state["score"]["coverage_percent"], 100)
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        self.assertFalse(state["actuators"]["buzzer"])

    def test_posture_needs_continuous_evidence_and_resets_after_good_sample(self):
        self.observe(3, posture="SLOUCH")
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        self.observe(posture="GOOD")
        self.observe(3, posture="SLOUCH")
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        state = self.observe(posture="SLOUCH")
        self.assertEqual(len(self.events("POSTURE_WARNING")), 1)
        self.assertTrue(state["actuators"]["buzzer"])

    def test_warning_cooldown_and_buzzer_pulse_are_bounded(self):
        self.observe(4, posture="SLOUCH")
        self.assertEqual(len(self.events("POSTURE_WARNING")), 1)
        state = self.observe(posture="SLOUCH")
        self.assertFalse(state["actuators"]["buzzer"])
        self.observe(8, posture="SLOUCH")
        self.assertEqual(len(self.events("POSTURE_WARNING")), 1)
        self.observe(posture="SLOUCH")
        self.assertEqual(len(self.events("POSTURE_WARNING")), 2)

    def test_distance_warning_reports_multimodal_agreement(self):
        self.observe(3, distance_cm=28, posture="LEAN_FORWARD")
        warnings = self.events("DISTANCE_WARNING")
        self.assertEqual(len(warnings), 1)
        self.assertIn("signals agree", warnings[0]["message"])
        self.assertEqual(self.engine.session["too_close_events"], 1)

    def test_noise_requires_sustained_level_and_does_not_record_audio(self):
        self.observe(3, noise_level=.9)
        self.assertEqual(self.events("NOISE_WARNING"), [])
        self.observe(noise_level=.9)
        self.assertEqual(len(self.events("NOISE_WARNING")), 1)
        self.assertFalse(self.engine.state(self.now)["privacy"]["audio_recording"])

    def test_absence_pauses_and_returns_without_posture_warning(self):
        self.observe()
        original = self.engine.session["id"]
        away = {"seat_occupied": False, "seat_pressure": 0, "person_detected": False, "posture": "SLOUCH", "motion": False}
        state = self.observe(4, **away)
        self.assertEqual(state["occupancy"], "TEMPORARILY_AWAY")
        self.assertEqual(state["session"]["state"], "PAUSED")
        self.assertEqual(state["actuators"]["lamp_percent"], 0)
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        paused_seconds = state["session"]["elapsed_seconds"]
        self.observe(5, **away)
        self.assertEqual(self.engine.session["elapsed_seconds"], paused_seconds)
        state = self.observe()
        self.assertEqual(state["session"]["id"], original)
        self.assertEqual(state["session"]["state"], "ACTIVE")

    def test_absence_timeout_ends_and_persists_session(self):
        self.engine.patch_settings({"occupancy_end_minutes": .5}, self.now)
        self.observe()
        session_id = self.engine.session["id"]
        state = self.observe(31, seat_occupied=False, person_detected=False, posture="NO_PERSON")
        self.assertIsNone(state["session"])
        saved = self.store.get_session(session_id)
        self.assertEqual(saved["state"], "ENDED")
        self.assertEqual(saved["end_reason"], "absence_timeout")

    def test_explicit_camera_failure_clears_pose_but_other_sensors_continue(self):
        self.observe(3, posture="SLOUCH", motion=True)
        state = self.observe(5, posture="SLOUCH", motion=True, vision_available=False)
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["sensors"]["person_detected"])
        self.assertEqual(state["session"]["state"], "ACTIVE")
        self.assertEqual(state["sensors"]["distance_cm"], 60)
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        self.assertEqual(len(self.events("VISION_OFFLINE")), 1)

    def test_low_confidence_pose_does_not_trigger_posture_alert(self):
        state = self.observe(6, posture="SLOUCH", confidence=.2, motion=True)
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        self.assertIsNone(state["score"]["components"]["posture"])

    def test_stale_camera_cannot_reuse_last_pose(self):
        self.engine.patch_settings({"sensor_stale_seconds": 2}, self.now)
        self.observe(posture="SLOUCH", motion=True)
        for _ in range(6):
            self.now += 1
            other_sources = observed_desk(motion=True)
            del other_sources[VISION]
            self.engine.step(self.now, other_sources)
        state = self.engine.state(self.now)
        self.assertEqual(state["health"]["vision"], "offline")
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertEqual(self.events("POSTURE_WARNING"), [])

    def test_unobserved_gap_does_not_count_as_sustained_bad_posture(self):
        self.observe(posture="SLOUCH")
        # A stalled gateway/scheduler cannot observe the intervening 100 seconds.
        # A new bad sample must begin a new evidence interval.
        self.now += 100
        self.engine.step(self.now, observed_desk(posture="SLOUCH"))
        self.assertEqual(self.events("POSTURE_WARNING"), [])
        self.observe(3, posture="SLOUCH")
        self.assertEqual(len(self.events("POSTURE_WARNING")), 1)

    def test_missing_sources_do_not_create_perfect_score_or_active_session(self):
        self.engine.step(self.now)
        state = self.engine.state(self.now)
        self.assertIsNone(state["score"]["total"])
        self.assertEqual(state["score"]["coverage_percent"], 0)
        self.assertIsNone(state["session"])
        self.assertTrue(all(d["status"] == "offline" for d in state["devices"]))

    def test_score_is_weighted_explainable_and_declines_for_poor_conditions(self):
        self.observe()
        state = self.observe(posture="SLOUCH")
        self.assertEqual(state["score"]["total"], 77.5)
        self.assertEqual(state["score"]["status"], "FAIR")
        poor = self.observe(posture="SLOUCH", distance_cm=15, noise_level=1, lux=0, temperature_c=40)
        self.assertGreaterEqual(poor["score"]["total"], 0)
        self.assertLess(poor["score"]["total"], state["score"]["total"])
        self.assertLessEqual(poor["score"]["total"], 100)

    def test_partial_snapshot_does_not_keep_omitted_reading_fresh(self):
        self.observe()
        self.now += 1
        self.engine.step(self.now, {ENVIRONMENT: {"lux": 200}})
        state = self.engine.state(self.now)
        self.assertEqual(state["sensors"]["lux"], 200)
        self.assertIsNone(state["sensors"]["temperature_c"])
        self.assertIsNone(state["score"]["components"]["thermal"])
        self.assertEqual(state["score"]["coverage_percent"], 85)

    def test_manual_pause_is_not_undone_by_presence_and_time_excludes_pause(self):
        self.observe(5)
        self.engine.control("pause", self.now)
        elapsed = self.engine.session["elapsed_seconds"]
        state = self.observe(10)
        self.assertEqual(state["session"]["state"], "PAUSED")
        self.assertEqual(state["session"]["elapsed_seconds"], elapsed)
        self.engine.control("resume", self.now)
        self.observe(2)
        self.assertEqual(self.engine.session["elapsed_seconds"], elapsed + 2)

    def test_early_break_does_not_reset_continuous_sitting_but_full_break_does(self):
        self.observe(5)
        before = self.engine.session["continuous_sitting_seconds"]
        self.engine.control("break", self.now)
        self.observe(2)
        self.engine.control("finish_break", self.now)
        self.assertEqual(self.engine.session["continuous_sitting_seconds"], before)
        self.engine.control("break", self.now)
        self.observe(5)
        self.engine.control("finish_break", self.now)
        self.assertEqual(self.engine.session["continuous_sitting_seconds"], 0)
        self.assertEqual(self.engine.session["screen_seconds"], 0)
        self.assertEqual(self.engine.session["breaks"], 2)

    def test_sitting_and_screen_reminders_then_break(self):
        self.observe(7)
        self.assertEqual(len(self.events("BREAK_REMINDER")), 1)
        self.assertEqual(len(self.events("EYE_BREAK_REMINDER")), 1)
        self.engine.control("break", self.now)
        state = self.observe(5)
        self.assertFalse(state["actuators"]["buzzer"])
        self.engine.control("finish_break", self.now)
        self.observe(3)
        self.assertEqual(len(self.events("BREAK_REMINDER")), 1)

    def test_end_does_not_immediately_autostart_while_person_stays(self):
        self.observe(3)
        ended = self.engine.control("end", self.now)["session"]
        self.assertEqual(ended["state"], "ENDED")
        self.observe(3)
        self.assertIsNone(self.engine.session)
        self.observe(seat_occupied=False, person_detected=False, posture="NO_PERSON")
        self.observe()
        self.assertIsNotNone(self.engine.session)
        self.assertNotEqual(self.engine.session["id"], ended["id"])

    def test_lighting_fan_hysteresis_and_manual_control_then_automatic_restore(self):
        state = self.observe(lux=0, temperature_c=29)
        self.assertEqual(state["actuators"]["lamp_percent"], 100)
        self.assertTrue(state["actuators"]["fan"])
        self.observe(temperature_c=27.5)
        self.assertTrue(self.engine.actuators["fan"])
        self.observe(temperature_c=26.5)
        self.assertFalse(self.engine.actuators["fan"])
        self.engine.set_actuators({"lamp_mode": "manual", "lamp_percent": 35, "fan_mode": "manual", "fan": True}, self.now)
        state = self.observe(lux=800, temperature_c=20)
        self.assertEqual(state["actuators"]["lamp_percent"], 35)
        self.assertTrue(state["actuators"]["fan"])
        result = self.engine.set_actuators({"lamp_mode": "auto", "fan_mode": "auto"}, self.now)
        self.assertEqual(result["lamp_percent"], 0)
        self.assertFalse(result["fan"])

    def test_mode_change_ends_session_and_clears_simulator_readings(self):
        self.engine.set_mode("demo", self.now)
        self.observe()
        previous_id = self.engine.session["id"]
        self.now += 1
        state = self.engine.set_mode("hardware", self.now)
        self.assertIsNone(state["session"])
        self.assertIsNone(state["sensors"]["lux"])
        self.assertEqual(state["score"]["coverage_percent"], 0)
        self.assertEqual(self.store.get_session(previous_id)["end_reason"], "mode_changed")

    def test_cloud_boundary_is_aggregate_allowlist_not_session_or_sensor_dump(self):
        self.observe(3)
        session = deepcopy(self.engine.session)
        session.update(frame="secret", audio="speech", user_id="person", samples=[observed_desk()], note="untrusted text")
        aggregates = self.engine.session_aggregates(session)
        allowed = {"session_minutes", "study_condition_score", "good_posture_percent", "slouch_events", "too_close_events", "breaks", "average_lux", "noise_warning_minutes", "average_temperature"}
        self.assertEqual(set(aggregates), allowed)
        self.assertTrue(all(value is None or isinstance(value, (float, int)) for value in aggregates.values()))
        self.assertFalse(self.engine.state(self.now)["privacy"]["cloud_ai_consent"])

    def test_invalid_telemetry_is_rejected_without_poisoning_fresh_state(self):
        self.observe()
        cases = [
            ("wrong/topic", {"lux": 10}),
            (ENVIRONMENT, {"lux": float("nan")}),
            (ENVIRONMENT, {"lux": float("inf")}),
            (ENVIRONMENT, {"lux": True}),
            (NODE_A, {"distance_cm": -1}),
            (NODE_A, {"seat_occupied": "true"}),
            (VISION, {"posture": "FOCUSED"}),
            (VISION, {"posture": "GOOD", "frame": "bytes"}),
            (NODE_B, {"noise_level": .2, "audio": "bytes"}),
            (VISION, {"posture": "GOOD", "timestamp": "2026-10-24T00:00:00"}),
            (ENVIRONMENT, {"lux": 10, "timestamp": iso(self.now + 31)}),
        ]
        for topic, payload in cases:
            with self.subTest(topic=topic, payload=payload):
                with self.assertRaises(ValueError):
                    self.engine.ingest(topic, payload, self.now)
        self.assertEqual(self.engine.sensors["lux"], 400)
        self.assertEqual(self.engine.metrics["invalid_messages"], len(cases))

    def test_old_captured_reading_cannot_become_fresh_on_receipt(self):
        self.engine.ingest(ENVIRONMENT, {"lux": 350, "timestamp": iso(self.now - 100)}, self.now)
        self.engine.step(self.now)
        self.assertIsNone(self.engine.sensors["lux"])
        self.engine.ingest(ENVIRONMENT, {"lux": 400, "timestamp": iso(self.now)}, self.now)
        with self.assertRaises(ValueError):
            self.engine.ingest(ENVIRONMENT, {"lux": 1, "timestamp": iso(self.now - 1)}, self.now)

    def test_settings_and_manual_controls_validate_atomically(self):
        original = deepcopy(self.engine.settings)
        for patch in [{"distance_min_cm": 90}, {"posture_warning_seconds": float("nan")}, {"cloud_ai_consent": "yes"}, {"weights": {"posture": 1}}, {"secret": "value"}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.engine.patch_settings(patch, self.now)
            self.assertEqual(self.engine.settings, original)
        for control in [{"lamp_percent": 80}, {"lamp_mode": "manual", "lamp_percent": 101}, {"fan_mode": "manual", "fan": 1}, {"buzzer": True}]:
            with self.subTest(control=control), self.assertRaises(ValueError):
                self.engine.set_actuators(control, self.now)

    def test_clock_regression_is_rejected_and_restart_closes_unfinished_session(self):
        self.observe(3)
        session_id = self.engine.session["id"]
        with self.assertRaises(ValueError):
            self.engine.step(self.now - 1)
        restarted = FocusGuardEngine(self.store, mode="hardware", now=self.now + 10)
        self.assertIsNone(restarted.session)
        self.assertEqual(self.store.get_session(session_id)["end_reason"], "gateway_restart")
        self.assertEqual(restarted.settings["posture_warning_seconds"], 3)


if __name__ == "__main__":
    unittest.main()
