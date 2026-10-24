export type DataMode = 'demo' | 'hardware';
export type VisionSource = 'simulated' | 'pc_camera' | 'gateway';
export type VisionInput = 'python_backend' | 'pc_camera';
export type Posture = 'GOOD' | 'SLOUCH' | 'LEAN_FORWARD' | 'LEAN_LEFT_RIGHT' | 'NO_PERSON' | 'UNKNOWN';
export type Scenario = 'normal' | 'slouch' | 'too_close' | 'dark' | 'noisy' | 'hot' | 'away' | 'camera_offline' | 'occluded' | 'network_offline';
export type ControlAction = 'start' | 'pause' | 'resume' | 'end' | 'break' | 'finish_break';
export type ScoreComponent = 'lighting' | 'noise' | 'thermal' | 'posture' | 'distance';

export interface Sensors {
  distance_cm: number | null;
  seat_pressure: number | null;
  seat_occupied: boolean | null;
  motion: boolean | null;
  noise_level: number | null;
  noise_state: 'QUIET' | 'MODERATE' | 'NOISY' | 'UNKNOWN';
  temperature_c: number | null;
  humidity_percent: number | null;
  pressure_hpa: number | null;
  lux: number | null;
  person_detected: boolean | null;
  posture: Posture;
  confidence: number | null;
  fps: number | null;
  vision_available: boolean;
}

export interface Settings {
  distance_min_cm: number;
  distance_max_cm: number;
  posture_warning_seconds: number;
  distance_warning_seconds: number;
  noise_warning_seconds: number;
  warning_cooldown_seconds: number;
  break_interval_minutes: number;
  eye_break_interval_minutes: number;
  break_duration_seconds: number;
  occupancy_pause_seconds: number;
  occupancy_end_minutes: number;
  sensor_stale_seconds: number;
  light_target_lux: number;
  temperature_fan_c: number;
  noise_threshold: number;
  confidence_min: number;
  auto_session: boolean;
  adaptive_reminders: boolean;
  buzzer_enabled: boolean;
  cloud_ai_consent: boolean;
  weights: Record<ScoreComponent, number>;
}

export interface ActuatorState {
  lamp_percent: number;
  fan: boolean;
  buzzer: boolean;
  lamp_mode: 'auto' | 'manual';
  fan_mode: 'auto' | 'manual';
}

export interface StudySession {
  id: string;
  started_at: string;
  started_epoch: number;
  ended_at?: string;
  state: 'ACTIVE' | 'PAUSED' | 'BREAK' | 'ENDED';
  mode: DataMode;
  vision_source?: VisionSource | 'unknown';
  vision_input?: VisionInput | null;
  elapsed_seconds: number;
  sitting_seconds: number;
  continuous_sitting_seconds: number;
  screen_seconds: number;
  duration_seconds: number;
  wall_seconds?: number;
  breaks: number;
  good_posture_percent: number | null;
  good_posture_seconds?: number;
  observed_posture_seconds?: number;
  average_score: number | null;
  score_integral?: number;
  score_seconds?: number;
  slouch_events: number;
  too_close_events: number;
  noise_warning_seconds: number;
  average_lux: number | null;
  lux_integral?: number;
  lux_seconds?: number;
  average_temperature: number | null;
  temperature_integral?: number;
  temperature_seconds?: number;
  sample_count: number;
  summary: string | null;
  summary_source?: 'local' | 'aws_bedrock';
  summary_note?: string;
  summary_generated_at?: string;
  pause_reason: string | null;
  end_reason?: string;
  break_remaining_seconds?: number;
  break_due_in_seconds?: number;
  break_interval_effective_seconds?: number;
  eye_break_due_in_seconds?: number;
}

export interface DeskEvent {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  mode: DataMode | 'unknown';
  vision_source?: VisionSource | 'unknown';
  vision_input?: VisionInput | null;
  session_id?: string;
  source?: string;
}

export interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline';
  last_seen: string | null;
  topic: string;
  simulated: boolean;
  source?: VisionSource;
}

export interface Rule {
  id: string;
  active: boolean;
  elapsed_seconds: number;
  threshold_seconds: number;
  cooldown_remaining_seconds: number;
}

export interface DeskState {
  mode: DataMode;
  vision_source: VisionSource;
  vision_input?: VisionInput | null;
  vision_last_seen: string | null;
  now: string;
  running: boolean;
  scenario: Scenario;
  occupancy: 'EMPTY' | 'USER_PRESENT' | 'TEMPORARILY_AWAY';
  sensors: Sensors;
  score: {
    total: number | null;
    components: Record<ScoreComponent, number | null>;
    coverage_percent: number;
    status?: string;
  };
  session: StudySession | null;
  actuators: ActuatorState;
  devices: Device[];
  events: DeskEvent[];
  settings: Settings;
  rules: Rule[];
  privacy: {
    video_upload: boolean;
    cloud_video_upload?: boolean;
    camera_frame_transport?: 'browser_to_python' | 'backend_local';
    audio_recording: boolean;
    cloud_ai_consent: boolean;
    stored_data: string;
  };
  health: {
    mqtt: string;
    influxdb: string;
    ai: string;
    storage: string;
    vision: string;
    service?: string;
    influx_pending?: number;
    influx_dropped?: number;
  };
  actuator_ack: {
    timestamp: string;
    command_id: string;
    lamp_percent: number | null;
    fan: boolean | null;
    buzzer: boolean | null;
  } | null;
}

export interface HistoryPoint {
  timestamp: string;
  mode: DataMode;
  vision_source?: VisionSource;
  vision_input?: VisionInput | null;
  score: number | null;
  distance_cm: number | null;
  seat_pressure: number | null;
  seat_occupied: boolean | null;
  motion: boolean | null;
  lux: number | null;
  noise_level: number | null;
  temperature_c: number | null;
  humidity_percent: number | null;
  pressure_hpa: number | null;
  posture: Posture;
  person_detected: boolean | null;
  vision_available: boolean;
  occupied: boolean;
  fps: number | null;
  vision_confidence: number | null;
  lamp_percent: number;
  fan: boolean;
  buzzer: boolean;
  session_active: boolean;
  session_seconds: number;
}

export interface Metrics {
  mode: DataMode;
  vision_source?: VisionSource;
  vision_input?: VisionInput | null;
  telemetry_messages: number;
  invalid_messages: number;
  observed_fps: number | null;
  vision_confidence: number | null;
  ingestion_latency_ms: {mean: number | null; p95: number | null; samples: number; note: string};
  warning_counts: Record<string, number>;
  posture_accuracy: number | null;
  distance_mae_cm: number | null;
  note: string;
}

export interface SummaryResult {
  session_id: string;
  summary: string;
  summary_source: 'local' | 'aws_bedrock';
  source: 'local' | 'aws_bedrock';
  cloud_sent: boolean;
  aggregates: Record<string, number | null>;
  note: string;
}
