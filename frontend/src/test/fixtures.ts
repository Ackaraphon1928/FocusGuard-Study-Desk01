import type { DeskState, HistoryPoint, Metrics } from '../lib/types';

// Deterministic synthetic fixtures for React interaction tests only.
export const deskFixture = {
  "mode": "demo",
  "vision_source": "simulated",
  "vision_last_seen": "1970-01-01T00:16:43Z",
  "now": "1970-01-01T00:16:43Z",
  "running": true,
  "scenario": "normal",
  "occupancy": "USER_PRESENT",
  "sensors": {
    "distance_cm": 55.1,
    "seat_pressure": 707.0,
    "seat_occupied": true,
    "motion": true,
    "noise_level": 0.26,
    "noise_state": "QUIET",
    "temperature_c": 25.2,
    "humidity_percent": 52.1,
    "pressure_hpa": 1009.8,
    "lux": 445.9,
    "person_detected": true,
    "posture": "GOOD",
    "confidence": 0.94,
    "fps": 18.4,
    "vision_available": true
  },
  "score": {
    "total": 99.8,
    "components": {
      "lighting": 100.0,
      "noise": 98.5,
      "thermal": 100.0,
      "posture": 100,
      "distance": 100.0
    },
    "coverage_percent": 100,
    "status": "GOOD"
  },
  "session": {
    "id": "2e19468b82bb",
    "started_at": "1970-01-01T00:16:40Z",
    "started_epoch": 1000,
    "state": "ACTIVE",
    "mode": "demo",
    "elapsed_seconds": 3.0,
    "sitting_seconds": 3.0,
    "continuous_sitting_seconds": 3.0,
    "screen_seconds": 3.0,
    "breaks": 0,
    "good_posture_seconds": 3.0,
    "observed_posture_seconds": 3.0,
    "score_integral": 299.4,
    "score_seconds": 3.0,
    "good_posture_percent": 100.0,
    "average_score": 99.8,
    "slouch_events": 0,
    "too_close_events": 0,
    "noise_warning_seconds": 0.0,
    "lux_integral": 1335.4,
    "lux_seconds": 3.0,
    "temperature_integral": 75.6,
    "temperature_seconds": 3.0,
    "summary": null,
    "pause_reason": null,
    "sample_count": 4,
    "duration_seconds": 3.0,
    "wall_seconds": 3,
    "average_lux": 445.1,
    "average_temperature": 25.2,
    "break_remaining_seconds": 0,
    "break_due_in_seconds": 2697.0,
    "break_interval_effective_seconds": 2700.0,
    "eye_break_due_in_seconds": 1197.0
  },
  "actuators": {
    "lamp_percent": 0,
    "fan": false,
    "buzzer": false,
    "lamp_mode": "auto",
    "fan_mode": "auto"
  },
  "devices": [
    {
      "id": "nodeA",
      "name": "Seat & distance",
      "status": "online",
      "last_seen": "1970-01-01T00:16:43Z",
      "topic": "focusguard/nodeA/user",
      "simulated": true
    },
    {
      "id": "nodeB",
      "name": "Motion & sound",
      "status": "online",
      "last_seen": "1970-01-01T00:16:43Z",
      "topic": "focusguard/nodeB/environment",
      "simulated": true
    },
    {
      "id": "environment",
      "name": "Environment gateway",
      "status": "online",
      "last_seen": "1970-01-01T00:16:43Z",
      "topic": "focusguard/gateway/environment",
      "simulated": true
    },
    {
      "id": "vision",
      "name": "Local pose camera",
      "status": "online",
      "last_seen": "1970-01-01T00:16:43Z",
      "topic": "focusguard/gateway/vision",
      "simulated": true
    }
  ],
  "events": [
    {
      "id": "afa7d323077747e581e697bbc77ca477",
      "event_type": "VISION_ONLINE",
      "severity": "info",
      "message": "Local pose metadata is available.",
      "timestamp": "1970-01-01T00:16:40Z",
      "mode": "demo"
    },
    {
      "id": "53895b467432463e9d09e0bd1c6bc386",
      "event_type": "SESSION_STARTED",
      "severity": "info",
      "message": "Study session started.",
      "timestamp": "1970-01-01T00:16:40Z",
      "mode": "demo"
    }
  ],
  "settings": {
    "distance_min_cm": 40.0,
    "distance_max_cm": 80.0,
    "posture_warning_seconds": 30.0,
    "distance_warning_seconds": 5.0,
    "noise_warning_seconds": 10.0,
    "warning_cooldown_seconds": 60.0,
    "break_interval_minutes": 45.0,
    "eye_break_interval_minutes": 20.0,
    "break_duration_seconds": 120.0,
    "occupancy_pause_seconds": 15.0,
    "occupancy_end_minutes": 15.0,
    "sensor_stale_seconds": 15.0,
    "light_target_lux": 400.0,
    "temperature_fan_c": 28.0,
    "noise_threshold": 0.65,
    "confidence_min": 0.6,
    "auto_session": true,
    "adaptive_reminders": true,
    "buzzer_enabled": true,
    "cloud_ai_consent": false,
    "weights": {
      "lighting": 0.15,
      "noise": 0.15,
      "thermal": 0.15,
      "posture": 0.3,
      "distance": 0.25
    }
  },
  "rules": [
    {
      "id": "POSTURE_WARNING",
      "active": false,
      "elapsed_seconds": 0.0,
      "threshold_seconds": 30.0,
      "cooldown_remaining_seconds": 0
    },
    {
      "id": "DISTANCE_WARNING",
      "active": false,
      "elapsed_seconds": 0.0,
      "threshold_seconds": 5.0,
      "cooldown_remaining_seconds": 0
    },
    {
      "id": "NOISE_WARNING",
      "active": false,
      "elapsed_seconds": 0.0,
      "threshold_seconds": 10.0,
      "cooldown_remaining_seconds": 0
    },
    {
      "id": "BREAK_REMINDER",
      "active": false,
      "elapsed_seconds": 0.0,
      "threshold_seconds": 0,
      "cooldown_remaining_seconds": 0
    },
    {
      "id": "EYE_BREAK_REMINDER",
      "active": false,
      "elapsed_seconds": 0.0,
      "threshold_seconds": 0,
      "cooldown_remaining_seconds": 0
    }
  ],
  "privacy": {
    "video_upload": false,
    "audio_recording": false,
    "cloud_ai_consent": false,
    "stored_data": "Derived sensor metadata and aggregate session statistics only"
  },
  "health": {
    "mqtt": "demo",
    "influxdb": "not_configured",
    "ai": "consent_required",
    "storage": "local_sqlite",
    "vision": "online"
  },
  "actuator_ack": null
} satisfies DeskState;

export function makeDesk(overrides: Partial<DeskState> = {}): DeskState { return { ...structuredClone(deskFixture), ...overrides }; }

export const historyFixture: HistoryPoint[] = [
  {
    "timestamp": "1970-01-01T00:16:40Z",
    "mode": "demo",
    "score": 99.8,
    "occupied": true,
    "vision_confidence": 0.94,
    "distance_cm": 55.0,
    "seat_pressure": 707.0,
    "seat_occupied": true,
    "motion": true,
    "lux": 445.1,
    "noise_level": 0.26,
    "temperature_c": 25.2,
    "humidity_percent": 52.0,
    "pressure_hpa": 1009.8,
    "posture": "GOOD",
    "person_detected": true,
    "vision_available": true,
    "fps": 18.4,
    "lamp_percent": 0,
    "fan": false,
    "buzzer": false,
    "session_active": true,
    "session_seconds": 0.0
  },
  {
    "timestamp": "1970-01-01T00:16:41Z",
    "mode": "demo",
    "score": 99.8,
    "occupied": true,
    "vision_confidence": 0.94,
    "distance_cm": 55.0,
    "seat_pressure": 707.0,
    "seat_occupied": true,
    "motion": true,
    "lux": 445.0,
    "noise_level": 0.26,
    "temperature_c": 25.2,
    "humidity_percent": 52.0,
    "pressure_hpa": 1009.8,
    "posture": "GOOD",
    "person_detected": true,
    "vision_available": true,
    "fps": 18.4,
    "lamp_percent": 0,
    "fan": false,
    "buzzer": false,
    "session_active": true,
    "session_seconds": 1.0
  },
  {
    "timestamp": "1970-01-01T00:16:42Z",
    "mode": "demo",
    "score": 99.8,
    "occupied": true,
    "vision_confidence": 0.94,
    "distance_cm": 55.0,
    "seat_pressure": 707.0,
    "seat_occupied": true,
    "motion": true,
    "lux": 445.3,
    "noise_level": 0.26,
    "temperature_c": 25.2,
    "humidity_percent": 52.0,
    "pressure_hpa": 1009.8,
    "posture": "GOOD",
    "person_detected": true,
    "vision_available": true,
    "fps": 18.4,
    "lamp_percent": 0,
    "fan": false,
    "buzzer": false,
    "session_active": true,
    "session_seconds": 2.0
  },
  {
    "timestamp": "1970-01-01T00:16:43Z",
    "mode": "demo",
    "score": 99.8,
    "occupied": true,
    "vision_confidence": 0.94,
    "distance_cm": 55.1,
    "seat_pressure": 707.0,
    "seat_occupied": true,
    "motion": true,
    "lux": 445.9,
    "noise_level": 0.26,
    "temperature_c": 25.2,
    "humidity_percent": 52.1,
    "pressure_hpa": 1009.8,
    "posture": "GOOD",
    "person_detected": true,
    "vision_available": true,
    "fps": 18.4,
    "lamp_percent": 0,
    "fan": false,
    "buzzer": false,
    "session_active": true,
    "session_seconds": 3.0
  }
];

export const metricsFixture: Metrics = {
  "telemetry_messages": 16,
  "invalid_messages": 0,
  "observed_fps": 18.4,
  "vision_confidence": 0.94,
  "ingestion_latency_ms": {
    "mean": null,
    "p95": null,
    "samples": 0,
    "note": "Publisher timestamp to gateway receipt; synchronized clocks required. Simulator has no measured hardware latency."
  },
  "warning_counts": {},
  "posture_accuracy": null,
  "distance_mae_cm": null,
  "note": "Accuracy and MAE require labeled ground truth; no benchmark values are fabricated.",
  "mode": "demo"
};
