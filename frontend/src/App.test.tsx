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

function mockMonitoring() {
  const state = makeDesk();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0];
    if (path === '/api/state') return Response.json(state);
    if (path === '/api/history') return Response.json(historyFixture);
    if (path === '/api/metrics') return Response.json(metricsFixture);
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
    expect(document.querySelector('video')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close Your camera stays at your desk.' }));
    await user.click(screen.getByRole('button', { name: 'Try a scenario' }));
    const demo = screen.getByRole('dialog', { name: 'The demo lab' });
    expect(within(demo).getByRole('button', { name: /Camera disconnected/ })).toBeInTheDocument();
    expect(within(demo).getByText(/Physical devices are never controlled in demo mode/)).toBeInTheDocument();
  });
});
