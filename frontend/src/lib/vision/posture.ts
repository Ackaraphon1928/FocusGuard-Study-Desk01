/** Display types for the Python posture pipeline. No inference or classification runs here. */
export type CameraView = 'front' | 'side';
export type PostureLabel = 'GOOD' | 'SLOUCH' | 'LEAN_FORWARD' | 'LEAN_LEFT_RIGHT' | 'NO_PERSON' | 'UNKNOWN';

export interface PoseGeometry {
  trackingMode?: 'full_body' | 'upper_body' | 'head_only';
  upperBody?: UpperBodyGeometry;
  headBow?: HeadBowGeometry;
  headHeightRatio: number | null;
  headOffsetRatio: number | null;
  torsoAngleDeg: number | null;
  shoulderAngleDeg: number | null;
  /** Shoulder depth ahead of hips, divided by torso length; world coordinates only. */
  forwardRatio: number | null;
  /** Nose depth ahead of shoulders, divided by torso length; world coordinates only. */
  neckForwardRatio: number | null;
  confidence: number;
  forwardSource: 'world' | 'image-plane' | 'unavailable';
}

/** Reliable facial evidence for a pronounced calibrated bow; no inferred torso. */
export interface HeadBowGeometry {
  noseEarPitchRatio: number;
  eyeEarPitchRatio: number;
  mouthPitchRatio?: number;
  headRollDeg: number;
  confidence: number;
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
  /** Camera-centred levels divided by apparent shoulder span; fixed camera required. */
  headLevelRatio?: number | null;
  shoulderLevelRatio?: number | null;
  /** Shoulder-relative Z/Y neck geometry; neither source measures camera distance. */
  neckDepthRatio?: number | null;
  neckHeightRatio3d?: number | null;
  neckInclinationDeg?: number | null;
  neckDepthSource?: 'world' | 'normalized' | null;
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
  subject?: { index: number | null; ambiguous: boolean; detected: number; reason: string };
}
