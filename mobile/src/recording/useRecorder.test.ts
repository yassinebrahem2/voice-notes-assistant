import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import React from 'react';
import { setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RecordScreen from '../../app/record';
import { paperTheme } from '../theme/paperTheme';
import { useRecorder } from './useRecorder';

type AppStateListener = (state: AppStateStatus) => void;

let changeListener: AppStateListener | undefined;

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ kind: 'meeting' })),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light', Heavy: 'heavy' },
}));

jest.mock('expo-audio', () => {
  const actualRecorder = {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(() => ({
      canRecord: true,
      isRecording: true,
      durationMillis: 0,
      metering: -25,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    })),
    uri: 'file:///data/recording.m4a',
  };
  return {
    useAudioRecorder: jest.fn(() => actualRecorder),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    RecordingPresets: {
      HIGH_QUALITY: { extension: '.m4a' },
      LOW_QUALITY: { extension: '.m4a' },
    },
  };
});

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

describe('useRecorder', () => {
  const originalEnv = Constants.executionEnvironment;
  let mockRecorder: ReturnType<typeof useAudioRecorder>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Default to Expo Go environment
    Constants.executionEnvironment = ExecutionEnvironment.StoreClient;
    mockRecorder = useAudioRecorder({} as never);
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
    Constants.executionEnvironment = originalEnv;
  });

  test('prepare configures audio mode and prepares recorder', async () => {
    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.prepare();
    });
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('after start, advancing 50ms polls getStatus and updates level.value', async () => {
    jest.mocked(mockRecorder.getStatus).mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 100,
      metering: -25,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    });

    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
    });

    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    expect(mockRecorder.getStatus).toHaveBeenCalled();
    expect(result.current.level.value).toBeCloseTo(0.5, 2);
    unmount();
  });

  test('over 1s elapsedMs changes at most 4 times', async () => {
    let currentMillis = 0;
    jest.mocked(mockRecorder.getStatus).mockImplementation(() => {
      currentMillis += 50;
      return {
        canRecord: true,
        isRecording: true,
        durationMillis: currentMillis,
        metering: -20,
        mediaServicesDidReset: false,
        url: 'file:///data/recording.m4a',
        fileSize: 0,
      };
    });

    const elapsedValues: number[] = [];
    const { result, unmount } = await renderHook(() => useRecorder('note'));

    await act(async () => {
      await result.current.start();
    });

    for (let i = 0; i < 20; i++) {
      await act(async () => {
        jest.advanceTimersByTime(50);
      });
      if (
        elapsedValues.length === 0 ||
        elapsedValues[elapsedValues.length - 1] !== result.current.elapsedMs
      ) {
        elapsedValues.push(result.current.elapsedMs);
      }
    }

    expect(elapsedValues.length).toBeLessThanOrEqual(5);
    unmount();
  });

  test('after stop, interval is cleared and no further getStatus calls occur', async () => {
    jest.mocked(mockRecorder.getStatus).mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 500,
      metering: -10,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    });

    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    const statusCallsBeforeStop = jest.mocked(mockRecorder.getStatus).mock.calls
      .length;

    let stopResult: { uri: string; durationMs: number } | undefined;
    await act(async () => {
      stopResult = await result.current.stop();
    });

    expect(deactivateKeepAwake).toHaveBeenCalled();
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(stopResult).toEqual({
      uri: 'file:///data/recording.m4a',
      durationMs: 500,
    });

    const callsAtStop = jest.mocked(mockRecorder.getStatus).mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(jest.mocked(mockRecorder.getStatus).mock.calls.length).toBe(
      callsAtStop,
    );
    expect(callsAtStop).toBeGreaterThanOrEqual(statusCallsBeforeStop);
    unmount();
  });

  test('returning to active after background in Expo Go with isRecording calls pause and sets paused', async () => {
    jest.mocked(mockRecorder.getStatus).mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 1000,
      metering: -15,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    });

    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.paused).toBe(false);

    // Background app
    await act(async () => {
      changeListener?.('background');
    });

    // Foreground app
    await act(async () => {
      changeListener?.('active');
    });

    expect(mockRecorder.pause).toHaveBeenCalledTimes(1);
    expect(result.current.paused).toBe(true);
    unmount();
  });

  test('outside Expo Go, returning to active after background does not pause', async () => {
    Constants.executionEnvironment = ExecutionEnvironment.Standalone;

    jest.mocked(mockRecorder.getStatus).mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 1000,
      metering: -15,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    });

    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
    });

    // Background app
    await act(async () => {
      changeListener?.('background');
    });

    // Foreground app
    await act(async () => {
      changeListener?.('active');
    });

    expect(mockRecorder.pause).not.toHaveBeenCalled();
    expect(result.current.paused).toBe(false);
    unmount();
  });

  test('resume restarts recording and clears paused state', async () => {
    jest.mocked(mockRecorder.getStatus).mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 1000,
      metering: -15,
      mediaServicesDidReset: false,
      url: 'file:///data/recording.m4a',
      fileSize: 0,
    });

    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
      result.current.pause();
    });

    expect(result.current.paused).toBe(true);

    await act(async () => {
      result.current.resume();
    });

    expect(mockRecorder.record).toHaveBeenCalledTimes(2);
    expect(result.current.paused).toBe(false);
    unmount();
  });

  test('discard stops recording, clears interval and resets state', async () => {
    const { result, unmount } = await renderHook(() => useRecorder('meeting'));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.discard();
    });

    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(deactivateKeepAwake).toHaveBeenCalled();
    expect(result.current.paused).toBe(false);
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.isRecording).toBe(false);
    unmount();
  });
});

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
    expect(screen.getByTestId('level-placeholder')).toBeTruthy();
    expect(screen.getByText('Keep the app open while recording')).toBeTruthy();
    unmount();
  });

  test('pressing Stop triggers medium haptic and navigates back', async () => {
    const { unmount } = await renderRecordScreen();
    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Stop recording' }),
      );
    });
    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
    expect(router.back).toHaveBeenCalled();
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
    // Simulate layout which starts recording
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

    // Tap Keep recording -> dismisses dialog
    await act(async () => {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Keep recording' }),
      );
    });

    // Tap Close again, then Discard -> discards and navigates back
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
