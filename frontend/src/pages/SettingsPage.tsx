import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Camera, Check, Fan, LampDesk, LockKeyhole, SlidersHorizontal } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { api } from '../lib/api';
import { useDesk, useDeskMutation } from '../lib/queries';
import type { ActuatorState, DeskState, Settings } from '../lib/types';
import { numericSettingFields, settingsSchema, type NumericSettingName, type SettingsForm } from '../lib/settings-schema';
import { useToast } from '../components/ToastProvider';
import { Badge, Button, Card, ErrorNotice, LoadingState } from '../components/ui';

const inputClassName = 'mt-2 block w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50';
type ActuatorCommand = Partial<Pick<ActuatorState, 'lamp_mode' | 'lamp_percent' | 'fan_mode' | 'fan'>>;
const weightFields = [
  { name: 'lighting', label: 'Lighting', color: 'bg-emerald-600' },
  { name: 'noise', label: 'Noise', color: 'bg-emerald-400' },
  { name: 'thermal', label: 'Thermal comfort', color: 'bg-lime-400' },
  { name: 'posture', label: 'Posture', color: 'bg-amber-300' },
  { name: 'distance', label: 'Distance', color: 'bg-teal-400' },
] as const;

function NumericField({ name, register, errors }: {
  name: NumericSettingName;
  register: UseFormRegister<SettingsForm>;
  errors: FieldErrors<SettingsForm>;
}) {
  const field = numericSettingFields[name];
  const error = errors[name];
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium text-stone-700">{field.label} <span className="font-normal text-stone-400">({field.unit})</span></label>
      <input id={name} type="number" min={field.min} max={field.max} step={field.step} className={inputClassName}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined}
        {...register(name, { valueAsNumber: true })} />
      {error && <p id={`${name}-error`} className="mt-1.5 text-xs text-red-700">{error.message}</p>}
    </div>
  );
}

function SettingToggle({ name, title, description, register }: {
  name: 'auto_session' | 'adaptive_reminders' | 'buzzer_enabled' | 'cloud_ai_consent';
  title: string;
  description: string;
  register: UseFormRegister<SettingsForm>;
}) {
  return (
    <label htmlFor={name} className="flex cursor-pointer items-start justify-between gap-5 border-t border-stone-100 py-5 last:pb-0">
      <span><span className="block text-sm font-semibold text-stone-800">{title}</span><span id={`${name}-description`} className="mt-1 block max-w-lg text-xs leading-relaxed text-stone-500">{description}</span></span>
      <span className="relative mt-0.5 inline-flex shrink-0 items-center">
        <input id={name} type="checkbox" className="peer sr-only" aria-describedby={`${name}-description`} {...register(name)} />
        <span className="h-6 w-11 rounded-full bg-stone-200 transition peer-checked:bg-emerald-700 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2" />
        <span className="pointer-events-none absolute left-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="p-5 sm:p-6"><h2 className="text-lg font-semibold tracking-tight text-stone-900">{title}</h2><p className="mb-6 mt-2 text-sm leading-relaxed text-stone-500">{description}</p>{children}</Card>;
}

function DeskControls({ actuators, mode }: { actuators: ActuatorState; mode: DeskState['mode'] }) {
  const { notify } = useToast();
  const [brightnessDraft, setBrightnessDraft] = useState<number | null>(null);
  const brightness = brightnessDraft ?? actuators.lamp_percent;
  const inFlight = useRef(false);
  const change = useDeskMutation<ActuatorCommand, ActuatorState>((values) => api<ActuatorState>('/actuators', { method: 'POST', body: JSON.stringify(values) }));

  const update = async (values: ActuatorCommand) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await change.mutateAsync(values);
      notify(mode === 'demo' ? 'Simulated desk controls updated.' : 'Desk control request sent.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update desk controls.', 'error');
    } finally {
      setBrightnessDraft(null);
      inFlight.current = false;
    }
  };
  const commitBrightness = (value: number) => {
    if (inFlight.current) return;
    if (value === actuators.lamp_percent) {
      setBrightnessDraft(null);
      return;
    }
    void update({ lamp_mode: 'manual', lamp_percent: value });
  };

  return (
    <SettingsSection title="Desk controls" description="Let your desk adapt, or choose the settings for this moment.">
      <div className="space-y-6">
        <div>
          <div className="mb-3 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-stone-800"><LampDesk className="size-4 text-emerald-700" />Desk lamp</span><output htmlFor="lamp-level" className="tabular-nums text-stone-500">{mode === 'hardware' ? 'Requested ' : ''}{Math.round(brightness)}%</output></div>
          <div className="flex items-center gap-4">
            <select id="lamp-mode" aria-label="Lamp mode" className={`${inputClassName} mt-0 w-36 shrink-0`} value={actuators.lamp_mode} disabled={change.isPending} onChange={(event) => void update({ lamp_mode: event.target.value as ActuatorState['lamp_mode'] })}>
              <option value="auto">Automatic</option><option value="manual">Manual</option>
            </select>
            <input id="lamp-level" type="range" min="0" max="100" step="5" value={brightness} aria-label="Lamp brightness" aria-valuetext={`${Math.round(brightness)} percent`} className="min-w-0 flex-1 accent-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" disabled={actuators.lamp_mode === 'auto' || change.isPending}
              onChange={(event) => setBrightnessDraft(Number(event.target.value))}
              onPointerUp={(event) => commitBrightness(Number(event.currentTarget.value))} onPointerCancel={(event) => commitBrightness(Number(event.currentTarget.value))} onKeyUp={(event) => commitBrightness(Number(event.currentTarget.value))} onBlur={(event) => commitBrightness(Number(event.currentTarget.value))} />
          </div>
        </div>
        <div className="border-t border-stone-100 pt-5">
          <div className="mb-3 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-stone-800"><Fan className="size-4 text-emerald-700" />Desk fan</span><span className="text-stone-500">{mode === 'hardware' ? 'Requested ' : ''}{actuators.fan ? 'On' : 'Off'}</span></div>
          <div className="flex items-center justify-between gap-4">
            <select id="fan-mode" aria-label="Fan mode" className={`${inputClassName} mt-0 w-36 shrink-0`} value={actuators.fan_mode} disabled={change.isPending} onChange={(event) => void update({ fan_mode: event.target.value as ActuatorState['fan_mode'] })}>
              <option value="auto">Automatic</option><option value="manual">Manual</option>
            </select>
            <label htmlFor="fan-power" className="inline-flex items-center gap-2 text-sm text-stone-600"><input id="fan-power" type="checkbox" className="size-4 rounded accent-emerald-700" checked={actuators.fan} disabled={actuators.fan_mode === 'auto' || change.isPending} onChange={(event) => void update({ fan_mode: 'manual', fan: event.target.checked })} />Fan power</label>
          </div>
        </div>
      </div>
      <ErrorNotice error={change.error} />
      <p className="mt-5 text-xs leading-relaxed text-stone-400" aria-live="polite">{change.isPending ? 'Applying desk controls…' : mode === 'demo' ? 'Controls apply immediately to the simulated desk. Brightness applies when you release the slider.' : 'Requests are sent to the local gateway. Devices shows the latest hardware acknowledgment. Brightness sends when you release the slider.'}</p>
    </SettingsSection>
  );
}

function PreferencesForm({ state }: { state: DeskState }) {
  const { notify } = useToast();
  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<SettingsForm>({ resolver: zodResolver(settingsSchema), mode: 'onBlur', defaultValues: state.settings });
  const watchedWeights = useWatch({ control, name: 'weights' });
  const save = useDeskMutation<SettingsForm, Settings>((values) => api<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(values) }));

  const weights = watchedWeights ?? state.settings.weights;
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const submit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(values);
      reset(saved);
      notify('Preferences saved. Your desk is up to date.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save your preferences.', 'error');
    }
  }, () => notify('Check the highlighted settings before saving.', 'error'));
  const fields = (names: NumericSettingName[]) => <div className="grid gap-5 sm:grid-cols-2">{names.map((name) => <NumericField key={name} name={name} register={register} errors={errors} />)}</div>;

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-5 py-4">
        <div className="flex items-center gap-3"><SlidersHorizontal className="size-5 text-emerald-700" /><p className="text-sm text-emerald-900">Your rules, reminders, and privacy choices.</p></div>
        <Badge tone={isDirty ? 'warning' : 'good'}>{isDirty ? 'Unsaved changes' : 'Preferences up to date'}</Badge>
      </div>
      <fieldset disabled={save.isPending} className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
        <legend className="sr-only">Desk preferences</legend>
        <div className="space-y-6">
          <SettingsSection title="Your ergonomic boundaries" description="Starting points for your prototype. Calibrate for the person and camera position at your desk.">
            {fields(['distance_min_cm', 'distance_max_cm', 'posture_warning_seconds', 'distance_warning_seconds', 'confidence_min', 'warning_cooldown_seconds'])}
          </SettingsSection>
          <SettingsSection title="Make time to step away" description="Reminders that fit your rhythm. A full movement break resets continuous sitting time.">
            {fields(['break_interval_minutes', 'eye_break_interval_minutes', 'break_duration_seconds', 'occupancy_pause_seconds', 'occupancy_end_minutes', 'sensor_stale_seconds'])}
            <div className="mt-6"><SettingToggle name="auto_session" title="Automatic session detection" description="Start and pause using seat, vision, and motion signals." register={register} /><SettingToggle name="adaptive_reminders" title="Adaptive reminders" description="Shorten the movement reminder interval by 20% while the condition score is below 60." register={register} /></div>
          </SettingsSection>
          <SettingsSection title="A comfortable environment" description="Lighting, noise, and temperature rules are configurable engineering parameters.">
            {fields(['light_target_lux', 'temperature_fan_c', 'noise_threshold', 'noise_warning_seconds'])}
            <div className="mt-6"><SettingToggle name="buzzer_enabled" title="Gentle audible reminders" description="Allow short buzzer pulses, with a cooldown between warnings." register={register} /></div>
          </SettingsSection>
          <SettingsSection title="Your score, explained" description="Five suitability values, one weighted score. Weights must add up to 1.">
            <fieldset aria-describedby="weight-total weight-note">
              <legend className="sr-only">Study Condition Score weights</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                {weightFields.map(({ name, label, color }) => <div key={name}><label htmlFor={`weight-${name}`} className="flex items-center gap-2 text-sm font-medium text-stone-700"><span className={`size-2 rounded-full ${color}`} />{label} weight</label><input id={`weight-${name}`} type="number" min="0" max="1" step="0.01" className={inputClassName} aria-invalid={Boolean(errors.weights?.[name])} aria-describedby={errors.weights?.[name] ? `weight-${name}-error` : 'weight-total'} {...register(`weights.${name}`, { valueAsNumber: true })} />{errors.weights?.[name] && <p id={`weight-${name}-error`} className="mt-1.5 text-xs text-red-700">{errors.weights?.[name]?.message}</p>}</div>)}
              </div>
              <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">{weightFields.map(({ name, color }) => <span key={name} className={color} style={{ flexGrow: Number.isFinite(weights[name]) ? Math.max(0, weights[name]) : 0 }} />)}</div>
              <p id="weight-total" className={`mt-3 text-xs font-medium tabular-nums ${Math.abs(weightTotal - 1) <= 0.001 ? 'text-emerald-700' : 'text-amber-700'}`} aria-live="polite">Total weight: {weightTotal.toFixed(3)} / 1.000</p>
              {errors.weights?.message && <p role="alert" className="mt-2 text-xs text-red-700">{errors.weights.message}</p>}
              <p id="weight-note" className="mt-3 text-xs leading-relaxed text-stone-400">This measures observable study conditions. It does not infer mental focus or clinical health.</p>
            </fieldset>
          </SettingsSection>
        </div>
        <div className="space-y-6">
          <SettingsSection title="Keep it close. Keep it private." description="Privacy is the default behavior of your desk.">
            <div className="mb-5 flex items-center justify-center gap-3 rounded-xl bg-stone-50 p-4 text-xs text-stone-600"><Camera className="size-4 text-emerald-700" /><span>Local camera</span><ArrowRight className="size-4 text-stone-400" /><span>Pose metadata</span></div>
            <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-stone-800">Local camera processing</p><p className="mt-1 text-xs leading-relaxed text-stone-500">Raw frames stay in the capturing PC browser or Raspberry Pi. No video upload or audio recording.</p></div><Badge tone="good">Local only</Badge></div>
            <SettingToggle name="cloud_ai_consent" title="Optional AI session summaries" description="Allow aggregate session statistics to be sent to AWS Bedrock. Off by default. Requires server credentials." register={register} />
            <p className="mt-5 text-xs leading-relaxed text-stone-400">Without cloud AI, your session statistics and local rule-based summaries remain available.</p>
          </SettingsSection>
          <DeskControls key={state.mode} actuators={state.actuators} mode={state.mode} />
          <SettingsSection title="Camera calibration" description="Sit upright at your usual distance, with your head, shoulders and hips visible.">
            <p className="mb-4 text-xs leading-relaxed text-stone-500">For the PC demo, open the camera lab, choose Front or Side, start the camera and select Calibrate upright posture. The neutral baseline stays in browser memory.</p>
            <a href="#/overview" className="mb-5 inline-flex text-xs font-semibold text-pine underline underline-offset-4">Open PC camera lab</a>
            <p className="mb-2 text-xs text-stone-500">For the Raspberry Pi hardware gateway:</p>
            <code className="block overflow-x-auto rounded-xl bg-stone-900 p-4 text-xs leading-relaxed text-stone-100">python -m raspberry_pi.gateway --calibrate --preview</code>
            <p className="mt-4 text-xs leading-relaxed text-stone-400">Moving the camera changes pose geometry. Recalibrate after changing its position.</p>
          </SettingsSection>
          <div className="flex items-start gap-3 px-2 py-1 text-xs leading-relaxed text-stone-500"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-700" /><p>These settings are stored locally and applied by the same decision engine in both demo and hardware modes.</p></div>
        </div>
      </fieldset>
      <ErrorNotice error={save.error} />
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white/95 px-5 py-4 shadow-lg shadow-stone-900/5 backdrop-blur-sm">
        <p className="text-sm text-stone-500">Small adjustments. A more comfortable workspace.</p>
        <Button type="submit" disabled={save.isPending}><Check className="size-4" />{save.isPending ? 'Saving preferences…' : 'Save preferences'}</Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const desk = useDesk();
  if (!desk.data) return desk.error ? <ErrorNotice error={desk.error} /> : <LoadingState message="Loading your desk preferences…" />;
  return <PreferencesForm key={desk.data.mode} state={desk.data} />;
}
