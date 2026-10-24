import { useMemo, useState } from 'react';
import { Bell, Database, Download, Info, Leaf, MoveHorizontal } from 'lucide-react';
import type { HistoryPoint, Posture, VisionSource } from '../lib/types';
import { exportUrl } from '../lib/api';
import { useDesk, useEvents, useHistory, useMetrics } from '../lib/queries';
import { clamp, formatNumber, formatTime, humanize, postureLabel } from '../lib/format';
import { Badge, Card, ErrorNotice, StatCard } from '../components/ui';
import { HistoryChart, historyMetrics } from '../components/charts/HistoryChart';

const postureColors: Record<string, string> = { GOOD: '#a7be8c', SLOUCH: '#d7b674', LEAN_FORWARD: '#c89b7e', LEAN_LEFT_RIGHT: '#b2a18b', NO_PERSON: '#e2e6da', UNKNOWN: '#e2e6da' };
const postureLegend = [['GOOD', 'Upright'], ['SLOUCH', 'Slouch'], ['LEAN_FORWARD', 'Forward lean'], ['LEAN_LEFT_RIGHT', 'Side lean'], ['UNKNOWN', 'Away / unknown']];
const windows = [{ minutes: 15, label: '15 min' }, { minutes: 60, label: '1 hour' }, { minutes: 360, label: '6 hours' }, { minutes: 1440, label: '24 hours' }];

function observedAverage(points: HistoryPoint[], key: 'score' | 'distance_cm') {
  const values = points.map((point) => point[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sourceLabel(source: VisionSource): string {
  return source === 'pc_camera' ? 'PC camera' : source === 'gateway' ? 'Hardware gateway' : 'Simulated';
}

export function AnalyticsPage() {
  const desk = useDesk();
  const mode = desk.data?.mode ?? 'demo';
  const pcCamera = mode === 'demo' && desk.data?.vision_source === 'pc_camera';
  const [minutes, setMinutes] = useState(60);
  const history = useHistory(mode, minutes);
  const events = useEvents(mode);
  const metrics = useMetrics();
  const points = useMemo(() => (history.data ?? []).filter((point) => point.mode === mode), [history.data, mode]);
  const warnings = useMemo(() => (events.data ?? []).filter((event) => event.mode === mode && /WARNING|REMINDER/.test(event.event_type)), [events.data, mode]);
  const hourly = Array.from({ length: 24 }, (_, hour) => warnings.filter((event) => new Date(event.timestamp).getHours() === hour).length);
  const hourlyMax = Math.max(1, ...hourly);
  const score = observedAverage(points, 'score');
  const distance = observedAverage(points, 'distance_cm');
  const observedMetrics = metrics.data?.mode === mode
    && (metrics.data.vision_source ? metrics.data.vision_source === desk.data?.vision_source : !pcCamera) ? metrics.data : undefined;
  const fps = desk.data?.sensors.vision_available ? observedMetrics?.observed_fps ?? desk.data.sensors.fps : null;
  const historySources = new Set(points.map((point) => point.vision_source ?? (point.mode === 'demo' ? 'simulated' : 'gateway')));
  const hasPcHistory = historySources.has('pc_camera');
  const mixedHistory = historySources.size > 1;
  const minimumConfidence = desk.data?.settings.confidence_min ?? 0.6;
  const timeline = useMemo(() => {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return sorted.flatMap<{ timestamp: string; posture: Posture; weight: number; source: VisionSource }>((point, index) => {
      const next = sorted[index + 1];
      const gap = next ? Math.max(1, (Date.parse(next.timestamp) - Date.parse(point.timestamp)) / 1000) : 1;
      const reliable = point.vision_available && point.person_detected && (point.vision_confidence ?? 0) >= minimumConfidence;
      const source = point.vision_source ?? (point.mode === 'demo' ? 'simulated' : 'gateway');
      return gap > 5 ? [{ timestamp: point.timestamp, posture: reliable ? point.posture : 'UNKNOWN', weight: 1, source }, { timestamp: point.timestamp, posture: 'UNKNOWN', weight: gap - 1, source }] : [{ timestamp: point.timestamp, posture: reliable ? point.posture : 'UNKNOWN', weight: gap, source }];
    });
  }, [points, minimumConfidence]);

  if (!desk.data) return <ErrorNotice error={desk.error} />;

  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Average conditions" value={score == null ? '—' : `${formatNumber(score)} / 100`} caption="Within the selected window" icon={Leaf} />
      <StatCard label="Viewing distance" value={distance == null ? '—' : `${formatNumber(distance)} cm`} caption={mode === 'demo' ? 'Simulated distance · not measured by webcam' : 'Average of available measurements'} icon={MoveHorizontal} />
      <StatCard label="Reminders & warnings" value={warnings.length} caption="Recently recorded in this workspace" icon={Bell} />
      <StatCard label="Stored readings" value={points.length.toLocaleString()} caption={`${minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes > 60 ? 's' : ''}`} of history selected`} icon={Database} />
    </div>
    {(history.error || events.error) && <ErrorNotice error={history.error || events.error} />}
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-lg font-semibold text-stone-800">Your environment over time</h2><p className="mt-1 text-sm text-stone-500">Missing observations appear as gaps.{points.length >= 10_000 ? ' Showing the latest 10,000 readings within this window.' : ''}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-[#ebece4] p-1" role="group" aria-label="History window">{windows.map((window) => <button type="button" key={window.minutes} aria-pressed={minutes === window.minutes} onClick={() => setMinutes(window.minutes)} className={`rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${minutes === window.minutes ? 'bg-white text-[#5b7541] shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>{window.label}</button>)}</div>
        <a href={exportUrl('history', mode, minutes)} download aria-label="Export selected history as CSV" className="rounded-xl border border-stone-200 bg-white p-2.5 text-stone-500 transition hover:bg-stone-50"><Download size={18} /></a>
      </div>
    </div>
    {history.isPending && <p role="status" className="text-sm text-stone-500">Loading history…</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      {historyMetrics.map((metric) => <Card className="min-w-0 p-5 sm:p-6" key={metric.key}>
        <div className="mb-5 flex items-start justify-between gap-3"><div><h3 className="font-semibold text-stone-800">{metric.label}</h3><p className="mt-1 text-xs text-stone-500">{metric.unit === '/ 100' ? 'Project-defined score out of 100' : metric.key === 'noise_level' ? 'Relative amplitude · not decibels' : metric.unit}</p></div><Badge tone="muted">{mode !== 'demo' ? 'Measured' : metric.key === 'score' && hasPcHistory ? mixedHistory ? 'Mixed vision sources' : 'PC pose + simulated sensors' : 'Simulated'}</Badge></div>
        <HistoryChart points={points} metric={metric.key} />
      </Card>)}
      <Card className="min-w-0 p-5 sm:p-6 lg:col-span-2">
        <h3 className="font-semibold text-stone-800">A posture timeline</h3><p className="mt-1 text-sm text-stone-500">Time-weighted observations; unavailable or uncertain poses remain unknown.</p>
        {points.length > 0 && <p className="mt-2 text-xs leading-relaxed text-stone-500">{mixedHistory ? 'This window includes PC camera and simulated pose observations. Each segment names its source.' : hasPcHistory ? 'PC camera pose observations. Environment and centimetre distances are simulated.' : mode === 'demo' ? 'Simulated pose observations. Older demo samples without a source are treated as simulated.' : 'Pose observations from the local hardware gateway.'}</p>}
        {timeline.length ? <><div className="mt-6 flex h-10 overflow-hidden rounded-xl" role="img" aria-label="Posture timeline from stored sensor observations">{timeline.map((segment, index) => <span key={`${segment.timestamp}-${index}`} style={{ flex: `${segment.weight} 1 0%`, backgroundColor: postureColors[segment.posture] ?? postureColors.UNKNOWN }} title={`${formatTime(segment.timestamp)} · ${postureLabel(segment.posture)} · ${sourceLabel(segment.source)}`} />)}</div><div className="mt-2 flex justify-between text-xs text-stone-500"><span>{formatTime(points[0]?.timestamp)}</span><span>{formatTime(points[points.length - 1]?.timestamp)}</span></div></> : <p className="py-7 text-sm text-stone-500">New live samples will build your posture timeline.</p>}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">{postureLegend.map(([key, label]) => <span key={key} className="inline-flex items-center gap-2 text-xs text-stone-500"><i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: postureColors[key!] }} />{label}</span>)}</div>
      </Card>
      <Card className="p-5 sm:p-6">
        <h3 className="font-semibold text-stone-800">When reminders happen</h3><p className="mt-1 text-sm text-stone-500">Recently recorded warnings by local hour, across saved dates.</p>
        <div className="mt-6 grid grid-cols-12 gap-1.5" aria-label="Warning counts by local hour">{hourly.map((count, hour) => <div key={hour} className="flex aspect-square items-center justify-center rounded-md text-xs font-medium" style={{ backgroundColor: count === 0 ? '#f0f2ec' : `rgba(117, 149, 81, ${0.2 + count / hourlyMax * 0.65})`, color: count / hourlyMax > 0.65 ? '#fff' : '#6c7e59' }} title={`${String(hour).padStart(2, '0')}:00 · ${count} warning${count === 1 ? '' : 's'}`} aria-label={`${String(hour).padStart(2, '0')}:00: ${count} warnings`}>{count || '·'}</div>)}</div>
        <div className="mt-2 flex justify-between text-xs text-stone-400"><span>00:00</span><span>11:00</span></div><div className="mt-2 flex justify-between text-xs text-stone-400"><span>12:00</span><span>23:00</span></div>
        <p className="mt-5 text-xs leading-relaxed text-stone-500">The event API returns the latest saved events; this count can include events outside the chart window.</p>
      </Card>
      <Card className="p-5 sm:p-6">
        <h3 className="font-semibold text-stone-800">What goes into your score</h3><p className="mt-1 text-sm text-stone-500">Current suitability, weighted by your rules</p>
        <div className="my-6 space-y-4">{Object.entries(desk.data.score.components).map(([key, value]) => <div key={key} className="grid grid-cols-[82px_1fr_35px] items-center gap-3 text-xs"><span className="text-stone-500">{humanize(key)}</span><div className="h-2 overflow-hidden rounded-full bg-[#eef0e8]"><div className="h-full rounded-full bg-[#9db47d] transition-[width]" style={{ width: `${clamp(value ?? 0)}%` }} /></div><span className="text-right font-medium tabular-nums text-stone-700">{formatNumber(value)}</span></div>)}</div>
        <div className="flex items-center justify-between border-t border-stone-100 pt-4 text-xs text-stone-500"><span>Observation coverage</span><strong className="text-[#6c854e]">{formatNumber(desk.data.score.coverage_percent)}%</strong></div>
        <p className="mt-3 text-xs leading-relaxed text-stone-500">Unknown inputs reduce coverage. This engineering score describes desk conditions and does not measure concentration.</p>
      </Card>
      <Card className="p-5 sm:p-6 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-stone-800">Measure what matters</h3><p className="mt-1 text-sm text-stone-500">Live diagnostics and the evaluation tools included with your prototype</p></div><Badge tone="muted">{mode === 'demo' ? 'Demo · not a benchmark' : 'Live diagnostics'}</Badge></div>
        {metrics.error && <div className="mt-4"><ErrorNotice error={metrics.error} /></div>}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <Diagnostic label="Vision throughput" value={`${formatNumber(fps, 1)} FPS`} description={pcCamera ? 'Measured PC camera processing rate in your browser; not Raspberry Pi throughput.' : mode === 'demo' ? 'Simulated value; run PC camera or Pi vision to measure throughput.' : 'Reported by your local vision gateway.'} />
          <Diagnostic label="Publisher → gateway latency" value={mode === 'demo' || observedMetrics?.ingestion_latency_ms.mean == null ? 'Awaiting samples' : `${formatNumber(observedMetrics.ingestion_latency_ms.mean, 1)} ms`} description={mode === 'demo' ? 'Physical latency is not measured by the simulator.' : `Mean / p95: ${formatNumber(observedMetrics?.ingestion_latency_ms.mean, 1)} / ${formatNumber(observedMetrics?.ingestion_latency_ms.p95, 1)} ms · ${observedMetrics?.ingestion_latency_ms.samples ?? 0} samples. Synchronized clocks required.`} />
          <Diagnostic label="Posture accuracy / F1" value="Awaiting trials" description="Collect labeled samples and run evaluation/evaluate.py." />
          <Diagnostic label="Distance MAE / actuator latency" value="Awaiting trials" description="Compare reference distances and physical actuator timestamps." />
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-stone-100 pt-4 text-xs text-stone-500"><span>Accepted telemetry: <strong>{formatNumber(observedMetrics?.telemetry_messages)}</strong></span><span>Rejected messages: <strong>{formatNumber(observedMetrics?.invalid_messages)}</strong></span></div>
        <div className="mt-5 flex gap-3 rounded-xl bg-[#f4f5ef] p-4 text-xs leading-relaxed text-stone-500"><Info size={18} className="mt-0.5 shrink-0 text-[#8d9d76]" /><p>Use the included evaluation protocol for upright posture, slouching, low light, occlusion, and multiple-person cases. {pcCamera ? 'Live camera labels still require labeled ground truth to establish accuracy. Simulated desk data does not establish physical response time.' : 'Simulated data does not establish accuracy or physical response time.'}</p></div>
      </Card>
    </div>
  </div>;
}

function Diagnostic({ label, value, description }: { label: string; value: string; description: string }) {
  return <div><p className="text-xs text-stone-500">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight text-stone-700">{value}</p><p className="mt-2 text-xs leading-relaxed text-stone-500">{description}</p></div>;
}
