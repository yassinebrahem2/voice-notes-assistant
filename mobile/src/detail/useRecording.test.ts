import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { apiFetch, type Schemas } from '../api/client';
import { ApiError } from '../api/errors';
import { recordingQuery, useRecording } from './useRecording';

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
        retryDelay: 1,
        gcTime: 0,
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
  return Wrapper;
}

describe('useRecording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    currentQueryClient?.clear();
    currentQueryClient = null;
  });

  test('recordingQuery produces query options with no-retry-on-404 rule', () => {
    const q = recordingQuery('rec_abc');
    expect(q.queryKey).toEqual(['recording', 'rec_abc']);
    expect(typeof q.queryFn).toBe('function');
    expect(q.retry(0, new ApiError(404, 'not_found', 'Not found'))).toBe(false);
    expect(q.retry(0, new ApiError(500, 'internal_error', 'Fail'))).toBe(true);
    expect(q.retry(2, new ApiError(500, 'internal_error', 'Fail'))).toBe(false);
  });

  test('fetches recording by id and returns data', async () => {
    const mockRecording: Partial<Schemas['RecordingDetailOut']> = {
      id: 'rec_123',
      kind: 'meeting',
      status: 'ready',
      title: 'Design Review',
    };
    mockApiFetch.mockResolvedValueOnce(mockRecording);

    const { result } = await renderHook(() => useRecording('rec_123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockApiFetch).toHaveBeenCalledWith('recordings/rec_123');
    expect(result.current.data).toEqual(mockRecording);
    expect(result.current.deleted).toBe(false);
  });

  test('does not retry on 404 and sets deleted: true', async () => {
    mockApiFetch.mockRejectedValue(
      new ApiError(404, 'not_found', 'Recording not found'),
    );

    const { result } = await renderHook(() => useRecording('rec_missing'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(result.current.deleted).toBe(true);
  });

  test('retries on network error', async () => {
    mockApiFetch
      .mockRejectedValueOnce(
        new ApiError(0, 'network_error', 'Network failure'),
      )
      .mockResolvedValueOnce({
        id: 'rec_retry',
        kind: 'note',
        status: 'ready',
      } as Schemas['RecordingDetailOut']);

    const { result } = await renderHook(() => useRecording('rec_retry'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.deleted).toBe(false);
  });

  test('does not fetch when id is empty', async () => {
    const { result } = await renderHook(() => useRecording(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('returns isFetching indicating network activity', async () => {
    let resolveFetch: (val: unknown) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = await renderHook(() => useRecording('rec_fetch'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(true);

    resolveFetch({
      id: 'rec_fetch',
      kind: 'meeting',
      status: 'ready',
    });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });
});
