import { render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { RecordingScreen } from '../../app/recording/[id]';
import type { Schemas } from '../api/client';
import { paperTheme } from '../theme/paperTheme';
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
  useReducedMotion: jest.fn(() => true),
}));

jest.mock('./useRecording', () => ({
  useRecording: jest.fn(),
}));

jest.mock('./mutations', () => ({
  useRetryRecording: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useUpdateRecording: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useRenameSpeaker: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeleteRecording: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const mockPlayerState = {
  isPlaying: true,
  positionMs: 1000,
  durationMs: 10000,
  error: null,
  playFrom: jest.fn().mockResolvedValue(undefined),
  toggle: jest.fn(),
  seekTo: jest.fn().mockResolvedValue(undefined),
  retry: jest.fn(),
};

jest.mock('../../src/player/usePlayer', () => ({
  usePlayer: jest.fn(() => mockPlayerState),
}));

const mockUseRecording = jest.mocked(useRecording);
const mockUseLocalSearchParams = jest.mocked(useLocalSearchParams);

describe('RecordingScreenPlayback', () => {
  test('keeps last active segment highlighted during playback gap instead of jumping to ?segment=', async () => {
    const mockRecording: Schemas['RecordingDetailOut'] = {
      id: 'rec_gap_test',
      kind: 'meeting',
      status: 'ready',
      title: 'Gap Test Meeting',
      created_at: '2026-10-17T12:00:00Z',
      duration_ms: 10000,
      error_code: null,
      error_message: null,
      failed_step: null,
      processing: false,
      speakers: [
        {
          id: 'spk_1',
          name: 'Alice',
          display_name: 'Alice',
          label: 'Speaker 1',
        },
      ],
      segments: [
        {
          id: 'seg_1',
          idx: 0,
          speaker_id: 'spk_1',
          start_ms: 0,
          end_ms: 2000,
          text: 'First segment.',
        },
        {
          id: 'seg_2',
          idx: 1,
          speaker_id: 'spk_1',
          start_ms: 4000,
          end_ms: 6000,
          text: 'Second segment.',
        },
      ],
      tags: [],
      summary: null,
      note: null,
      waveform_peaks: null,
    };

    mockUseRecording.mockReturnValue({
      data: mockRecording,
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    mockUseLocalSearchParams.mockReturnValue({
      id: 'rec_gap_test',
      segment: 'seg_2',
    });

    mockPlayerState.positionMs = 1000;
    mockPlayerState.isPlaying = true;

    const { rerender } = await render(
      <PaperProvider theme={paperTheme('dark')}>
        <RecordingScreen id="rec_gap_test" segment="seg_2" />
      </PaperProvider>,
    );

    // At 1000 ms, seg_1 is active
    expect(screen.getByTestId('segment-seg_1-highlighted')).toBeTruthy();
    expect(screen.queryByTestId('segment-seg_2-highlighted')).toBeNull();

    // Advance position to 3000 ms (gap between seg_1 and seg_2)
    mockPlayerState.positionMs = 3000;

    await rerender(
      <PaperProvider theme={paperTheme('dark')}>
        <RecordingScreen id="rec_gap_test" segment="seg_2" />
      </PaperProvider>,
    );

    // During playback gap, seg_1 should remain highlighted, not jumping back to seg_2
    expect(screen.getByTestId('segment-seg_1-highlighted')).toBeTruthy();
    expect(screen.queryByTestId('segment-seg_2-highlighted')).toBeNull();
  });
});
