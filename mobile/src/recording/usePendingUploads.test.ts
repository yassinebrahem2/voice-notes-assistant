import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Schemas } from '../api/client';
import { listPending, removePending, type PendingUpload } from './pending';
import { uploadPending } from './upload';
import { usePendingUploads } from './usePendingUploads';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

jest.mock('./pending', () => ({
  listPending: jest.fn(),
  removePending: jest.fn(),
}));

jest.mock('./upload', () => ({
  uploadPending: jest.fn(),
}));

describe('usePendingUploads', () => {
  const sampleItems: PendingUpload[] = [
    {
      clientUploadId: 'test-1',
      kind: 'note',
      path: 'file:///mock/1.m4a',
      createdAt: '2026-10-17T00:00:00Z',
      durationMs: 3000,
    },
  ];

  beforeEach(() => {
    jest.mocked(listPending).mockReset().mockResolvedValue(sampleItems);
    jest.mocked(removePending).mockReset().mockResolvedValue();
    jest.mocked(uploadPending).mockReset();
  });

  test('loads pending items on mount', async () => {
    const { result } = await renderHook(() => usePendingUploads());

    await waitFor(() => {
      expect(result.current.items).toEqual(sampleItems);
    });
    expect(listPending).toHaveBeenCalled();
  });

  test('remove calls removePending and refreshes', async () => {
    const { result } = await renderHook(() => usePendingUploads());
    await waitFor(() => expect(result.current.items).toEqual(sampleItems));

    jest.mocked(listPending).mockResolvedValue([]);

    await act(async () => {
      await result.current.remove('test-1');
    });

    expect(removePending).toHaveBeenCalledWith('test-1');
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  test('retry calls uploadPending and refreshes', async () => {
    const { result } = await renderHook(() => usePendingUploads());
    await waitFor(() => expect(result.current.items).toEqual(sampleItems));

    const mockResult = { id: 'rec-1' } as Schemas['RecordingOut'];
    jest.mocked(uploadPending).mockResolvedValueOnce(mockResult);
    jest.mocked(listPending).mockResolvedValue([]);

    let uploadRes: Schemas['RecordingOut'] | undefined;
    await act(async () => {
      uploadRes = await result.current.retry('test-1');
    });

    expect(uploadPending).toHaveBeenCalledWith(sampleItems[0], undefined);
    expect(uploadRes).toEqual(mockResult);
    await waitFor(() => expect(result.current.items).toEqual([]));
  });
});
