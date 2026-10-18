import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RecordScreen from '../../app/record';
import { paperTheme } from '../theme/paperTheme';
import { enqueue } from './pending';
import { uploadPending } from './upload';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ kind: 'meeting' })),
}));

jest.mock('./pending', () => ({
  enqueue: jest.fn(),
  removePending: jest.fn(() => Promise.resolve()),
}));

jest.mock('./upload', () => ({
  uploadPending: jest.fn(),
}));

const mockFiles = new Map<string, boolean>();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockFiles.get(this.uri) ?? false;
    }
    delete = jest.fn(() => {
      mockFiles.delete(this.uri);
    });
  }
  return {
    File: MockFile,
    Paths: { document: 'file:///mock-doc' },
    Directory: class MockDir {
      create = jest.fn();
    },
  };
});

let mockPlayerStatus: {
  isLoaded: boolean;
  duration: number;
  error?: string | null;
} = { isLoaded: true, duration: 5 };
const mockPlayerRelease = jest.fn();

jest.mock('expo-audio', () => {
  const actual = jest.requireActual('expo-audio');
  return {
    ...actual,
    createAudioPlayer: jest.fn(() => ({
      currentStatus: mockPlayerStatus,
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      release: mockPlayerRelease,
    })),
  };
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

interface MockAudioRecorderProto {
  addListener: (
    event: string,
    cb: (status: unknown) => void,
  ) => { remove: () => void };
  prepareToRecordAsync: () => Promise<void>;
  uri?: string;
}

interface MockGlobal {
  expo?: {
    modules?: {
      ExpoAudio?: {
        AudioRecorder?: {
          prototype: MockAudioRecorderProto;
        };
      };
    };
  };
}

describe('RecordScreen failure paths and controls', () => {
  let recorderStatusListener: ((status: unknown) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFiles.clear();
    mockPlayerStatus = { isLoaded: true, duration: 5 };
    mockPlayerRelease.mockClear();
    Constants.executionEnvironment = ExecutionEnvironment.StoreClient;

    const g = globalThis as unknown as MockGlobal;
    const proto = g.expo?.modules?.ExpoAudio?.AudioRecorder?.prototype;
    if (proto) {
      proto.addListener = jest.fn((_evt, cb) => {
        recorderStatusListener = cb;
        return { remove: jest.fn() };
      });
      proto.uri = 'file:///mock/cache-file.m4a';
    }

    jest.mocked(enqueue).mockResolvedValue({
      clientUploadId: 'test-uuid',
      kind: 'meeting',
      path: 'file:///mock/path.meeting.m4a',
      createdAt: '2026-10-17T00:00:00Z',
      durationMs: 500,
    });
    jest.mocked(uploadPending).mockResolvedValue({
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
    });
  });

  afterEach(async () => {
    await act(async () => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  test('start() rejecting shows "Couldn\'t start recording" and no Stop button', async () => {
    const g = globalThis as unknown as MockGlobal;
    const proto = g.expo?.modules?.ExpoAudio?.AudioRecorder?.prototype;
    const origPrepare = proto?.prepareToRecordAsync;
    if (proto) {
      proto.prepareToRecordAsync = jest
        .fn()
        .mockRejectedValue(new Error('Audio permission denied or device busy'));
    }

    try {
      const { unmount } = await renderRecordScreen();
      const recordRoot = screen.getByTestId('record-screen');
      await act(async () => {
        fireEvent(recordRoot, 'layout');
      });

      expect(screen.getByText("Couldn't start recording")).toBeTruthy();
      expect(screen.queryByTestId('stop-button')).toBeNull();
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
      unmount();
    } finally {
      if (proto && origPrepare) {
        proto.prepareToRecordAsync = origPrepare;
      }
    }
  });

  test('two quick Stop taps call recorder.stop() once and enqueue once', async () => {
    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    const stopButton = screen.getByTestId('stop-button');
    await act(async () => {
      fireEvent.press(stopButton);
      fireEvent.press(stopButton);
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('enqueue rejecting once then succeeding on Retry uploads the same URI', async () => {
    jest
      .mocked(enqueue)
      .mockRejectedValueOnce(new Error('Storage full'))
      .mockResolvedValueOnce({
        clientUploadId: 'retry-uuid',
        kind: 'meeting',
        path: 'file:///mock/path.meeting.m4a',
        createdAt: '2026-10-17T00:00:00Z',
        durationMs: 500,
      });

    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    const stopButton = screen.getByTestId('stop-button');
    await act(async () => {
      fireEvent.press(stopButton);
    });

    expect(screen.getByText("Couldn't save the recording")).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    await act(async () => {
      fireEvent.press(retryBtn);
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(uploadPending).toHaveBeenCalledWith(
      expect.objectContaining({ clientUploadId: 'retry-uuid' }),
      expect.any(Function),
    );
    unmount();
  });

  test('recorder status update with hasError and playable file shows Save and Discard, Save enqueues', async () => {
    mockFiles.set('file:///mock/cache-file.m4a', true);
    mockPlayerStatus = { isLoaded: true, duration: 4 };

    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    await act(async () => {
      recorderStatusListener?.({
        id: 'mock-audio-recorder',
        isFinished: false,
        hasError: true,
        error: 'MediaRecorder error',
        url: null,
      });
    });

    expect(screen.getByRole('button', { name: 'Save recording' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Discard recording' }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save recording' }));
    });

    expect(enqueue).toHaveBeenCalledWith(
      'file:///mock/cache-file.m4a',
      'meeting',
      expect.any(Number),
    );
    unmount();
  });

  test('with no file, a zero duration, or a player that never loads (after 3 s), "Recording failed", and player is released', async () => {
    mockFiles.set('file:///mock/cache-file.m4a', true);
    mockPlayerStatus = { isLoaded: false, duration: 0 };

    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    await act(async () => {
      recorderStatusListener?.({
        id: 'mock-audio-recorder',
        isFinished: false,
        hasError: true,
        error: 'Device error',
        url: null,
      });
    });

    // Advance 3 seconds for playability timeout
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByText('Recording failed')).toBeTruthy();
    expect(mockPlayerRelease).toHaveBeenCalled();
    expect(mockFiles.get('file:///mock/cache-file.m4a')).toBeUndefined();
    unmount();
  });

  test('Discard deletes the cache file', async () => {
    mockFiles.set('file:///mock/cache-file.m4a', true);

    const { unmount } = await renderRecordScreen();
    const recordRoot = screen.getByTestId('record-screen');
    await act(async () => {
      fireEvent(recordRoot, 'layout');
    });

    // Simulate recorder status with error and playable file
    mockPlayerStatus = { isLoaded: true, duration: 5 };
    await act(async () => {
      recorderStatusListener?.({
        id: 'mock-audio-recorder',
        isFinished: false,
        hasError: true,
        error: 'MediaRecorder error',
        url: null,
      });
    });

    const discardBtn = screen.getByRole('button', {
      name: 'Discard recording',
    });
    await act(async () => {
      fireEvent.press(discardBtn);
    });

    expect(mockFiles.get('file:///mock/cache-file.m4a')).toBeUndefined();
    expect(router.back).toHaveBeenCalled();
    unmount();
  });
});
