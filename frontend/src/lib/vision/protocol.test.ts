import { describe, expect, it } from 'vitest';
import { observationMetadata, unavailableMetadata } from './protocol';
import type { PoseObservation } from './protocol';

function observation(): PoseObservation {
  return {
    type: 'result', people: 1, fps: 14.8, inferenceMs: 35.4, width: 640, height: 480,
    landmarks: [[{ x: 0.47, y: 0.31, z: -0.12, visibility: 0.93 }]],
    result: {
      posture: 'GOOD', candidate: 'GOOD', personDetected: true, confidence: 0.93,
      geometry: {
        headHeightRatio: 0.5, headOffsetRatio: 0, torsoAngleDeg: 0, shoulderAngleDeg: 0,
        forwardRatio: null, neckForwardRatio: null, confidence: 0.93, forwardSource: 'unavailable',
      },
      calibration: { status: 'ready', frames: 30, required: 30 }, reason: 'tracking_2d',
    },
  };
}

describe('PC camera metadata boundary', () => {
  it('copies only the seven derived fields, excluding images, landmarks and geometry', () => {
    const input = { ...observation(), frame: 'private image', image: 'data:image/jpeg;base64,private', faceLandmarks: [0.1, 0.2] };
    const metadata = observationMetadata(input);
    expect(metadata).toEqual({
      person_detected: true, posture: 'GOOD', confidence: 0.93, fps: 14.8,
      vision_available: true, inference_ms: 35.4, ambiguous_people: false,
    });
    expect(Object.keys(metadata).sort()).toEqual(['ambiguous_people', 'confidence', 'fps', 'inference_ms', 'person_detected', 'posture', 'vision_available']);
    expect(JSON.stringify(metadata)).not.toMatch(/landmarks|geometry|image|private|width|height/i);
  });

  it.each(['needed', 'collecting'] as const)('does not publish scoring confidence during %s calibration', (status) => {
    const input = observation();
    input.result.calibration.status = status;
    expect(observationMetadata(input).confidence).toBe(0);
  });

  it.each(['UNKNOWN', 'NO_PERSON'] as const)('does not turn %s into a confident posture claim', (posture) => {
    const input = observation();
    input.result.posture = posture;
    input.result.personDetected = posture !== 'NO_PERSON';
    const metadata = observationMetadata(input);
    expect(metadata.confidence).toBe(0);
    expect(metadata.posture).toBe(posture);
    expect(metadata.person_detected).toBe(posture !== 'NO_PERSON');
  });

  it('marks multiple people ambiguous without allowing positive posture confidence', () => {
    const input = observation();
    input.people = 2;
    expect(observationMetadata(input)).toMatchObject({ confidence: 0, ambiguous_people: true, person_detected: true });
  });

  it.each([
    [Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, 0, 0, 0],
    [-10, -2, -0.5, 0, 0, 0],
    [400, 80_000, 1.2, 240, 60_000, 1],
  ])('bounds invalid or excessive performance/reliability values (%s, %s, %s)', (fps, inferenceMs, confidence, expectedFps, expectedInference, expectedConfidence) => {
    const input = observation();
    input.fps = fps;
    input.inferenceMs = inferenceMs;
    input.result.confidence = confidence;
    expect(observationMetadata(input)).toMatchObject({ fps: expectedFps, inference_ms: expectedInference, confidence: expectedConfidence });
  });

  it('creates a fresh metadata-only unavailable snapshot for camera shutdown', () => {
    const unavailable = unavailableMetadata();
    expect(unavailable).toEqual({
      person_detected: false, posture: 'UNKNOWN', confidence: 0, fps: 0,
      vision_available: false, inference_ms: 0, ambiguous_people: false,
    });
    unavailable.fps = 80;
    expect(unavailableMetadata().fps).toBe(0);
  });
});
