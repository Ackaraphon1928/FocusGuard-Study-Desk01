import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { DataMode, DeskEvent, DeskState, HistoryPoint, Metrics, StudySession } from './types';

export const deskKeys = {
  all: ['focusguard'] as const,
  state: ['focusguard', 'state'] as const,
  history: (mode: DataMode, minutes: number) => ['focusguard', 'history', mode, minutes] as const,
  sessions: (mode: DataMode) => ['focusguard', 'sessions', mode] as const,
  events: (mode: DataMode) => ['focusguard', 'events', mode] as const,
  metrics: ['focusguard', 'metrics'] as const,
};

export function useDesk() {
  return useQuery({
    queryKey: deskKeys.state,
    queryFn: ({ signal }) => api<DeskState>('/state', { signal }),
    refetchInterval: 1000,
    staleTime: 500,
    retry: 1,
  });
}

export function useHistory(mode: DataMode, minutes = 60) {
  return useQuery({
    queryKey: deskKeys.history(mode, minutes),
    queryFn: ({ signal }) => api<HistoryPoint[]>(`/history?mode=${mode}&minutes=${minutes}&limit=10000`, { signal }),
    refetchInterval: 7000,
    staleTime: 5000,
  });
}

export function useSessions(mode: DataMode) {
  return useQuery({
    queryKey: deskKeys.sessions(mode),
    queryFn: ({ signal }) => api<StudySession[]>(`/sessions?mode=${mode}`, { signal }),
    refetchInterval: 7000,
    staleTime: 3000,
  });
}

export function useEvents(mode: DataMode) {
  return useQuery({
    queryKey: deskKeys.events(mode),
    queryFn: ({ signal }) => api<DeskEvent[]>(`/events?mode=${mode}&limit=1000`, { signal }),
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useMetrics() {
  return useQuery({
    queryKey: deskKeys.metrics,
    queryFn: ({ signal }) => api<Metrics>('/metrics', { signal }),
    refetchInterval: 7000,
    staleTime: 5000,
  });
}

export function useDeskMutation<TVariables, TData = DeskState>(mutationFn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (data) => {
      if (data && typeof data === 'object' && 'sensors' in data && 'mode' in data) {
        queryClient.setQueryData(deskKeys.state, data);
      }
      await queryClient.invalidateQueries({ queryKey: deskKeys.all });
    },
  });
}
