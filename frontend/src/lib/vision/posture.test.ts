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

function upperPose(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  return pose({
    2: { x: 0.47, y: 0.205 }, 5: { x: 0.53, y: 0.205 },
    7: { x: 0.44, y: 0.21 }, 8: { x: 0.56, y: 0.21 },
    9: { x: 0.48, y: 0.255 }, 10: { x: 0.52, y: 0.255 },
    23: { y: 1.2, visibility: 0.1, presence: 0.1 },
    24: { y: 1.2, visibility: 0.1, presence: 0.1 },
    ...overrides,
  });
}

function withVisibleHips(points: Landmark[]): Landmark[] {
  return points.map((point, index) => index === 23 || index === 24
    ? { ...point, y: 0.76, visibility: 0.99, presence: 0.99 } : { ...point });
}

function upperForward(): Landmark[] {
  const points = upperPose({ 11: { x: 0.35 }, 12: { x: 0.65 } });
  for (const index of [0, 2, 5, 7, 8, 9, 10]) {
    points[index].x = 0.5 + (points[index].x - 0.5) * 1.25;
    points[index].y = 0.3 + (points[index].y - 0.22) * 1.25;
  }
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
    ['low head visibility', { 0: { visibility: 0.1 } }],
    ['low shoulder visibility', { 11: { visibility: 0.1 } }],
    ['low presence', { 0: { presence: 0.1 } }],
    ['low shoulder presence', { 12: { presence: 0.1 } }],
    ['out of frame shoulder', { 12: { x: 1.001 } }],
    ['nonfinite nose', { 0: { x: Number.NaN } }],
    ['nonfinite depth', { 12: { z: Number.POSITIVE_INFINITY } }],
    ['invalid reliability', { 12: { visibility: Number.NaN } }],
  ])('rejects %s even if the remaining landmarks are reliable', (_, overrides) => {
    expect(extractPoseGeometry(pose(overrides as Record<number, Partial<Landmark>>), 640, 480).geometry).toBeNull();
  });

  it.each([
    ['low hip visibility', { 23: { visibility: 0.1 } }],
    ['low hip presence', { 24: { presence: 0.1 } }],
    ['out of frame hip', { 24: { y: 1.2 } }],
    ['hip clipped at edge', { 23: { y: 0.999 } }],
    ['nonfinite optional hip', { 23: { x: Number.NaN } }],
    ['tiny inferred torso', { 23: { y: 0.42 }, 24: { y: 0.42 } }],
    ['inverted inferred torso', { 23: { y: 0.3 }, 24: { y: 0.3 } }],
  ])('uses upper-body evidence when %s makes hips unusable', (_, overrides) => {
    const result = extractPoseGeometry(pose(overrides as Record<number, Partial<Landmark>>), 640, 480);
    expect(result.geometry).toMatchObject({ trackingMode: 'upper_body', forwardRatio: null, neckForwardRatio: null });
    expect(result.geometry?.upperBody?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('rejects degenerate or tiny upper bodies instead of using unreliable hip geometry', () => {
    const points = pose();
    for (const point of points) Object.assign(point, { x: 0.5, y: 0.5 });
    expect(extractPoseGeometry(points, 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(upperPose({ 11: { x: 0.499 }, 12: { x: 0.501 } }), 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(upperPose({ 0: { y: 0.99 } }), 640, 480).geometry).toBeNull();
  });

  it('accepts visible shoulders at the frame edge without inventing off-frame points', () => {
    expect(extractPoseGeometry(upperPose({ 11: { x: 0 }, 12: { x: 1 } }), 640, 480).geometry?.trackingMode).toBe('upper_body');
    expect(extractPoseGeometry(upperPose({ 11: { x: -0.001 } }), 640, 480).geometry).toBeNull();
  });

  it('combines moderate seated-crop presence with strong visibility while rejecting weak evidence', () => {
    const geometry = extractPoseGeometry(upperPose({ 11: { presence: 0.55, visibility: 0.95 } }), 640, 480).geometry;
    expect(geometry?.trackingMode).toBe('upper_body');
    expect(geometry?.confidence).toBeCloseTo(Math.sqrt(0.55 * 0.95));
    expect(geometry!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(extractPoseGeometry(upperPose({ 11: { presence: 0.1, visibility: 0.95 } }), 640, 480).geometry).toBeNull();
    expect(extractPoseGeometry(upperPose({ 0: { visibility: 0.59, presence: 0.99 } }), 640, 480).geometry).toBeNull();
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

  it('restarts calibration on genuine movement while tolerating a brief unreliable frame', () => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50));
    const moved = classifier.update(frame(750, pose({ 0: { y: 0.31 } })));
    expect(moved.reason).toBe('calibration_unstable');
    expect(moved.calibration.frames).toBe(1);
    const occluded = classifier.update(frame(800, pose({ 11: { visibility: 0.1 } })));
    expect(occluded.posture).toBe('UNKNOWN');
    expect(occluded.calibration.frames).toBe(1);
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

  it('immediately clears a previous bad label when no person, multiple people or missing core points are seen', () => {
    const classifier = calibrated();
    const slouch = pose({ 0: { y: 0.31 } });
    expect(stable(classifier, slouch).posture).toBe('SLOUCH');
    expect(classifier.update({ ...frame(2_200), landmarks: [] }).posture).toBe('NO_PERSON');
    const multiple = classifier.update({ ...frame(2_250), landmarks: [pose(), pose()] });
    expect(multiple).toMatchObject({ posture: 'UNKNOWN', confidence: 0, personDetected: true, reason: 'multiple_people' });
    expect(classifier.update(frame(2_300, pose({ 12: { y: 1.1 } }))).posture).toBe('UNKNOWN');
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

describe('seated upper-body tracking and calibration continuity', () => {
  it('requires calibration even when head and shoulders are reliable and hips are hidden', () => {
    const result = new PostureClassifier().update(frame(0, upperPose()));
    expect(result).toMatchObject({ posture: 'UNKNOWN', confidence: 0, reason: 'calibration_needed', personDetected: true });
    expect(result.geometry?.trackingMode).toBe('upper_body');
  });

  it('calibrates at a desk and distinguishes stable upper-body posture changes', () => {
    const neutral = upperPose();
    const collapsed = upperPose();
    for (const index of [0, 2, 5, 7, 8, 9, 10]) collapsed[index].y += 0.19;
    const lateral = upperPose({ 11: { y: 0.35 }, 12: { y: 0.45 } });
    const reclined = upperPose({
      11: { x: 0.404 }, 12: { x: 0.596 },
      7: { x: 0.452 }, 8: { x: 0.548 },
      9: { y: 0.28 }, 10: { y: 0.28 },
    });
    for (const [points, expected] of [
      [neutral, 'GOOD'], [upperForward(), 'LEAN_FORWARD'],
      [collapsed, 'SLOUCH'], [reclined, 'SLOUCH'], [lateral, 'LEAN_LEFT_RIGHT'],
    ] as const) {
      const result = stable(calibrated({}, neutral), points);
      expect(result.posture).toBe(expected);
      expect(result.reason).toBe('tracking_upper_body');
      expect(result.geometry?.trackingMode).toBe('upper_body');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('does not infer a posture change from a uniform size change alone', () => {
    const neutral = upperPose();
    const farther = neutral.map(point => ({ ...point, x: 0.5 + (point.x - 0.5) * 0.8, y: 0.5 + (point.y - 0.5) * 0.8 }));
    expect(stable(calibrated({}, neutral), farther).posture).toBe('GOOD');
  });

  it('calibrates continuously when optional hips alternate between visible and hidden', () => {
    const classifier = new PostureClassifier();
    const upper = upperPose();
    const full = withVisibleHips(upper);
    classifier.startCalibration();
    for (let index = 0; index < 30; index++) {
      const result = classifier.update(frame(index * 50, index % 2 ? full : upper));
      expect(result.calibration.frames).toBe(index + 1);
      expect(result.reason).not.toBe('calibration_unstable');
    }
    expect(stable(classifier, upper)).toMatchObject({ posture: 'GOOD', calibration: { status: 'ready' } });
    expect(stable(classifier, full, undefined, 2_200)).toMatchObject({ posture: 'GOOD', calibration: { status: 'ready' } });
  });

  it.each(['upper_to_full', 'full_to_upper'] as const)('preserves a calibrated baseline across %s visibility changes', (transition) => {
    const upper = upperPose();
    const full = withVisibleHips(upper);
    const classifier = calibrated({}, transition === 'upper_to_full' ? upper : full);
    expect(stable(classifier, transition === 'upper_to_full' ? full : upper)).toMatchObject({ posture: 'GOOD', calibration: { status: 'ready' } });
    const forward = transition === 'upper_to_full' ? withVisibleHips(upperForward()) : upperForward();
    expect(stable(classifier, forward, undefined, 2_200)).toMatchObject({ posture: 'LEAN_FORWARD', calibration: { status: 'ready' } });
  });

  it('preserves neutral samples across a brief weak frame but never counts the weak observation', () => {
    const classifier = new PostureClassifier();
    const neutral = upperPose();
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50, neutral));
    const weak = classifier.update(frame(750, upperPose({ 11: { visibility: 0.1 } })));
    expect(weak).toMatchObject({ posture: 'UNKNOWN', confidence: 0, calibration: { status: 'collecting', frames: 15 } });
    expect(classifier.update(frame(800, neutral)).calibration.frames).toBe(16);
    for (let index = 0; index < 14; index++) classifier.update(frame(850 + index * 50, neutral));
    expect(stable(classifier, neutral, undefined, 1_550)).toMatchObject({ posture: 'GOOD', calibration: { status: 'ready', frames: 30 } });
  });

  it('restarts collection after unreliable observations persist beyond the grace interval', () => {
    const classifier = new PostureClassifier();
    const neutral = upperPose();
    const weak = upperPose({ 11: { presence: 0.1 } });
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50, neutral));
    expect(classifier.update(frame(750, weak)).calibration.frames).toBe(15);
    expect(classifier.update(frame(1_450, weak)).calibration.frames).toBe(0);
    expect(classifier.update(frame(1_500, neutral)).calibration).toMatchObject({ status: 'collecting', frames: 1 });
  });

  it('keeps reliable samples across a sub-gap delay, but clears them after a genuine frame gap', () => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 15; index++) classifier.update(frame(index * 50, upperPose()));
    expect(classifier.update(frame(1_600, upperPose())).calibration.frames).toBe(16);
    expect(classifier.update(frame(3_200, upperPose())).calibration.frames).toBe(1);
  });

  it('still clears a stable upper-body label immediately when head or shoulder evidence is missing', () => {
    const classifier = calibrated({}, upperPose());
    expect(stable(classifier, upperForward()).posture).toBe('LEAN_FORWARD');
    expect(classifier.update(frame(2_200, upperPose({ 0: { x: Number.NaN } })))).toMatchObject({ posture: 'UNKNOWN', confidence: 0 });
    expect(classifier.update(frame(2_250, upperPose({ 12: { presence: 0.1 } })))).toMatchObject({ posture: 'UNKNOWN', confidence: 0 });
    expect(classifier.update({ ...frame(2_300), landmarks: [] }).posture).toBe('NO_PERSON');
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
