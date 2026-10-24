import { Activity, Bell, Check, Clock3, Coffee, Lightbulb, PersonStanding, Ruler, Volume2 } from 'lucide-react';
import { formatTime, humanize } from '../lib/format';
import type { DeskEvent } from '../lib/types';

export function EventsList({ events, limit = 5 }: {events: DeskEvent[]; limit?: number}) {
  if (!events.length) return <p className="py-10 text-center text-xs leading-7 text-muted">All quiet here.<br />Desk activity and reminders will appear here.</p>;
  return <ul className="divide-y divide-line/60">{events.slice(0, limit).map(event => {
    const name = event.event_type;
    const Icon = name.includes('POSTURE') ? PersonStanding : /CLOSE|DISTANCE/.test(name) ? Ruler : name.includes('BREAK') ? Coffee : name.includes('LAMP') ? Lightbulb : name.includes('SESSION') ? Clock3 : name.includes('NOISE') ? Volume2 : event.severity === 'info' ? Check : Bell;
    return <li key={event.id} className="flex items-start gap-3 py-3.5"><div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${event.severity === 'info' ? 'bg-sage-light text-pine' : event.severity === 'critical' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}><Icon className="size-3.5" /></div><div className="min-w-0"><p className="text-xs font-medium text-ink">{humanize(name)}</p><p className="mt-1 text-[11px] leading-5 text-muted">{event.message}</p></div><time dateTime={event.timestamp} className="ml-auto shrink-0 pt-1 text-[10px] tabular-nums text-muted">{formatTime(event.timestamp)}</time></li>;
  })}</ul>;
}

export function LiveLabel({ demo, offline = false }: {demo: boolean; offline?: boolean}) {
  return <span className="inline-flex items-center gap-2 text-[10px] font-medium tracking-wide text-pine"><Activity className="size-3.5" />{offline ? 'RECONNECTING' : demo ? 'LIVE SIMULATION' : 'LIVE MONITORING'}</span>;
}
