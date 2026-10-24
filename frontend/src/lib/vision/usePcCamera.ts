import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { deskKeys } from '../queries';
import type { DeskState } from '../types';
import type { CameraView } from './posture';
import { initialVisionSnapshot, type VisionSnapshot } from './protocol';

export const visionStatusKey = ['focusguard', 'vision', 'status'] as const;

type BrowserLease = {
  token: string | null;
  stream: MediaStream | null;
  socket: WebSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  canvas: HTMLCanvasElement | null;
  inFlight: boolean;
  acknowledged: boolean;
  closed: boolean;
};

type PcActivation = VisionSnapshot & { browserToken: string };

function releaseBrowser(lease: BrowserLease, video: HTMLVideoElement | null, closeSocket = true) {
  lease.closed = true;
  if (lease.timer) clearTimeout(lease.timer);
  if (lease.watchdog) clearTimeout(lease.watchdog);
  lease.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  if (video?.srcObject === lease.stream) {
    video.pause();
    video.srcObject = null;
  }
  lease.stream = null;
  if (lease.socket && closeSocket) {
    lease.socket.onopen = null;
    lease.socket.onmessage = null;
    lease.socket.onerror = null;
    lease.socket.onclose = null;
    lease.socket.close();
  }
  lease.canvas = null;
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission was denied. Allow camera access to use PC camera mode. The Python backend has been restored.';
    if (error.name === 'NotFoundError') return 'No PC camera was found. Connect a webcam and try again.';
    if (error.name === 'NotReadableError') return 'The PC camera is busy. Close other camera apps and try again.';
  }
  return error instanceof Error ? error.message : 'Could not open the PC camera. The Python backend has been restored.';
}

/** Python owns inference in both modes. The optional browser mode only sends JPEGs. */
export function usePcCamera(state: DeskState) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: visionStatusKey,
    queryFn: ({ signal }) => api<VisionSnapshot>('/vision/status', { signal }),
    refetchInterval: 500, staleTime: 0, retry: false,
  });
  const snapshot = status.data ?? initialVisionSnapshot;
  const [controlError, setControlError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [browserRequested, setBrowserRequested] = useState(false);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [selectedView, setSelectedView] = useState<CameraView>('front');
  const [mirrored, setMirrored] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const browser = useRef<BrowserLease | null>(null);
  const mounted = useRef(true);
  const active = useRef(false);
  const owned = useRef(false);
  const requestEpoch = useRef(0);
  const captureGeneration = useRef(0);
  const previousMode = useRef(state.mode);
  const previousSource = useRef(state.vision_source);
  const pcMode = browserRequested || snapshot.inputMode === 'pc_camera';
  active.current = pending || snapshot.status === 'loading' || snapshot.status === 'running';

  useEffect(() => {
    setSelectedView(snapshot.view);
    setCameraIndex(snapshot.cameraIndex);
  }, [snapshot.view, snapshot.cameraIndex]);

  const saveSnapshot = useCallback((next: VisionSnapshot) => {
    queryClient.setQueryData(visionStatusKey, next);
    setSelectedView(next.view);
    setCameraIndex(next.cameraIndex);
  }, [queryClient]);

  const restoreBrowser = useCallback(async (lease: BrowserLease, error?: string) => {
    const wasCurrent = browser.current === lease;
    if (wasCurrent) browser.current = null;
    releaseBrowser(lease, videoRef.current);
    if (mounted.current && wasCurrent) {
      setPending(false);
      setBrowserRequested(false);
      if (error) setControlError(error);
    }
    // Closing the socket also restores the backend. The explicit request covers
    // permission denial, page navigation and a lease that has not connected yet.
    if (lease.token) {
      try {
        const next = await api<VisionSnapshot>('/vision/input', { method: 'POST', body: JSON.stringify({ mode: 'python_backend', token: lease.token }), keepalive: true });
        if (mounted.current && wasCurrent && !browser.current) saveSnapshot(next);
      } catch (restoreError) {
        if (mounted.current && wasCurrent && !browser.current) setControlError(error ?? cameraError(restoreError));
      }
    }
    void queryClient.invalidateQueries({ queryKey: deskKeys.all });
  }, [queryClient, saveSnapshot]);

  const stopNative = useCallback(async () => {
    requestEpoch.current += 1;
    active.current = false;
    setPending(false);
    setControlError(null);
    try {
      const next = await api<VisionSnapshot>('/vision/stop', { method: 'POST', body: '{}', keepalive: true });
      owned.current = false;
      if (mounted.current) saveSnapshot(next);
      void queryClient.invalidateQueries({ queryKey: deskKeys.state });
    } catch (error) {
      if (mounted.current) setControlError(error instanceof Error ? error.message : 'Could not stop the Python camera service.');
    }
  }, [queryClient, saveSnapshot]);

  const stopPc = useCallback(async () => {
    const lease = browser.current;
    requestEpoch.current += 1;
    setControlError(null);
    if (lease) await restoreBrowser(lease);
  }, [restoreBrowser]);

  const stop = useCallback(async () => {
    if (browser.current) await stopPc();
    else if (snapshot.inputMode !== 'pc_camera') await stopNative();
  }, [snapshot.inputMode, stopNative, stopPc]);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      requestEpoch.current += 1;
      if (browser.current) {
        void restoreBrowser(browser.current);
        return;
      }
      if (!owned.current) return;
      owned.current = false;
      active.current = false;
      void api('/vision/stop', { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
    };
    const hide = () => { if (document.hidden) leave(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [restoreBrowser]);

  useEffect(() => {
    const switchedMode = previousMode.current !== state.mode;
    const switchedAway = (previousSource.current === 'pc_camera' || previousSource.current === 'gateway') && previousSource.current !== state.vision_source;
    previousMode.current = state.mode;
    previousSource.current = state.vision_source;
    if ((owned.current || browser.current) && (switchedMode || switchedAway)) void stop();
  }, [state.mode, state.vision_source, stop]);

  const command = useCallback(async (path: string, body: object) => {
    setControlError(null);
    try {
      const next = await api<VisionSnapshot>(path, { method: 'POST', body: JSON.stringify(body) });
      if (mounted.current) saveSnapshot(next);
      return next;
    } catch (error) {
      if (mounted.current) setControlError(error instanceof Error ? error.message : 'The Python camera service could not complete this action.');
      return null;
    }
  }, [saveSnapshot]);

  const start = useCallback(async () => {
    if (active.current || browser.current || snapshot.inputMode === 'pc_camera') return;
    const epoch = ++requestEpoch.current;
    const generation = ++captureGeneration.current;
    owned.current = true;
    active.current = true;
    setPending(true);
    setControlError(null);
    try {
      const next = await api<VisionSnapshot>('/vision/start', { method: 'POST', body: JSON.stringify({ camera_index: cameraIndex, view: selectedView }) });
      if (!mounted.current || requestEpoch.current !== epoch) {
        // A cancelled old Start may finish after a new PC/native session began.
        // Its compensation must never stop that replacement pipeline.
        if (captureGeneration.current === generation) void api('/vision/stop', { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
        return;
      }
      saveSnapshot(next);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
    } catch (error) {
      if (mounted.current && requestEpoch.current === epoch) setControlError(error instanceof Error ? error.message : 'Could not start the backend camera.');
    } finally {
      if (mounted.current && requestEpoch.current === epoch) setPending(false);
    }
  }, [cameraIndex, queryClient, saveSnapshot, selectedView, snapshot.inputMode]);

  const startPc = useCallback(async () => {
    if (browser.current || state.mode !== 'demo' || snapshot.inputMode === 'pc_camera' || pending) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setControlError('PC camera requires localhost or HTTPS and a browser with webcam access.');
      return;
    }
    const lease: BrowserLease = { token: null, stream: null, socket: null, timer: null, watchdog: null, canvas: null, inFlight: false, acknowledged: false, closed: false };
    browser.current = lease;
    captureGeneration.current += 1;
    // A handoff makes the saved native profile a server-owned background
    // pipeline, even when the activation response is lost or arrives late.
    owned.current = false;
    requestEpoch.current += 1;
    setBrowserRequested(true);
    setPending(true);
    setControlError(null);
    const current = () => mounted.current && browser.current === lease && !lease.closed;
    const fail = (error: unknown) => { if (current()) void restoreBrowser(lease, cameraError(error)); };
    try {
      // Suspend native capture before asking the browser to open the same device.
      const activated = await api<PcActivation>('/vision/input', { method: 'POST', body: JSON.stringify({ mode: 'pc_camera', view: selectedView }) });
      lease.token = activated.browserToken;
      if (!current()) { await restoreBrowser(lease); return; }
      const { browserToken: _token, ...publicSnapshot } = activated;
      saveSnapshot(publicSnapshot);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 } } });
      lease.stream = stream;
      if (!current()) { releaseBrowser(lease, videoRef.current); return; }
      stream.getVideoTracks().forEach(track => { track.onended = () => fail(new Error('The PC camera disconnected. Python backend mode has been restored.')); });
      const video = videoRef.current;
      if (!video) throw new Error('The camera preview could not be initialized.');
      video.srcObject = stream;
      await video.play();
      if (!current()) return;
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}/api/vision/pc-camera`, ['focusguard-pc', lease.token]);
      lease.socket = socket;
      lease.canvas = document.createElement('canvas');
      const schedule = () => {
        if (!current() || lease.inFlight || socket.readyState !== WebSocket.OPEN) return;
        lease.timer = setTimeout(capture, 100);
      };
      const capture = () => {
        lease.timer = null;
        if (!current() || lease.inFlight || socket.readyState !== WebSocket.OPEN) return;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) { schedule(); return; }
        const canvas = lease.canvas;
        if (!canvas) return;
        const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { fail(new Error('This browser could not encode camera frames.')); return; }
        lease.inFlight = true;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (!current()) return;
          if (!blob || blob.size > 512 * 1024 || socket.readyState !== WebSocket.OPEN) {
            fail(new Error('The PC camera connection could not send a frame. Python backend mode has been restored.'));
            return;
          }
          try {
            socket.send(blob);
            if (lease.watchdog) clearTimeout(lease.watchdog);
            lease.watchdog = setTimeout(() => fail(new Error('Python did not acknowledge the camera frame. Backend mode has been restored.')), lease.acknowledged ? 12000 : 50000);
          } catch (error) { fail(error); }
        }, 'image/jpeg', 0.7);
      };
      socket.onopen = () => { if (current()) { if (lease.watchdog) clearTimeout(lease.watchdog); setPending(false); capture(); } };
      socket.onmessage = event => {
        if (!current()) return;
        try {
          const next = JSON.parse(String(event.data)) as VisionSnapshot;
          if (!next || next.inputMode !== 'pc_camera' || !['loading', 'running', 'error'].includes(next.status)) throw new Error('The Python camera returned an invalid result.');
          if (lease.watchdog) clearTimeout(lease.watchdog);
          lease.inFlight = false;
          lease.acknowledged = true;
          saveSnapshot(next);
          if (next.status === 'error') { fail(new Error(next.error ?? 'Python camera inference failed.')); return; }
          schedule();
        } catch (error) { fail(error); }
      };
      socket.onerror = () => fail(new Error('The PC camera connection failed. Python backend mode has been restored.'));
      socket.onclose = () => fail(new Error('The PC camera connection closed. Python backend mode has been restored.'));
      lease.watchdog = setTimeout(() => fail(new Error('Could not connect the PC camera to Python. Backend mode has been restored.')), 12000);
    } catch (error) { fail(error); }
  }, [pending, queryClient, restoreBrowser, saveSnapshot, selectedView, snapshot.inputMode, state.mode]);

  const setView = useCallback((view: CameraView) => {
    setSelectedView(view);
    void command('/vision/view', { view });
  }, [command]);

  const useSimulated = useCallback(async () => {
    const lease = browser.current;
    requestEpoch.current += 1;
    captureGeneration.current += 1;
    owned.current = false;
    if (lease) {
      browser.current = null;
      // Keep the socket until the explicit source command cancels its lease.
      // Closing it first would briefly resume the old native camera.
      releaseBrowser(lease, videoRef.current, false);
    } else await stopNative();
    setPending(true);
    setControlError(null);
    try {
      const next = await api<DeskState>('/demo/vision-source', { method: 'POST', body: JSON.stringify({ source: 'simulated' }) });
      if (mounted.current) queryClient.setQueryData(deskKeys.state, next);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
    } catch (error) { if (mounted.current) setControlError(error instanceof Error ? error.message : 'Could not select simulated vision.'); }
    finally {
      if (lease) releaseBrowser(lease, videoRef.current);
      if (mounted.current) { setBrowserRequested(false); setPending(false); }
      void queryClient.invalidateQueries({ queryKey: visionStatusKey });
    }
  }, [queryClient, stopNative]);

  return {
    ...snapshot, pcMode, browserRequested, videoRef,
    pcControlledElsewhere: snapshot.inputMode === 'pc_camera' && !browserRequested,
    status: pending ? 'loading' as const : snapshot.status,
    error: controlError ?? snapshot.error ?? (status.error instanceof Error ? status.error.message : null),
    message: pending ? browserRequested ? 'Opening PC camera and connecting to Python…' : 'Starting the camera attached to the Python backend…' : snapshot.message,
    width: snapshot.observation?.width ?? 640, height: snapshot.observation?.height ?? 480,
    view: selectedView, setView, cameraIndex, setCameraIndex, mirrored, setMirrored,
    start, stop, startPc, stopPc, calibrate: () => void command('/vision/calibrate', {}),
    setPreview: (enabled: boolean) => void command('/vision/preview', { enabled }), useSimulated,
  };
}
