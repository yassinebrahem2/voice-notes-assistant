import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { withTiming } from 'react-native-reanimated';

import type { Schemas } from '../api/client';
import { motion } from '../theme/motion';
import { paperTheme } from '../theme/paperTheme';
import { ProcessingTimeline } from './ProcessingTimeline';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('./mutations', () => ({
  useRetryRecording: jest.fn(() => ({
    mutate: jest.fn(),
    isPending: false,
  })),
}));

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    __esModule: true,
    ...actual,
    useReducedMotion: jest.fn(() => false),
    withTiming: jest.fn((toValue, config) =>
      actual.withTiming(toValue, config),
    ),
  };
});

function makeProcessingRecording(
  overrides: Partial<Schemas['RecordingDetailOut']> = {},
): Schemas['RecordingDetailOut'] {
  return {
    id: 'rec_proc',
    kind: 'meeting',
    status: 'transcribing',
    title: 'Processing meeting',
    created_at: '2026-10-17T12:00:00Z',
    duration_ms: 10000,
    error_code: null,
    error_message: null,
    failed_step: null,
    processing: true,
    segments: [],
    speakers: [],
    tags: [],
    summary: null,
    note: null,
    waveform_peaks: null,
    ...overrides,
  };
}

describe('ProcessingTimeline', () => {
  test('uses motion.durations.slow for the pulse animation', async () => {
    const recording = makeProcessingRecording();

    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <ProcessingTimeline recording={recording} />
      </PaperProvider>,
    );

    expect(screen.getByText('Transcribing audio')).toBeTruthy();
    expect(withTiming).toHaveBeenCalledWith(1.3, {
      duration: motion.durations.slow,
    });
    expect(withTiming).toHaveBeenCalledWith(1, {
      duration: motion.durations.slow,
    });
  });
});
