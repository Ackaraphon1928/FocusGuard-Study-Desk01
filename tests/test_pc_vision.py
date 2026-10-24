"""Real-camera demo boundaries without a camera, network, or wall clock."""

import csv
import io
import json
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.engine import FocusGuardEngine, VISION_TOPIC, iso
from backend.integrations import MqttBridge
from backend.main import create_app
from backend.storage import Store


def pose(**changes):
    return {"person_detected": True, "posture": "GOOD", "confidence": .95,
            "fps": 17.5, "vision_available": True, **changes}


class PcVisionEngineTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.store = Store(":memory:")
        self.engine = FocusGuardEngine(self.store, mode="demo", now=self.now)
        self.engine.patch_settings({"sensor_stale_seconds": 2, "posture_warning_seconds": 3,
                                    "occupancy_pause_seconds": 2, "warning_cooldown_seconds": 10}, self.now)
        self.engine.set_vision_source("pc_camera", self.now)

    def tearDown(self):
        self.store.close()

    def observe(self, **changes):
        self.now += 1
        self.engine.ingest_pc_vision(pose(**changes), self.now)
        self.engine.step(self.now)
        return self.engine.state(self.now)

    def warnings(self):
        return [event for event in self.store.events(1000) if event["event_type"] == "POSTURE_WARNING"]

    def test_camera_selection_waits_for_a_reliable_person(self):
        state = self.engine.state(self.now)
        self.assertEqual(state["vision_source"], "pc_camera")
        self.assertIsNone(state["vision_last_seen"])
        self.assertIsNone(state["session"])
        self.assertEqual(state["occupancy"], "EMPTY")
        self.assertFalse(state["sensors"]["seat_occupied"])
        self.assertFalse(state["sensors"]["motion"])
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["sensors"]["fps"])

    def test_pc_labels_survive_simulator_ticks_and_identify_their_source(self):
        state = self.observe(posture="LEAN_LEFT_RIGHT")
        self.now += .5
        self.engine.step(self.now)
        state = self.engine.state(self.now)
        self.assertEqual(state["sensors"]["posture"], "LEAN_LEFT_RIGHT")
        self.assertEqual(state["sensors"]["fps"], 17.5)
        self.assertEqual(state["vision_last_seen"], iso(self.now - .5))
        self.assertEqual(state["occupancy"], "USER_PRESENT")
        self.assertTrue(state["sensors"]["seat_occupied"])
        self.assertTrue(state["sensors"]["motion"])
        self.assertGreater(state["sensors"]["distance_cm"], 50)
        vision = next(device for device in state["devices"] if device["id"] == "vision")
        self.assertFalse(vision["simulated"])
        self.assertEqual(vision["source"], "pc_camera")
        self.assertTrue(all(device["simulated"] for device in state["devices"] if device["id"] != "vision"))

    def test_camera_absence_prevents_fake_occupancy_and_pauses_active_time(self):
        self.observe()
        self.observe(person_detected=False, posture="NO_PERSON")
        seconds = self.engine.session["elapsed_seconds"]
        for _ in range(3):
            state = self.observe(person_detected=False, posture="NO_PERSON")
        self.assertEqual(state["session"]["state"], "PAUSED")
        self.assertEqual(state["session"]["elapsed_seconds"], seconds)
        self.assertFalse(state["sensors"]["seat_occupied"])
        self.assertFalse(state["sensors"]["motion"])
        self.assertFalse(state["actuators"]["buzzer"])

    def test_no_person_keeps_its_label_with_zero_landmark_confidence(self):
        state = self.observe(person_detected=False, posture="NO_PERSON", confidence=0)
        self.assertEqual(state["sensors"]["posture"], "NO_PERSON")
        self.assertEqual(state["occupancy"], "EMPTY")
        self.assertIsNone(state["session"])
        self.assertTrue(state["sensors"]["vision_available"])
        vision = next(device for device in state["devices"] if device["id"] == "vision")
        self.assertEqual(vision["status"], "online")
        # An explicit ambiguity signal takes precedence over the empty label.
        state = self.observe(person_detected=False, posture="NO_PERSON", confidence=0, ambiguous_people=True)
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["session"])

    def test_real_slouch_uses_existing_sustained_rules_and_demo_buzzer(self):
        for _ in range(3):
            self.observe(posture="SLOUCH")
        self.assertEqual(self.warnings(), [])
        state = self.observe(posture="SLOUCH")
        self.assertEqual(len(self.warnings()), 1)
        self.assertTrue(state["actuators"]["buzzer"])
        self.assertEqual(self.warnings()[0]["mode"], "demo")
        bridge = MqttBridge(self.engine)
        bridge.client = Mock()
        bridge.status = "connected"
        bridge.publish(self.now)
        bridge.client.publish.assert_not_called()

    def test_low_confidence_and_multiple_people_cannot_create_posture_evidence(self):
        for changes in [{"confidence": .2}, {"ambiguous_people": True}]:
            with self.subTest(changes=changes):
                for _ in range(5):
                    state = self.observe(posture="SLOUCH", **changes)
                self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
                self.assertFalse(state["sensors"]["seat_occupied"])
                self.assertEqual(state["occupancy"], "EMPTY")
                self.assertIsNone(state["session"])
                self.assertEqual(self.warnings(), [])

    def test_stale_camera_has_no_simulated_pose_or_fps_fallback(self):
        self.observe(posture="SLOUCH")
        self.now += 10
        self.engine.step(self.now)
        state = self.engine.state(self.now)
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["sensors"]["fps"])
        self.assertFalse(state["sensors"]["vision_available"])
        self.assertFalse(state["sensors"]["seat_occupied"])
        self.assertEqual(state["session"]["elapsed_seconds"], 2)
        self.assertEqual(self.warnings(), [])
        self.observe(posture="SLOUCH")
        self.assertEqual(self.warnings(), [])

    def test_network_scenario_cannot_preserve_synthetic_presence_after_camera_loss(self):
        self.observe()
        self.engine.set_scenario("network_offline", self.now)
        state = self.observe(person_detected=False, posture="NO_PERSON")
        self.assertNotEqual(state["occupancy"], "USER_PRESENT")
        self.assertFalse(state["sensors"]["seat_occupied"])
        self.assertFalse(state["sensors"]["motion"])

    def test_camera_offline_clears_observations_and_sustained_rules(self):
        self.observe(posture="SLOUCH")
        for _ in range(4):
            state = self.observe(vision_available=False, posture="SLOUCH")
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["sensors"]["fps"])
        self.assertEqual(self.warnings(), [])
        self.assertEqual(state["session"]["state"], "PAUSED")

    def test_stopping_camera_restores_simulation_and_separates_session_aggregates(self):
        self.observe(posture="SLOUCH")
        original = self.engine.session["id"]
        self.now += 1
        state = self.engine.set_vision_source("simulated", self.now)
        self.assertEqual(state["vision_source"], "simulated")
        self.assertEqual(state["sensors"]["posture"], "GOOD")
        self.assertGreater(state["sensors"]["fps"], 18)
        self.assertNotEqual(state["session"]["id"], original)
        self.assertEqual(self.store.get_session(original)["end_reason"], "vision_source_changed")
        self.assertTrue(next(device for device in state["devices"] if device["id"] == "vision")["simulated"])

    def test_source_is_recorded_on_each_history_point(self):
        self.observe(posture="SLOUCH")
        self.now += 1
        self.engine.set_vision_source("simulated", self.now)
        points = self.store.history()
        self.assertEqual({point["vision_source"] for point in points}, {"simulated", "pc_camera"})
        actual = next(point for point in points if point["posture"] == "SLOUCH")
        self.assertEqual(actual["vision_source"], "pc_camera")
        self.assertEqual(actual["mode"], "demo")

    def test_incompatible_scenarios_are_rejected_without_overwriting_pc_pose(self):
        self.observe(posture="LEAN_FORWARD")
        for scenario in ["slouch", "too_close", "away", "camera_offline", "occluded"]:
            with self.subTest(scenario=scenario), self.assertRaises(ValueError):
                self.engine.set_scenario(scenario, self.now)
        state = self.engine.set_scenario("dark", self.now)
        self.assertEqual(state["sensors"]["posture"], "LEAN_FORWARD")
        self.assertLess(state["sensors"]["lux"], 100)

    def test_mode_changes_clear_pc_metadata_and_refuse_further_pc_ingestion(self):
        self.observe(posture="SLOUCH")
        self.now += 1
        state = self.engine.set_mode("hardware", self.now)
        self.assertEqual(state["vision_source"], "gateway")
        self.assertIsNone(state["vision_last_seen"])
        self.assertEqual(state["sensors"]["posture"], "UNKNOWN")
        self.assertIsNone(state["sensors"]["fps"])
        with self.assertRaises(ValueError):
            self.engine.ingest_pc_vision(pose(), self.now)
        state = self.engine.set_mode("demo", self.now)
        self.assertEqual(state["vision_source"], "simulated")
        self.assertEqual(state["sensors"]["posture"], "GOOD")

    def test_engine_rejects_media_and_arbitrary_geometry_fields(self):
        for field in ["image", "frame", "landmarks", "keypoints", "distance_cm", "timestamp", "user_id"]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.engine.ingest_pc_vision(pose(**{field: "private"}), self.now)
        self.assertNotIn(VISION_TOPIC, self.engine.sources)

    def test_metrics_report_camera_source_and_the_mixed_demo_boundary(self):
        self.observe()
        metrics = self.engine.observed_metrics()
        self.assertEqual(metrics["vision_source"], "pc_camera")
        self.assertEqual(metrics["observed_fps"], 17.5)
        self.assertIn("remain simulated", metrics["note"])
        self.assertIsNone(metrics["posture_accuracy"])


class PcVisionApiTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.env = patch.dict("os.environ", {"MQTT_ENABLED": "false", "INFLUX_URL": "", "INFLUX_TOKEN": "", "BEDROCK_MODEL_ID": ""})
        self.env.start()
        self.clock = patch("backend.main.time.time", side_effect=lambda: self.now)
        self.clock.start()
        self.app = create_app(db_path=":memory:", mode="demo", background=False)
        self.client = TestClient(self.app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.clock.stop()
        self.env.stop()

    def select_camera(self):
        response = self.client.post("/api/demo/vision-source", json={"source": "pc_camera"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_endpoint_selects_camera_and_accepts_only_derived_metadata(self):
        self.select_camera()
        self.now += 1
        response = self.client.post("/api/demo/vision", json=pose(posture="SLOUCH", inference_ms=24, ambiguous_people=False))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["accepted"])
        state = self.client.get("/api/state").json()
        self.assertEqual(state["vision_source"], "pc_camera")
        self.assertEqual(state["sensors"]["posture"], "SLOUCH")
        self.assertEqual(state["vision_last_seen"], iso(self.now))
        self.assertFalse(state["privacy"]["video_upload"])
        self.assertFalse(state["privacy"]["cloud_ai_consent"])

    def test_http_boundary_rejects_media_geometry_and_wrong_field_types(self):
        self.select_camera()
        invalid = [pose(frame="base64"), pose(landmarks=[{"x": .2}]), pose(audio="base64"),
                   pose(distance_cm=50), pose(person_detected="true"), pose(confidence=True),
                   pose(fps="15"), pose(posture="FOCUSED"), pose(confidence=1.1),
                   pose(vision_available=None), {"posture": "GOOD"}]
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.client.post("/api/demo/vision", json=payload)
                self.assertEqual(response.status_code, 422, response.text)
        engine = self.app.state.runtime.engine
        self.assertNotIn(VISION_TOPIC, engine.sources)
        self.assertNotIn("base64", json.dumps(engine.store.history()))

    def test_pc_endpoints_are_guarded_by_mode_and_selected_source(self):
        self.assertEqual(self.client.post("/api/demo/vision", json=pose()).status_code, 409)
        self.select_camera()
        self.client.post("/api/mode", json={"mode": "hardware"})
        self.assertEqual(self.client.post("/api/demo/vision", json=pose()).status_code, 409)
        self.assertEqual(self.client.post("/api/demo/vision-source", json={"source": "pc_camera"}).status_code, 409)
        self.assertEqual(self.client.post("/api/demo/vision-source", json={"source": "simulated"}).status_code, 409)
        self.assertEqual(self.client.get("/api/state").json()["vision_source"], "gateway")

    def test_http_scenario_guard_and_source_validation(self):
        self.select_camera()
        self.assertEqual(self.client.post("/api/demo", json={"scenario": "slouch"}).status_code, 422)
        self.assertEqual(self.client.post("/api/demo", json={"scenario": "hot"}).status_code, 200)
        self.assertEqual(self.client.post("/api/demo/vision-source", json={"source": "remote_camera"}).status_code, 422)
        self.assertEqual(self.client.post("/api/demo/vision-source", json={"source": "pc_camera", "video": "secret"}).status_code, 422)

    def test_sessions_events_and_csv_preserve_camera_source_after_switching(self):
        self.select_camera()
        self.now += 1
        self.client.post("/api/demo/vision", json=pose(posture="SLOUCH"))
        camera_session = self.client.get("/api/state").json()["session"]
        self.assertEqual(camera_session["vision_source"], "pc_camera")
        self.now += 1
        state = self.client.post("/api/demo/vision-source", json={"source": "simulated"}).json()
        self.assertEqual(state["session"]["vision_source"], "simulated")
        saved = self.client.get(f"/api/sessions/{camera_session['id']}").json()
        self.assertEqual(saved["vision_source"], "pc_camera")
        self.assertEqual(saved["end_reason"], "vision_source_changed")
        runtime = self.app.state.runtime
        self.client.portal.call(runtime.wait_summaries)
        events = self.client.get("/api/events").json()
        session_events = [event for event in events if event.get("session_id") == camera_session["id"]]
        self.assertEqual({event["event_type"] for event in session_events}, {"SESSION_ENDED", "SUMMARY_CREATED"})
        self.assertTrue(all(event["vision_source"] == "pc_camera" for event in session_events))
        self.assertTrue(all("vision_source" in event for event in events))
        for kind in ["history", "sessions", "events"]:
            with self.subTest(kind=kind):
                response = self.client.get(f"/api/export?kind={kind}")
                self.assertEqual(response.status_code, 200)
                rows = list(csv.DictReader(io.StringIO(response.text)))
                self.assertIn("pc_camera", {row["vision_source"] for row in rows})
                self.assertIn("simulated", {row["vision_source"] for row in rows})


if __name__ == "__main__":
    unittest.main()
