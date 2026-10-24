import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Check, Clock3, Coffee, Droplets, Fan, Info, Lightbulb, Pause, PersonStanding, Play, Ruler, ShieldCheck, Sun, Thermometer, Volume2, Zap, type LucideIcon } from 'lucide-react';
import { api } from '../lib/api';
import { clamp, errorMessage, formatDuration, formatNumber, formatTime, postureLabel, shortDuration } from '../lib/format';
import { useDesk, useDeskMutation, useEvents, useHistory } from '../lib/queries';
import type { ControlAction, DeskState } from '../lib/types';
import { Card, Button, Badge, ErrorNotice, LoadingState } from '../components/ui';
import { useToast } from '../components/ToastProvider';
import { DeskIllustration } from '../components/DeskIllustration';
import { PcCameraPanel } from '../components/PcCameraPanel';
import { EventsList, LiveLabel } from '../components/EventsList';
import { HistoryChart, historyMetrics, type HistoryMetric } from '../components/charts/HistoryChart';

function SensorCard({ label, icon: Icon, value, unit, description, warning = false }: {label: string; icon: LucideIcon; value: string; unit?: string; description: string; warning?: boolean}) {
  return <Card className="min-w-0 p-4"><div className="flex items-center gap-2 text-[11px] text-muted"><Icon className="size-3.5 shrink-0 text-sage" />{label}</div><div className="mt-4 truncate text-2xl font-semibold tracking-tight text-ink" title={`${value} ${unit ?? ''}`}>{value}{unit && <span className="ml-1 text-xs font-normal tracking-normal text-muted">{unit}</span>}</div><div className={`mt-2 flex items-start gap-1.5 text-[10px] leading-5 ${warning ? 'text-amber-700' : 'text-muted'}`}><span className={`mt-2 size-1 shrink-0 rounded-full ${warning ? 'bg-amber-500' : 'bg-sage'}`} />{description}</div></Card>;
}

function ScoreCard({ state }: {state: DeskState}) {
  const score = state.score.total;
  const good = score != null && score >= 80;
  return <Card className="flex min-h-80 flex-col border-pine-dark bg-pine-dark! p-5 text-white"><div className="flex items-center justify-between text-xs text-white/75"><h2>Study Condition Score</h2><span title="A configurable score of observed desk conditions, not mental focus."><Info className="size-3.5" /></span></div><div className="relative mx-auto my-2 flex size-48 items-center justify-center"><svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-233" aria-hidden="true"><circle cx="100" cy="100" r="78" fill="none" stroke="#3c6653" strokeWidth="9" strokeDasharray="390 490" strokeLinecap="round" /><circle cx="100" cy="100" r="78" fill="none" stroke="#c7e1a4" strokeWidth="9" strokeDasharray={`${clamp(score ?? 0) / 100 * 390} 490`} strokeLinecap="round" /></svg><div className="mt-3 text-center"><div className="text-6xl font-medium tracking-[-3px] tabular-nums">{formatNumber(score)}</div><p className="mt-2 text-[10px] tracking-widest text-white/50">OUT OF 100</p></div></div><div className="-mt-3 flex items-center justify-center gap-1.5 text-xs text-lime">{good ? <Check className="size-3.5" /> : <Info className="size-3.5" />}{score == null ? 'Not enough data' : good ? 'In a good place' : score >= 60 ? 'Room to improve' : 'A little attention needed'}</div><p className="mt-2 text-center text-[10px] leading-6 text-white/55">{good ? 'Your desk conditions are looking good.' : 'Small adjustments can make a difference.'}</p><div className="mt-auto flex justify-between gap-2 border-t border-white/10 pt-3 text-[9px] text-white/50"><span className="flex items-center gap-1"><ShieldCheck className="size-3" />Conditions, not concentration</span><span>{formatNumber(state.score.coverage_percent)}% coverage</span></div></Card>;
}

export function OverviewPage() {
  const desk = useDesk();
  const state = desk.data;
  const mode = state?.mode ?? 'demo';
  const history = useHistory(mode);
  const events = useEvents(mode);
  const [metric, setMetric] = useState<HistoryMetric>('score');
  const { notify } = useToast();
  const controls = useDeskMutation<ControlAction>(action => api<DeskState>('/control', { method: 'POST', body: JSON.stringify({ action }) }));
  if (!state) return <><ErrorNotice error={desk.error} /><LoadingState /></>;
  const { sensors: s, actuators: a, session, settings } = state;
  const pcCamera = state.vision_source === 'pc_camera';
  const active = session?.state === 'ACTIVE';
  const onBreak = session?.state === 'BREAK';
  const sitting = session?.continuous_sitting_seconds ?? 0;
  const interval = session?.break_interval_effective_seconds ?? settings.break_interval_minutes * 60;
  const remaining = session?.break_due_in_seconds ?? Math.max(0, interval - sitting);
  const validPose = s.vision_available && s.person_detected && s.confidence != null && s.confidence >= settings.confidence_min;
  async function control(action: ControlAction) {
    try {
      await controls.mutateAsync(action);
      notify(({ start: 'Your session is ready.', pause: 'Session paused. Take your time.', resume: 'Welcome back to your desk.', end: 'Session saved. Your reflection is being prepared in Session history.', break: 'Step away, stretch, and take a breath.', finish_break: 'Welcome back to your desk.' })[action]);
    } catch (error) { notify(errorMessage(error), 'error'); }
  }
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><h2 className="text-base font-semibold tracking-tight">Your desk, at a glance</h2><LiveLabel demo={mode === 'demo'} pcCamera={pcCamera} offline={desk.isError} /></div>
    <ErrorNotice error={controls.error} />
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1.2fr_1fr]">
      <ScoreCard state={state} /><DeskIllustration state={state} />
      <Card className="flex min-h-80 flex-col p-5 lg:col-span-2 xl:col-span-1"><div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-xs text-muted"><Clock3 className="size-3.5" />Current session</h2><Badge tone={onBreak ? 'warning' : active ? 'good' : 'muted'}>{onBreak ? 'On a break' : active ? 'In progress' : session ? 'Paused' : 'Ready'}</Badge></div><div className="mt-8 text-[38px] leading-none font-medium tracking-tighter tabular-nums sm:text-[42px]">{formatDuration(session?.elapsed_seconds)}</div><p className="mt-3 text-[10px] text-muted">{session ? `Started at ${formatTime(session.started_at)} · ${mode === 'demo' ? 'Demo' : 'Study'} session` : 'Sessions start when your desk is occupied'}</p><div className="mt-7 flex justify-between text-[11px] text-muted"><span>{onBreak ? 'Enjoy your movement break' : 'Next movement break'}</span><strong className="font-medium text-pine">{onBreak ? shortDuration(session.break_remaining_seconds) : session ? `${Math.ceil(remaining / 60)} min` : '—'}</strong></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-sage-light"><div className="h-full rounded-full bg-sage transition-[width]" style={{ width: `${clamp(sitting / interval * 100)}%` }} /></div><div className="mt-5 flex gap-2">{!session ? <Button className="flex-1" onClick={() => void control('start')} disabled={controls.isPending || desk.isError}><Play />Start session</Button> : onBreak ? <Button className="flex-1" onClick={() => void control('finish_break')} disabled={controls.isPending}><Play />Back to desk</Button> : <><Button variant="secondary" className="flex-1" onClick={() => void control(active ? 'pause' : 'resume')} disabled={controls.isPending}>{active ? <Pause /> : <Play />}{active ? 'Pause' : 'Resume'}</Button>{active && <Button className="flex-1" onClick={() => void control('break')} disabled={controls.isPending}><Coffee />Take a break</Button>}</>}</div><div className="mt-auto flex justify-between pt-4 text-[10px] text-muted"><span>{session ? `${session.breaks} breaks taken` : 'Your time, at your pace'}</span>{session && <button onClick={() => void control('end')} disabled={controls.isPending} className="text-pine disabled:opacity-50">End session ↗</button>}</div></Card>
    </div>
    <PcCameraPanel state={state} />
    <div className="flex items-center justify-between"><h2 className="text-base font-semibold tracking-tight">The little things that matter</h2><span className="text-[10px] text-muted">Updated every second</span></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
      <SensorCard label="Posture" icon={PersonStanding} value={postureLabel(s.posture)} description={validPose ? `${formatNumber((s.confidence ?? 0) * 100)}% ${pcCamera ? 'landmark reliability · PC' : 'confidence'}` : s.vision_available ? 'Uncertain pose' : 'Vision offline'} warning={!!validPose && s.posture !== 'GOOD'} />
      <SensorCard label="Viewing distance" icon={Ruler} value={formatNumber(s.distance_cm)} unit="cm" description={pcCamera ? 'Simulated ToF · not camera depth' : s.distance_cm == null ? 'Sensor unavailable' : s.distance_cm < settings.distance_min_cm ? 'A little too close' : 'Comfortable distance'} warning={s.distance_cm != null && s.distance_cm < settings.distance_min_cm} />
      <SensorCard label="Ambient light" icon={Sun} value={formatNumber(s.lux)} unit="lux" description={s.lux == null ? 'Sensor unavailable' : s.lux < 250 ? 'Lamp lends a hand' : 'Well lit'} />
      <SensorCard label="Noise level" icon={Volume2} value={formatNumber(s.noise_level == null ? null : s.noise_level * 100)} unit="%" description={s.noise_level == null ? 'Sensor unavailable' : `${s.noise_state.toLowerCase()} · relative level`} warning={s.noise_level != null && s.noise_level >= settings.noise_threshold} />
      <SensorCard label="Temperature" icon={Thermometer} value={formatNumber(s.temperature_c, 1)} unit="°C" description={s.temperature_c == null ? 'Sensor unavailable' : s.temperature_c >= settings.temperature_fan_c ? 'Getting a little warm' : 'Comfortable'} warning={s.temperature_c != null && s.temperature_c >= settings.temperature_fan_c} />
      <SensorCard label="Humidity" icon={Droplets} value={formatNumber(s.humidity_percent)} unit="%" description={s.humidity_percent == null ? 'Sensor unavailable' : s.humidity_percent < 30 ? 'A little dry' : s.humidity_percent > 70 ? 'A little humid' : 'Comfortable range'} warning={s.humidity_percent != null && (s.humidity_percent < 30 || s.humidity_percent > 70)} />
    </div>
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 text-xs"><span className="flex items-center gap-2 text-muted"><Zap className="size-4 text-sage" />{mode === 'demo' ? 'Your desk is adapting' : 'Requested desk controls'}</span><span className="flex items-center gap-2 text-muted"><Lightbulb className="size-4" />Lamp <strong className="font-medium text-pine">{a.lamp_percent}%</strong><Badge tone="muted">{a.lamp_mode}</Badge></span><span className="flex items-center gap-2 text-muted"><Fan className="size-4" />Fan <strong className="font-medium text-pine">{a.fan ? 'On' : 'Off'}</strong><Badge tone="muted">{a.fan_mode}</Badge></span><span className="flex items-center gap-2 text-muted"><Bell className="size-4" />{a.buzzer ? 'Beeping' : settings.buzzer_enabled ? 'Reminders enabled' : 'Reminders muted'}</span><Link to="/settings" className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-pine">Adjust controls<ArrowRight className="size-3" /></Link></Card>
    <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]"><Card className="min-w-0 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold tracking-tight">A little perspective</h2><p className="mt-1.5 text-[11px] text-muted">Your conditions over the last hour</p></div><select aria-label="History metric" value={metric} onChange={event => setMetric(event.target.value as HistoryMetric)} className="max-w-40 rounded-lg border border-line bg-white px-2.5 py-2 text-xs text-pine">{historyMetrics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div><ErrorNotice error={history.error} /><div className="mt-5"><HistoryChart points={history.data ?? []} metric={metric} height={190} /></div><div className="mt-4 flex justify-between text-[10px] text-muted"><span>{mode === 'demo' ? 'Demo readings ? vision sources recorded' : 'Sensor readings'} · stored locally</span><Link to="/analytics" className="inline-flex items-center gap-1 text-pine">Explore<ArrowRight className="size-3" /></Link></div></Card><Card className="p-5"><div className="flex justify-between"><h2 className="text-base font-semibold tracking-tight">Around your desk</h2><Link to="/analytics" className="inline-flex items-center gap-1 text-[11px] text-pine">Explore<ArrowRight className="size-3" /></Link></div><EventsList events={events.data ?? state.events} limit={4} /></Card></div>
  </div>;
}
