import type { DataMode } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const error: unknown = await response.json();
      if (error && typeof error === 'object' && 'detail' in error) {
        const detail = error.detail;
        message = typeof detail === 'string' ? detail : JSON.stringify(detail);
      }
    } catch { /* HTTP status remains useful when the response is not JSON. */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function exportUrl(kind: 'history' | 'sessions' | 'events', mode: DataMode, minutes = 1440): string {
  return `/api/export?${new URLSearchParams({ kind, mode, minutes: String(minutes) })}`;
}
