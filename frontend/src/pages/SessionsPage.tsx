import { useMemo, useState } from 'react';
import { ArrowUpRight, Clock3, Coffee, Download, Leaf, PersonStanding, Sparkles } from 'lucide-react';
import type { DeskState, StudySession } from '../lib/types';
import { api, exportUrl } from '../lib/api';
import { useDesk, useSessions, useDeskMutation } from '../lib/queries';
import { formatDate, formatNumber, formatTime, humanize, shortDuration } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNotice, Modal, StatCard } from '../components/ui';
import { useToast } from '../components/ToastProvider';

type SummaryResponse = { session_id: string; summary: string; summary_source: string; source: string; cloud_sent: boolean; note: string };

function average(sessions: StudySession[], key: 'average_score' | 'good_posture_percent') {
  const values = sessions.map((session) => session[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summaryText(session: StudySession) {
  const value: unknown = session.summary;
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'text' in value && typeof value.text === 'string' ? value.text : null;
}

function sourceLabel(source: string | null | undefined) {
  return source === 'aws_bedrock' ? 'AWS Bedrock · aggregate statistics only' : source === 'local' ? 'Generated locally · aggregate statistics' : source ? humanize(source) : 'Summary has not been generated';
}

export function SessionsPage() {
  const desk = useDesk();
  return desk.data ? <SessionJournal key={desk.data.mode} desk={desk.data} /> : <ErrorNotice error={desk.error} />;
}

function SessionJournal({ desk }: { desk: DeskState }) {
  const mode = desk.mode;
  const sessionsQuery = useSessions(mode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generated, setGenerated] = useState<SummaryResponse | null>(null);
  const { notify } = useToast();
  const summary = useDeskMutation<string, SummaryResponse>((id) => api<SummaryResponse>(`/sessions/${encodeURIComponent(id)}/summary`, { method: 'POST', body: '{}' }));
  const sessions = useMemo(() => (sessionsQuery.data ?? []).filter((session) => session.mode === mode), [sessionsQuery.data, mode]);
  const selected = sessions.find((session) => session.id === selectedId);
  const totalSeconds = sessions.reduce((total, session) => total + (session.elapsed_seconds ?? session.duration_seconds ?? 0), 0);
  const posture = average(sessions, 'good_posture_percent');
  const score = average(sessions, 'average_score');

  async function generateSummary(id: string) {
    try {
      const result = await summary.mutateAsync(id);
      setGenerated(result);
      notify('Your session reflection is ready.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not generate a session summary.', 'error'); }
  }

  const generatedForSelection = generated?.session_id === selectedId ? generated : null;
  const currentSummary = selected ? generatedForSelection?.summary ?? summaryText(selected) : null;
  const currentSource = generatedForSelection?.source ?? selected?.summary_source;

  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Sessions" value={sessions.length} caption="In this workspace" icon={Clock3} />
      <StatCard label="Time at your desk" value={shortDuration(totalSeconds)} caption="Across current and saved sessions" icon={Coffee} />
      <StatCard label="Upright posture" value={posture === null ? '—' : `${formatNumber(posture)}%`} caption="Average of observed session percentages" icon={PersonStanding} />
      <StatCard label="Average conditions" value={score === null ? '—' : `${formatNumber(score)} / 100`} caption="A project-defined environment score" icon={Leaf} />
    </div>
    {sessionsQuery.error && <ErrorNotice error={sessionsQuery.error} />}
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 px-6 py-5">
        <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold text-stone-800">Your session journal</h2><Badge tone="muted">{mode === 'demo' ? 'Demo data' : 'Hardware data'}</Badge></div>
        <a href={exportUrl('sessions', mode)} download className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"><Download size={16} />Export CSV</a>
      </div>
      {sessionsQuery.isPending ? <p role="status" className="p-10 text-center text-sm text-stone-500">Loading your sessions…</p> : sessions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[710px] text-left text-sm">
        <thead className="bg-stone-50/60 text-xs uppercase tracking-wider text-stone-500"><tr>{['Session', 'Time at desk', 'Conditions', 'Upright', 'Breaks', ''].map((heading) => <th key={heading} scope="col" className="px-6 py-4 font-medium">{heading || <span className="sr-only">Details</span>}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">{sessions.map((session) => <tr key={session.id} className="transition hover:bg-stone-50/60">
          <td className="px-6 py-5"><p className="font-medium text-stone-800">{formatDate(session.started_at)}</p><p className="mt-1 text-xs text-stone-500">{formatTime(session.started_at)} – {session.ended_at ? formatTime(session.ended_at) : humanize(session.state)}</p></td>
          <td className="px-6 py-5 tabular-nums text-stone-600">{shortDuration(session.elapsed_seconds ?? session.duration_seconds ?? 0)}</td>
          <td className="px-6 py-5"><Badge tone={session.average_score != null && session.average_score < 60 ? 'warning' : session.average_score == null ? 'muted' : 'good'}>{session.average_score == null ? 'Unobserved' : `${formatNumber(session.average_score)} / 100`}</Badge></td>
          <td className="px-6 py-5 tabular-nums text-stone-600">{session.good_posture_percent == null ? '—' : `${formatNumber(session.good_posture_percent)}%`}</td>
          <td className="px-6 py-5 text-stone-600">{formatNumber(session.breaks)}</td>
          <td className="px-6 py-5"><button type="button" onClick={() => { setSelectedId(session.id); setGenerated(null); }} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 font-medium text-[#658146] hover:bg-[#eff3e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6c884c]">View session<ArrowUpRight size={16} /></button></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="Your first chapter is ahead." description="End a session from the overview to save its conditions, events, and summary here." />}
      <p className="border-t border-stone-100 px-6 py-4 text-xs leading-relaxed text-stone-500">{mode === 'demo' ? 'Simulator sessions are kept separate from hardware sessions.' : 'Sessions contain derived sensor metadata. Camera frames and audio are never saved.'}</p>
    </Card>
    <div className="flex gap-3 rounded-2xl bg-[#f0f3e9] p-5 text-sm leading-relaxed text-stone-600"><Sparkles className="mt-0.5 shrink-0 text-[#7d9662]" size={20} /><p>Open a session for a local reflection. Enable optional AWS Bedrock summaries in privacy settings to share aggregate statistics with cloud AI.</p></div>
    <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `${formatDate(selected.started_at)} · ${formatTime(selected.started_at)}` : 'Session details'} description="Your session journal">
      {selected && <div className="space-y-6">
        <div className="flex flex-wrap gap-2"><Badge tone="muted">{selected.mode === 'demo' ? 'Demo session' : 'Hardware session'}</Badge><Badge tone={selected.state === 'ACTIVE' ? 'good' : 'muted'}>{selected.ended_at ? 'Completed' : humanize(selected.state)}</Badge></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Time at desk" value={shortDuration(selected.elapsed_seconds ?? selected.duration_seconds ?? 0)} caption="Active seated time" icon={Clock3} />
          <StatCard label="Average score" value={formatNumber(selected.average_score)} caption="Out of 100 · observed conditions" icon={Leaf} />
          <StatCard label="Upright posture" value={selected.good_posture_percent == null ? '—' : `${formatNumber(selected.good_posture_percent)}%`} caption="Of reliable pose observations" icon={PersonStanding} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          {[
            ['Breaks taken', formatNumber(selected.breaks)], ['Posture warnings', formatNumber(selected.slouch_events)],
            ['Distance warnings', formatNumber(selected.too_close_events)], ['Average light', selected.average_lux == null ? '—' : `${formatNumber(selected.average_lux)} lux`],
            ['Average temperature', selected.average_temperature == null ? '—' : `${formatNumber(selected.average_temperature, 1)} °C`], ['Observed samples', formatNumber(selected.sample_count)],
          ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-stone-100 pb-3"><dt className="text-stone-500">{label}</dt><dd className="font-medium text-stone-700">{value}</dd></div>)}
        </dl>
        <section className="rounded-2xl bg-[#f1f4eb] p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#6b824f]"><Sparkles size={16} />Session reflection</div>
          <p className="whitespace-pre-line text-sm leading-7 text-stone-700">{currentSummary || 'Generate a reflection on your session conditions and habits from its aggregate statistics.'}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={summary.isPending} onClick={() => generateSummary(selected.id)}><Sparkles size={16} />{summary.isPending ? 'Writing reflection…' : currentSummary ? 'Refresh summary' : 'Generate summary'}</Button><span className="text-xs text-stone-500">{sourceLabel(currentSource)}</span></div>
          {generatedForSelection?.note && <p className="mt-3 text-xs leading-relaxed text-stone-500">{generatedForSelection.note}</p>}
          {!currentSummary && <p className="mt-3 text-xs leading-relaxed text-stone-500">{desk.settings.cloud_ai_consent ? 'Cloud AI is enabled. A local fallback remains available if Bedrock is unavailable.' : 'Cloud sharing is off. Your reflection is generated locally.'}</p>}
        </section>
        <p className="text-xs leading-relaxed text-stone-500">{selected.mode === 'demo' ? 'This session uses simulated sensor readings.' : 'Only derived sensor data is saved. No camera or audio recording.'}</p>
      </div>}
    </Modal>
  </div>;
}
