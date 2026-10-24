import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ToastProvider';
import { deskKeys } from '../lib/queries';
import type { ActuatorState, DeskState, Settings } from '../lib/types';
import { makeDesk } from '../test/fixtures';
import { SettingsPage } from './SettingsPage';

const clients: QueryClient[] = [];

function mountPage(initialState = makeDesk()) {
  let state = initialState;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    if (path === '/api/state') return Response.json(state);
    if (path === '/api/settings' && options?.method === 'PATCH') {
      const settings = JSON.parse(String(options.body)) as Settings;
      state = { ...state, settings };
      return Response.json(settings);
    }
    if (path === '/api/actuators' && options?.method === 'POST') {
      const changes = JSON.parse(String(options.body)) as Partial<ActuatorState>;
      state = { ...state, actuators: { ...state.actuators, ...changes } };
      return Response.json(state.actuators);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ToastProvider><SettingsPage /></ToastProvider></QueryClientProvider>);
  return {
    client,
    fetchMock,
    setServerState: (next: DeskState) => { state = next; },
    writesTo: (path: string) => fetchMock.mock.calls.filter(([input, options]) => String(input) === path && options?.method !== undefined),
  };
}

afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe('desk preferences', () => {
  it('keeps unsaved edits through a state refetch and saves the selected numbers and consent', async () => {
    const user = userEvent.setup();
    const original = makeDesk();
    const { client, fetchMock, setServerState } = mountPage(original);
    const minimumDistance = await screen.findByRole('spinbutton', { name: 'Minimum viewing distance (cm)' });
    const cloudConsent = screen.getByRole('checkbox', { name: /^Optional AI session summaries/ });
    expect(minimumDistance).toHaveValue(40);
    expect(cloudConsent).not.toBeChecked();

    await user.clear(minimumDistance);
    await user.type(minimumDistance, '55');
    await user.click(cloudConsent);
    setServerState({ ...original, settings: { ...original.settings, distance_min_cm: 45 } });
    await act(async () => { await client.refetchQueries({ queryKey: deskKeys.state }); });

    expect(client.getQueryData<DeskState>(deskKeys.state)?.settings.distance_min_cm).toBe(45);
    expect(minimumDistance).toHaveValue(55);
    expect(cloudConsent).toBeChecked();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Preferences saved. Your desk is up to date.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ ...original.settings, distance_min_cm: 55, cloud_ai_consent: true }),
    }));
    expect(screen.getByText('Preferences up to date')).toBeInTheDocument();
    expect(minimumDistance).toHaveValue(55);
  });

  it('shows the invalid weight total and blocks the settings request', async () => {
    const user = userEvent.setup();
    const { writesTo } = mountPage();
    const postureWeight = await screen.findByRole('spinbutton', { name: 'Posture weight' });
    await user.clear(postureWeight);
    await user.type(postureWeight, '0.6');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Weights add up to 1.300. Adjust them to total 1.00.')).toBeInTheDocument();
    expect(screen.getByText('Total weight: 1.300 / 1.000')).toBeInTheDocument();
    expect(writesTo('/api/settings')).toHaveLength(0);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('sends manual lamp and fan controls immediately without submitting preferences', async () => {
    const user = userEvent.setup();
    const { fetchMock, writesTo } = mountPage();
    const lampMode = await screen.findByRole('combobox', { name: 'Lamp mode' });
    const brightness = screen.getByRole('slider', { name: 'Lamp brightness' });
    const fanMode = screen.getByRole('combobox', { name: 'Fan mode' });
    const fanPower = screen.getByRole('checkbox', { name: 'Fan power' });
    expect(brightness).toBeDisabled();
    expect(fanPower).toBeDisabled();

    await user.selectOptions(lampMode, 'manual');
    await waitFor(() => expect(brightness).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith('/api/actuators', expect.objectContaining({ method: 'POST', body: JSON.stringify({ lamp_mode: 'manual' }) }));
    fireEvent.change(brightness, { target: { value: '65' } });
    fireEvent.pointerUp(brightness);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/actuators', expect.objectContaining({ method: 'POST', body: JSON.stringify({ lamp_mode: 'manual', lamp_percent: 65 }) })));
    await waitFor(() => expect(brightness).toBeEnabled());
    fireEvent.blur(brightness);
    expect(brightness).toHaveValue('65');

    await user.selectOptions(fanMode, 'manual');
    await waitFor(() => expect(fanPower).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith('/api/actuators', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fan_mode: 'manual' }) }));
    await user.click(fanPower);
    await waitFor(() => expect(fanPower).toBeChecked());
    expect(fetchMock).toHaveBeenCalledWith('/api/actuators', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fan_mode: 'manual', fan: true }) }));
    expect(writesTo('/api/actuators')).toHaveLength(4);
    expect(writesTo('/api/settings')).toHaveLength(0);
  });
});
