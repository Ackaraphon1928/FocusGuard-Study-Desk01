import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverviewPage } from './OverviewPage';
import { makeDesk } from '../test/fixtures';
import { renderWorkspace } from '../test/render';

vi.mock('../components/charts/HistoryChart', () => ({
  HistoryChart: () => <div aria-label="History chart" />,
  historyMetrics: [{ key: 'score', label: 'Study conditions' }],
}));

describe('live session controls', () => {
  it('pauses through the API and updates available actions from returned state', async () => {
    let state = makeDesk();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/control') {
        expect(JSON.parse(String(options?.body))).toEqual({ action: 'pause' });
        state = { ...state, running: false, session: { ...state.session!, state: 'PAUSED' } };
        return Response.json(state);
      }
      return Response.json(url === '/api/state' ? state : []);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<OverviewPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take a break' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/control')).toBe(true);
  });

  it('uses continuous sitting rather than all-time sitting for the next break', async () => {
    const state = makeDesk();
    state.session = { ...state.session!, sitting_seconds: 3000, continuous_sitting_seconds: 0, break_due_in_seconds: 2700, breaks: 1 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/state' ? state : [])));
    renderWorkspace(<OverviewPage />);
    expect(await screen.findByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('1 breaks taken')).toBeInTheDocument();
  });

  it('shows unknown sensors without fabricating a healthy score or confidence', async () => {
    const state = makeDesk({ mode: 'hardware', session: null, occupancy: 'EMPTY', running: false });
    state.score = { total: null, components: { lighting: null, noise: null, thermal: null, posture: null, distance: null }, coverage_percent: 0 };
    state.sensors = { distance_cm: null, seat_pressure: null, seat_occupied: null, motion: null, noise_level: null, noise_state: 'UNKNOWN', temperature_c: null, humidity_percent: null, pressure_hpa: null, lux: null, person_detected: null, posture: 'UNKNOWN', confidence: null, fps: null, vision_available: false };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/state' ? state : [])));
    renderWorkspace(<OverviewPage />);
    expect(await screen.findByText('Not enough data')).toBeInTheDocument();
    expect(screen.getByText('0% coverage')).toBeInTheDocument();
    expect(screen.queryByText('100% confidence')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled());
  });
});
