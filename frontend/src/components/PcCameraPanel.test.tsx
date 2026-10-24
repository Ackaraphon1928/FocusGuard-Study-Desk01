import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PcCameraPanel } from './PcCameraPanel';
import { deskKeys, useDesk } from '../lib/queries';
import { initialVisionSnapshot, type VisionSnapshot, type PoseObservation } from '../lib/vision/protocol';
import { visionStatusKey } from '../lib/vision/usePcCamera';
import { makeDesk } from '../test/fixtures';
import { renderWorkspace } from '../test/render';
import type { DeskState } from '../lib/types';

function Harness() {
  const { data } = useDesk();
  return data ? <PcCameraPanel state={data} /> : null;
}

function observation(): PoseObservation {
  return {
    type: 'result', people: 1, fps: 15.5, inferenceMs: 28, width: 640, height: 480, landmarks: [],
    result: {
      posture: 'GOOD', candidate: 'GOOD', confidence: 0.95, personDetected: true,
      geometry: { trackingMode: 'upper_body', headHeightRatio: 0.5, headOffsetRatio: 0, torsoAngleDeg: 0, shoulderAngleDeg: 0, forwardRatio: null, neckForwardRatio: null, confidence: 0.95, forwardSource: 'unavailable' },
      calibration: { status: 'ready', frames: 30, required: 30 }, reason: 'tracking_upper_body',
    },
  };
}

let currentState: DeskState;
let currentSnapshot: VisionSnapshot;
let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>>;
let getUserMedia: ReturnType<typeof vi.fn>;
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function calls(path: string) { return fetchMock.mock.calls.filter(([input]) => String(input) === `/api${path}`); }

beforeEach(() => {
  currentState = makeDesk();
  currentSnapshot = { ...initialVisionSnapshot };
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('Worker', vi.fn());
  vi.stubGlobal('createImageBitmap', vi.fn());
  fetchMock = vi.fn(async (input, options) => {
    const path = String(input);
    if (path === '/api/state') return Response.json(currentState);
    if (path === '/api/vision/status') return Response.json(currentSnapshot);
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (path === '/api/vision/start') {
      currentState = { ...currentState, vision_source: currentState.mode === 'demo' ? 'pc_camera' : 'gateway' };
      currentSnapshot = { ...currentSnapshot, status: 'running', cameraIndex: body.camera_index, view: body.view, delegate: 'CPU', observation: observation(), fps: 15.5, inferenceMs: 28, frames: 75 };
    } else if (path === '/api/vision/stop') {
      currentSnapshot = { ...currentSnapshot, status: 'stopped', observation: null, fps: 0, previewEnabled: false };
    } else if (path === '/api/vision/calibrate') {
      currentSnapshot = { ...currentSnapshot, observation: { ...observation(), result: { ...observation().result, posture: 'UNKNOWN', candidate: 'UNKNOWN', calibration: { status: 'collecting', frames: 1, required: 30 }, reason: 'calibrating' } } };
    } else if (path === '/api/vision/view') {
      currentSnapshot = { ...currentSnapshot, view: body.view, observation: null };
    } else if (path === '/api/vision/preview') {
      currentSnapshot = { ...currentSnapshot, previewEnabled: body.enabled };
    } else if (path === '/api/demo/vision-source') {
      currentState = { ...currentState, vision_source: body.source };
      return Response.json(currentState);
    } else throw new Error(`Unexpected request: ${path}`);
    return Response.json(currentSnapshot);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

async function startRunning() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start backend camera' }));
  await screen.findByText('Live Python vision');
}

describe('Python camera controls and monitoring', () => {
  it('polls metadata without starting capture, opening browser APIs or loading an image', async () => {
    renderWorkspace(<Harness />);
    await screen.findByRole('button', { name: 'Start backend camera' });
    await waitFor(() => expect(calls('/vision/status').length).toBeGreaterThan(0));
    expect(calls('/vision/start')).toHaveLength(0);
    expect(calls('/vision/stop')).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(document.querySelector('video,canvas,img')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Enable local debug preview' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Calibrate upright posture' })).toBeDisabled();
  });

  it('starts the selected backend camera and displays Python results without publishing browser metadata', async () => {
    renderWorkspace(<Harness />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Backend camera index' }), '2');
    await startRunning();
    expect(JSON.parse(String(calls('/vision/start')[0][1]?.body))).toEqual({ camera_index: 2, view: 'front' });
    expect(screen.getByText('15.5 actual FPS')).toBeInTheDocument();
    expect(screen.getByText('Python · CPU')).toBeInTheDocument();
    expect(screen.getByText('Calibrated')).toBeInTheDocument();
    expect(screen.getByLabelText('Python tracking diagnostics')).toHaveTextContent('75 processed frames');
    expect(calls('/demo/vision')).toHaveLength(0);
    expect(calls('/demo/vision-source')).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Backend camera index' })).toBeDisabled();
  });

  it('uses subsequent status snapshots for live labels and diagnostics', async () => {
    renderWorkspace(<Harness />);
    await startRunning();
    currentSnapshot = { ...currentSnapshot, fps: 12.1, frames: 100, observation: { ...observation(), result: { ...observation().result, posture: 'SLOUCH', candidate: 'SLOUCH' } } };
    await screen.findByText('12.1 actual FPS', {}, { timeout: 1800 });
    expect(screen.getByLabelText('Python tracking diagnostics')).toHaveTextContent('Candidate: SLOUCH');
    expect(screen.getByLabelText('Python tracking diagnostics')).toHaveTextContent('100 processed frames');
    expect(calls('/vision/status').length).toBeGreaterThan(1);
  });

  it('sends calibration and view controls to Python rather than applying local posture logic', async () => {
    renderWorkspace(<Harness />);
    await startRunning();
    await userEvent.click(screen.getByRole('button', { name: 'Recalibrate upright posture' }));
    expect(await screen.findByText('Collecting')).toBeInTheDocument();
    expect(JSON.parse(String(calls('/vision/calibrate')[0][1]?.body))).toEqual({});
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Camera view' }), 'side');
    await waitFor(() => expect(calls('/vision/view')).toHaveLength(1));
    expect(JSON.parse(String(calls('/vision/view')[0][1]?.body))).toEqual({ view: 'side' });
    expect(currentSnapshot.view).toBe('side');
  });

  it('streams the local debug preview only after explicit opt-in and removes it when disabled', async () => {
    renderWorkspace(<Harness />);
    await startRunning();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const preview = screen.getByRole('checkbox', { name: 'Enable local debug preview' });
    await userEvent.click(preview);
    expect(await screen.findByRole('img', { name: 'Optional Python camera preview with pose overlay' })).toHaveAttribute('src', '/api/vision/preview.mjpeg');
    expect(JSON.parse(String(calls('/vision/preview')[0][1]?.body))).toEqual({ enabled: true });
    await userEvent.click(preview);
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
    expect(JSON.parse(String(calls('/vision/preview')[1][1]?.body))).toEqual({ enabled: false });
  });

  it('reports backend startup errors and allows retry without browser permissions', async () => {
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, options) => String(input) === '/api/vision/start'
      ? Promise.resolve(Response.json({ detail: 'Camera 0 could not be opened. Close other camera apps.' }, { status: 503 })) : defaultFetch(input, options));
    renderWorkspace(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start backend camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera 0 could not be opened');
    expect(screen.getByRole('button', { name: 'Start backend camera' })).toBeEnabled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each(['stop', 'unmount', 'hidden tab', 'mode change', 'source change'] as const)('stops a UI-owned Python camera on %s and retains explicit source selection', async (action) => {
    const mounted = renderWorkspace(<Harness />);
    await startRunning();
    if (action === 'stop') await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    else if (action === 'unmount') mounted.unmount();
    else await act(async () => {
      if (action === 'hidden tab') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        currentState = action === 'mode change' ? { ...currentState, mode: 'hardware', vision_source: 'gateway' } : { ...currentState, vision_source: 'simulated' };
        mounted.queryClient.setQueryData(deskKeys.state, currentState);
      }
    });
    await waitFor(() => expect(calls('/vision/stop')).toHaveLength(1));
    expect(calls('/vision/stop')[0][1]?.keepalive).toBe(true);
    expect(calls('/demo/vision-source')).toHaveLength(0);
    expect(calls('/demo/vision')).toHaveLength(0);
  });

  it('preserves a pre-existing headless pipeline when the dashboard unmounts', async () => {
    currentState = makeDesk({ mode: 'hardware', vision_source: 'gateway' });
    currentSnapshot = { ...currentSnapshot, status: 'running', delegate: 'CPU', view: 'side', cameraIndex: 1, fps: 15.5, observation: observation() };
    const mounted = renderWorkspace(<Harness />);
    await screen.findByText('Live Python vision');
    expect(screen.getByRole('combobox', { name: 'Camera view' })).toHaveValue('side');
    expect(screen.getByRole('combobox', { name: 'Backend camera index' })).toHaveValue('1');
    mounted.unmount();
    expect(calls('/vision/start')).toHaveLength(0);
    expect(calls('/vision/stop')).toHaveLength(0);
  });

  it('allows the same Python camera controls in the hardware workspace', async () => {
    currentState = makeDesk({ mode: 'hardware', vision_source: 'gateway' });
    renderWorkspace(<Harness />);
    await startRunning();
    expect(currentState.vision_source).toBe('gateway');
    expect(screen.queryByRole('button', { name: 'Use simulated vision' })).not.toBeInTheDocument();
    expect(screen.getByText(/Python camera observations join the real sensor metadata/)).toBeInTheDocument();
  });

  it('stops Python before explicitly switching back to simulated vision', async () => {
    renderWorkspace(<Harness />);
    await startRunning();
    await userEvent.click(await screen.findByRole('button', { name: 'Use simulated vision' }));
    await waitFor(() => expect(calls('/demo/vision-source')).toHaveLength(1));
    const paths = fetchMock.mock.calls.map(([input]) => String(input));
    expect(paths.indexOf('/api/vision/stop')).toBeLessThan(paths.indexOf('/api/demo/vision-source'));
    expect(JSON.parse(String(calls('/demo/vision-source')[0][1]?.body))).toEqual({ source: 'simulated' });
    expect(currentState.vision_source).toBe('simulated');
  });

  it('compensates a late Start response after Stop instead of reviving the camera', async () => {
    let resolveStart!: (response: Response) => void;
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, options) => String(input) === '/api/vision/start'
      ? new Promise<Response>((resolve) => { resolveStart = resolve; }) : defaultFetch(input, options));
    renderWorkspace(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start backend camera' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Starting the camera attached to the Python backend');
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    await act(async () => resolveStart(Response.json({ ...initialVisionSnapshot, status: 'running' })));
    await waitFor(() => expect(calls('/vision/stop')).toHaveLength(2));
    expect(screen.queryByText('Live Python vision')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start backend camera' })).toBeEnabled();
  });

  it('displays asynchronous Python pipeline errors from polling', async () => {
    const mounted = renderWorkspace(<Harness />);
    await startRunning();
    await act(async () => {
      currentSnapshot = { ...currentSnapshot, status: 'error', error: 'The camera disconnected. Reconnect it and start again.', observation: null };
      mounted.queryClient.setQueryData(visionStatusKey, currentSnapshot);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The camera disconnected');
    expect(screen.getByRole('button', { name: 'Start backend camera' })).toBeEnabled();
  });
});
