import { z } from 'zod';

export const numericSettingFields = {
  distance_min_cm: { label: 'Minimum viewing distance', unit: 'cm', min: 10, max: 150, step: 1 },
  distance_max_cm: { label: 'Maximum viewing distance', unit: 'cm', min: 20, max: 250, step: 1 },
  posture_warning_seconds: { label: 'Sustained posture warning', unit: 'sec', min: 1, max: 600, step: 1 },
  distance_warning_seconds: { label: 'Distance warning delay', unit: 'sec', min: 1, max: 300, step: 1 },
  noise_warning_seconds: { label: 'Sustained noise warning', unit: 'sec', min: 1, max: 600, step: 1 },
  warning_cooldown_seconds: { label: 'Reminder cooldown', unit: 'sec', min: 1, max: 3600, step: 1 },
  break_interval_minutes: { label: 'Movement break every', unit: 'min', min: 0.1, max: 180, step: 0.1 },
  eye_break_interval_minutes: { label: 'Look-away reminder every', unit: 'min', min: 0.1, max: 120, step: 0.01 },
  break_duration_seconds: { label: 'Movement break duration', unit: 'sec', min: 5, max: 1800, step: 1 },
  occupancy_pause_seconds: { label: 'Pause when away after', unit: 'sec', min: 1, max: 300, step: 1 },
  occupancy_end_minutes: { label: 'End inactive session after', unit: 'min', min: 0.5, max: 240, step: 0.1 },
  sensor_stale_seconds: { label: 'Sensor freshness limit', unit: 'sec', min: 2, max: 300, step: 1 },
  light_target_lux: { label: 'Target lighting', unit: 'lux', min: 50, max: 2000, step: 1 },
  temperature_fan_c: { label: 'Turn fan on above', unit: '°C', min: 18, max: 40, step: 0.5 },
  noise_threshold: { label: 'Relative noise threshold', unit: '0–1', min: 0.05, max: 1, step: 0.05 },
  confidence_min: { label: 'Minimum pose confidence', unit: '0–1', min: 0.1, max: 1, step: 0.05 },
} as const;

export type NumericSettingName = keyof typeof numericSettingFields;

const numericSetting = (name: NumericSettingName) => {
  const { label, min, max } = numericSettingFields[name];
  return z.number().finite().min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);
};

const weight = z.number().finite().min(0, 'Use a weight between 0 and 1.').max(1, 'Use a weight between 0 and 1.');

export const settingsSchema = z.object({
  distance_min_cm: numericSetting('distance_min_cm'),
  distance_max_cm: numericSetting('distance_max_cm'),
  posture_warning_seconds: numericSetting('posture_warning_seconds'),
  distance_warning_seconds: numericSetting('distance_warning_seconds'),
  noise_warning_seconds: numericSetting('noise_warning_seconds'),
  warning_cooldown_seconds: numericSetting('warning_cooldown_seconds'),
  break_interval_minutes: numericSetting('break_interval_minutes'),
  eye_break_interval_minutes: numericSetting('eye_break_interval_minutes'),
  break_duration_seconds: numericSetting('break_duration_seconds'),
  occupancy_pause_seconds: numericSetting('occupancy_pause_seconds'),
  occupancy_end_minutes: numericSetting('occupancy_end_minutes'),
  sensor_stale_seconds: numericSetting('sensor_stale_seconds'),
  light_target_lux: numericSetting('light_target_lux'),
  temperature_fan_c: numericSetting('temperature_fan_c'),
  noise_threshold: numericSetting('noise_threshold'),
  confidence_min: numericSetting('confidence_min'),
  auto_session: z.boolean(),
  adaptive_reminders: z.boolean(),
  buzzer_enabled: z.boolean(),
  cloud_ai_consent: z.boolean(),
  weights: z.object({ lighting: weight, noise: weight, thermal: weight, posture: weight, distance: weight }),
}).superRefine((settings, context) => {
  if (settings.distance_max_cm <= settings.distance_min_cm) {
    context.addIssue({ code: 'custom', path: ['distance_max_cm'], message: 'Maximum viewing distance must exceed the minimum.' });
  }
  const total = Object.values(settings.weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.001) {
    context.addIssue({ code: 'custom', path: ['weights'], message: `Weights add up to ${total.toFixed(3)}. Adjust them to total 1.00.` });
  }
});

export type SettingsForm = z.infer<typeof settingsSchema>;
