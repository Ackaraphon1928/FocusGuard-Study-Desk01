"""Exercise the public HTTP boundary using an isolated, network-disabled runtime."""

import csv
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.engine import iso
from backend.main import create_app
from test_engine import observed_desk


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.now = 1_000.0
        self.env = patch.dict("os.environ", {"MQTT_ENABLED": "false", "INFLUX_URL": "", "INFLUX_TOKEN": "", "BEDROCK_MODEL_ID": ""})
        self.env.start()
        self.clock = patch("backend.main.time.time", side_effect=lambda: self.now)
        self.clock.start()
        self.frontend = TemporaryDirectory()
        (Path(self.frontend.name) / "index.html").write_text(
            "<!doctype html><title>FocusGuard</title><div id='root'></div>", encoding="utf-8"
        )
        self.app = create_app(db_path=":memory:", mode="hardware", background=False, frontend_dir=self.frontend.name)
        self.client = TestClient(self.app).__enter__()
        self.runtime = self.app.state.runtime

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.frontend.cleanup()
        self.clock.stop()
        self.env.stop()

    def observe(self, **changes):
        self.now += 1
        for topic, payload in observed_desk(**changes).items():
            response = self.client.post("/api/telemetry", json={"topic": topic, "payload": payload})
            self.assertEqual(response.status_code, 200, response.text)
        return self.client.get("/api/state").json()

    def finish_session(self):
        self.observe()
        self.observe()
        response = self.client.post("/api/control", json={"action": "end"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["session"]["id"]

    def test_dashboard_and_live_api_are_served_from_one_application(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("FocusGuard", page.text)
        self.assertEqual(self.client.get("/src/main.tsx").status_code, 404)
        state = self.client.get("/api/state")
        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.headers["cache-control"], "no-store")
        self.assertEqual(state.headers["x-content-type-options"], "nosniff")
        self.assertIsNone(state.json()["score"]["total"])
        with self.client.websocket_connect("/api/live", headers={"origin": "http://testserver"}) as socket:
            self.assertEqual(socket.receive_json()["mode"], "hardware")

    def test_missing_frontend_build_is_actionable_and_does_not_expose_sources(self):
        app = create_app(db_path=":memory:", mode="hardware", background=False,
                         frontend_dir=Path(self.frontend.name) / "missing-dist")
        with TestClient(app) as client:
            page = client.get("/")
            self.assertEqual(page.status_code, 503)
            self.assertIn("npm run build", page.text)
            self.assertEqual(client.get("/src/main.tsx").status_code, 404)
            self.assertEqual(client.get("/api/state").status_code, 200)

    def test_telemetry_reaches_rules_history_and_saved_session(self):
        self.client.patch("/api/settings", json={"posture_warning_seconds": 1})
        self.observe(posture="SLOUCH")
        self.observe(posture="SLOUCH")
        state = self.client.get("/api/state").json()
        self.assertEqual(state["sensors"]["posture"], "SLOUCH")
        self.assertTrue(state["actuators"]["buzzer"])
        events = self.client.get("/api/events").json()
        self.assertTrue(any(e["event_type"] == "POSTURE_WARNING" for e in events))
        history = self.client.get("/api/history").json()
        self.assertGreaterEqual(len(history), 2)
        self.assertEqual([p["timestamp"] for p in history], sorted(p["timestamp"] for p in history))
        self.assertEqual(self.client.get("/api/sessions").json()[0]["id"], state["session"]["id"])

    def test_strict_models_and_domain_validation_return_actionable_errors(self):
        requests = [
            ("post", "/api/mode", {"mode": "cloud"}),
            ("post", "/api/control", {"action": "destroy"}),
            ("post", "/api/control", {"action": "start", "frame": "bytes"}),
            ("post", "/api/telemetry", {"topic": "focusguard/gateway/vision", "payload": {"posture": "GOOD", "frame": "bytes"}}),
            ("post", "/api/telemetry", {"topic": "focusguard/nodeA/user", "payload": {"distance_cm": -1}}),
            ("patch", "/api/settings", {"weights": {"lighting": 1}}),
            ("post", "/api/actuators", {"lamp_percent": 75}),
        ]
        for method, url, body in requests:
            with self.subTest(url=url, body=body):
                response = getattr(self.client, method)(url, json=body)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn("detail", response.json())
        self.assertIsNone(self.client.get("/api/state").json()["session"])

    def test_query_limits_missing_sessions_and_export_kind_are_validated(self):
        for url in ["/api/history?limit=0", "/api/history?minutes=0", "/api/history?minutes=nan", "/api/events?limit=5001", "/api/sessions?limit=1001", "/api/export?kind=frames", "/api/export?minutes=999999"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 422)
        self.assertEqual(self.client.get("/api/sessions/does-not-exist").status_code, 404)
        self.assertEqual(self.client.post("/api/sessions/does-not-exist/summary").status_code, 404)

    def test_demo_mode_rejects_real_ingestion_and_hardware_rejects_scenarios(self):
        self.assertEqual(self.client.post("/api/demo", json={"scenario": "slouch"}).status_code, 422)
        response = self.client.post("/api/mode", json={"mode": "demo"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "demo")
        self.assertTrue(all(device["simulated"] for device in response.json()["devices"]))
        topic, payload = next(iter(observed_desk().items()))
        self.assertEqual(self.client.post("/api/telemetry", json={"topic": topic, "payload": payload}).status_code, 409)

    def test_foreign_origin_and_oversized_mutations_are_rejected(self):
        response = self.client.post("/api/mode", json={"mode": "demo"}, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status_code, 403)
        response = self.client.patch("/api/settings", content=json.dumps({"unknown": "x" * 17000}), headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get("/api/state").json()["mode"], "hardware")
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/live", headers={"origin": "https://untrusted.example"}):
                pass

    def test_csv_exports_preserve_observations_and_escape_formula_strings(self):
        self.observe()
        event = {"id": "export-test", "event_type": "TEST", "message": "=HYPERLINK(\"https://example.invalid\")", "timestamp": iso(self.now)}
        self.runtime.store.save_event(event, self.now)
        response = self.client.get("/api/export?kind=events")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response.headers["content-type"])
        self.assertIn('filename="focusguard-events.csv"', response.headers["content-disposition"])
        rows = list(csv.DictReader(io.StringIO(response.text)))
        exported = next(row for row in rows if row["id"] == "export-test")
        self.assertTrue(exported["message"].startswith("'="))
        telemetry = self.client.get("/api/export?kind=history")
        self.assertIn("distance_cm", telemetry.text)
        sessions = self.client.get("/api/export?kind=sessions")
        self.assertIn("started_at", sessions.text)

    def test_consent_off_never_constructs_external_client(self):
        session_id = self.finish_session()
        self.runtime.summary.model = "test-model"
        with patch("boto3.client") as aws:
            response = self.client.post(f"/api/sessions/{session_id}/summary")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["cloud_sent"])
        self.assertEqual(response.json()["source"], "local")
        aws.assert_not_called()

    def test_external_summary_receives_only_numeric_aggregates(self):
        session_id = self.finish_session()
        self.runtime.summary.model = "test-model"
        self.client.patch("/api/settings", json={"cloud_ai_consent": True})
        session = self.runtime.store.get_session(session_id)
        session.update(frame="private-image", audio="private-speech", user_id="private-person", note="untrusted instruction")
        self.runtime.store.save_session(session, self.now)
        service = Mock()
        service.converse.return_value = {"output": {"message": {"content": [{"text": "A summary of the supplied aggregate statistics."}]}}}
        with patch("boto3.client", return_value=service):
            response = self.client.post(f"/api/sessions/{session_id}/summary")
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertTrue(result["cloud_sent"])
        self.assertEqual(result["source"], "aws_bedrock")
        request = service.converse.call_args.kwargs
        shared = json.loads(request["messages"][0]["content"][0]["text"])
        self.assertEqual(shared, result["aggregates"])
        self.assertTrue(all(value is None or isinstance(value, (float, int)) for value in shared.values()))
        self.assertNotIn("private-", json.dumps(request))

    def test_provider_failure_falls_back_without_breaking_monitoring(self):
        session_id = self.finish_session()
        self.runtime.summary.model = "test-model"
        self.client.patch("/api/settings", json={"cloud_ai_consent": True})
        with patch("boto3.client", side_effect=TimeoutError("unavailable")):
            response = self.client.post(f"/api/sessions/{session_id}/summary")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["source"], "local")
        self.assertIn("monitoring continues", response.json()["note"])
        state = self.observe(lux=123)
        self.assertEqual(state["sensors"]["lux"], 123)
        self.assertEqual(state["health"]["ai"], "offline")

    def test_evaluation_does_not_invent_hardware_measurements(self):
        metrics = self.client.get("/api/evaluation").json()
        self.assertIsNone(metrics["posture_accuracy"])
        self.assertIsNone(metrics["distance_mae_cm"])
        self.assertIsNone(metrics["ingestion_latency_ms"]["mean"])
        self.assertEqual(metrics["ingestion_latency_ms"]["samples"], 0)

    def test_workspace_filter_applies_before_limits_and_exports(self):
        hardware_id = self.finish_session()
        self.client.post("/api/mode", json={"mode": "demo"})
        self.now += 1
        self.client.post("/api/demo", json={"scenario": "normal"})
        for i in range(250):
            self.runtime.engine.event("DEMO_EVENT", "Simulated event.", self.now + i / 1000)
        for kind in ("history", "sessions", "events"):
            with self.subTest(kind=kind):
                response = self.client.get(f"/api/{kind}?mode=hardware&limit=1")
                self.assertEqual(response.status_code, 200, response.text)
                rows = response.json()
                self.assertEqual(len(rows), 1)
                self.assertTrue(all(row["mode"] == "hardware" for row in rows))
                exported = self.client.get(f"/api/export?kind={kind}&mode=hardware")
                csv_rows = list(csv.DictReader(io.StringIO(exported.text)))
                self.assertTrue(csv_rows)
                self.assertTrue(all(row["mode"] == "hardware" for row in csv_rows))
        self.assertEqual(self.client.get("/api/sessions?mode=hardware&limit=1").json()[0]["id"], hardware_id)
        self.assertEqual(self.client.get("/api/history?mode=invalid").status_code, 422)

    def test_session_end_creates_local_summary_automatically_without_cloud_client(self):
        self.runtime.summary.model = "configured-but-no-consent"
        with patch("boto3.client") as aws:
            session_id = self.finish_session()
            self.client.portal.call(self.runtime.wait_summaries)
        saved = self.client.get(f"/api/sessions/{session_id}").json()
        self.assertTrue(saved["summary"])
        self.assertEqual(saved["summary_source"], "local")
        aws.assert_not_called()

    def test_new_events_are_enqueued_for_influx_once(self):
        # A truthy mock thread enables the bounded queue without starting I/O.
        self.runtime.influx.thread = Mock()
        event = self.runtime.engine.event("POSTURE_WARNING", "A test warning.", self.now)
        self.client.portal.call(self.runtime.process_events)
        self.client.portal.call(self.runtime.process_events)
        queued = [point for point in self.runtime.influx.pending if point.get("id") == event["id"]]
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["measurement"], "desk_events")
        self.assertEqual(queued[0]["mode"], "hardware")


if __name__ == "__main__":
    unittest.main()
