import { describe, expect, it } from 'vitest';
import { extractPoseGeometry, PostureClassifier, TemporalPosture } from './posture';
import type { Landmark, PoseFrame, PostureClassifierOptions } from './posture';

function pose(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99 }));
  Object.assign(points[0], { x: 0.5, y: 0.22 });
  Object.assign(points[11], { x: 0.38, y: 0.4 });
  Object.assign(points[12], { x: 0.62, y: 0.4 });
  Object.assign(points[23], { x: 0.42, y: 0.76 });
  Object.assign(points[24], { x: 0.58, y: 0.76 });
  for (const [index, change] of Object.entries(overrides)) Object.assign(points[Number(index)], change);
  return points;
}

function world(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.99, presence: 0.99 }));
  Object.assign(points[0], { x: 0, y: -0.72, z: -0.12 });
  Object.assign(points[11], { x: -0.18, y: -0.45, z: 0 });
  Object.assign(points[12], { x: 0.18, y: -0.45, z: 0 });
  Object.assign(points[23], { x: -0.12, y: 0, z: 0 });
  Object.assign(points[24], { x: 0.12, y: 0, z: 0 });
  for (const [index, change] of Object.entries(overrides)) Object.assign(points[Number(index)], change);
  return points;
}

function frame(timestampMs: number, points = pose(), worldPoints?: Landmark[]): PoseFrame {
  return { timestampMs, width: 640, height: 480, landmarks: [points], worldLandmarks: worldPoints ? [worldPoints] : undefined };
}

function calibrated(options: PostureClassifierOptions = {}, points = pose(), worldPoints?: Landmark[]): PostureClassifier {
  const classifier = new PostureClassifier(options);
  classifier.startCalibration();
  for (let index = 0; index < 30; index++) classifier.update(frame(index * 50, points, worldPoints));
  return classifier;
}

function stable(classifier: PostureClassifier, points = pose(), worldPoints?: Landmark[], start = 1_500) {
  classifier.update(frame(start, points, worldPoints));
  return classifier.update(frame(start + 650, points, worldPoints));
}

describe('landmark geometry', () => {
  it('uses nose, shoulders and hips without requiring visible ears', () => {
    const points = pose({ 7: { visibility: 0 }, 8: { visibility: 0 } });
    const result = extractPoseGeometry(points, 640, 480);
    expect(result.geometry?.headHeightRatio).toBeCloseTo(0.5);
    expect(result.geometry?.forwardSource).toBe('unavailable');
  });

  it('corrects angles and offsets for the image aspect ratio', () => {
    const points = pose({ 0: { x: 0.55 }, 11: { x: 0.43 }, 12: { x: 0.67 } });
    const wide = extractPoseGeometry(points, 1_280, 720).geometry!;
    const square = extractPoseGeometry(points, 720, 720).geometry!;
    expect(wide.torsoAngleDeg).toBeCloseTo(Math.atan2(64, 0.36 * 720) * 180 / Math.PI);
    expect(wide.torsoAngleDeg).toBeGreaterThan(square.torsoAngleDeg);
  });

  it.each([
    ['low visibility', { 23: { visibility: 0.1 } }],
    ['low presence', { 0: { presence: 0.1 } }],
    ['out of frame hip', { 24: { y: 1.2 } }],
    ['hip clipped at edge', { 23: { y: 0.999 } }],
    ['nonfinite nose', { 0: { x: Number.NaN } }],
    ['nonfinite depth', { 12: { z: Number.POSITIVE_INFINITY } }],
    ['invalid reliability', { 12: { visibility: Number.NaN } }],
  ])('rejects %s even if the remaining landmarks are reliable', (_, overrides) => {
    expect(extractPoseGeometry(pose(overrides as Record<number, Partial<Landmark>>), 640, 480).geometry).toBeNull();
  });

  it('rejects degenerate, tiny, or anatomically inverted geometry', () => {
    const points = pose();
    for (const point of points) Object.assign(point, { x: 0.5, y: 0.5 });
    expect(extractPoseGeometry(points, 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(pose({ 23: { y: 0.42 }, 24: { y: 0.42 } }), 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(pose({ 23: { y: 0.3 }, 24: { y: 0.3 } }), 640, 480).geometry).toBeNull();
  });

  it('rejects missing landmarks and invalid dimensions', () => {
    expect(extractPoseGeometry([], 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(pose(), 0, 480).reason).toBe('invalid_frame');
    expect(extractPoseGeometry(pose(), Number.NaN, 480).geometry).toBeNull();
  });

  it('does not assign perfect confidence when visibility is missing', () => {
    const points: Landmark[] = pose().map(({ x, y, z }) => ({ x, y, z }));
    expect(extractPoseGeometry(points, 640, 480).geometry).toBeNull();
  });

  it('uses relative world depth only when a plausible world torso is available', () => {
    const geometry = extractPoseGeometry(pose(), 640, 480, 'front', world({
      11: { z: -0.2 }, 12: { z: -0.2 }, 0: { z: -0.32 },
    })).geometry!;
    expect(geometry.forwardSource).toBe('world');
    expect(geometry.forwardRatio).toBeCloseTo(0.2 / Math.hypot(0.45, 0.2));
    expect(geometry.neckForwardRatio).toBeCloseTo(0.12 / Math.hypot(0.45, 0.2));
    expect(extractPoseGeometry(pose(), 640, 480, 'front', world({ 11: { z: Number.NaN } })).geometry?.forwardSource).toBe('unavailable');
  });

  it('uses the weakest landmark reliability across image and any world geometry used', () => {
    const geometry = extractPoseGeometry(pose(), 640, 480, 'front', world({ 23: { visibility: 0.64 } })).geometry!;
    expect(geometry.forwardSource).toBe('world');
    expect(geometry.confidence).toBe(0.64);
  });
});

describe('personal calibration and posture labels', () => {
  it('requires explicit calibration before making a posture claim', () => {
    const result = new PostureClassifier().update(frame(0));
    expect(result.posture).toBe('UNKNOWN');
    expect(result.reason).toBe('calibration_needed');
    expect(result.personDetected).toBe(true);
  });

  it('requires at least 30 stable reliable frames and a real observation interval', () => {
    const classifier = new PostureClassifier({ calibrationFrames: 2 });
    classifier.startCalibration();
    for (let index = 0; index < 30; index++) {
      const result = classifier.update(frame(index * 10));
      expect(result.calibration.status).toBe('collecting');
      expect(result.calibration.required).toBe(30);
    }
    const complete = classifier.update(frame(1_200));
    expect(complete.calibration.status).toBe('ready');
    expect(complete.posture).toBe('UNKNOWN');
    expect(stable(classifier).posture).toBe('GOOD');
  });

  it('resets calibration on movement or unreliable observations', () => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50));
    const moved = classifier.update(frame(750, pose({ 0: { y: 0.31 } })));
    expect(moved.reason).toBe('calibration_unstable');
    expect(moved.calibration.frames).toBe(1);
    const occluded = classifier.update(frame(800, pose({ 11: { visibility: 0.1 } })));
    expect(occluded.calibration.frames).toBe(0);
  });

  it('uses a median baseline instead of allowing small neutral jitter to bias it', () => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 30; index++) classifier.update(frame(index * 50, pose({ 0: { y: index % 5 === 0 ? 0.24 : 0.22 } })));
    const result = stable(classifier, pose({ 0: { y: 0.277 } }));
    expect(result.candidate).toBe('SLOUCH');
    expect(result.posture).toBe('SLOUCH');
  });

  it('labels a sustained head drop as slouch from a front webcam', () => {
    const classifier = calibrated();
    expect(stable(classifier, pose({ 0: { y: 0.31 } })).posture).toBe('SLOUCH');
  });

  it('labels front forward lean using calibrated world shoulder-to-hip depth', () => {
    const classifier = calibrated({}, pose(), world());
    const forward = world({ 11: { z: -0.22 }, 12: { z: -0.22 }, 0: { z: -0.34 } });
    const result = stable(classifier, pose(), forward);
    expect(result.posture).toBe('LEAN_FORWARD');
    expect(result.geometry?.forwardSource).toBe('world');
  });

  it('labels neck protrusion separately from a forward torso', () => {
    const classifier = calibrated({}, pose(), world());
    expect(stable(classifier, pose(), world({ 0: { z: -0.25 } })).posture).toBe('SLOUCH');
  });

  it('does not call front image scale/depth a measured forward lean', () => {
    const classifier = calibrated();
    const result = stable(classifier);
    expect(result.posture).toBe('GOOD');
    expect(result.geometry?.forwardRatio).toBeNull();
    expect(result.geometry?.forwardSource).toBe('unavailable');
    expect(result.reason).toBe('tracking_2d');
  });

  it('reports the 2D limitation when world tracking becomes unavailable', () => {
    const classifier = calibrated({}, pose(), world());
    const result = stable(classifier);
    expect(result.geometry?.forwardRatio).toBeNull();
    expect(result.geometry?.forwardSource).toBe('unavailable');
    expect(result.reason).toBe('tracking_2d');
  });

  it('does not mistake a front sideways head movement for forward neck slouch', () => {
    expect(stable(calibrated(), pose({ 0: { x: 0.58 } })).posture).toBe('GOOD');
  });

  it('keeps ratio features unchanged when moving a similarly posed person closer to the camera', () => {
    const classifier = calibrated({}, pose(), world());
    const resized = pose().map((point) => ({ ...point, x: 0.5 + (point.x - 0.5) * 1.15, y: 0.5 + (point.y - 0.5) * 1.15 }));
    const result = stable(classifier, resized, world());
    expect(result.posture).toBe('GOOD');
    expect(result.geometry?.headHeightRatio).toBeCloseTo(0.5);
    expect(result.geometry?.forwardRatio).toBe(0);
  });

  it('labels lateral torso lean and shoulder tilt from a front camera', () => {
    const tiltedTorso = pose({ 0: { x: 0.61 }, 11: { x: 0.49 }, 12: { x: 0.73 } });
    expect(stable(calibrated(), tiltedTorso).posture).toBe('LEAN_LEFT_RIGHT');
    const tiltedShoulders = pose({ 11: { y: 0.35 }, 12: { y: 0.45 } });
    expect(stable(calibrated(), tiltedShoulders).posture).toBe('LEAN_LEFT_RIGHT');
  });

  it('allows a side camera to use one visible shoulder and hip', () => {
    const side = pose({ 0: { x: 0.52 }, 11: { x: 0.44 }, 23: { x: 0.44 }, 12: { visibility: 0.1 }, 24: { visibility: 0.1 } });
    const classifier = calibrated({ view: 'side' }, side);
    expect(stable(classifier, side).posture).toBe('GOOD');
    const leaning = pose({ 0: { x: 0.65 }, 11: { x: 0.57 }, 23: { x: 0.44 }, 12: { visibility: 0.1 }, 24: { visibility: 0.1 } });
    const result = stable(classifier, leaning, undefined, 2_200);
    expect(result.posture).toBe('LEAN_FORWARD');
    expect(result.geometry?.forwardSource).toBe('image-plane');
  });

  it('does not label a backward side tilt as forward lean', () => {
    const side = pose({ 0: { x: 0.52 }, 11: { x: 0.44 }, 23: { x: 0.44 }, 12: { visibility: 0.1 }, 24: { visibility: 0.1 } });
    const classifier = calibrated({ view: 'side' }, side);
    const backward = pose({ 0: { x: 0.39 }, 11: { x: 0.31 }, 23: { x: 0.44 }, 12: { visibility: 0.1 }, 24: { visibility: 0.1 } });
    expect(stable(classifier, backward).posture).toBe('UNKNOWN');
  });

  it('immediately clears a previous bad label when no person, multiple people or cropped hips are seen', () => {
    const classifier = calibrated();
    const slouch = pose({ 0: { y: 0.31 } });
    expect(stable(classifier, slouch).posture).toBe('SLOUCH');
    expect(classifier.update({ ...frame(2_200), landmarks: [] }).posture).toBe('NO_PERSON');
    const multiple = classifier.update({ ...frame(2_250), landmarks: [pose(), pose()] });
    expect(multiple).toMatchObject({ posture: 'UNKNOWN', confidence: 0, personDetected: true, reason: 'multiple_people' });
    expect(classifier.update(frame(2_300, pose({ 24: { y: 1.1 } }))).posture).toBe('UNKNOWN');
    expect(classifier.update(frame(2_350, slouch)).posture).toBe('UNKNOWN');
    expect(classifier.update(frame(3_000, slouch)).posture).toBe('SLOUCH');
  });

  it('resets calibration when changing camera orientation or explicitly restarting', () => {
    const classifier = calibrated();
    expect(stable(classifier).posture).toBe('GOOD');
    classifier.setView('side');
    expect(classifier.update(frame(2_200)).calibration.status).toBe('needed');
    classifier.startCalibration();
    expect(classifier.update(frame(2_250)).calibration).toMatchObject({ status: 'collecting', frames: 1 });
    classifier.reset();
    expect(classifier.update(frame(2_300)).calibration.status).toBe('needed');
  });

  it('does not count duplicate or discontinuous timestamps as a stable calibration sequence', () => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50));
    expect(classifier.update(frame(700)).calibration.frames).toBe(1);
    expect(classifier.update(frame(5_000)).calibration.frames).toBe(1);
    expect(classifier.update(frame(Number.NaN)).posture).toBe('UNKNOWN');
  });
});

describe('temporal evidence', () => {
  it('requires 600ms of a continuous new label and preserves the previous stable label during transitions', () => {
    const temporal = new TemporalPosture();
    expect(temporal.update('GOOD', 0)).toBe('UNKNOWN');
    expect(temporal.update('GOOD', 650)).toBe('GOOD');
    expect(temporal.update('SLOUCH', 700)).toBe('GOOD');
    expect(temporal.update('GOOD', 750)).toBe('GOOD');
    expect(temporal.update('SLOUCH', 800)).toBe('GOOD');
    expect(temporal.update('SLOUCH', 1_400)).toBe('SLOUCH');
    expect(temporal.update('UNKNOWN', 1_450)).toBe('UNKNOWN');
    expect(temporal.update('NO_PERSON', 1_500)).toBe('NO_PERSON');
    expect(temporal.update('GOOD', 1_550)).toBe('UNKNOWN');
    expect(temporal.update('GOOD', 2_200)).toBe('GOOD');
  });

  it('clears retained labels after timestamp jumps, nonfinite timestamps and explicit reset', () => {
    const temporal = new TemporalPosture();
    temporal.update('SLOUCH', 0);
    expect(temporal.update('SLOUCH', 650)).toBe('SLOUCH');
    expect(temporal.update('SLOUCH', 5_000)).toBe('UNKNOWN');
    expect(temporal.update('SLOUCH', 5_650)).toBe('SLOUCH');
    expect(temporal.update('SLOUCH', 1_000)).toBe('UNKNOWN');
    expect(temporal.update('SLOUCH', Number.NaN)).toBe('UNKNOWN');
    temporal.update('GOOD', 2_000);
    temporal.update('GOOD', 2_650);
    temporal.reset();
    expect(temporal.update('GOOD', 2_700)).toBe('UNKNOWN');
  });
});
