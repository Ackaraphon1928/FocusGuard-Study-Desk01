import { describe, expect, it } from 'vitest';
import dataset from '../../test/fixtures/pc-dataset.landmarks.json';
import { extractPoseGeometry, PostureClassifier, type Landmark, type PoseFrame } from './posture';
import { observationMetadata } from './protocol';

type Sample = typeof dataset.images[number];
const good = dataset.images.find(sample => sample.label === 'GOOD')!;

function frame(sample: Sample, timestampMs: number, landmarks: Landmark[][] = sample.landmarks): PoseFrame {
  return { timestampMs, landmarks, worldLandmarks: sample.worldLandmarks, width: sample.width, height: sample.height };
}

function run(sample: Sample, transform: (sample: Sample) => Landmark[][] = sample => sample.landmarks) {
  const classifier = new PostureClassifier({ view: 'front' });
  classifier.startCalibration();
  for (let index = 0; index < 30; index++) classifier.update(frame(good, index * 100, transform(good)));
  let result = classifier.update(frame(sample, 3_000, transform(sample)));
  for (let index = 1; index < 15; index++) result = classifier.update(frame(sample, 3_000 + index * 100, transform(sample)));
  return result;
}

// These real extracted coordinates are tuning regressions, not held-out accuracy
// trials. The single GOOD screenshot also supplies the calibration reference.
describe('provided seated-webcam tuning regressions', () => {
  it.each(dataset.images)('labels $filename with hips outside the frame', sample => {
    const result = run(sample);
    expect(result.posture).toBe(sample.label);
    expect(result.geometry?.trackingMode).toBe('upper_body');
    expect(result.reason).toBe('tracking_upper_body');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(sample.landmarks[0].slice(23, 25).every(point => point.y > 1)).toBe(true);
    const metadata = observationMetadata({ type: 'result', result, landmarks: sample.landmarks, people: 1, fps: 10, inferenceMs: 30, width: sample.width, height: sample.height });
    expect(metadata.posture).toBe(sample.label);
    expect(metadata.confidence).toBeGreaterThanOrEqual(0.6);
    expect(Object.keys(metadata)).not.toContain('landmarks');
  });

  it.each(dataset.images)('preserves $filename under mirrored capture', sample => {
    expect(run(sample, input => input.landmarks.map(points => points.map(point => ({ ...point, x: 1 - point.x })))).posture).toBe(sample.label);
  });

  it.each(dataset.images)('tolerates small landmark jitter for $filename', sample => {
    const jitter = (input: Sample) => input.landmarks.map(points => points.map((point, index) => ({
      ...point, x: point.x + (index % 2 ? 1 : -1) / input.width,
      y: point.y + (index % 3 ? 1 : -1) / input.height,
    })));
    expect(run(sample, jitter).posture).toBe(sample.label);
  });

  it.each([0.8, 1.2])('does not confuse uniform image-size change (%s×) with forward lean or reclining', scale => {
    const classifier = new PostureClassifier();
    classifier.startCalibration();
    for (let index = 0; index < 30; index++) classifier.update(frame(good, index * 100));
    const center = { x: (good.landmarks[0][11].x + good.landmarks[0][12].x) / 2, y: (good.landmarks[0][11].y + good.landmarks[0][12].y) / 2 };
    const points = good.landmarks.map(pose => pose.map(point => ({ ...point, x: center.x + (point.x - center.x) * scale, y: center.y + (point.y - center.y) * scale })));
    classifier.update(frame(good, 3_000, points));
    expect(classifier.update(frame(good, 3_700, points)).posture).toBe('GOOD');
  });

  it('does not classify an occluded head or shoulder using invented hips', () => {
    for (const index of [0, 11, 12]) {
      const points = good.landmarks[0].map((point, current) => current === index ? { ...point, visibility: 0.1 } : point);
      expect(extractPoseGeometry(points, good.width, good.height).geometry).toBeNull();
    }
  });

  it('keeps the sparse dataset provenance explicit', () => {
    expect(dataset.images).toHaveLength(7);
    expect(dataset.images.filter(sample => sample.label === 'GOOD')).toHaveLength(1);
    expect(dataset.provenance.sdk_version).toBe('0.10.32');
    expect(dataset.provenance.running_mode).toBe('VIDEO');
    expect(dataset.provenance.model_sha256).toBe('59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a');
  });
});
