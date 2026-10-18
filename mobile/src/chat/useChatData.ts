import { useQuery } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';

const READY_POLL_MS = 5_000;

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<Schemas['TagOut'][]>('tags'),
  });
}

// undefined until the list is known, so the screen does not flash the wrong empty state.
export function useHasReadyRecording(): boolean | undefined {
  const { data, isError } = useQuery({
    queryKey: ['recordings', 'chat-ready'],
    queryFn: () => apiFetch<Schemas['RecordingOut'][]>('recordings'),
    // The Chat tab stays mounted, so poll while a loaded list has nothing ready. A failed refetch keeps
    // the old data, so the status guard (not data alone) stops polling when the server goes away.
    refetchInterval: (query) =>
      query.state.status === 'success' &&
      query.state.data !== undefined &&
      !query.state.data.some((recording) => recording.status === 'ready')
        ? READY_POLL_MS
        : false,
  });
  // If the list cannot be loaded the server may still answer, so do not block asking.
  if (isError) return true;
  return data?.some((recording) => recording.status === 'ready');
}
