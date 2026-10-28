"""A missing frame is never labeled; stable-label recovery needs fresh evidence."""
import unittest

from backend.vision.posture import TemporalPosture


class TemporalRecoveryTests(unittest.TestCase):
    def settled(self, interval=67):
        temporal = TemporalPosture()
        for i in range(15):
            temporal.update("SLOUCH", i * interval)
        return temporal, 14 * interval

    def test_one_bad_frame_is_unknown_then_two_reliable_frames_recover(self):
        temporal, timestamp = self.settled()
        self.assertEqual(temporal.update("UNKNOWN", timestamp+67), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", timestamp+134), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", timestamp+201), "SLOUCH")

    def test_low_frame_rate_has_bounded_recovery_without_labeling_missing_frame(self):
        temporal, timestamp = self.settled(250)
        self.assertEqual(temporal.update("UNKNOWN", timestamp+250), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", timestamp+500), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", timestamp+750), "SLOUCH")

    def test_repeated_uncertainty_does_not_recover_old_label(self):
        temporal, timestamp = self.settled()
        for step, label in enumerate(("UNKNOWN", "UNKNOWN", "SLOUCH", "SLOUCH"), 1):
            self.assertEqual(temporal.update(label, timestamp+step*67), "UNKNOWN")

    def test_a_different_candidate_cancels_recovery(self):
        temporal, timestamp = self.settled()
        for step, label in enumerate(("UNKNOWN", "GOOD", "SLOUCH", "SLOUCH"), 1):
            self.assertEqual(temporal.update(label, timestamp+step*67), "UNKNOWN")

    def test_absence_long_delay_duplicate_and_reset_clear_recovery(self):
        for interruption in ("absence", "long_delay", "duplicate", "reset"):
            temporal, timestamp = self.settled()
            temporal.update("UNKNOWN", timestamp+67)
            if interruption == "absence":
                temporal.update("NO_PERSON", timestamp+100)
            elif interruption == "reset":
                temporal.reset()
            elif interruption == "duplicate":
                temporal.update("SLOUCH", timestamp+67)
            recovery_time = timestamp+(1000 if interruption == "long_delay" else 134)
            with self.subTest(interruption=interruption):
                self.assertEqual(temporal.update("SLOUCH", recovery_time), "UNKNOWN")
                self.assertEqual(temporal.update("SLOUCH", recovery_time+67), "UNKNOWN")

    def test_new_label_still_needs_full_settling_interval(self):
        temporal = TemporalPosture()
        for i in range(9):
            self.assertEqual(temporal.update("SLOUCH", i*67), "UNKNOWN")
        self.assertEqual(temporal.update("SLOUCH", 603), "SLOUCH")

    def test_a_pending_different_label_cannot_recover_stale_displayed_label(self):
        temporal, timestamp = self.settled()
        self.assertEqual(temporal.update("GOOD", timestamp+67), "SLOUCH")
        for step, label in enumerate(("UNKNOWN", "SLOUCH", "SLOUCH"), 2):
            self.assertEqual(temporal.update(label, timestamp+step*67), "UNKNOWN")

    def test_uncertainty_between_confirmations_ends_the_episode(self):
        temporal, timestamp = self.settled()
        labels = ("UNKNOWN", "SLOUCH", "UNKNOWN", "SLOUCH", "SLOUCH")
        for step, label in enumerate(labels, 1):
            self.assertEqual(temporal.update(label, timestamp+step*67), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
