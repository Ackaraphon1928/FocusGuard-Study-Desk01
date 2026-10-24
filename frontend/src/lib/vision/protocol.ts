import type { Posture } from '../types';
import type { CameraView, Landmark, PostureResult } from './posture';

export type PoseWorkerInput =
  | { type: 'init'; view: CameraView }
  | { type: 'frame'; frame: ImageBitmap; timestampMs: number }
  | { type: 'calibrate' }
  | { type: 'view'; view: CameraView }
  | { type: 'close' };

export interface PoseObservation {
  type: 'result';
  result: PostureResult;
  landmarks: Landmark[][];
  people: number;
  fps: number;
  inferenceMs: number;
  width: number;
  height: number;
}

export type PoseWorkerOutput =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | PoseObservation
  | { type: 'error'; message: string };

export interface PcVisionMetadata {
  person_detected: boolean;
  posture: Posture;
  confidence: number;
  fps: number;
  vision_available: boolean;
  inference_ms: number;
  ambiguous_people: boolean;
}

const bounded = (value: number, upper: number) => Number.isFinite(value) ? Math.max(0, Math.min(upper, value)) : 0;

/** Explicit allowlist. Neither frames nor landmarks can cross the HTTP boundary. */
export function observationMetadata(observation: PoseObservation): PcVisionMetadata {
  const { result } = observation;
  const reliable = result.calibration.status === 'ready' && result.posture !== 'UNKNOWN' && result.posture !== 'NO_PERSON' && observation.people === 1;
  return {
    person_detected: result.personDetected,
    posture: result.posture,
    confidence: reliable ? bounded(result.confidence, 1) : 0,
    fps: bounded(observation.fps, 240),
    vision_available: true,
    inference_ms: bounded(observation.inferenceMs, 60000),
    ambiguous_people: observation.people > 1,
  };
}

export const unavailableMetadata = (): PcVisionMetadata => ({
  person_detected: false, posture: 'UNKNOWN', confidence: 0, fps: 0,
  vision_available: false, inference_ms: 0, ambiguous_people: false,
});

export const poseDescriptions: Record<Posture, string> = {
  GOOD: 'Upright / นั่งตรง',
  SLOUCH: 'Slouch / หลังค่อมหรือก้มศีรษะ',
  LEAN_FORWARD: 'Forward lean / โน้มตัวไปข้างหน้า',
  LEAN_LEFT_RIGHT: 'Side lean / เอียงซ้ายหรือขวา',
  NO_PERSON: 'No person / ไม่พบคน',
  UNKNOWN: 'Uncertain / ยังประเมินไม่ได้',
};

export function trackingHint(reason: string): string {
  const hints: Record<string, string> = {
    calibration_needed: 'Sit upright with your head, shoulders, and hips visible, then calibrate.',
    calibrating: 'Hold your normal upright posture while the neutral baseline is collected.',
    calibration_complete: 'Calibration complete. Keep the camera fixed and try a posture change.',
    calibration_unstable: 'Keep still in your neutral posture. The calibration restarted after movement.',
    multiple_people: 'More than one person is visible. Keep one person in the camera view.',
    no_person: 'No person detected. Desk presence will pause after its configured grace interval.',
    cropped_pose: 'Move back or tilt the camera so your head, shoulders, and hips are visible.',
    unreliable_landmarks: 'Some body points are uncertain. Improve lighting and keep your upper body and hips visible.',
    invalid_frame: 'Waiting for a reliable camera frame.',
    backward_lean_unsupported: 'This side-view heuristic does not classify leaning backward.',
    tracking_2d: 'Tracking image-plane posture. Forward depth is unavailable in this frame.',
    tracking: 'Tracking live pose. Sustained posture changes feed your desk reminders.',
  };
  return hints[reason] ?? 'Keep your head, shoulders, and hips visible in even lighting.';
}
