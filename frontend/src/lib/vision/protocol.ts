import type { Posture } from '../types';
import type { CameraView, PostureResult } from './posture';

/** Derived diagnostics only. Body landmarks never travel in the JSON response. */
export interface PoseObservation {
  type: 'result';
  result: PostureResult;
  landmarks: [];
  people: number;
  fps: number;
  inferenceMs: number;
  width: number;
  height: number;
}

export interface VisionSnapshot {
  status: 'idle' | 'loading' | 'running' | 'stopped' | 'error';
  error: string | null;
  message: string;
  delegate: 'CPU' | 'GPU' | null;
  cameraIndex: number;
  view: CameraView;
  observation: PoseObservation | null;
  fps: number;
  inferenceMs: number;
  frames: number;
  updatedAt: string | null;
  previewEnabled: boolean;
}

export const initialVisionSnapshot: VisionSnapshot = {
  status: 'idle', error: null, message: 'Python camera is off. Start it when you are ready.',
  delegate: null, cameraIndex: 0, view: 'front', observation: null,
  fps: 0, inferenceMs: 0, frames: 0, updatedAt: null, previewEnabled: false,
};

export const poseDescriptions: Record<Posture, string> = {
  GOOD: 'Upright / นั่งตรง',
  SLOUCH: 'Slouch / หลังค่อม ก้มศีรษะ หรือเอนพิง',
  LEAN_FORWARD: 'Forward lean / โน้มตัวไปข้างหน้า',
  LEAN_LEFT_RIGHT: 'Side lean / เอียงซ้ายหรือขวา',
  NO_PERSON: 'No person / ไม่พบคน',
  UNKNOWN: 'Uncertain / ยังประเมินไม่ได้',
};

export function trackingHint(reason: string): string {
  const hints: Record<string, string> = {
    calibration_needed: 'Sit upright, look ahead and keep your head and shoulders visible, then calibrate. Hips are optional in Front view.',
    calibrating: 'Hold your normal upright posture while the neutral baseline is collected.',
    calibration_complete: 'Calibration complete. Keep the camera fixed and try a posture change.',
    calibration_unstable: 'Hold your normal upright posture. Movement changed the neutral samples; keep the camera fixed while calibration settles.',
    multiple_people: 'More than one person is visible. Keep one person in the camera view.',
    no_person: 'No person detected. Desk presence will pause after its configured grace interval.',
    cropped_pose: 'Keep your head and both shoulders inside the frame. Hips may stay behind the desk in Front view; a Side view benefits from a visible shoulder and hip.',
    unreliable_landmarks: 'Head or shoulder points are uncertain. Improve lighting and keep your face and upper body visible.',
    invalid_geometry: 'The visible body points do not form usable posture geometry. Keep your head and shoulders visible and check the selected camera view.',
    invalid_frame: 'Waiting for a reliable camera frame.',
    backward_lean_unsupported: 'This side-view heuristic does not classify leaning backward.',
    tracking_2d: 'Tracking image-plane posture. Forward depth is unavailable in this frame.',
    tracking_upper_body: 'Tracking head and shoulders; hips are optional. Forward lean and slouch use changes from your calibrated upper-body baseline.',
    tracking: 'Tracking live pose. Sustained posture changes feed your desk reminders.',
  };
  return hints[reason] ?? 'Keep your head and shoulders visible in even lighting, and calibrate while sitting upright.';
}
