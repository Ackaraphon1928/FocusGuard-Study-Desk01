import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, exportUrl } from './api';

describe('typed API boundary', () => {
  it('preserves AbortSignal and encodes mutation bodies as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lamp_percent: 50 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const abort = new AbortController();
    const result = await api<{lamp_percent: number}>('/actuators', { method: 'POST', signal: abort.signal, body: JSON.stringify({ lamp_mode: 'manual', lamp_percent: 50 }) });
    expect(result.lamp_percent).toBe(50);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/actuators');
    expect(options.signal).toBe(abort.signal);
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ lamp_mode: 'manual', lamp_percent: 50 });
  });

  it('surfaces domain validation instead of swallowing failed controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'A session is already running' }), { status: 422 })));
    try {
      await api('/control', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
      throw new Error('Expected the control error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(422);
      expect((error as Error).message).toBe('A session is already running');
    }
  });

  it('retains HTTP status when an upstream failure is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(api('/state')).rejects.toThrow('Request failed (503)');
  });

  it('exports the selected workspace and duration explicitly', () => {
    const url = new URL(exportUrl('history', 'hardware', 360), 'http://localhost');
    expect(url.searchParams.get('mode')).toBe('hardware');
    expect(url.searchParams.get('minutes')).toBe('360');
    expect(url.searchParams.get('kind')).toBe('history');
  });
});
