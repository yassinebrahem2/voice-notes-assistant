import { useMutation } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';
import { queryClient } from '../api/queryClient';

export function useRetryRecording() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Schemas['RecordingDetailOut']>(`recordings/${id}/retry`, {
        method: 'POST',
      }),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['recording', id] });
      void queryClient.invalidateQueries({ queryKey: ['recordings'] });
    },
  });
}
