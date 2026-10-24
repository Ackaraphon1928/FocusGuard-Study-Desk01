import type { Posture } from './types';

export function formatNumber(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function formatDuration(seconds: number | undefined | null): string {
  const n = Math.max(0, Math.floor(seconds ?? 0));
  return [Math.floor(n / 3600), Math.floor(n % 3600 / 60), n % 60].map(v => String(v).padStart(2, '0')).join(':');
}

export function shortDuration(seconds: number | undefined | null): string {
  const n = Math.max(0, Math.floor(seconds ?? 0));
  return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : `${Math.floor(n / 60)}m ${n % 60}s`;
}

export function formatTime(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function humanize(value: string | null | undefined): string {
  return String(value ?? 'unknown').toLowerCase().replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
}

export function postureLabel(posture: Posture | undefined): string {
  return ({ GOOD: 'Upright', SLOUCH: 'Slouching', LEAN_FORWARD: 'Leaning in', LEAN_LEFT_RIGHT: 'Side lean', NO_PERSON: 'Away', UNKNOWN: 'Unavailable' } as const)[posture ?? 'UNKNOWN'];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
