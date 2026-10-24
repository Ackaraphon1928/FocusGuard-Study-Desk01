import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoLab } from './DemoLab';
import { makeDesk } from '../test/fixtures';
import { renderWorkspace } from '../test/render';

describe('demo lab workflow', () => {
  it('changes the selected scenario through the real mutation boundary', async () => {
    let state = makeDesk();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/demo') {
        expect(JSON.parse(String(options?.body))).toEqual({ scenario: 'dark' });
        state = { ...state, scenario: 'dark' };
      }
      return Response.json(state);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<DemoLab open onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: /Lights down/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Lights down scenario is running.')).toBeInTheDocument();
  });

  it('saves presentation timing as settings and communicates persistence', async () => {
    const state = makeDesk();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/settings') {
        const changes = JSON.parse(String(options?.body));
        expect(options?.method).toBe('PATCH');
        expect(changes.break_interval_minutes).toBe(.5);
        expect(changes.posture_warning_seconds).toBe(3);
        expect(changes.cloud_ai_consent).toBeUndefined();
        return Response.json({ ...state.settings, ...changes });
      }
      return Response.json(state);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<DemoLab open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enable fast rules' }));
    expect(await screen.findByRole('button', { name: 'Fast rules enabled' })).toBeInTheDocument();
    expect(screen.getByText(/These settings persist until changed/)).toBeInTheDocument();
  });
});
