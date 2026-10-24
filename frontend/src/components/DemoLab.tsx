import { useState } from 'react';
import { Check, PersonStanding, Ruler, Moon, Volume2, Thermometer, Coffee, CameraOff, ScanEye, WifiOff, Info, FlaskConical } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage, formatNumber, humanize } from '../lib/format';
import { useDesk, useDeskMutation } from '../lib/queries';
import type { DeskState, Scenario, Settings } from '../lib/types';
import { Button, ErrorNotice, Modal } from './ui';
import { useToast } from './ToastProvider';

export const demoScenarios = [
  { id: 'normal', title: 'In balance', description: 'Upright, quiet & comfortable', icon: Check },
  { id: 'slouch', title: 'A little slouch', description: 'Sustained posture warning', icon: PersonStanding },
  { id: 'too_close', title: 'Leaning too close', description: 'Distance + vision fusion', icon: Ruler },
  { id: 'dark', title: 'Lights down', description: 'Watch the desk lamp adapt', icon: Moon },
  { id: 'noisy', title: 'A noisy room', description: 'Relative sound level rises', icon: Volume2 },
  { id: 'hot', title: 'Feeling the heat', description: 'Automatic fan control', icon: Thermometer },
  { id: 'away', title: 'Step away', description: 'Occupancy pauses the session', icon: Coffee },
  { id: 'camera_offline', title: 'Camera disconnected', description: 'Other sensors keep working', icon: CameraOff },
  { id: 'occluded', title: 'An uncertain pose', description: 'Low-confidence vision case', icon: ScanEye },
  { id: 'network_offline', title: 'Sensor network offline', description: 'Stale readings become unknown', icon: WifiOff },
] satisfies {id: Scenario; title: string; description: string; icon: typeof Check}[];

export function DemoLab({ open, onClose }: {open: boolean; onClose: () => void}) {
  const { data: state } = useDesk();
  const { notify } = useToast();
  const [fast, setFast] = useState(false);
  const scenarioMutation = useDeskMutation<Scenario>(scenario => api<DeskState>('/demo', { method: 'POST', body: JSON.stringify({ scenario }) }));
  const timingMutation = useDeskMutation<Partial<Settings>, Settings>(settings => api<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(settings) }));
  const rules = state?.rules.filter(r => r.active || r.cooldown_remaining_seconds > 0) ?? [];
  async function choose(scenario: Scenario) {
    try { await scenarioMutation.mutateAsync(scenario); notify(`${demoScenarios.find(item => item.id === scenario)?.title ?? 'Demo'} scenario is running.`); }
    catch (error) { notify(errorMessage(error), 'error'); }
  }
  async function enableFastRules() {
    try {
      await timingMutation.mutateAsync({ posture_warning_seconds: 3, distance_warning_seconds: 2, noise_warning_seconds: 3, warning_cooldown_seconds: 10, break_interval_minutes: .5, eye_break_interval_minutes: .33, break_duration_seconds: 20, occupancy_pause_seconds: 3, occupancy_end_minutes: 1 });
      setFast(true); notify('Presentation timing enabled. Change thresholds in Rules & settings to restore normal timing.');
    } catch (error) { notify(errorMessage(error), 'error'); }
  }
  return <Modal drawer open={open} onClose={onClose} title="The demo lab" description="Change the conditions at your virtual desk and watch FocusGuard respond. No hardware needed.">
    <div className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-pine"><FlaskConical className="size-4" />Live simulated sensors. Real rules.</div>
    <ErrorNotice error={scenarioMutation.error || timingMutation.error} />
    <div className="mt-3 grid grid-cols-2 gap-2.5">{demoScenarios.map(({ id, title, description, icon: Icon }) => <button key={id} onClick={() => void choose(id)} disabled={scenarioMutation.isPending || state?.mode !== 'demo'} aria-pressed={state?.scenario === id} className={`flex min-h-28 flex-col items-start rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${state?.scenario === id ? 'border-sage bg-sage-light' : 'border-line hover:bg-sage-light/50'}`}><Icon className="mb-3 size-5 text-sage" /><strong className="text-xs font-semibold text-ink">{title}</strong><span className="mt-1.5 text-[10px] leading-5 text-muted">{description}</span></button>)}</div>
    <div className="mt-5 rounded-xl border border-line bg-canvas p-4"><h3 className="text-xs font-semibold">What your desk is noticing</h3>{rules.length ? rules.map(rule => <div key={rule.id} className="mt-3 flex justify-between gap-3 text-[11px]"><span className="text-muted">{humanize(rule.id)}</span><strong className="font-medium text-amber-700">{rule.cooldown_remaining_seconds > 0 ? `${Math.ceil(rule.cooldown_remaining_seconds)}s cooldown` : `${formatNumber(rule.elapsed_seconds, 1)}s / ${formatNumber(rule.threshold_seconds)}s`}</strong></div>) : <p className="mt-2 text-xs leading-6 text-muted">FocusGuard waits for a sustained condition. One uncertain frame won’t trigger a warning.</p>}</div>
    <div className="my-6 flex items-center gap-4"><div><h3 className="text-xs font-semibold">Presentation timing</h3><p className="mt-2 text-xs leading-6 text-muted">Shorter delays and a 30-second break interval. These settings persist until changed.</p></div><Button variant="secondary" onClick={() => void enableFastRules()} disabled={timingMutation.isPending} className="shrink-0">{fast ? 'Fast rules enabled' : 'Enable fast rules'}</Button></div>
    <div className="flex gap-3 rounded-xl bg-sage-light p-4 text-xs leading-6 text-muted"><Info className="mt-1 size-4 shrink-0 text-sage" /><p>Demo readings, confidence, and FPS are simulated. Physical devices are never controlled in demo mode.</p></div>
  </Modal>;
}
