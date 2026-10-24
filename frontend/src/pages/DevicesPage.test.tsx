import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeskState } from '../lib/types';
import { makeDesk } from '../test/fixtures';
import { ToastProvider } from '../components/ToastProvider';
import { DevicesPage } from './DevicesPage';

const clients: QueryClient[] = [];

function stateFixture(): DeskState {
  return makeDesk({
    mode: 'demo', now: '2026-10-24T01:00:20Z', devices: [], actuator_ack: null,
    health: { mqtt: 'demo', influxdb: 'not_configured', ai: 'consent_required', storage: 'local_sqlite', vision: 'offline' },
    actuators: { lamp_percent: 75, fan: true, buzzer: false, lamp_mode: 'manual', fan_mode: 'manual' },
    sensors: { distance_cm: null, seat_pressure: null, seat_occupied: null, motion: null, noise_level: null, noise_state: 'UNKNOWN', temperature_c: null, humidity_percent: null, pressure_hpa: null, lux: null, person_detected: null, posture: 'UNKNOWN', confidence: null, fps: null, vision_available: false },
  });
}

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ToastProvider><DevicesPage /></ToastProvider></QueryClientProvider>);
}

afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); });

describe('devices and network', () => {
  it('posts the selected source and keeps unavailable hardware readings and outputs unknown', async () => {
    const user = userEvent.setup();
    let state = stateFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === '/api/state') return Response.json(state);
      if (path === '/api/mode' && options?.method === 'POST') {
        state = { ...state, mode: 'hardware', health: { ...state.health, mqtt: 'not_configured' } };
        return Response.json(state);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    mountPage();

    const source = await screen.findByRole('combobox', { name: 'Data source' });
    await user.selectOptions(source, 'hardware');
    await waitFor(() => expect(source).toHaveValue('hardware'));
    expect(fetchMock).toHaveBeenCalledWith('/api/mode', expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'hardware' }) }));
    expect(await screen.findByText('Awaiting gateway report')).toBeInTheDocument();
    expect(screen.getAllByText('No packets yet')).toHaveLength(4);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('57 cm')).not.toBeInTheDocument();
    expect(screen.getByText('75% · Manual')).toBeInTheDocument();
  });

  it('shows stale gateway output reports separately from requested control values', async () => {
    const state = { ...stateFixture(), mode: 'hardware' as const, actuator_ack: { timestamp: '2026-10-24T01:00:00Z', command_id: 'old-command', lamp_percent: 20, fan: false, buzzer: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
    mountPage();
    expect(await screen.findByText('Gateway report stale')).toBeInTheDocument();
    expect(screen.getByText('75% · Manual')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText(/This report is older than the eight-second command expiry/)).toBeInTheDocument();
  });

  it('shows PC camera metadata over local HTTP while desk nodes remain simulated', async () => {
    const state = makeDesk({ vision_source: 'pc_camera' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
    mountPage();
    const heading = await screen.findByRole('heading', { name: 'Local vision pipeline' });
    const vision = within(heading.parentElement!.parentElement!.parentElement!);
    expect(vision.getByText('PC webcam · Python + MediaPipe')).toBeInTheDocument();
    expect(vision.getByText('PC camera online')).toBeInTheDocument();
    expect(vision.getByText('Python pipeline · derived metadata')).toBeInTheDocument();
    expect(vision.getByText('/api/vision/status')).toBeInTheDocument();
    expect(vision.queryByText('Internal simulator')).not.toBeInTheDocument();
    expect(vision.queryByText('Simulated')).not.toBeInTheDocument();
    expect(screen.getAllByText('Internal simulator')).toHaveLength(3);
    expect(screen.getByText(/Python captures the PC webcam/)).toBeInTheDocument();
  });

  it('keeps an unavailable Raspberry Pi pipeline distinct from the PC webcam demo', async () => {
    const state = { ...stateFixture(), mode: 'hardware' as const, vision_source: 'gateway' as const };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
    mountPage();
    expect(await screen.findByText('Raspberry Pi · OpenCV + MediaPipe')).toBeInTheDocument();
    expect(screen.queryByText('PC webcam · Python + MediaPipe')).not.toBeInTheDocument();
    expect(screen.queryByText(/PC camera online|PC camera unavailable/)).not.toBeInTheDocument();
    expect(screen.getAllByText('MQTT · local network')).toHaveLength(4);
    expect(screen.getAllByText('No packets yet')).toHaveLength(4);
  });
});
