import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import { apiFetch, type Schemas } from '../api/client';
import { ApiError } from '../api/errors';
import {
  useDeleteRecording,
  useRenameSpeaker,
  useUpdateRecording,
} from './mutations';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('../api/client', () => ({
  apiFetch: jest.fn(),
  ApiError: jest.requireActual('../api/errors').ApiError,
}));

const mockApiFetch = jest.mocked(apiFetch);

let currentQueryClient: QueryClient | null = null;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 60000,
      },
      mutations: {
        retry: false,
        gcTime: 60000,
      },
    },
  });
  currentQueryClient = queryClient;
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { queryClient, Wrapper };
}

const baseRecording: Schemas['RecordingDetailOut'] = {
  id: 'rec_1',
  kind: 'meeting',
  status: 'ready',
  title: 'Old Title',
  duration_ms: 60000,
  created_at: '2026-10-17T12:00:00Z',
  processing: false,
  error_code: null,
  error_message: null,
  failed_step: null,
  summary: null,
  note: null,
  waveform_peaks: null,
  tags: [{ id: 'tag_1', name: 'Work', count: 1 }],
  speakers: [
    {
      id: 'spk_1',
      name: null,
      display_name: 'Speaker 1',
      label: '1',
    },
  ],
  segments: [],
};

describe('Recording mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    currentQueryClient?.clear();
    currentQueryClient = null;
  });

  describe('useRenameSpeaker', () => {
    test('optimistically updates speaker and rolls back on error showing "Couldn\'t save"', async () => {
      const { queryClient, Wrapper } = createWrapper();
      queryClient.setQueryData(['recording', 'rec_1'], baseRecording);

      let rejectMutation!: (reason: unknown) => void;
      mockApiFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectMutation = reject;
          }),
      );

      const onNotify = jest.fn();
      const { result } = await renderHook(
        () => useRenameSpeaker('rec_1', { onNotify }),
        { wrapper: Wrapper },
      );

      const mutationPromise = result.current
        .mutateAsync({ speakerId: 'spk_1', name: 'Alice' })
        .catch(() => {});

      // Optimistic update applied
      await waitFor(() => {
        const cached = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
          'recording',
          'rec_1',
        ]);
        expect(cached?.speakers[0].name).toBe('Alice');
        expect(cached?.speakers[0].display_name).toBe('Alice');
      });

      // API call fails
      rejectMutation(new ApiError(500, 'internal_error', 'Server error'));
      await mutationPromise;

      // Rolls back to original state and notifies
      await waitFor(() => {
        const cached = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
          'recording',
          'rec_1',
        ]);
        expect(cached?.speakers[0].name).toBeNull();
        expect(cached?.speakers[0].display_name).toBe('Speaker 1');
      });

      expect(onNotify).toHaveBeenCalledWith("Couldn't save");
    });
  });

  describe('useUpdateRecording', () => {
    test('optimistically updates title and tags and rolls back on error', async () => {
      const { queryClient, Wrapper } = createWrapper();
      queryClient.setQueryData(['recording', 'rec_1'], baseRecording);

      let rejectMutation!: (reason: unknown) => void;
      mockApiFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectMutation = reject;
          }),
      );

      const onNotify = jest.fn();
      const { result } = await renderHook(
        () => useUpdateRecording('rec_1', { onNotify }),
        { wrapper: Wrapper },
      );

      const mutationPromise = result.current
        .mutateAsync({ title: 'New Title', tags: ['Personal'] })
        .catch(() => {});

      // Optimistic update applied
      await waitFor(() => {
        const cached = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
          'recording',
          'rec_1',
        ]);
        expect(cached?.title).toBe('New Title');
        expect(cached?.tags.map((t) => t.name)).toEqual(['Personal']);
      });

      // API call fails
      rejectMutation(new ApiError(500, 'internal_error', 'Server error'));
      await mutationPromise;

      // Rolls back to original state and notifies
      await waitFor(() => {
        const cached = queryClient.getQueryData<Schemas['RecordingDetailOut']>([
          'recording',
          'rec_1',
        ]);
        expect(cached?.title).toBe('Old Title');
        expect(cached?.tags.map((t) => t.name)).toEqual(['Work']);
      });

      expect(onNotify).toHaveBeenCalledWith("Couldn't save");
    });
  });

  describe('useDeleteRecording', () => {
    test('shows "Available when processing finishes" on 409 conflict', async () => {
      const { Wrapper } = createWrapper();
      mockApiFetch.mockRejectedValue(
        new ApiError(409, 'recording_busy', 'Recording busy'),
      );

      const onNotify = jest.fn();
      const { result } = await renderHook(
        () => useDeleteRecording({ onNotify }),
        {
          wrapper: Wrapper,
        },
      );

      result.current.mutate('rec_1');

      await waitFor(() => {
        expect(onNotify).toHaveBeenCalledWith(
          'Available when processing finishes',
        );
      });
      expect(router.back).not.toHaveBeenCalled();
    });

    test('invalidates recordings, notifies "Deleted", and navigates back on success', async () => {
      const { queryClient, Wrapper } = createWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiFetch.mockResolvedValue(undefined);

      const onNotify = jest.fn();
      const { result } = await renderHook(
        () => useDeleteRecording({ onNotify }),
        {
          wrapper: Wrapper,
        },
      );

      result.current.mutate('rec_1');

      await waitFor(() => {
        expect(onNotify).toHaveBeenCalledWith('Deleted');
      });
      expect(router.back).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recordings'] });
    });
  });
});
