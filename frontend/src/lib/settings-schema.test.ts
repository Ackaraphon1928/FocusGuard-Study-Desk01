import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings-schema';
import type { Settings } from './types';

// Independent API contract fixture: backend/API.md default settings.
const defaults: Settings = {
  distance_min_cm: 40,
  distance_max_cm: 80,
  posture_warning_seconds: 30,
  distance_warning_seconds: 5,
  noise_warning_seconds: 10,
  warning_cooldown_seconds: 60,
  break_interval_minutes: 45,
  eye_break_interval_minutes: 20,
  break_duration_seconds: 120,
  occupancy_pause_seconds: 15,
  occupancy_end_minutes: 15,
  sensor_stale_seconds: 15,
  light_target_lux: 400,
  temperature_fan_c: 28,
  noise_threshold: 0.65,
  confidence_min: 0.6,
  auto_session: true,
  adaptive_reminders: true,
  buzzer_enabled: true,
  cloud_ai_consent: false,
  weights: { lighting: 0.15, noise: 0.15, thermal: 0.15, posture: 0.30, distance: 0.25 },
};

const contractBounds = [
  ['distance_min_cm', 10, 150],
  ['distance_max_cm', 20, 250],
  ['posture_warning_seconds', 1, 600],
  ['distance_warning_seconds', 1, 300],
  ['noise_warning_seconds', 1, 600],
  ['warning_cooldown_seconds', 1, 3600],
  ['break_interval_minutes', 0.1, 180],
  ['eye_break_interval_minutes', 0.1, 120],
  ['break_duration_seconds', 5, 1800],
  ['occupancy_pause_seconds', 1, 300],
  ['occupancy_end_minutes', 0.5, 240],
  ['sensor_stale_seconds', 2, 300],
  ['light_target_lux', 50, 2000],
  ['temperature_fan_c', 18, 40],
  ['noise_threshold', 0.05, 1],
  ['confidence_min', 0.1, 1],
] as const;

describe('settings API contract validation', () => {
  it('accepts the documented defaults without changing consent or weights', () => {
    expect(settingsSchema.parse(defaults)).toEqual(defaults);
  });

  it('accepts documented lower and upper bounds, including fractional timing', () => {
    const lower = Object.fromEntries(contractBounds.map(([name, min]) => [name, min]));
    const upper = Object.fromEntries(contractBounds.map(([name, , max]) => [name, max]));
    expect(settingsSchema.safeParse({ ...defaults, ...lower }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...defaults, ...upper }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...defaults, eye_break_interval_minutes: 0.33, break_interval_minutes: 0.5 }).success).toBe(true);
  });

  it.each(contractBounds)('rejects %s outside the API range', (name, min, max) => {
    for (const value of [min - 0.01, max + 0.01]) {
      const result = settingsSchema.safeParse({ ...defaults, [name]: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === name)).toBe(true);
    }
  });

  it.each([40, 39])('rejects a maximum distance of %s when the minimum is 40', (distance_max_cm) => {
    const result = settingsSchema.safeParse({ ...defaults, distance_max_cm });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['distance_max_cm'] })]));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects missing or nonfinite numeric inputs (%s)', (distance_min_cm) => {
    expect(settingsSchema.safeParse({ ...defaults, distance_min_cm }).success).toBe(false);
  });

  it('requires all five weights and a total within the API tolerance', () => {
    expect(settingsSchema.safeParse({ ...defaults, weights: { lighting: 0.5, posture: 0.5 } }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaults, weights: { ...defaults.weights, posture: 0.3005 } }).success).toBe(true);
    const result = settingsSchema.safeParse({ ...defaults, weights: { ...defaults.weights, posture: 0.4 } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['weights'] })]));
  });

  it('rejects negative or oversized weights even when the total remains one', () => {
    expect(settingsSchema.safeParse({ ...defaults, weights: { lighting: -0.2, noise: 0, thermal: 0, posture: 1.2, distance: 0 } }).success).toBe(false);
  });

  it.each(['auto_session', 'adaptive_reminders', 'buzzer_enabled', 'cloud_ai_consent'])('requires %s to be a boolean', (name) => {
    expect(settingsSchema.safeParse({ ...defaults, [name]: 'true' }).success).toBe(false);
  });
});
