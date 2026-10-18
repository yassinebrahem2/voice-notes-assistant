import { useQuery } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';
import { needsPolling } from './rowStatus';

export interface UseRecordingsParams {
  kind: 'meeting' | 'note';
  q?: string;
  tagIds?: string[];
}

export function useRecordings({ kind, q, tagIds }: UseRecordingsParams) {
  const normalizedQ = q?.trim() ?? '';
  const normalizedTagIds = tagIds ?? [];

  return useQuery({
    queryKey: [
      'recordings',
      { kind, q: normalizedQ, tagIds: normalizedTagIds },
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('kind', kind);
      if (normalizedQ.length > 0) {
        params.set('q', normalizedQ);
      }
      for (const id of normalizedTagIds) {
        params.append('tag_id', id);
      }
      const qs = params.toString();
      const path = qs ? `recordings?${qs}` : 'recordings';
      return apiFetch<Schemas['RecordingOut'][]>(path);
    },
    refetchInterval: (query) => (needsPolling(query.state.data) ? 2000 : false),
  });
}
