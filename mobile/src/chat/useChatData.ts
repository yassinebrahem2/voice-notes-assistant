import { useQuery } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';

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
  });
  // If the list cannot be loaded the server may still answer, so do not block asking.
  if (isError) return true;
  return data?.some((recording) => recording.status === 'ready');
}
