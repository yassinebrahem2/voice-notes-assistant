import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { apiFetch, type Schemas } from '../api/client';
import { ApiError } from '../api/errors';
import { errorMessage } from '../api/errorMessages';
import { showSnackbar } from '../components/snackbarStore';

export function normalizeTag(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
}

export interface MutationOptions<TData = unknown> {
  onNotify?: (message: string) => void;
  onSuccess?: (data: TData) => void;
  onError?: (error: unknown) => void;
}

export interface UpdateRecordingInput {
  title?: string | null;
  tags?: string[] | null;
}

export interface RenameSpeakerInput {
  speakerId: string;
  name: string;
}

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

export function useUpdateRecording(
  recordingId: string,
  options?: MutationOptions<Schemas['RecordingOut']>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: UpdateRecordingInput) =>
      apiFetch<Schemas['RecordingOut']>(`recordings/${recordingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['recording', recordingId] });
      const previous = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
        'recording',
        recordingId,
      ]);

      if (previous) {
        queryClient.setQueryData<Schemas['RecordingDetailOut']>(
          ['recording', recordingId],
          {
            ...previous,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.tags !== undefined
              ? {
                  tags:
                    patch.tags === null
                      ? []
                      : patch.tags.map((name) => {
                          const existing = previous.tags?.find(
                            (t) => t.name === name,
                          );
                          return (
                            existing ?? {
                              id: `opt_${name}`,
                              name,
                              count: 1,
                            }
                          );
                        }),
                }
              : {}),
          },
        );
      }

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['recording', recordingId], context.previous);
      }
      options?.onNotify?.("Couldn't save");
      options?.onError?.(error);
    },
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['recording', recordingId],
      });
      void queryClient.invalidateQueries({ queryKey: ['recordings'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useRenameSpeaker(
  recordingId: string,
  options?: MutationOptions<Schemas['SpeakerOut']>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speakerId, name }: RenameSpeakerInput) =>
      apiFetch<Schemas['SpeakerOut']>(
        `recordings/${recordingId}/speakers/${speakerId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      ),
    onMutate: async ({ speakerId, name }) => {
      await queryClient.cancelQueries({ queryKey: ['recording', recordingId] });
      const previous = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
        'recording',
        recordingId,
      ]);

      if (previous) {
        const trimmed = name.trim();
        const updatedSpeakers = (previous.speakers ?? []).map((spk) => {
          if (spk.id === speakerId) {
            const nextName = trimmed || null;
            const fallbackLabel = spk.label
              ? spk.label.startsWith('Speaker')
                ? spk.label
                : `Speaker ${spk.label}`
              : spk.display_name;
            const displayName = trimmed || fallbackLabel;
            return {
              ...spk,
              name: nextName,
              display_name: displayName,
            };
          }
          return spk;
        });

        queryClient.setQueryData<Schemas['RecordingDetailOut']>(
          ['recording', recordingId],
          {
            ...previous,
            speakers: updatedSpeakers,
          },
        );
      }

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['recording', recordingId], context.previous);
      }
      options?.onNotify?.("Couldn't save");
      options?.onError?.(error);
    },
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['recording', recordingId],
      });
    },
  });
}

export function useDeleteRecording(options?: MutationOptions<void>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`recordings/${id}`, {
        method: 'DELETE',
      }),
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.code === 'recording_busy')
      ) {
        options?.onNotify?.('Available when processing finishes');
      } else {
        options?.onNotify?.(errorMessage(error));
      }
      options?.onError?.(error);
    },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['recordings'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.removeQueries({ queryKey: ['recording', id] });
      showSnackbar('Deleted');
      options?.onSuccess?.();
      router.back();
    },
  });
}
