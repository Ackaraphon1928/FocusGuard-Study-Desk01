/**
 * Personal, explainable posture heuristics for a stationary webcam.
 * Confidence measures landmark reliability, not clinical/classifier accuracy.
 * Images and landmarks remain in the browser; callers may publish labels only.
 */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export type CameraView = 'front' | 'side';
export type PostureLabel = 'GOOD' | 'SLOUCH' | 'LEAN_FORWARD' | 'LEAN_LEFT_RIGHT' | 'NO_PERSON' | 'UNKNOWN';

export interface PoseFrame {
  landmarks: readonly (readonly Landmark[])[];
  worldLandmarks?: readonly (readonly Landmark[])[];
  timestampMs: number;
  width: number;
  height: number;
}

export interface PoseGeometry {
  headHeightRatio: number;
  headOffsetRatio: number;
  torsoAngleDeg: number;
  shoulderAngleDeg: number;
  /** Shoulder depth ahead of hips, divided by torso length; world coordinates only. */
  forwardRatio: number | null;
  /** Nose depth ahead of shoulders, divided by torso length; world coordinates only. */
  neckForwardRatio: number | null;
  confidence: number;
  forwardSource: 'world' | 'image-plane' | 'unavailable';
}

export interface CalibrationState {
  status: 'needed' | 'collecting' | 'ready';
  frames: number;
  required: number;
}

export interface PostureResult {
  posture: PostureLabel;
  candidate: PostureLabel;
  personDetected: boolean;
  confidence: number;
  geometry: PoseGeometry | null;
  calibration: CalibrationState;
  reason: string;
}

export interface PostureClassifierOptions {
  view?: CameraView;
  calibrationFrames?: number;
  settleMs?: number;
}

const MIN_VISIBILITY = 0.6;
const MAX_FRAME_GAP_MS = 1_500;
const MIN_CALIBRATION_MS = 1_200;
const DEGREES = 180 / Math.PI;

type Point = { x: number; y: number; z: number };
type GeometryResult = { geometry: PoseGeometry | null; reason: string };

function reliability(point: Landmark): number {
  // Missing visibility is unknown evidence, never an assumed perfect detection.
  const values = [point.visibility ?? 0, point.presence ?? 1];
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ? Math.min(...values) : 0;
}

function inFrame(point: Landmark | undefined): point is Landmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0.015 && point.x <= 0.985 && point.y >= 0.015 && point.y <= 0.985
    && (point.z === undefined || Number.isFinite(point.z));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function imagePoint(point: Landmark, width: number, height: number): Point {
  return { x: point.x * width, y: point.y * height, z: 0 };
}

function worldPoint(point: Landmark | undefined): point is Landmark & { z: number } {
  return !!point && [point.x, point.y, point.z].every((value) => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(point.x) < 3 && Math.abs(point.y) < 3 && Math.abs(point.z!) < 3
    && reliability(point) >= MIN_VISIBILITY;
}

/** Reject cropped or unreliable required points before applying geometry rules. */
export function extractPoseGeometry(
  landmarks: readonly Landmark[], width: number, height: number, view: CameraView = 'front',
  worldLandmarks?: readonly Landmark[],
): GeometryResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { geometry: null, reason: 'invalid_frame' };
  }
  if (landmarks.length < 25) return { geometry: null, reason: 'unreliable_landmarks' };

  // Ears are frequently occluded in a front webcam. Nose + shoulders + hips suffice.
  const leftSide = [0, 11, 23];
  const rightSide = [0, 12, 24];
  const side = [leftSide, rightSide].sort((a, b) => {
    const quality = (indices: number[]) => Math.min(...indices.map((index) => landmarks[index] ? reliability(landmarks[index]) : 0));
    return quality(b) - quality(a);
  })[0];
  const required = view === 'front' ? [0, 11, 12, 23, 24] : side;
  if (required.some((index) => !inFrame(landmarks[index]))) return { geometry: null, reason: 'cropped_pose' };
  let confidence = Math.min(...required.map((index) => reliability(landmarks[index])));
  if (confidence < MIN_VISIBILITY) return { geometry: null, reason: 'unreliable_landmarks' };

  const nose = imagePoint(landmarks[0], width, height);
  const visibleShoulder = landmarks[side[1]];
  const leftShoulder = imagePoint(landmarks[11] ?? visibleShoulder, width, height);
  const rightShoulder = imagePoint(landmarks[12] ?? visibleShoulder, width, height);
  const shoulder = view === 'front' ? midpoint(leftShoulder, rightShoulder) : imagePoint(landmarks[side[1]], width, height);
  const hip = view === 'front'
    ? midpoint(imagePoint(landmarks[23], width, height), imagePoint(landmarks[24], width, height))
    : imagePoint(landmarks[side[2]], width, height);
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const shoulderSpan = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  const headHeightRatio = (shoulder.y - nose.y) / torso;
  if (torso < height * 0.12 || hip.y - shoulder.y < height * 0.08
    || headHeightRatio < -0.05 || headHeightRatio > 1.5
    || (view === 'front' && (shoulderSpan / torso < 0.25 || shoulderSpan / torso > 2.2))) {
    return { geometry: null, reason: 'invalid_geometry' };
  }
  const torsoAngleDeg = Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * DEGREES;
  if (Math.abs(torsoAngleDeg) > 65) return { geometry: null, reason: 'invalid_geometry' };
  // A side camera can legitimately see only one shoulder; never use its hidden partner.
  const bothShouldersReliable = [11, 12].every((index) => inFrame(landmarks[index]) && reliability(landmarks[index]) >= MIN_VISIBILITY);
  const shoulderAngleDeg = bothShouldersReliable && shoulderSpan > height * 0.03
    ? Math.atan2(leftShoulder.y - rightShoulder.y, Math.abs(leftShoulder.x - rightShoulder.x)) * DEGREES : 0;

  let forwardRatio: number | null = null;
  let neckForwardRatio: number | null = null;
  const worldIndices = view === 'front' ? [0, 11, 12, 23, 24] : side;
  if (worldLandmarks && worldIndices.every((index) => worldPoint(worldLandmarks[index]))) {
    const worldNose = worldLandmarks[0] as Point;
    const worldShoulder = view === 'front'
      ? midpoint(worldLandmarks[11] as Point, worldLandmarks[12] as Point) : worldLandmarks[side[1]] as Point;
    const worldHip = view === 'front'
      ? midpoint(worldLandmarks[23] as Point, worldLandmarks[24] as Point) : worldLandmarks[side[2]] as Point;
    const worldTorso = Math.hypot(worldShoulder.x - worldHip.x, worldShoulder.y - worldHip.y, worldShoulder.z - worldHip.z);
    // MediaPipe world landmarks use metres and negative Z is closer to the camera.
    if (worldTorso >= 0.12 && worldTorso <= 1.2 && worldHip.y - worldShoulder.y > 0.05) {
      forwardRatio = (worldHip.z - worldShoulder.z) / worldTorso;
      neckForwardRatio = (worldShoulder.z - worldNose.z) / worldTorso;
      if (Math.abs(neckForwardRatio) > 1.5) {
        forwardRatio = null;
        neckForwardRatio = null;
      } else {
        confidence = Math.min(confidence, ...worldIndices.map((index) => reliability(worldLandmarks[index])));
      }
    }
  }
  return {
    geometry: {
      headHeightRatio,
      headOffsetRatio: (nose.x - shoulder.x) / torso,
      torsoAngleDeg,
      shoulderAngleDeg,
      forwardRatio,
      neckForwardRatio,
      confidence,
      forwardSource: view === 'side' ? 'image-plane' : forwardRatio === null ? 'unavailable' : 'world',
    },
    reason: 'reliable_geometry',
  };
}

/** A gap, absence, or unreliable frame must clear previously retained labels. */
export class TemporalPosture {
  private candidate: PostureLabel = 'UNKNOWN';
  private current: PostureLabel = 'UNKNOWN';
  private startedAt = 0;
  private lastAt: number | null = null;

  constructor(private readonly settleMs = 600) {}

  reset(): void {
    this.candidate = 'UNKNOWN';
    this.current = 'UNKNOWN';
    this.startedAt = 0;
    this.lastAt = null;
  }

  update(label: PostureLabel, timestampMs: number): PostureLabel {
    if (!Number.isFinite(timestampMs)) {
      this.reset();
      return 'UNKNOWN';
    }
    if (this.lastAt !== null && (timestampMs < this.lastAt || timestampMs - this.lastAt > MAX_FRAME_GAP_MS)) this.reset();
    this.lastAt = timestampMs;
    if (label === 'UNKNOWN' || label === 'NO_PERSON') {
      this.current = label;
      this.candidate = label;
      this.startedAt = timestampMs;
      return label;
    }
    if (this.current === 'NO_PERSON') this.current = 'UNKNOWN';
    if (label !== this.candidate) {
      this.candidate = label;
      this.startedAt = timestampMs;
    }
    if (timestampMs - this.startedAt >= this.settleMs) this.current = label;
    return this.current;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function baselineFrom(samples: PoseGeometry[]): PoseGeometry {
  const fieldMedian = (field: 'headHeightRatio' | 'headOffsetRatio' | 'torsoAngleDeg' | 'shoulderAngleDeg' | 'confidence') => median(samples.map((sample) => sample[field]));
  const optionalMedian = (field: 'forwardRatio' | 'neckForwardRatio') => {
    const values = samples.map((sample) => sample[field]).filter((value): value is number => value !== null);
    return values.length >= samples.length * 0.8 ? median(values) : null;
  };
  return {
    headHeightRatio: fieldMedian('headHeightRatio'), headOffsetRatio: fieldMedian('headOffsetRatio'),
    torsoAngleDeg: fieldMedian('torsoAngleDeg'), shoulderAngleDeg: fieldMedian('shoulderAngleDeg'),
    confidence: fieldMedian('confidence'), forwardRatio: optionalMedian('forwardRatio'),
    neckForwardRatio: optionalMedian('neckForwardRatio'), forwardSource: samples[0].forwardSource,
  };
}

function stableAgainst(sample: PoseGeometry, baseline: PoseGeometry): boolean {
  return Math.abs(sample.torsoAngleDeg - baseline.torsoAngleDeg) <= 8
    && Math.abs(sample.shoulderAngleDeg - baseline.shoulderAngleDeg) <= 8
    && Math.abs(sample.headHeightRatio - baseline.headHeightRatio) <= 0.12
    && Math.abs(sample.headOffsetRatio - baseline.headOffsetRatio) <= 0.12
    && (sample.forwardRatio === null || baseline.forwardRatio === null || Math.abs(sample.forwardRatio - baseline.forwardRatio) <= 0.12)
    && (sample.neckForwardRatio === null || baseline.neckForwardRatio === null || Math.abs(sample.neckForwardRatio - baseline.neckForwardRatio) <= 0.12);
}

/** Calibration is explicit: sit upright, keep the camera still, then startCalibration(). */
export class PostureClassifier {
  private view: CameraView;
  private readonly requiredFrames: number;
  private readonly temporal: TemporalPosture;
  private calibrationStatus: CalibrationState['status'] = 'needed';
  private samples: PoseGeometry[] = [];
  private calibrationStartedAt: number | null = null;
  private lastTimestamp: number | null = null;
  private baseline: PoseGeometry | null = null;

  constructor(options: PostureClassifierOptions = {}) {
    this.view = options.view ?? 'front';
    this.requiredFrames = Number.isFinite(options.calibrationFrames) ? Math.max(30, Math.floor(options.calibrationFrames!)) : 30;
    this.temporal = new TemporalPosture(options.settleMs ?? 600);
  }

  reset(): void {
    this.calibrationStatus = 'needed';
    this.samples = [];
    this.baseline = null;
    this.calibrationStartedAt = null;
    this.lastTimestamp = null;
    this.temporal.reset();
  }

  startCalibration(): void {
    this.reset();
    this.calibrationStatus = 'collecting';
  }

  setView(view: CameraView): void {
    if (view !== this.view) {
      this.view = view;
      this.reset();
    }
  }

  private result(candidate: PostureLabel, frame: PoseFrame, geometry: PoseGeometry | null, reason: string): PostureResult {
    return {
      posture: this.temporal.update(candidate, frame.timestampMs), candidate,
      personDetected: frame.landmarks.length > 0,
      confidence: candidate === 'UNKNOWN' || candidate === 'NO_PERSON' ? 0 : geometry?.confidence ?? 0,
      geometry,
      calibration: { status: this.calibrationStatus, frames: this.samples.length, required: this.requiredFrames },
      reason,
    };
  }

  private clearCollection(): void {
    if (this.calibrationStatus === 'collecting') {
      this.samples = [];
      this.calibrationStartedAt = null;
    }
  }

  update(frame: PoseFrame): PostureResult {
    if (!Number.isFinite(frame.timestampMs)) {
      this.clearCollection();
      return this.result('UNKNOWN', frame, null, 'invalid_frame');
    }
    const timestampGap = this.lastTimestamp !== null
      && (frame.timestampMs <= this.lastTimestamp || frame.timestampMs - this.lastTimestamp > MAX_FRAME_GAP_MS);
    this.lastTimestamp = frame.timestampMs;
    if (timestampGap) this.clearCollection();
    if (frame.landmarks.length === 0) {
      this.clearCollection();
      return this.result('NO_PERSON', frame, null, 'no_person');
    }
    if (frame.landmarks.length !== 1) {
      this.clearCollection();
      return this.result('UNKNOWN', frame, null, 'multiple_people');
    }
    const { geometry, reason } = extractPoseGeometry(frame.landmarks[0], frame.width, frame.height, this.view, frame.worldLandmarks?.[0]);
    if (!geometry) {
      this.clearCollection();
      return this.result('UNKNOWN', frame, null, reason);
    }
    if (this.calibrationStatus === 'needed') return this.result('UNKNOWN', frame, geometry, 'calibration_needed');
    if (this.calibrationStatus === 'collecting') {
      const unstable = this.samples.length > 0 && !stableAgainst(geometry, baselineFrom(this.samples));
      if (unstable) this.clearCollection();
      this.calibrationStartedAt ??= frame.timestampMs;
      this.samples.push(geometry);
      // Do not count duplicate timestamps as successive observations.
      if (this.samples.length >= this.requiredFrames && frame.timestampMs - this.calibrationStartedAt >= MIN_CALIBRATION_MS) {
        this.baseline = baselineFrom(this.samples);
        this.calibrationStatus = 'ready';
      }
      return this.result('UNKNOWN', frame, geometry, unstable ? 'calibration_unstable' : this.baseline ? 'calibration_complete' : 'calibrating');
    }
    const baseline = this.baseline!;
    let candidate: PostureLabel = 'GOOD';
    if (this.view === 'front'
      && (Math.abs(geometry.torsoAngleDeg - baseline.torsoAngleDeg) > 12 || Math.abs(geometry.shoulderAngleDeg - baseline.shoulderAngleDeg) > 12)) {
      candidate = 'LEAN_LEFT_RIGHT';
    } else if (this.view === 'front' && baseline.forwardRatio !== null && geometry.forwardRatio !== null
      && geometry.forwardRatio - baseline.forwardRatio > 0.22) {
      candidate = 'LEAN_FORWARD';
    } else if (this.view === 'side' && Math.abs(geometry.torsoAngleDeg - baseline.torsoAngleDeg) > 18) {
      const direction = Math.sign(baseline.headOffsetRatio);
      if (Math.abs(baseline.headOffsetRatio) < 0.05 || (geometry.torsoAngleDeg - baseline.torsoAngleDeg) * direction < 0) {
        return this.result('UNKNOWN', frame, geometry, 'backward_lean_unsupported');
      }
      candidate = 'LEAN_FORWARD';
    } else if (baseline.headHeightRatio - geometry.headHeightRatio > 0.15
      || (this.view === 'side' && Math.abs(geometry.headOffsetRatio - baseline.headOffsetRatio) > 0.22)
      || (baseline.neckForwardRatio !== null && geometry.neckForwardRatio !== null && geometry.neckForwardRatio - baseline.neckForwardRatio > 0.2)) {
      candidate = 'SLOUCH';
    }
    return this.result(candidate, frame, geometry, geometry.forwardSource === 'unavailable' ? 'tracking_2d' : 'tracking');
  }
}
