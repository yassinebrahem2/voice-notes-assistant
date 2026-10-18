import { useQuery } from '@tanstack/react-query';

import { apiFetch, ApiError, type Schemas } from '../api/client';

export function recordingQuery(id: string) {
  return {
    queryKey: ['recording', id] as const,
    queryFn: () => apiFetch<Schemas['RecordingDetailOut']>(`recordings/${id}`),
    retry: (failureCount: number, error: unknown) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  };
}

export function useRecording(id: string) {
  const query = useQuery({
    ...recordingQuery(id),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const r = q.state.data;
      if (!r) return false;
      return r.status !== 'ready' && r.status !== 'failed' ? 2000 : false;
    },
  });

  const deleted = query.error instanceof ApiError && query.error.status === 404;

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    deleted,
    refetch: query.refetch,
  };
}
