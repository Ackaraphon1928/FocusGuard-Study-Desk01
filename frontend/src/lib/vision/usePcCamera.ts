import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { deskKeys } from '../queries';
import type { DeskState } from '../types';
import type { CameraView } from './posture';
import { drawPose } from './drawing';
import { observationMetadata, unavailableMetadata, type PoseObservation, type PoseWorkerInput, type PoseWorkerOutput } from './protocol';

export type CameraStatus = 'idle' | 'requesting' | 'loading' | 'running' | 'stopped' | 'error';
interface CameraSnapshot {
  status: CameraStatus;
  error: string | null;
  publishingError: string | null;
  message: string;
  observation: PoseObservation | null;
  delegate: 'GPU' | 'CPU' | null;
  width: number;
  height: number;
}

interface CameraRuntime {
  video: HTMLVideoElement;
  stream: MediaStream | null;
  worker: Worker | null;
  abort: AbortController;
  frameId: number | null;
  videoCallback: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval> | null;
  rejectReady: ((reason: Error) => void) | null;
  inFlight: boolean;
  ignoreNextResult: boolean;
  publishing: boolean;
  selected: boolean;
  lastCapture: number;
  lastResult: number;
  lastPublish: number;
  ended: (() => void) | null;
}

const initialSnapshot: CameraSnapshot = {
  status: 'idle', error: null, publishingError: null, message: 'Camera is off. Start it when you are ready.',
  observation: null, delegate: null, width: 640, height: 480,
};

function release(runtime: CameraRuntime): void {
  const video = runtime.video;
  runtime.abort.abort();
  if (runtime.timeout) clearTimeout(runtime.timeout);
  if (runtime.watchdog) clearInterval(runtime.watchdog);
  runtime.rejectReady?.(new Error('Camera startup was cancelled.'));
  runtime.rejectReady = null;
  if (runtime.frameId != null) {
    if (runtime.videoCallback) video?.cancelVideoFrameCallback?.(runtime.frameId);
    else cancelAnimationFrame(runtime.frameId);
  }
  for (const track of runtime.stream?.getTracks() ?? []) {
    if (runtime.ended) track.removeEventListener('ended', runtime.ended);
    track.stop();
  }
  runtime.worker?.terminate();
  if (video && video.srcObject === runtime.stream) {
    video.pause(); video.srcObject = null;
  }
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission was denied. Allow this localhost site to use your camera, then start again.';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'No matching camera was found. Connect a webcam or choose another camera.';
    if (error.name === 'NotReadableError') return 'The camera could not be opened. Close other camera applications and try again.';
  }
  return error instanceof Error ? error.message : 'The PC camera could not be started.';
}

export function usePcCamera(state: DeskState) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<CameraRuntime | null>(null);
  const stateRef = useRef(state);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setViewValue] = useState<CameraView>('front');
  const [deviceId, setDeviceId] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mirrored, setMirrored] = useState(true);
  useEffect(() => { stateRef.current = state; }, [state]);

  const markUnavailable = useCallback(() => {
    // keepalive permits a small metadata-only update during navigation/unload.
    void api('/demo/vision', { method: 'POST', body: JSON.stringify(unavailableMetadata()), keepalive: true }).catch(() => {});
  }, []);

  const stop = useCallback((message = 'Camera stopped. PC vision remains selected and is unavailable until you start again.') => {
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    if (runtime) {
      release(runtime);
      if (runtime.selected) markUnavailable();
    }
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setSnapshot(previous => ({ ...previous, status: 'stopped', observation: null, error: null, publishingError: null, message }));
  }, [markUnavailable]);

  useEffect(() => {
    const hide = () => { if (document.hidden && runtimeRef.current) stop('Camera stopped because this tab was hidden. Start it again when you return.'); };
    const leave = () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) { release(runtime); if (runtime.selected) markUnavailable(); }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [markUnavailable, stop]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && (state.mode !== 'demo' || (runtime.selected && state.vision_source !== 'pc_camera'))) {
      stop('Camera stopped because the workspace or vision source changed.');
    }
  }, [state.mode, state.vision_source, stop]);

  const start = useCallback(async () => {
    if (runtimeRef.current) return;
    if (stateRef.current.mode !== 'demo') {
      setSnapshot(previous => ({ ...previous, status: 'error', error: 'Use the demo workspace for the PC camera. Hardware mode listens to the Raspberry Pi.' }));
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setSnapshot(previous => ({ ...previous, status: 'error', error: 'Camera access needs a secure context. Open http://127.0.0.1:5173, localhost, or HTTPS in a current desktop Chrome or Edge.' }));
      return;
    }
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      setSnapshot(previous => ({ ...previous, status: 'error', error: 'This browser lacks the worker or image APIs needed for local pose inference. Use a current desktop Chrome or Edge.' }));
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const runtime: CameraRuntime = {
      video, stream: null, worker: null, abort: new AbortController(), frameId: null, videoCallback: false,
      timeout: null, watchdog: null, rejectReady: null, inFlight: false, ignoreNextResult: false, publishing: false,
      selected: false, lastCapture: -Infinity, lastResult: performance.now(), lastPublish: -Infinity, ended: null,
    };
    runtimeRef.current = runtime;
    setSnapshot({ ...initialSnapshot, status: 'requesting', message: 'Waiting for camera permission…' });
    const fail = (error: unknown) => {
      if (runtimeRef.current !== runtime) return;
      const message = cameraError(error);
      stop();
      setSnapshot(previous => ({ ...previous, status: 'error', error: message, message: 'Camera is off.' }));
    };
    try {
      // getUserMedia is invoked only by this user-triggered start action.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
      });
      if (runtimeRef.current !== runtime) { stream.getTracks().forEach(track => track.stop()); return; }
      runtime.stream = stream;
      runtime.ended = () => fail(new Error('The camera disconnected. Reconnect it, then start again.'));
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', runtime.ended!));
      video.srcObject = stream;
      await video.play();
      if (runtimeRef.current !== runtime) return;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (runtimeRef.current !== runtime) return;
      setCameras(devices.filter(device => device.kind === 'videoinput'));
      setSnapshot(previous => ({ ...previous, status: 'loading', width: video.videoWidth || 640, height: video.videoHeight || 480, message: 'Loading the local MediaPipe model and WASM runtime…' }));
      const worker = new Worker('/vision/pose.worker.js');
      runtime.worker = worker;
      const ready = new Promise<'GPU' | 'CPU'>((resolve, reject) => {
        runtime.rejectReady = reject;
        runtime.timeout = setTimeout(() => reject(new Error('The local pose model did not initialize. Restart the camera; if needed run npm run prepare:vision and restart the dev server.')), 40000);
        worker.onerror = () => { const error = new Error('The pose worker could not run. Check that the local model and worker assets were built, then restart.'); reject(error); fail(error); };
        worker.onmessage = ({ data }: MessageEvent<PoseWorkerOutput>) => {
          if (runtimeRef.current !== runtime) return;
          if (data.type === 'ready') { if (runtime.timeout) clearTimeout(runtime.timeout); runtime.rejectReady = null; resolve(data.delegate); return; }
          if (data.type === 'error') { reject(new Error(data.message)); fail(new Error(data.message)); return; }
          if (data.type !== 'result') return;
          runtime.inFlight = false;
          runtime.lastResult = performance.now();
          if (runtime.ignoreNextResult) { runtime.ignoreNextResult = false; return; }
          if (canvasRef.current) drawPose(canvasRef.current, data);
          setSnapshot(previous => ({ ...previous, observation: data, width: data.width, height: data.height }));
          if (!runtime.selected || runtime.publishing || runtime.lastResult - runtime.lastPublish < 450) return;
          runtime.lastPublish = runtime.lastResult;
          runtime.publishing = true;
          void api('/demo/vision', { method: 'POST', body: JSON.stringify(observationMetadata(data)), signal: runtime.abort.signal })
            .then(() => { if (runtimeRef.current === runtime) setSnapshot(previous => previous.publishingError ? { ...previous, publishingError: null } : previous); })
            .catch((error: unknown) => {
              if (runtimeRef.current !== runtime || runtime.abort.signal.aborted) return;
              if (error instanceof ApiError && (error.status === 409 || error.status === 422)) { fail(error); return; }
              setSnapshot(previous => ({ ...previous, publishingError: 'Local preview continues, but the monitoring service is disconnected. Its camera data will expire until the connection returns.' }));
            })
            .finally(() => { runtime.publishing = false; });
        };
      });
      worker.postMessage({ type: 'init', view } satisfies PoseWorkerInput);
      const delegate = await ready;
      if (runtimeRef.current !== runtime) return;
      const source = await api<DeskState>('/demo/vision-source', { method: 'POST', body: JSON.stringify({ source: 'pc_camera' }), signal: runtime.abort.signal });
      runtime.selected = true;
      if (runtimeRef.current !== runtime) { markUnavailable(); return; }
      queryClient.setQueryData(deskKeys.state, source);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
      runtime.lastResult = performance.now();
      setSnapshot(previous => ({ ...previous, status: 'running', delegate, message: 'PC camera is live. Sit upright and calibrate your neutral posture.' }));

      const schedule = () => {
        if (runtimeRef.current !== runtime) return;
        if (video.requestVideoFrameCallback) {
          runtime.videoCallback = true;
          runtime.frameId = video.requestVideoFrameCallback(() => { void capture(); });
        } else {
          runtime.videoCallback = false;
          runtime.frameId = requestAnimationFrame(() => { void capture(); });
        }
      };
      const capture = async () => {
        if (runtimeRef.current !== runtime) return;
        schedule();
        const timestamp = performance.now();
        if (runtime.inFlight || timestamp - runtime.lastCapture < 66 || video.readyState < 2 || video.paused || document.hidden) return;
        runtime.inFlight = true;
        runtime.lastCapture = timestamp;
        try {
          const bitmap = await createImageBitmap(video);
          if (runtimeRef.current !== runtime) { bitmap.close(); return; }
          worker.postMessage({ type: 'frame', frame: bitmap, timestampMs: timestamp } satisfies PoseWorkerInput, [bitmap]);
        } catch (error) { runtime.inFlight = false; fail(error); }
      };
      runtime.watchdog = setInterval(() => {
        if (runtimeRef.current === runtime && performance.now() - runtime.lastResult > 8000) fail(new Error('The pose pipeline stopped producing frames. Check the camera, then start again.'));
      }, 1000);
      schedule();
    } catch (error) { fail(error); }
  }, [deviceId, markUnavailable, queryClient, stop, view]);

  const calibrate = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime) { runtime.ignoreNextResult = runtime.inFlight; runtime.worker?.postMessage({ type: 'calibrate' } satisfies PoseWorkerInput); if (runtime.selected) markUnavailable(); }
    setSnapshot(previous => ({ ...previous, observation: null, message: 'Keep still in your normal upright posture. Collecting a reliable neutral baseline…' }));
  }, [markUnavailable]);

  const setView = useCallback((next: CameraView) => {
    setViewValue(next);
    const runtime = runtimeRef.current;
    if (runtime) { runtime.ignoreNextResult = runtime.inFlight; runtime.worker?.postMessage({ type: 'view', view: next } satisfies PoseWorkerInput); }
    setSnapshot(previous => ({ ...previous, observation: null, message: 'Camera view changed. Calibrate your upright posture again.' }));
    if (runtimeRef.current?.selected) markUnavailable();
  }, [markUnavailable]);

  const useSimulated = useCallback(async () => {
    stop('Camera is off. Simulated vision is selected.');
    try {
      const next = await api<DeskState>('/demo/vision-source', { method: 'POST', body: JSON.stringify({ source: 'simulated' }) });
      queryClient.setQueryData(deskKeys.state, next);
      await queryClient.invalidateQueries({ queryKey: deskKeys.all });
    } catch (error) { setSnapshot(previous => ({ ...previous, error: cameraError(error) })); }
  }, [queryClient, stop]);

  return { ...snapshot, videoRef, canvasRef, view, setView, mirrored, setMirrored, deviceId, setDeviceId, cameras, start, stop, calibrate, useSimulated };
}
