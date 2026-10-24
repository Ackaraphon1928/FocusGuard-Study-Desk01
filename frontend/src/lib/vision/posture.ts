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
  trackingMode?: 'full_body' | 'upper_body';
  upperBody?: UpperBodyGeometry;
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

/** Front-webcam features that remain observable when a desk hides the hips. */
export interface UpperBodyGeometry {
  shoulderSpanRatio: number;
  faceSpanRatio: number | null;
  faceReference: 'ears' | 'eyes' | null;
  headHeightRatio: number;
  headOffsetRatio: number;
  shoulderAngleDeg: number;
  headRollDeg: number | null;
  headPitchRatio: number | null;
  facePitchRatio: number | null;
  confidence: number;
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
const CALIBRATION_GRACE_MS = 700;
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

function upperInFrame(point: Landmark | undefined): point is Landmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && (point.z === undefined || Number.isFinite(point.z));
}

function upperReliability(point: Landmark): number {
  const visibility = point.visibility ?? 0;
  const presence = point.presence ?? 1;
  if (![visibility, presence].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    || visibility < MIN_VISIBILITY || presence < 0.5) return 0;
  // Presence and visibility describe different uncertainty. A visible shoulder
  // near the bottom edge can have moderate presence in a seated crop. Require
  // both gates, then combine them; never use invented off-frame hip confidence.
  return Math.sqrt(visibility * presence);
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

function upperBodyGeometry(landmarks: readonly Landmark[], width: number, height: number): UpperBodyGeometry | null {
  const required = [0, 11, 12];
  if (!required.every(index => upperInFrame(landmarks[index]) && upperReliability(landmarks[index]) >= MIN_VISIBILITY)) return null;
  const nose = imagePoint(landmarks[0], width, height);
  const left = imagePoint(landmarks[11], width, height);
  const right = imagePoint(landmarks[12], width, height);
  const shoulder = midpoint(left, right);
  const span = Math.hypot(left.x - right.x, left.y - right.y);
  const headHeight = (shoulder.y - nose.y) / span;
  const headOffset = (nose.x - shoulder.x) / span;
  if (span < Math.max(12, width * 0.08) || span > width * 1.15
    || headHeight < -0.6 || headHeight > 1.6 || Math.abs(headOffset) > 1.5) return null;
  let faceSpanRatio: number | null = null;
  let faceReference: UpperBodyGeometry['faceReference'] = null;
  let headRollDeg: number | null = null;
  let headPitchRatio: number | null = null;
  let facePitchRatio: number | null = null;
  for (const [a, b, reference] of [[7, 8, 'ears'], [2, 5, 'eyes']] as const) {
    if (![a, b].every(index => inFrame(landmarks[index]) && reliability(landmarks[index]) >= MIN_VISIBILITY)) continue;
    const first = imagePoint(landmarks[a], width, height);
    const second = imagePoint(landmarks[b], width, height);
    const faceSpan = Math.hypot(first.x - second.x, first.y - second.y);
    if (faceSpan < width * 0.025 || faceSpan > span * 1.2) continue;
    faceSpanRatio = faceSpan / width;
    faceReference = reference;
    // Sort in image X so mirroring cannot reverse the pitch/roll convention.
    const [imageLeft, imageRight] = first.x <= second.x ? [first, second] : [second, first];
    headRollDeg = Math.atan2(imageRight.y - imageLeft.y, imageRight.x - imageLeft.x) * DEGREES;
    headPitchRatio = (nose.y - (first.y + second.y) / 2) / faceSpan;
    break;
  }
  if ([2, 5, 9, 10].every(index => upperInFrame(landmarks[index]) && upperReliability(landmarks[index]) >= MIN_VISIBILITY)) {
    const eyeY = (landmarks[2].y + landmarks[5].y) / 2 * height;
    const mouthY = (landmarks[9].y + landmarks[10].y) / 2 * height;
    if (mouthY - eyeY > height * 0.025) facePitchRatio = (nose.y - eyeY) / (mouthY - eyeY);
  }
  return {
    shoulderSpanRatio: span / width, faceSpanRatio, faceReference,
    headHeightRatio: headHeight, headOffsetRatio: headOffset,
    shoulderAngleDeg: Math.atan2(left.y - right.y, Math.abs(left.x - right.x)) * DEGREES,
    headRollDeg, headPitchRatio, facePitchRatio,
    confidence: Math.min(...required.map(index => upperReliability(landmarks[index]))),
  };
}

/** Reject cropped or unreliable required points before applying geometry rules. */
export function extractPoseGeometry(
  landmarks: readonly Landmark[], width: number, height: number, view: CameraView = 'front',
  worldLandmarks?: readonly Landmark[],
): GeometryResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { geometry: null, reason: 'invalid_frame' };
  }
  if (landmarks.length < 13) return { geometry: null, reason: 'unreliable_landmarks' };

  // A laptop webcam usually cannot see hips behind the desk. Never let those
  // inferred/out-of-frame points veto otherwise reliable head/shoulder evidence.
  const upper = upperBodyGeometry(landmarks, width, height);
  const upperFallback = (): GeometryResult => upper ? {
    geometry: {
      trackingMode: 'upper_body', upperBody: upper,
      headHeightRatio: upper.headHeightRatio, headOffsetRatio: upper.headOffsetRatio,
      torsoAngleDeg: 0, shoulderAngleDeg: upper.shoulderAngleDeg,
      forwardRatio: null, neckForwardRatio: null, confidence: upper.confidence,
      forwardSource: 'image-plane',
    }, reason: 'reliable_upper_body',
  } : { geometry: null, reason: 'invalid_geometry' };
  const leftSide = [0, 11, 23];
  const rightSide = [0, 12, 24];
  const side = [leftSide, rightSide].sort((a, b) => {
    const quality = (indices: number[]) => Math.min(...indices.map((index) => landmarks[index] ? reliability(landmarks[index]) : 0));
    return quality(b) - quality(a);
  })[0];
  const required = view === 'front' ? [0, 11, 12] : side;
  if (required.some((index) => !(view === 'front' ? upperInFrame(landmarks[index]) : inFrame(landmarks[index])))) return { geometry: null, reason: 'cropped_pose' };
  let confidence = Math.min(...required.map((index) => view === 'front' ? upperReliability(landmarks[index]) : reliability(landmarks[index])));
  if (confidence < MIN_VISIBILITY) return { geometry: null, reason: 'unreliable_landmarks' };
  if (view === 'front' && ![23, 24].every(index => inFrame(landmarks[index]) && reliability(landmarks[index]) >= MIN_VISIBILITY)) return upperFallback();
  if (view === 'front') confidence = Math.min(confidence, reliability(landmarks[23]), reliability(landmarks[24]));

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
    return view === 'front' ? upperFallback() : { geometry: null, reason: 'invalid_geometry' };
  }
  const torsoAngleDeg = Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * DEGREES;
  if (Math.abs(torsoAngleDeg) > 65) return view === 'front' ? upperFallback() : { geometry: null, reason: 'invalid_geometry' };
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
      trackingMode: 'full_body', ...(upper ? { upperBody: upper } : {}),
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

function upperBaseline(samples: UpperBodyGeometry[]): UpperBodyGeometry | undefined {
  if (!samples.length) return undefined;
  const field = (key: 'shoulderSpanRatio' | 'headHeightRatio' | 'headOffsetRatio' | 'shoulderAngleDeg' | 'confidence') => median(samples.map(sample => sample[key]));
  const optional = (key: 'faceSpanRatio' | 'headRollDeg' | 'headPitchRatio' | 'facePitchRatio', source = samples) => {
    const values = source.map(sample => sample[key]).filter((value): value is number => value !== null);
    return values.length >= samples.length * 0.8 ? median(values) : null;
  };
  const reference = samples.filter(sample => sample.faceReference === 'ears').length >= samples.length * 0.8 ? 'ears'
    : samples.filter(sample => sample.faceReference === 'eyes').length >= samples.length * 0.8 ? 'eyes' : null;
  const faceSamples = reference ? samples.filter(sample => sample.faceReference === reference) : [];
  return {
    shoulderSpanRatio: field('shoulderSpanRatio'), headHeightRatio: field('headHeightRatio'),
    headOffsetRatio: field('headOffsetRatio'), shoulderAngleDeg: field('shoulderAngleDeg'), confidence: field('confidence'),
    faceReference: reference, faceSpanRatio: optional('faceSpanRatio', faceSamples),
    headRollDeg: optional('headRollDeg', faceSamples), headPitchRatio: optional('headPitchRatio', faceSamples),
    facePitchRatio: optional('facePitchRatio'),
  };
}

function baselineFrom(samples: PoseGeometry[]): PoseGeometry {
  const fieldMedian = (field: 'headHeightRatio' | 'headOffsetRatio' | 'torsoAngleDeg' | 'shoulderAngleDeg' | 'confidence') => median(samples.map((sample) => sample[field]));
  const optionalMedian = (field: 'forwardRatio' | 'neckForwardRatio') => {
    const values = samples.map((sample) => sample[field]).filter((value): value is number => value !== null);
    return values.length >= samples.length * 0.8 ? median(values) : null;
  };
  return {
    trackingMode: samples.filter(sample => sample.trackingMode === 'full_body').length >= samples.length * 0.8 ? 'full_body' : 'upper_body',
    upperBody: upperBaseline(samples.flatMap(sample => sample.upperBody ? [sample.upperBody] : [])),
    headHeightRatio: fieldMedian('headHeightRatio'), headOffsetRatio: fieldMedian('headOffsetRatio'),
    torsoAngleDeg: fieldMedian('torsoAngleDeg'), shoulderAngleDeg: fieldMedian('shoulderAngleDeg'),
    confidence: fieldMedian('confidence'), forwardRatio: optionalMedian('forwardRatio'),
    neckForwardRatio: optionalMedian('neckForwardRatio'), forwardSource: samples[0].forwardSource,
  };
}

function stableAgainst(sample: PoseGeometry, baseline: PoseGeometry): boolean {
  if (sample.upperBody && baseline.upperBody) {
    const a = sample.upperBody;
    const b = baseline.upperBody;
    return Math.abs(a.shoulderAngleDeg - b.shoulderAngleDeg) <= 8
      && Math.abs(a.headHeightRatio - b.headHeightRatio) <= 0.12
      && Math.abs(a.headOffsetRatio - b.headOffsetRatio) <= 0.12
      && Math.abs(a.shoulderSpanRatio / b.shoulderSpanRatio - 1) <= 0.12
      && (a.facePitchRatio === null || b.facePitchRatio === null || Math.abs(a.facePitchRatio - b.facePitchRatio) <= 0.15);
  }
  return Math.abs(sample.torsoAngleDeg - baseline.torsoAngleDeg) <= 8
    && Math.abs(sample.shoulderAngleDeg - baseline.shoulderAngleDeg) <= 8
    && Math.abs(sample.headHeightRatio - baseline.headHeightRatio) <= 0.12
    && Math.abs(sample.headOffsetRatio - baseline.headOffsetRatio) <= 0.12
    && (sample.forwardRatio === null || baseline.forwardRatio === null || Math.abs(sample.forwardRatio - baseline.forwardRatio) <= 0.12)
    && (sample.neckForwardRatio === null || baseline.neckForwardRatio === null || Math.abs(sample.neckForwardRatio - baseline.neckForwardRatio) <= 0.12);
}

/** Relative front-view cues, calibrated to this person's normal seated crop. */
function classifyUpperBody(current: UpperBodyGeometry, baseline: UpperBodyGeometry): PostureLabel {
  const shoulderScale = current.shoulderSpanRatio / baseline.shoulderSpanRatio;
  const heightDrop = baseline.headHeightRatio - current.headHeightRatio;
  const comparableFace = current.faceReference !== null && current.faceReference === baseline.faceReference;
  const faceScale = comparableFace && current.faceSpanRatio !== null && baseline.faceSpanRatio !== null
    ? current.faceSpanRatio / baseline.faceSpanRatio : 1;
  const pitchChange = current.facePitchRatio !== null && baseline.facePitchRatio !== null
    ? current.facePitchRatio - baseline.facePitchRatio : null;
  const earPitchChange = comparableFace && current.headPitchRatio !== null && baseline.headPitchRatio !== null
    ? current.headPitchRatio - baseline.headPitchRatio : null;
  const rollChange = comparableFace && current.headRollDeg !== null && baseline.headRollDeg !== null
    ? Math.abs(current.headRollDeg - baseline.headRollDeg) : 0;

  // Lateral tilt can compress the vertical head/shoulder gap too: classify it
  // before interpreting that gap as forward lean or head collapse.
  if (Math.abs(current.shoulderAngleDeg - baseline.shoulderAngleDeg) > 12
    || (rollChange > 18 && Math.abs(current.headOffsetRatio - baseline.headOffsetRatio) > 0.18)) return 'LEAN_LEFT_RIGHT';

  // Downward head pitch foreshortens nose-to-mouth relative to eye-to-mouth.
  // This separates a bowed/collapsed head from approaching the camera while
  // still looking ahead. A nearly collapsed gap also works without face extras.
  if ((pitchChange !== null && pitchChange > 0.14 && heightDrop > 0.12)
    || (earPitchChange !== null && earPitchChange > 0.27 && heightDrop > 0.18)
    || current.headHeightRatio < Math.min(0.08, baseline.headHeightRatio * 0.2)) return 'SLOUCH';

  // User's reclined/chin-up example: size reduction alone is insufficient;
  // require both a raised head/shoulder gap and a changed facial pitch.
  if (shoulderScale < 0.9 && current.headHeightRatio - baseline.headHeightRatio > 0.09
    && pitchChange !== null && pitchChange < -0.06) return 'SLOUCH';

  if (heightDrop > Math.max(0.1, baseline.headHeightRatio * 0.22)
    && (shoulderScale > 1.12 || faceScale > 1.18)) return 'LEAN_FORWARD';

  if (heightDrop > 0.16 || (pitchChange !== null && pitchChange > 0.17)) return 'SLOUCH';
  return 'GOOD';
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
  private lastReliableAt: number | null = null;
  private collectionInterrupted = false;
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
    this.lastReliableAt = null;
    this.collectionInterrupted = false;
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
      this.lastReliableAt = null;
      this.collectionInterrupted = false;
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
      this.collectionInterrupted = true;
      if (this.lastReliableAt === null || frame.timestampMs - this.lastReliableAt > CALIBRATION_GRACE_MS) this.clearCollection();
      return this.result('NO_PERSON', frame, null, 'no_person');
    }
    if (frame.landmarks.length !== 1) {
      this.clearCollection();
      return this.result('UNKNOWN', frame, null, 'multiple_people');
    }
    const { geometry, reason } = extractPoseGeometry(frame.landmarks[0], frame.width, frame.height, this.view, frame.worldLandmarks?.[0]);
    if (!geometry) {
      this.collectionInterrupted = true;
      if (this.lastReliableAt === null || frame.timestampMs - this.lastReliableAt > CALIBRATION_GRACE_MS) this.clearCollection();
      return this.result('UNKNOWN', frame, null, reason);
    }
    if (this.calibrationStatus === 'needed') return this.result('UNKNOWN', frame, geometry, 'calibration_needed');
    if (this.calibrationStatus === 'collecting') {
      if (this.collectionInterrupted && this.lastReliableAt !== null && frame.timestampMs - this.lastReliableAt > CALIBRATION_GRACE_MS) this.clearCollection();
      this.collectionInterrupted = false;
      const unstable = this.samples.length > 0 && !stableAgainst(geometry, baselineFrom(this.samples));
      if (unstable) this.clearCollection();
      this.calibrationStartedAt ??= frame.timestampMs;
      this.lastReliableAt = frame.timestampMs;
      this.samples.push(geometry);
      // Do not count duplicate timestamps as successive observations.
      if (this.samples.length >= this.requiredFrames && frame.timestampMs - this.calibrationStartedAt >= MIN_CALIBRATION_MS) {
        this.baseline = baselineFrom(this.samples);
        this.calibrationStatus = 'ready';
      }
      return this.result('UNKNOWN', frame, geometry, unstable ? 'calibration_unstable' : this.baseline ? 'calibration_complete' : 'calibrating');
    }
    const baseline = this.baseline!;
    if (this.view === 'front' && (geometry.trackingMode === 'upper_body' || baseline.trackingMode === 'upper_body')
      && geometry.upperBody && baseline.upperBody) {
      return this.result(classifyUpperBody(geometry.upperBody, baseline.upperBody), frame, geometry, 'tracking_upper_body');
    }
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
