import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RecordScreen from '../../app/record';
import { paperTheme } from '../theme/paperTheme';

type AppStateListener = (state: AppStateStatus) => void;
let changeListener: AppStateListener | undefined;

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ kind: 'meeting' })),
}));

jest.mock('./pending', () => ({
  enqueue: jest.fn(() =>
    Promise.resolve({
      clientUploadId: 'test-uuid',
      kind: 'meeting',
      path: 'file:///mock/path.m4a',
      createdAt: '2026-10-17T00:00:00Z',
      durationMs: 500,
    }),
  ),
  removePending: jest.fn(() => Promise.resolve()),
}));

jest.mock('./upload', () => ({
  uploadPending: jest.fn(() =>
    Promise.resolve({
      id: 'rec_test_1',
      kind: 'meeting',
      status: 'uploaded',
      title: null,
      created_at: '2026-10-17T00:00:00Z',
      duration_ms: 500,
      processing: false,
      error_code: null,
      error_message: null,
      failed_step: null,
      tags: [],
      waveform_peaks: null,
    }),
  ),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light', Heavy: 'heavy' },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, bottom: 24, left: 0, right: 0 },
};

function renderRecordScreen() {
  return render(
    React.createElement(
      SafeAreaProvider,
      { initialMetrics: metrics },
      React.createElement(
        PaperProvider as React.ComponentType<{
          theme: ReturnType<typeof paperTheme>;
          children?: React.ReactNode;
        }>,
        { theme: paperTheme('dark') },
        React.createElement(RecordScreen),
      ),
    ),
  );
}

describe('RecordScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Constants.executionEnvironment = ExecutionEnvironment.StoreClient;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((event, listener) => {
        if (event === 'change') {
          changeListener = listener as AppStateListener;
        }
        return { remove: jest.fn() } as never;
      });
  });

  afterEach(async () => {
    await act(async () => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  test('renders kind, timer, placeholder, and Expo Go note', async () => {
    const { unmount } = await renderRecordScreen();
    expect(screen.getByText('Meeting')).toBeTruthy();
    expect(screen.getByTestId('record-timer')).toBeTruthy();
    expect(screen.getByTestId('waveform')).toBeTruthy();
    expect(screen.getByText('Keep the app open while recording')).toBeTruthy();
    unmount();
  });

  test('pressing Stop triggers medium haptic and transitions to upload', async () => {
    const { unmount } = await renderRecordScreen();
    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Stop recording' }),
      );
    });
    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
    expect(screen.getByTestId('upload-progress-ring')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/recording/[id]',
      params: { id: 'rec_test_1' },
    });
    unmount();
  });

  test('pressing Close when not recording navigates back immediately', async () => {
    const { unmount } = await renderRecordScreen();
    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Close recorder' }),
      );
    });
    expect(router.back).toHaveBeenCalled();
    unmount();
  });

  test('pressing Close during recording opens discard dialog with Keep recording and Discard', async () => {
    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Close recorder' }),
      );
    });

    expect(screen.getByText('Discard recording?')).toBeTruthy();
    expect(screen.getByText('This recording will not be saved.')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Keep recording' }),
      );
    });

    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Close recorder' }),
      );
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
    });
    expect(router.back).toHaveBeenCalled();
    unmount();
  });

  test('displays paused banner when paused with Resume and Stop buttons', async () => {
    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    await act(async () => {
      changeListener?.('background');
    });
    await act(async () => {
      changeListener?.('active');
    });

    expect(screen.getByTestId('paused-banner')).toBeTruthy();
    expect(
      screen.getByText('Paused while the app was in the background'),
    ).toBeTruthy();

    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Resume recording' }),
      );
    });
    expect(screen.queryByTestId('paused-banner')).toBeNull();
    unmount();
  });
});
