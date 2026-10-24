import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { deskKeys } from '../queries';
import type { DeskState } from '../types';
import type { CameraView } from './posture';
import { initialVisionSnapshot, type VisionSnapshot } from './protocol';

export const visionStatusKey = ['focusguard', 'vision', 'status'] as const;

/** The browser controls and displays the Python pipeline; it never opens a camera. */
export function usePcCamera(state: DeskState) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: visionStatusKey,
    queryFn: ({ signal }) => api<VisionSnapshot>('/vision/status', { signal }),
    refetchInterval: 500,
    staleTime: 0,
    retry: false,
  });
  const snapshot = status.data ?? initialVisionSnapshot;
  const [controlError, setControlError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [selectedView, setSelectedView] = useState<CameraView>('front');
  const [mirrored, setMirrored] = useState(true);
  const mounted = useRef(true);
  const active = useRef(false);
  const owned = useRef(false);
  const requestEpoch = useRef(0);
  const previousMode = useRef(state.mode);
  const previousSource = useRef(state.vision_source);
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

  const stop = useCallback(async () => {
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

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      requestEpoch.current += 1;
      if (!owned.current) return;
      owned.current = false;
      active.current = false;
      void api('/vision/stop', { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
    };
    const hide = () => { if (document.hidden && owned.current) void stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [stop]);

  useEffect(() => {
    const switchedMode = previousMode.current !== state.mode;
    const switchedAway = (previousSource.current === 'pc_camera' || previousSource.current === 'gateway') && previousSource.current !== state.vision_source;
    previousMode.current = state.mode;
    previousSource.current = state.vision_source;
    if (owned.current && (switchedMode || switchedAway)) void stop();
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
    if (active.current) return;
    const epoch = ++requestEpoch.current;
    owned.current = true;
    active.current = true;
    setPending(true);
    setControlError(null);
    try {
      const next = await api<VisionSnapshot>('/vision/start', { method: 'POST', body: JSON.stringify({ camera_index: cameraIndex, view: selectedView }) });
      if (!mounted.current || requestEpoch.current !== epoch) {
        // A late response must not reopen a camera after Stop or navigation.
        void api('/vision/stop', { method: 'POST', body: '{}', keepalive: true }).catch(() => {});
        return;
      }
      saveSnapshot(next);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
    } catch (error) {
      if (mounted.current && requestEpoch.current === epoch) {
        // A lost response can hide a successful server-side start. Retain
        // ownership so Stop, hide or navigation can still release that camera.
        setControlError(error instanceof Error ? error.message : 'Could not start the backend camera.');
      }
    } finally {
      if (mounted.current && requestEpoch.current === epoch) setPending(false);
    }
  }, [cameraIndex, queryClient, saveSnapshot, selectedView]);

  const setView = useCallback((view: CameraView) => {
    setSelectedView(view);
    void command('/vision/view', { view });
  }, [command]);

  const useSimulated = useCallback(async () => {
    await stop();
    try {
      const next = await api<DeskState>('/demo/vision-source', { method: 'POST', body: JSON.stringify({ source: 'simulated' }) });
      if (mounted.current) queryClient.setQueryData(deskKeys.state, next);
      void queryClient.invalidateQueries({ queryKey: deskKeys.all });
    } catch (error) { if (mounted.current) setControlError(error instanceof Error ? error.message : 'Could not select simulated vision.'); }
  }, [queryClient, stop]);

  return {
    ...snapshot,
    status: pending ? 'loading' as const : snapshot.status,
    error: controlError ?? snapshot.error ?? (status.error instanceof Error ? status.error.message : null),
    message: pending ? 'Starting the camera attached to the Python backend…' : snapshot.message,
    width: snapshot.observation?.width ?? 640,
    height: snapshot.observation?.height ?? 480,
    view: selectedView, setView, cameraIndex, setCameraIndex, mirrored, setMirrored,
    start, stop, calibrate: () => void command('/vision/calibrate', {}),
    setPreview: (enabled: boolean) => void command('/vision/preview', { enabled }),
    useSimulated,
  };
}
