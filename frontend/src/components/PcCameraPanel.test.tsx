import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PcCameraPanel } from './PcCameraPanel';
import { deskKeys, useDesk } from '../lib/queries';
import { makeDesk } from '../test/fixtures';
import { renderWorkspace } from '../test/render';
import type { DeskState } from '../lib/types';
import type { PoseObservation, PoseWorkerInput, PoseWorkerOutput } from '../lib/vision/protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: string;
  onmessage: ((event: MessageEvent<PoseWorkerOutput>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn<(message: PoseWorkerInput, transfer?: Transferable[]) => void>();
  terminate = vi.fn();
  constructor(url: string | URL) { this.url = String(url); FakeWorker.instances.push(this); }
  emit(data: PoseWorkerOutput) { this.onmessage?.({ data } as MessageEvent<PoseWorkerOutput>); }
}

function Harness() {
  const { data } = useDesk();
  return data ? <PcCameraPanel state={data} /> : null;
}

function poseObservation(): PoseObservation {
  return {
    type: 'result', people: 1, fps: 15.5, inferenceMs: 28, width: 640, height: 480,
    landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }))],
    result: {
      posture: 'GOOD', candidate: 'GOOD', confidence: 0.95, personDetected: true,
      geometry: { headHeightRatio: 0.5, headOffsetRatio: 0, torsoAngleDeg: 0, shoulderAngleDeg: 0, forwardRatio: null, neckForwardRatio: null, confidence: 0.95, forwardSource: 'unavailable' },
      calibration: { status: 'ready', frames: 30, required: 30 }, reason: 'tracking_2d',
    },
  };
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalRequestFrame = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'requestVideoFrameCallback');
const originalCancelFrame = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'cancelVideoFrameCallback');
let tracks: (MediaStreamTrack & { stop: ReturnType<typeof vi.fn> })[];
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn<MediaDevices['getUserMedia']>>;
let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>>;
let currentState: DeskState;
let callbacks: Map<number, VideoFrameRequestCallback>;
let nextFrameId: number;
let requestFrame: ReturnType<typeof vi.fn<(callback: VideoFrameRequestCallback) => number>>;
let cancelFrame: ReturnType<typeof vi.fn<(id: number) => void>>;
let bitmap: ImageBitmap;
let hidden: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  currentState = makeDesk();
  tracks = Array.from({ length: 2 }, () => Object.assign(new EventTarget(), { stop: vi.fn(), kind: 'video' })) as unknown as typeof tracks;
  stream = { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
  getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) } });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Worker', FakeWorker);
  FakeWorker.instances = [];
  bitmap = { close: vi.fn(), width: 640, height: 480 } as unknown as ImageBitmap;
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
  hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  callbacks = new Map();
  nextFrameId = 0;
  requestFrame = vi.fn((callback: VideoFrameRequestCallback) => { const id = ++nextFrameId; callbacks.set(id, callback); return id; });
  cancelFrame = vi.fn((id: number) => { callbacks.delete(id); });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: requestFrame });
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: cancelFrame });
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url === '/api/state') return Response.json(currentState);
    if (url === '/api/demo/vision-source') {
      const { source } = JSON.parse(String(options?.body));
      currentState = { ...currentState, vision_source: source };
      return Response.json(currentState);
    }
    if (url === '/api/demo/vision') return Response.json({ accepted: true });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  for (const [object, key, descriptor] of [
    [navigator, 'mediaDevices', originalMediaDevices],
    [HTMLVideoElement.prototype, 'requestVideoFrameCallback', originalRequestFrame],
    [HTMLVideoElement.prototype, 'cancelVideoFrameCallback', originalCancelFrame],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
});

function sourceRequests() { return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/demo/vision-source'); }
function metadataRequests() { return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/demo/vision'); }

async function startUntilModelLoads() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start PC camera' }));
  await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
  return FakeWorker.instances[0];
}

async function startRunning() {
  const worker = await startUntilModelLoads();
  await act(async () => { worker.emit({ type: 'ready', delegate: 'CPU' }); });
  await screen.findByText('Live PC vision');
  return worker;
}

describe('PC camera lifecycle and metadata publishing', () => {
  it('requests neither permission nor source changes until Start PC camera is clicked', async () => {
    renderWorkspace(<Harness />);
    await screen.findByRole('button', { name: 'Start PC camera' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(sourceRequests()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Calibrate upright posture' })).toBeDisabled();
  });

  it('explains permission denial without changing the selected vision source', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    renderWorkspace(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start PC camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission was denied');
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(sourceRequests()).toHaveLength(0);
    expect(metadataRequests()).toHaveLength(0);
    expect(FakeWorker.instances).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Start PC camera' })).toBeEnabled();
  });

  it('selects PC vision only after the model is ready and publishes an allowlisted frame result', async () => {
    renderWorkspace(<Harness />);
    const worker = await startUntilModelLoads();
    expect(worker.url).toBe('/vision/pose.worker.js');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', view: 'front' });
    expect(sourceRequests()).toHaveLength(0);
    await act(async () => { worker.emit({ type: 'ready', delegate: 'CPU' }); });
    await screen.findByText('Live PC vision');
    expect(sourceRequests()).toHaveLength(1);
    expect(JSON.parse(String(sourceRequests()[0][1]?.body))).toEqual({ source: 'pc_camera' });
    const [id, callback] = [...callbacks][0];
    callbacks.delete(id);
    await act(async () => { callback(performance.now(), {} as VideoFrameCallbackMetadata); });
    await waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'frame', frame: bitmap }), [bitmap]));
    await act(async () => { worker.emit(poseObservation()); });
    await waitFor(() => expect(metadataRequests()).toHaveLength(1));
    const metadata = JSON.parse(String(metadataRequests()[0][1]?.body));
    expect(metadata).toEqual({ person_detected: true, posture: 'GOOD', confidence: 0.95, fps: 15.5, vision_available: true, inference_ms: 28, ambiguous_people: false });
    expect(JSON.stringify(metadata)).not.toMatch(/landmark|geometry|frame|image|width|height/i);
    expect(screen.getByText('15.5 actual FPS')).toBeInTheDocument();
  });

  it.each(['stop', 'unmount'] as const)('releases every track and the worker on %s, marks unavailable, and keeps PC vision selected', async (action) => {
    const mounted = renderWorkspace(<Harness />);
    const worker = await startRunning();
    if (action === 'stop') await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    else mounted.unmount();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    await waitFor(() => expect(metadataRequests()).toHaveLength(1));
    expect(JSON.parse(String(metadataRequests()[0][1]?.body))).toMatchObject({ vision_available: false, posture: 'UNKNOWN', confidence: 0, fps: 0 });
    expect(metadataRequests()[0][1]?.keepalive).toBe(true);
    expect(sourceRequests()).toHaveLength(1);
    expect(currentState.vision_source).toBe('pc_camera');
    await act(async () => { worker.emit(poseObservation()); });
    expect(metadataRequests()).toHaveLength(1);
    if (action === 'stop') expect((screen.getByLabelText('Local PC camera preview') as HTMLVideoElement).srcObject).toBeNull();
  });

  it('stops a late permission stream when startup was cancelled while permission was pending', async () => {
    let resolvePermission!: (value: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => { resolvePermission = resolve; }));
    renderWorkspace(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start PC camera' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Waiting for camera permission…');
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    await act(async () => { resolvePermission(stream); });
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(sourceRequests()).toHaveLength(0);
    expect(metadataRequests()).toHaveLength(0);
  });

  it('does not restart a cancelled camera when the vision-source HTTP response arrives late', async () => {
    let resolveSource!: (value: Response) => void;
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, options) => String(input) === '/api/demo/vision-source'
      ? new Promise<Response>((resolve) => { resolveSource = resolve; }) : defaultFetch(input, options));
    renderWorkspace(<Harness />);
    const worker = await startUntilModelLoads();
    await act(async () => { worker.emit({ type: 'ready', delegate: 'CPU' }); });
    await waitFor(() => expect(sourceRequests()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    await act(async () => {
      currentState = { ...currentState, vision_source: 'pc_camera' };
      resolveSource(Response.json(currentState));
    });
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(screen.queryByText('Live PC vision')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start PC camera' })).toBeEnabled();
    await waitFor(() => expect(metadataRequests()).toHaveLength(1));
    expect(JSON.parse(String(metadataRequests()[0][1]?.body)).vision_available).toBe(false);
  });

  it.each(['hardware mode', 'hidden tab'] as const)('stops the running camera when switching to %s', async (reason) => {
    const mounted = renderWorkspace(<Harness />);
    const worker = await startRunning();
    await act(async () => {
      if (reason === 'hardware mode') {
        currentState = { ...currentState, mode: 'hardware', vision_source: 'gateway' };
        mounted.queryClient.setQueryData(deskKeys.state, currentState);
      } else {
        hidden.mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    await waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(metadataRequests()).toHaveLength(1);
    expect(JSON.parse(String(metadataRequests()[0][1]?.body)).vision_available).toBe(false);
    if (reason === 'hardware mode') expect(screen.getByRole('button', { name: 'Start PC camera' })).toBeDisabled();
  });

  it('sends calibration and view changes to the local worker while clearing server posture', async () => {
    renderWorkspace(<Harness />);
    const worker = await startRunning();
    await userEvent.click(screen.getByRole('button', { name: 'Calibrate upright posture' }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'calibrate' });
    expect(metadataRequests()).toHaveLength(1);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Camera view' }), 'side');
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'view', view: 'side' });
    expect(metadataRequests()).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: 'Camera device' })).toBeDisabled();
    expect(sourceRequests()).toHaveLength(1);
  });

  it('requires the explicit simulated-vision action to return to simulated posture', async () => {
    renderWorkspace(<Harness />);
    const worker = await startRunning();
    await userEvent.click(screen.getByRole('button', { name: 'Use simulated vision' }));
    await waitFor(() => expect(currentState.vision_source).toBe('simulated'));
    expect(worker.terminate).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(sourceRequests()).toHaveLength(2);
    expect(JSON.parse(String(sourceRequests()[1][1]?.body))).toEqual({ source: 'simulated' });
  });

  it('closes a late ImageBitmap when stopped during frame capture without sending it to a terminated worker', async () => {
    let resolveBitmap!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(() => new Promise<ImageBitmap>((resolve) => { resolveBitmap = resolve; })));
    renderWorkspace(<Harness />);
    const worker = await startRunning();
    const [id, callback] = [...callbacks][0];
    callbacks.delete(id);
    await act(async () => { callback(performance.now(), {} as VideoFrameCallbackMetadata); });
    expect(createImageBitmap).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
    await act(async () => { resolveBitmap(bitmap); });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls.some(([message]) => message.type === 'frame')).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('releases camera access if the local worker cannot initialize without selecting PC vision', async () => {
    renderWorkspace(<Harness />);
    const worker = await startUntilModelLoads();
    await act(async () => { worker.emit({ type: 'error', message: 'Local model is missing. Prepare the model and restart.' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Local model is missing');
    expect(worker.terminate).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(sourceRequests()).toHaveLength(0);
    expect(metadataRequests()).toHaveLength(0);
  });

  it('handles camera track disconnection by releasing resources and clearing the server observation', async () => {
    renderWorkspace(<Harness />);
    const worker = await startRunning();
    await act(async () => { tracks[0].dispatchEvent(new Event('ended')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('The camera disconnected');
    expect(worker.terminate).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(JSON.parse(String(metadataRequests()[0][1]?.body)).vision_available).toBe(false);
    expect(currentState.vision_source).toBe('pc_camera');
  });
});
