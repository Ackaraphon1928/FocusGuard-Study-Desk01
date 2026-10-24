import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { makeDesk, historyFixture, metricsFixture } from './test/fixtures';
import { renderWorkspace } from './test/render';

vi.mock('./components/charts/HistoryChart', () => ({
  HistoryChart: () => <div aria-label="History chart" />,
  historyMetrics: [
    { key: 'score', label: 'Study conditions', unit: '/100' },
    { key: 'distance_cm', label: 'Viewing distance', unit: 'cm' },
    { key: 'lux', label: 'Ambient lighting', unit: 'lux' },
    { key: 'noise_level', label: 'Relative noise', unit: '%' },
    { key: 'temperature_c', label: 'Temperature', unit: '°C' },
    { key: 'humidity_percent', label: 'Humidity', unit: '%' },
  ],
}));

function mockMonitoring(state = makeDesk(), history = historyFixture, metrics = metricsFixture) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0];
    if (path === '/api/state') return Response.json(state);
    if (path === '/api/history') return Response.json(history);
    if (path === '/api/metrics') return Response.json(metrics);
    return Response.json([]);
  }));
}

describe('React workspace routes and privacy', () => {
  it('navigates all five real pages while retaining a usable monitoring shell', async () => {
    mockMonitoring();
    renderWorkspace(<App />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Your desk, at a glance' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    await user.click(within(nav).getByRole('link', { name: 'Session history' }));
    expect(await screen.findByRole('heading', { name: 'Your session journal' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Analytics' }));
    expect(await screen.findByRole('heading', { name: 'Your environment over time' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Devices & network' }));
    expect(await screen.findByRole('heading', { name: 'Data source' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Rules & settings' }));
    expect(await screen.findByRole('heading', { name: 'Your ergonomic boundaries' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export data' })).toHaveAttribute('href', expect.stringContaining('mode=demo'));
  });

  it('opens native privacy and demo dialogs from the shell', async () => {
    mockMonitoring();
    renderWorkspace(<App />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Your desk, at a glance' });
    await user.click(screen.getByRole('button', { name: 'How it works' }));
    expect(screen.getByRole('dialog', { name: 'Your camera stays at your desk.' })).toBeInTheDocument();
    for (const video of document.querySelectorAll('video')) expect(video.srcObject).toBeFalsy();
    await user.click(screen.getByRole('button', { name: 'Close Your camera stays at your desk.' }));
    await user.click(screen.getByRole('button', { name: 'Try a scenario' }));
    const demo = screen.getByRole('dialog', { name: 'The demo lab' });
    expect(within(demo).getByRole('button', { name: /Camera disconnected/ })).toBeInTheDocument();
    expect(within(demo).getByText(/Physical devices are never controlled in demo mode/)).toBeInTheDocument();
  });

  it('identifies actual PC camera throughput and mixed historical vision sources in the demo workspace', async () => {
    const state = makeDesk({ vision_source: 'pc_camera' });
    state.sensors.fps = 14.3;
    const history = historyFixture.map((point, index) => index === 0 ? { ...point, vision_source: 'pc_camera' as const } : point);
    mockMonitoring(state, history, { ...metricsFixture, vision_source: 'pc_camera', observed_fps: 14.3 });
    renderWorkspace(<App />, '/analytics');
    expect(await screen.findByText('PC camera + simulated environment')).toBeInTheDocument();
    expect(await screen.findByText('14.3 FPS')).toBeInTheDocument();
    expect(screen.getByText('Measured PC camera processing rate in your browser; not Raspberry Pi throughput.')).toBeInTheDocument();
    expect(screen.queryByText(/Simulated value; run/)).not.toBeInTheDocument();
    expect(screen.getByText('Mixed vision sources')).toBeInTheDocument();
    expect(screen.getAllByTitle(/· PC camera/).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/· Simulated/).length).toBeGreaterThan(0);
    expect(screen.getByText('Simulated distance · not measured by webcam')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting trials')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'How it works' }));
    expect(screen.getByText(/PC camera video is processed in your browser/)).toBeInTheDocument();
  });

  it('uses current PC camera FPS when metrics still describe the previous simulated source', async () => {
    const state = makeDesk({ vision_source: 'pc_camera' });
    state.sensors.fps = 11.2;
    mockMonitoring(state, historyFixture, { ...metricsFixture, vision_source: 'simulated', observed_fps: 99 });
    renderWorkspace(<App />, '/analytics');
    expect(await screen.findByText('11.2 FPS')).toBeInTheDocument();
    expect(screen.queryByText('99.0 FPS')).not.toBeInTheDocument();
    expect(screen.queryByText('Mixed vision sources')).not.toBeInTheDocument();
  });
});
