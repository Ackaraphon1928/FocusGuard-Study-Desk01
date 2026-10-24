import { describe, expect, it } from 'vitest';
import { initialVisionSnapshot, poseDescriptions, trackingHint } from './protocol';

describe('Python vision presentation', () => {
  it('defaults to a stopped, metadata-only backend without a preview', () => {
    expect(initialVisionSnapshot).toMatchObject({ status: 'idle', observation: null, previewEnabled: false, delegate: null, frames: 0 });
    expect(JSON.stringify(initialVisionSnapshot)).not.toMatch(/landmarks|data:image|frame:/);
  });

  it('describes all six backend posture labels for the user', () => {
    expect(Object.keys(poseDescriptions).sort()).toEqual(['GOOD', 'LEAN_FORWARD', 'LEAN_LEFT_RIGHT', 'NO_PERSON', 'SLOUCH', 'UNKNOWN']);
    expect(poseDescriptions.GOOD).toContain('นั่งตรง');
    expect(poseDescriptions.UNKNOWN).toContain('ยังประเมินไม่ได้');
  });

  it('turns backend reason codes into actionable tracking guidance', () => {
    expect(trackingHint('calibrating')).toContain('neutral baseline');
    expect(trackingHint('cropped_pose')).toContain('head and both shoulders');
    expect(trackingHint('multiple_people')).toContain('one person');
    expect(trackingHint('new_backend_reason')).toContain('calibrate while sitting upright');
  });
});
