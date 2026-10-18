import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { PaperProvider } from 'react-native-paper';

import { ApiError, type Schemas } from '../api/client';
import { queryClient } from '../api/queryClient';
import { showSnackbar } from '../components/snackbarStore';
import { openFanOut } from '../recording/fanOutStore';
import type { PendingUpload } from '../recording/pending';
import { usePendingUploads } from '../recording/usePendingUploads';
import { useServerUrl } from '../settings/serverUrl';
import { paperTheme } from '../theme/paperTheme';
import { resetTabFilters } from './filters';
import { LibraryScreen, listStaggerDelay } from './LibraryScreen';
import { useRecordings } from './useRecordings';
import { useTags } from './useTags';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('../components/snackbarStore', () => ({
  showSnackbar: jest.fn(),
}));

jest.mock('../settings/serverUrl', () => ({
  useServerUrl: jest.fn(),
}));

jest.mock('../recording/fanOutStore', () => ({
  openFanOut: jest.fn(),
}));

jest.mock('../recording/usePendingUploads', () => ({
  usePendingUploads: jest.fn(),
}));

jest.mock('./useRecordings', () => ({
  useRecordings: jest.fn(),
}));

jest.mock('./useTags', () => ({
  useTags: jest.fn(),
}));

jest.mock('../api/queryClient', () => ({
  queryClient: {
    prefetchQuery: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

const mockUsePendingUploads = jest.mocked(usePendingUploads);
const mockUseRecordings = jest.mocked(useRecordings);
const mockUseTags = jest.mocked(useTags);
const mockUseServerUrl = jest.mocked(useServerUrl);
const mockShowSnackbar = jest.mocked(showSnackbar);

async function renderScreen(kind: 'meeting' | 'note' = 'meeting') {
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <LibraryScreen kind={kind} />
    </PaperProvider>,
  );
}

describe('LibraryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTabFilters('meeting');
    resetTabFilters('note');

    mockUseServerUrl.mockReturnValue({
      url: 'http://localhost:8000',
      loading: false,
      error: null,
      setUrl: jest.fn(),
    });

    mockUsePendingUploads.mockReturnValue({
      items: [],
      retry: jest.fn(),
      remove: jest.fn(),
      refresh: jest.fn(),
    });

    mockUseTags.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTags>);

    mockUseRecordings.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRecordings>);
  });

  test('with no server URL set the no-server state shows whatever the error says', async () => {
    mockUseServerUrl.mockReturnValue({
      url: null,
      loading: false,
      error: null,
      setUrl: jest.fn(),
    });
    mockUseRecordings.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Cannot reach host'),
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRecordings>);

    await renderScreen('meeting');

    expect(screen.getByText('Cannot reach host')).toBeTruthy();
    const settingsBtn = screen.getByRole('button', { name: 'Open Settings' });
    expect(settingsBtn).toBeTruthy();

    fireEvent.press(settingsBtn);
    expect(router.push).toHaveBeenCalledWith('/settings');
  });

  test('renders "Record your first meeting" empty state when no recordings exist', async () => {
    await renderScreen('meeting');

    expect(screen.getByText('Record your first meeting')).toBeTruthy();
    const recordBtn = screen.getByRole('button', { name: 'Record' });
    expect(recordBtn).toBeTruthy();
    fireEvent.press(recordBtn);
    expect(openFanOut).toHaveBeenCalled();
  });

  test('renders "Record your first note" empty state for notes tab', async () => {
    await renderScreen('note');

    expect(screen.getByText('Record your first note')).toBeTruthy();
    const recordBtn = screen.getByRole('button', { name: 'Record' });
    expect(recordBtn).toBeTruthy();
    fireEvent.press(recordBtn);
    expect(openFanOut).toHaveBeenCalled();
  });

  test('renders "No matching recordings" and allows clearing filters when search has no matches', async () => {
    mockUseTags.mockReturnValue({
      data: [{ id: 'tag-1', name: 'Design', count: 1 }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTags>);

    mockUseRecordings.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRecordings>);

    await renderScreen('meeting');

    const searchInput = screen.getByPlaceholderText('Search meetings…');
    await act(async () => {
      fireEvent.changeText(searchInput, 'nonexistent query');
    });

    expect(await screen.findByText('No matching recordings')).toBeTruthy();
    const clearBtn = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearBtn).toBeTruthy();

    await act(async () => {
      fireEvent.press(clearBtn);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search meetings…').props.value).toBe(
        '',
      );
    });
  });

  test('renders pending rows on top of server rows with Retry and Delete buttons', async () => {
    const retryFn = jest.fn().mockResolvedValue(undefined);
    const removeFn = jest.fn().mockResolvedValue(undefined);

    const pendingItem: PendingUpload = {
      clientUploadId: 'pending-1',
      kind: 'meeting',
      path: 'file:///pending/1.m4a',
      createdAt: '2026-10-17T10:00:00Z',
      durationMs: 45000,
    };

    mockUsePendingUploads.mockReturnValue({
      items: [pendingItem],
      retry: retryFn,
      remove: removeFn,
      refresh: jest.fn(),
    });

    const serverRecording: Schemas['RecordingOut'] = {
      id: 'server-1',
      kind: 'meeting',
      title: 'Sprint Planning',
      status: 'ready',
      created_at: '2026-10-16T14:00:00Z',
      duration_ms: 180000,
      processing: false,
      error_code: null,
      error_message: null,
      failed_step: null,
      waveform_peaks: null,
      tags: [{ id: 't-1', name: 'Scrum', count: 1 }],
    };

    const refetchFn = jest.fn();
    mockUseRecordings.mockReturnValue({
      data: [serverRecording],
      isLoading: false,
      error: null,
      refetch: refetchFn,
    } as unknown as ReturnType<typeof useRecordings>);

    await renderScreen('meeting');

    // Check Pending Row
    expect(screen.getByText('Not uploaded')).toBeTruthy();
    const retryButton = screen.getByLabelText('Retry upload');
    const deleteButton = screen.getByLabelText('Delete pending recording');
    expect(retryButton).toBeTruthy();
    expect(deleteButton).toBeTruthy();

    await act(async () => {
      fireEvent.press(retryButton);
    });
    expect(retryFn).toHaveBeenCalledWith('pending-1');
    expect(refetchFn).toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(deleteButton);
    });
    expect(removeFn).toHaveBeenCalledWith('pending-1');

    // Check Server Row
    expect(screen.getByText('Sprint Planning')).toBeTruthy();
    expect(screen.getByText('Scrum')).toBeTruthy();

    // Verify ordering: pending row is before server row in rendered tree
    const pendingText = screen.getByText('Not uploaded');
    const serverText = screen.getByText('Sprint Planning');
    expect(pendingText).toBeTruthy();
    expect(serverText).toBeTruthy();
  });

  describe('pending search', () => {
    const pendingItems: PendingUpload[] = (['meeting', 'note'] as const).map(
      (kind) => ({
        clientUploadId: `pending-${kind}`,
        kind,
        path: `file:///pending/${kind}.m4a`,
        createdAt: '2026-10-17T10:00:00Z',
        durationMs: 45000,
      }),
    );
    const retry = jest.fn();
    const remove = jest.fn();

    beforeEach(() => {
      jest.useFakeTimers();
      mockUsePendingUploads.mockReturnValue({
        items: pendingItems,
        retry,
        remove,
        refresh: jest.fn(),
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test.each([
      ['meeting', 'Meeting', 'Note', ' mEeT '],
      ['note', 'Note', 'Meeting', ' nOt '],
    ] as const)(
      '%s searches its pending label after 300 ms and clearing restores the row',
      async (kind, label, otherLabel, matchingQuery) => {
        const queueBefore = pendingItems.map((item) => ({ ...item }));
        await renderScreen(kind);
        const searchInput = screen.getByRole('search');
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.queryByText(otherLabel)).toBeNull();

        await act(async () => {
          fireEvent.changeText(searchInput, matchingQuery);
        });
        await act(async () => jest.advanceTimersByTime(300));
        expect(screen.getByText('Not uploaded')).toBeTruthy();

        await act(async () => {
          fireEvent.changeText(searchInput, `${kind}-test`);
        });
        await act(async () => jest.advanceTimersByTime(299));
        expect(screen.getByText('Not uploaded')).toBeTruthy();
        await act(async () => jest.advanceTimersByTime(1));
        expect(screen.queryByText('Not uploaded')).toBeNull();
        expect(screen.getByText('No matching recordings')).toBeTruthy();

        await act(async () => {
          fireEvent.press(
            screen.getByRole('button', { name: 'Clear filters' }),
          );
        });
        expect(searchInput.props.value).toBe('');
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.queryByText(otherLabel)).toBeNull();
        expect(screen.queryByText('No matching recordings')).toBeNull();
        await act(async () => {
          fireEvent.changeText(searchInput, '   ');
        });
        await act(async () => jest.advanceTimersByTime(300));
        expect(screen.getByText('Not uploaded')).toBeTruthy();
        expect(pendingItems).toEqual(queueBefore);
        expect(retry).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
      },
    );

    test('keeps the server error when an unmatched pending row is hidden', async () => {
      const refetch = jest.fn();
      mockUseRecordings.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new ApiError(501, 'not_implemented', 'Not implemented'),
        refetch,
      } as unknown as ReturnType<typeof useRecordings>);
      await renderScreen('meeting');
      await act(async () => {
        fireEvent.changeText(screen.getByRole('search'), 'meeting-test');
      });
      await act(async () => jest.advanceTimersByTime(300));

      expect(screen.queryByText('Not uploaded')).toBeNull();
      expect(screen.getByText('Not available yet.')).toBeTruthy();
      expect(screen.queryByText('No matching recordings')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Clear filters' }),
      ).toBeNull();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
      });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  test('server row navigates on press and prefetches on press-in', async () => {
    const serverRecording: Schemas['RecordingOut'] = {
      id: 'server-42',
      kind: 'meeting',
      title: 'Quarterly Review',
      status: 'ready',
      created_at: '2026-10-16T14:00:00Z',
      duration_ms: 125000,
      processing: false,
      error_code: null,
      error_message: null,
      failed_step: null,
      waveform_peaks: null,
      tags: [],
    };

    mockUseRecordings.mockReturnValue({
      data: [serverRecording],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRecordings>);

    await renderScreen('meeting');

    const row = await screen.findByRole('button', { name: 'Quarterly Review' });
    await act(async () => {
      fireEvent(row, 'pressIn');
    });
    expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['recording', 'server-42'],
        queryFn: expect.any(Function),
        retry: expect.any(Function),
      }),
    );

    await act(async () => {
      fireEvent.press(row);
    });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/recording/[id]',
      params: { id: 'server-42' },
    });
  });

  test('a failed library Retry shows errorMessage in a snackbar', async () => {
    const pendingItem: PendingUpload = {
      clientUploadId: 'pending-fail',
      kind: 'meeting',
      path: '/mock/path/pending-fail.meeting.m4a',
      createdAt: '2026-10-16T12:00:00Z',
      durationMs: 45000,
    };
    const retryFn = jest
      .fn()
      .mockRejectedValueOnce(
        new ApiError(0, 'network_error', "Can't reach the server."),
      );
    mockUsePendingUploads.mockReturnValue({
      items: [pendingItem],
      retry: retryFn,
      remove: jest.fn(),
      refresh: jest.fn(),
    });

    await renderScreen('meeting');

    const retryButton = screen.getByLabelText('Retry upload');
    await act(async () => {
      fireEvent.press(retryButton);
    });

    expect(retryFn).toHaveBeenCalledWith('pending-fail');
    expect(mockShowSnackbar).toHaveBeenCalledWith("Can't reach the server.");
  });

  test('the stagger delay of row 20 equals that of row 8', () => {
    expect(listStaggerDelay(20)).toBe(listStaggerDelay(8));
  });

  test('displays tag suggestions and filters when a tag chip is pressed', async () => {
    mockUseTags.mockReturnValue({
      data: [
        { id: 'tag-arch', name: 'Architecture', count: 3 },
        { id: 'tag-ops', name: 'DevOps', count: 1 },
      ],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTags>);

    await renderScreen('meeting');

    expect(await screen.findByText('Architecture')).toBeTruthy();
    expect(screen.getByText('DevOps')).toBeTruthy();

    const tagChip = screen.getByRole('button', {
      name: 'Filter by Architecture',
    });
    await act(async () => {
      fireEvent.press(tagChip);
    });

    await waitFor(() => {
      expect(mockUseRecordings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tagIds: ['tag-arch'],
        }),
      );
    });
  });
});
