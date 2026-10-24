import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudySession } from '../lib/types';
import { deskFixture, makeDesk } from '../test/fixtures';
import { ToastProvider } from '../components/ToastProvider';
import { SessionsPage } from './SessionsPage';

const clients: QueryClient[] = [];
const session: StudySession = {
  id: 'demo-session', mode: 'demo', state: 'ENDED', started_at: '2026-10-24T01:00:00Z', ended_at: '2026-10-24T01:10:00Z', started_epoch: 1792803600,
  elapsed_seconds: 600, duration_seconds: 600, sitting_seconds: 600, continuous_sitting_seconds: 600, screen_seconds: 600, breaks: 0,
  good_posture_percent: null, average_score: null, slouch_events: 0, too_close_events: 0, noise_warning_seconds: 0,
  average_lux: null, average_temperature: null, sample_count: 0, summary: null, pause_reason: null,
};
const desk = makeDesk({ mode: 'demo', settings: { ...deskFixture.settings, cloud_ai_consent: true } });

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><ToastProvider><SessionsPage /></ToastProvider></QueryClientProvider>);
}

afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

describe('session journal', () => {
  it('preserves unknown statistics and labels a local fallback accurately with cloud consent enabled', async () => {
    const user = userEvent.setup();
    let saved = { ...session };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === '/api/state') return Response.json(desk);
      if (path.startsWith('/api/sessions?')) return Response.json([saved]);
      if (path === '/api/sessions/demo-session/summary' && options?.method === 'POST') {
        saved = { ...saved, summary: 'There were not enough sensor observations to calculate a session score.', summary_source: 'local' };
        return Response.json({ session_id: session.id, summary: saved.summary, source: 'local', summary_source: 'local', cloud_sent: false, note: 'AWS Bedrock is not configured. Summary generated locally.' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPage();

    await user.click(await screen.findByRole('button', { name: /view session/i }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('Unobserved')).toBeInTheDocument();
    expect(within(modal).queryByText('0%')).not.toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Generate summary' }));

    expect(await within(modal).findByText('There were not enough sensor observations to calculate a session score.')).toBeInTheDocument();
    expect(within(modal).getByText('Generated locally · aggregate statistics')).toBeInTheDocument();
    expect(within(modal).getByText('AWS Bedrock is not configured. Summary generated locally.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/demo-session/summary', expect.objectContaining({ method: 'POST', body: '{}' }));
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/export?kind=sessions&mode=demo&minutes=1440');
  });

  it('shows an empty journal and excludes sessions from the other workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/state') return Response.json(desk);
      if (path.startsWith('/api/sessions?')) return Response.json([{ ...session, id: 'hardware-session', mode: 'hardware' }]);
      throw new Error(`Unexpected request: ${path}`);
    }));
    mountPage();
    expect(await screen.findByText('Your first chapter is ahead.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /view session/i })).not.toBeInTheDocument());
  });
});
