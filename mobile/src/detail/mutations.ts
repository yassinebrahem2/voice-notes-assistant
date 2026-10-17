import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';

export function useRetryRecording() {
  const queryClient = useQueryClient();

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
