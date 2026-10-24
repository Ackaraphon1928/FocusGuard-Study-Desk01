"""Camera handoffs must not mix sessions or carry sustained posture evidence."""
import unittest

from backend.engine import FocusGuardEngine, VISION_TOPIC
from backend.integrations import InfluxWriter
from backend.storage import Store


class VisionInputProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.engine = FocusGuardEngine(self.store, now=1000)
        self.engine.set_vision_source("pc_camera", 1000)

    def tearDown(self):
        self.store.close()

    def observe(self, now):
        self.engine.ingest_pc_vision({"person_detected": True, "posture": "SLOUCH",
                                    "confidence": .95, "fps": 10, "vision_available": True}, now)
        self.engine.step(now)

    def test_handoff_ends_old_session_clears_evidence_and_records_input(self):
        self.observe(1001)
        previous = self.engine.session["id"]
        self.engine.set_vision_input("pc_camera", 1002)
        self.assertEqual(self.store.get_session(previous)["vision_input"], "python_backend")
        self.assertEqual(self.store.get_session(previous)["end_reason"], "vision_input_changed")
        self.assertNotIn(VISION_TOPIC, self.engine.sources)
        self.assertIsNone(self.engine.session)
        self.assertEqual(self.engine.state(1002)["sensors"]["posture"], "UNKNOWN")
        self.observe(1003)
        self.assertEqual(self.engine.session["vision_input"], "pc_camera")
        self.assertNotEqual(self.engine.session["id"], previous)
        points = self.store.history()
        self.assertEqual({point["vision_input"] for point in points if point["vision_source"] == "pc_camera"},
                         {"pc_camera", "python_backend"})
        browser_point = next(point for point in points if point["vision_input"] == "pc_camera")
        self.assertIn('vision_input="pc_camera"', InfluxWriter.line(browser_point))

    def test_privacy_transport_changes_back_without_fake_vision(self):
        self.engine.set_vision_input("pc_camera", 1001)
        privacy = self.engine.state(1001)["privacy"]
        self.assertTrue(privacy["video_upload"])
        self.assertEqual(privacy["camera_frame_transport"], "browser_to_python")
        self.assertFalse(privacy["cloud_video_upload"])
        self.engine.set_vision_input("python_backend", 1002)
        state = self.engine.state(1002)
        self.assertFalse(state["privacy"]["video_upload"])
        self.assertEqual(state["vision_source"], "pc_camera")
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")

    def test_idempotent_selection_preserves_session_hardware_rejects_browser(self):
        self.observe(1001)
        session = self.engine.session["id"]
        self.engine.set_vision_input("python_backend", 1002)
        self.assertEqual(self.engine.session["id"], session)
        self.engine.set_mode("hardware", 1003)
        with self.assertRaises(ValueError):
            self.engine.set_vision_input("pc_camera", 1004)
        self.assertEqual(self.engine.vision_input, "python_backend")


if __name__ == "__main__":
    unittest.main()
