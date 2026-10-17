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

import { RecordingScreen } from '../../app/recording/[id]';
import type { Schemas } from '../api/client';
import { paperTheme } from '../theme/paperTheme';
import { useRetryRecording } from './mutations';
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
}));

const mockUseRecording = jest.mocked(useRecording);
const mockUseRetryRecording = jest.mocked(useRetryRecording);
const mockUseLocalSearchParams = jest.mocked(useLocalSearchParams);

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
  });

  test('renders deleted state on 404 with back navigation', async () => {
    mockUseRecording.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Not found'),
      deleted: true,
      refetch: jest.fn(),
    });

    await renderScreen('rec_deleted');
    expect(screen.getByText('This recording was deleted')).toBeTruthy();

    const backButton = screen.getByLabelText('Back');
    fireEvent.press(backButton);
    expect(router.back).toHaveBeenCalled();
  });

  test('renders "Nothing was said" when ready recording has no segments', async () => {
    mockUseRecording.mockReturnValue({
      data: {
        id: 'rec_empty',
        kind: 'meeting',
        status: 'ready',
        title: 'Empty Meeting',
        segments: [],
        speakers: [],
        tags: [],
        created_at: '2026-10-17T12:00:00Z',
        duration_ms: 1000,
        error_code: null,
        error_message: null,
        failed_step: null,
        processing: false,
        summary: null,
        note: null,
        waveform_peaks: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_empty');
    expect(screen.getByText('Nothing was said')).toBeTruthy();
  });

  test('renders failed state with error message and Retry button', async () => {
    mockUseRecording.mockReturnValue({
      data: {
        id: 'rec_failed',
        kind: 'meeting',
        status: 'failed',
        title: 'Failed Processing',
        error_code: 'transcription_failed',
        error_message: 'Transcription failed due to noise.',
        failed_step: 'transcribing',
        segments: [],
        speakers: [],
        tags: [],
        created_at: '2026-10-17T12:00:00Z',
        duration_ms: 5000,
        processing: false,
        summary: null,
        note: null,
        waveform_peaks: null,
      },
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
    const mockRecording: Schemas['RecordingDetailOut'] = {
      id: 'rec_meeting',
      kind: 'meeting',
      status: 'ready',
      title: 'Sprint Planning',
      tags: [{ id: 'tag_1', name: 'Work', count: 1 }],
      created_at: '2026-10-17T12:00:00Z',
      duration_ms: 60000,
      error_code: null,
      error_message: null,
      failed_step: null,
      processing: false,
      note: null,
      waveform_peaks: null,
      speakers: [
        {
          id: 'spk_1',
          name: 'Sarah',
          display_name: 'Sarah',
          label: 'Speaker 1',
        },
      ],
      segments: [
        {
          id: 'seg_1',
          idx: 0,
          speaker_id: 'spk_1',
          start_ms: 12000,
          end_ms: 18000,
          text: 'We should release next Tuesday.',
        },
      ],
      summary: {
        overview: 'Discussed sprint timeline.',
        decisions: [
          {
            text: 'Ship on Tuesday.',
            citations: [
              {
                recording_id: 'rec_meeting',
                segment_id: 'seg_1',
                start_ms: 12000,
              },
            ],
          },
        ],
        action_items: [],
        open_questions: [],
      },
    };

    mockUseRecording.mockReturnValue({
      data: mockRecording,
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

    // Citation chip with Plex Mono time: 00:12
    const citationChip = screen.getByLabelText('Jump to 00:12');
    fireEvent.press(citationChip);

    // After clicking citation, it switches to transcript and shows the transcript text
    await waitFor(() =>
      expect(screen.getByText('We should release next Tuesday.')).toBeTruthy(),
    );
  });

  test('highlights segment and opens transcript when ?segment= is in URL params', async () => {
    const mockRecording: Schemas['RecordingDetailOut'] = {
      id: 'rec_meeting_param',
      kind: 'meeting',
      status: 'ready',
      title: 'Roadmap Sync',
      tags: [],
      created_at: '2026-10-17T12:00:00Z',
      duration_ms: 30000,
      error_code: null,
      error_message: null,
      failed_step: null,
      processing: false,
      note: null,
      waveform_peaks: null,
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
    };

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

    await renderScreen('rec_meeting_param', 'seg_target');

    // Should already be on transcript and showing the segment
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
    const mockRecording: Schemas['RecordingDetailOut'] = {
      id: 'rec_note',
      kind: 'note',
      status: 'ready',
      title: 'Idea for feature',
      tags: [],
      created_at: '2026-10-17T12:00:00Z',
      duration_ms: 15000,
      error_code: null,
      error_message: null,
      failed_step: null,
      processing: false,
      summary: null,
      waveform_peaks: null,
      speakers: [],
      segments: [
        {
          id: 'seg_n1',
          idx: 0,
          speaker_id: null,
          start_ms: 0,
          end_ms: 5000,
          text: 'Raw speech note.',
        },
      ],
      note: {
        key_points: [
          {
            text: 'Key idea number one.',
            citations: [
              { recording_id: 'rec_note', segment_id: 'seg_n1', start_ms: 0 },
            ],
          },
        ],
        clean_text: 'Cleaned up text of the idea.',
      },
    };

    mockUseRecording.mockReturnValue({
      data: mockRecording,
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
