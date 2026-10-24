import { Check, Info, Ruler, ShieldCheck } from 'lucide-react';
import { formatNumber, postureLabel } from '../lib/format';
import type { DeskState } from '../lib/types';
import { Badge, Card } from './ui';

export function DeskIllustration({ state }: {state: DeskState}) {
  const { sensors, actuators, occupancy } = state;
  const absent = !sensors.person_detected || !sensors.vision_available;
  const transform = sensors.posture === 'SLOUCH' ? 'translate(9 9) rotate(7 125 100)' : sensors.posture === 'LEAN_FORWARD' ? 'translate(15 3) rotate(13 125 100)' : sensors.posture === 'LEAN_LEFT_RIGHT' ? 'translate(-10 0) rotate(-12 125 100)' : '';
  const valid = sensors.vision_available && sensors.confidence != null && sensors.confidence >= state.settings.confidence_min;
  const PoseIcon = valid ? Check : Info;
  return <Card className="flex min-h-80 flex-col p-5"><div className="flex items-center justify-between gap-2"><h2 className="text-xs font-medium text-muted">Your study space</h2><Badge tone={occupancy === 'USER_PRESENT' ? 'good' : 'muted'}>{occupancy === 'USER_PRESENT' ? 'Desk occupied' : occupancy === 'TEMPORARILY_AWAY' ? 'Temporarily away' : 'Desk empty'}</Badge></div>
    <div className="relative flex min-h-52 flex-1 items-center justify-center">
      <svg viewBox="0 0 280 185" className={`h-48 w-full max-w-80 fill-none stroke-[1.3] ${absent ? 'opacity-30' : ''}`} role="img" aria-label={`Illustrative posture diagram: ${postureLabel(sensors.posture)}. Not a camera feed.`}>
        <ellipse cx="139" cy="164" rx="105" ry="10" fill="#f3f4ee" />
        <path d="M132 30v120M80 95h104" stroke="#cad5c1" strokeDasharray="3 4" />
        {actuators.lamp_percent > 0 && <path d="m218 72-32 46h67l-26-46Z" fill="#f5efd2" opacity=".7" />}
        <path d="m49 113 113-16 79 17-114 20-78-21Z" fill="#e9ebdf" stroke="#c8cebc" />
        <path d="M57 117v43m172-43v43m-100-25v35" stroke="#b7c0aa" strokeWidth="4" />
        <path d="M169 58h44v39h-44z" fill="#f5f6ee" stroke="#a8b79c" /><path d="M173 62h36v30h-36z" fill="#dce8d0" stroke="#8fa47f" />
        <path d="M191 97v10m-8 1h17" stroke="#a0b18c" strokeWidth="2" /><path d="m158 113 29-4 13 4-29 5-13-5Z" fill="#f5f6ee" stroke="#a8b79c" />
        <path d="m226 110-3-24 14-15-12-14M217 72l19-5 6 8-22 5-3-8Z" stroke="#95a67e" />
        <path d="M91 124v31m30-22v24M81 160h48" stroke="#b2bfa0" strokeWidth="3" /><path d="M81 116q19-9 47 2l-3 13q-28-7-43-3Z" fill="#f5f6ee" stroke="#a8b79c" />
        <g transform={transform} stroke={valid ? '#6f8e62' : '#c5ab76'} strokeWidth="3" strokeLinecap="round"><circle cx="121" cy="55" r="12" fill="#c5d8ad" strokeWidth="1.2" /><path d="m120 69-5 24 8 19m-6-39 22 17 16 3m-36-13-21 12 1 20" /><circle cx="118" cy="76" r="3" fill="#c5d8ad" strokeWidth="1.2" /><circle cx="137" cy="89" r="3" fill="#c5d8ad" strokeWidth="1.2" /></g>
        <g stroke="#6f8e62" strokeWidth="3" strokeLinecap="round"><path d="m121 110 12 17 12 23m-25-34-16 17-2 24" /><circle cx="132" cy="128" r="3" fill="#c5d8ad" strokeWidth="1.2" /><circle cx="104" cy="133" r="3" fill="#c5d8ad" strokeWidth="1.2" /></g>
      </svg>
      <span className="absolute top-9 right-0 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1.5 text-[10px] text-pine shadow-xs"><Ruler className="size-3" />{formatNumber(sensors.distance_cm)} cm</span>
      <span className="absolute bottom-8 left-0 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1.5 text-[10px] text-pine shadow-xs"><PoseIcon className="size-3" />{postureLabel(sensors.posture)}</span>
    </div><div className="flex flex-wrap items-center justify-between gap-1 border-t border-line/60 pt-3 text-[9px] text-muted"><span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" />Illustrative pose · not a camera feed</span><span>{sensors.vision_available ? `${formatNumber(sensors.fps, 1)} FPS` : 'Vision offline'}</span></div>
  </Card>;
}
