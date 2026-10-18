import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { useReducedMotion } from 'react-native-reanimated';

import { RecordingScreen } from '../../app/recording/[id]';
import { ApiError } from '../api/client';
import { paperTheme } from '../theme/paperTheme';
import { useRetryRecording } from './mutations';
import {
  makeMockRecording,
  mockMeetingWithSummary,
  mockNoteWithKeyPoints,
  mockPlayer,
} from './recordingFixtures';
import { useRecording } from './useRecording';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('./useRecording', () => ({
  useRecording: jest.fn(),
}));

jest.mock('./mutations', () => ({
  useRetryRecording: jest.fn(),
  useUpdateRecording: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useRenameSpeaker: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeleteRecording: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

jest.mock('../../src/player/usePlayer', () => ({
  usePlayer: jest.fn(() => mockPlayer),
}));

const mockUseRecording = jest.mocked(useRecording);
const mockUseRetryRecording = jest.mocked(useRetryRecording);
const mockUseLocalSearchParams = jest.mocked(useLocalSearchParams);
const mockUseReducedMotion = jest.mocked(useReducedMotion);

async function renderScreen(id = 'rec_1', segment?: string) {
  mockUseLocalSearchParams.mockReturnValue({ id, segment });
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <RecordingScreen id={id} segment={segment} />
    </PaperProvider>,
  );
}

describe('RecordingScreen', () => {
  const mockRetry = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRetryRecording.mockReturnValue({
      mutate: mockRetry,
      isPending: false,
    } as unknown as ReturnType<typeof useRetryRecording>);
    mockUseReducedMotion.mockReturnValue(true);
  });

  test('renders deleted state on 404 with back navigation', async () => {
    mockUseRecording.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(404, 'not_found', 'Not found'),
      deleted: true,
      refetch: jest.fn(),
    });

    await renderScreen('rec_deleted');
    expect(screen.getByText('This recording was deleted')).toBeTruthy();

    const backButton = screen.getByLabelText('Back');
    fireEvent.press(backButton);
    expect(router.back).toHaveBeenCalled();
  });

  test('a 500 with no data shows error screen, Retry reflects isFetching, and refetches', async () => {
    const mockRefetch = jest.fn();
    mockUseRecording.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: true,
      error: new ApiError(500, 'internal_error', 'Server error'),
      deleted: false,
      refetch: mockRefetch,
    });

    const { rerender } = await renderScreen('rec_err');
    expect(
      screen.getByText('Something went wrong on the server.'),
    ).toBeTruthy();
    const retryBtn = screen.getByLabelText('Retry');
    expect(retryBtn.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByRole('progressbar')).toBeTruthy();

    mockUseRecording.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new ApiError(500, 'internal_error', 'Server error'),
      deleted: false,
      refetch: mockRefetch,
    });
    await rerender(
      <PaperProvider theme={paperTheme('dark')}>
        <RecordingScreen id="rec_err" />
      </PaperProvider>,
    );
    const idleRetryBtn = screen.getByLabelText('Retry');
    expect(idleRetryBtn.props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.press(idleRetryBtn);
    expect(mockRefetch).toHaveBeenCalled();
  });

  test('a loaded recording whose refetch fails keeps title and transcript on screen', async () => {
    const mockRecording = makeMockRecording({
      id: 'rec_outage',
      title: 'Meeting in Outage',
      segments: [
        {
          id: 'seg_1',
          idx: 0,
          speaker_id: null,
          start_ms: 0,
          end_ms: 1000,
          text: 'Preserved during outage.',
        },
      ],
    });
    mockUseRecording.mockReturnValue({
      data: mockRecording,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new ApiError(500, 'internal_error', 'Outage'),
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_outage');
    expect(
      screen.queryByText('Something went wrong on the server.'),
    ).toBeNull();
    expect(screen.getByText('Meeting in Outage')).toBeTruthy();
    expect(screen.getByText('Preserved during outage.')).toBeTruthy();
  });

  test('renders "Nothing was said" when ready recording has no segments', async () => {
    mockUseRecording.mockReturnValue({
      data: makeMockRecording({
        id: 'rec_empty',
        title: 'Empty Meeting',
        segments: [],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_empty');
    expect(screen.getByText('Nothing was said')).toBeTruthy();
  });

  test('a ready meeting with segments and an empty summary shows its transcript', async () => {
    mockUseRecording.mockReturnValue({
      data: makeMockRecording({
        id: 'rec_no_sum',
        title: 'No Summary Meeting',
        segments: [
          {
            id: 'seg_1',
            idx: 0,
            speaker_id: null,
            start_ms: 0,
            end_ms: 2000,
            text: 'Spoken transcript words.',
          },
        ],
        summary: null,
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_no_sum');
    expect(screen.queryByText('Nothing was said')).toBeNull();
    expect(screen.getByText('Spoken transcript words.')).toBeTruthy();
  });

  test('renders failed state with error message and Retry button', async () => {
    mockUseRecording.mockReturnValue({
      data: makeMockRecording({
        id: 'rec_failed',
        status: 'failed',
        title: 'Failed Processing',
        error_code: 'transcription_failed',
        error_message: 'Transcription failed due to noise.',
        failed_step: 'transcribing',
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_failed');
    expect(screen.getByText('Transcription failed due to noise.')).toBeTruthy();

    const retryButton = screen.getByLabelText('Retry processing');
    fireEvent.press(retryButton);
    expect(mockRetry).toHaveBeenCalledWith('rec_failed');
  });

  test('renders meeting with summary tabs and clicking citation jumps to transcript', async () => {
    mockUseRecording.mockReturnValue({
      data: mockMeetingWithSummary,
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_meeting');
    expect(screen.getByText('Sprint Planning')).toBeTruthy();
    expect(screen.getByText('Discussed sprint timeline.')).toBeTruthy();
    expect(screen.getByText('Ship on Tuesday.')).toBeTruthy();

    expect(screen.getByTestId('player-bar')).toBeTruthy();
    expect(screen.getByLabelText('Play')).toBeTruthy();

    const citationChip = screen.getByLabelText('Jump to 00:12');
    fireEvent.press(citationChip);
    expect(mockPlayer.playFrom).toHaveBeenCalledWith(12000);

    await waitFor(() =>
      expect(screen.getByText('We should release next Tuesday.')).toBeTruthy(),
    );
  });

  test('highlights segment and opens transcript when ?segment= is in URL params', async () => {
    const mockRecording = makeMockRecording({
      id: 'rec_meeting_param',
      title: 'Roadmap Sync',
      duration_ms: 30000,
      speakers: [
        { id: 'spk_1', name: 'Alex', display_name: 'Alex', label: 'Speaker 1' },
      ],
      segments: [
        {
          id: 'seg_target',
          idx: 0,
          speaker_id: 'spk_1',
          start_ms: 5000,
          end_ms: 10000,
          text: 'This is the cited segment.',
        },
      ],
      summary: {
        overview: 'Overview sync.',
        decisions: [],
        action_items: [],
        open_questions: [],
      },
    });

    mockUseRecording.mockReturnValue({
      data: mockRecording,
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    const scrollToSpy = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => {});

    mockUseReducedMotion.mockReturnValue(false);
    await renderScreen('rec_meeting_param', 'seg_target');

    expect(screen.getByText('This is the cited segment.')).toBeTruthy();
    expect(screen.getByTestId('segment-seg_target-highlighted')).toBeTruthy();

    const turnEl = screen.getByTestId('turn-0');
    const segmentEl = screen.getByTestId('segment-seg_target-highlighted');

    await fireEvent(turnEl, 'layout', {
      nativeEvent: { layout: { y: 150 } },
    });
    await fireEvent(segmentEl, 'layout', {
      nativeEvent: { layout: { y: 40 } },
    });

    expect(scrollToSpy).toHaveBeenCalledWith({
      y: 170,
      animated: true,
    });
    scrollToSpy.mockRestore();
  });

  test('renders note view with key points and clean note', async () => {
    mockUseRecording.mockReturnValue({
      data: mockNoteWithKeyPoints,
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_note');
    expect(screen.getByText('Idea for feature')).toBeTruthy();
    expect(screen.getByText('Key idea number one.')).toBeTruthy();
    expect(screen.getByText('Cleaned up text of the idea.')).toBeTruthy();
  });
});
