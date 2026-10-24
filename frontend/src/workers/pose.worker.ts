/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerOptions } from '@mediapipe/tasks-vision';
import { PostureClassifier } from '../lib/vision/posture';
import type { PoseWorkerInput, PoseWorkerOutput } from '../lib/vision/protocol';

// Built as a classic IIFE worker for development and production. The pinned
// MediaPipe WASM loader uses importScripts(), which a module worker cannot run.
const context = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: PoseLandmarker | null = null;
let classifier = new PostureClassifier();
let frameTimes: number[] = [];
let previousTimestamp = -1;

const emit = (message: PoseWorkerOutput) => context.postMessage(message);

async function initialize(view: 'front' | 'side') {
  landmarker?.close();
  landmarker = null;
  classifier = new PostureClassifier({ view });
  frameTimes = [];
  previousTimestamp = -1;
  if (typeof OffscreenCanvas === 'undefined') throw new Error('This browser does not support OffscreenCanvas. Use a current desktop Chrome or Edge.');
  const origin = context.location.origin;
  const files = await FilesetResolver.forVisionTasks(`${origin}/vision/wasm`);
  const create = (delegate: 'GPU' | 'CPU') => {
    const options: PoseLandmarkerOptions = {
      baseOptions: { modelAssetPath: `${origin}/vision/pose_landmarker_lite.task`, delegate },
      canvas: new OffscreenCanvas(640, 480),
      runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
      outputSegmentationMasks: false,
    };
    return PoseLandmarker.createFromOptions(files, options);
  };
  let delegate: 'GPU' | 'CPU' = 'GPU';
  try { landmarker = await create('GPU'); }
  catch { delegate = 'CPU'; landmarker = await create('CPU'); }
  emit({ type: 'ready', delegate });
}

context.onmessage = async ({ data }: MessageEvent<PoseWorkerInput>) => {
  try {
    if (data.type === 'init') { await initialize(data.view); return; }
    if (data.type === 'close') { landmarker?.close(); landmarker = null; context.close(); return; }
    if (data.type === 'calibrate') { classifier.startCalibration(); return; }
    if (data.type === 'view') { classifier.setView(data.view); return; }
    if (data.type !== 'frame') return;
    const bitmap = data.frame;
    try {
      if (!landmarker) throw new Error('The pose model is not ready. Restart the camera.');
      const timestamp = Math.max(previousTimestamp + .01, data.timestampMs);
      previousTimestamp = timestamp;
      const started = performance.now();
      const pose = landmarker.detectForVideo(bitmap, timestamp);
      const inferenceMs = performance.now() - started;
      frameTimes.push(timestamp);
      frameTimes = frameTimes.filter(time => timestamp - time <= 3000).slice(-60);
      const fps = frameTimes.length > 1 ? (frameTimes.length - 1) * 1000 / (frameTimes.at(-1)! - frameTimes[0]!) : 0;
      const result = classifier.update({ landmarks: pose.landmarks, worldLandmarks: pose.worldLandmarks, timestampMs: timestamp, width: bitmap.width, height: bitmap.height });
      emit({ type: 'result', result, landmarks: pose.landmarks, people: pose.landmarks.length, fps, inferenceMs, width: bitmap.width, height: bitmap.height });
    } finally { bitmap.close(); }
  } catch (error) {
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Local pose inference failed.' });
  }
};
