import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { audioModeFor, isExpoGo, shouldPauseOnReturn } from './environment';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn() }));

describe('environment', () => {
  describe('isExpoGo', () => {
    const originalEnv = Constants.executionEnvironment;
    const originalOwnership = Constants.appOwnership;

    beforeEach(() => {
      jest.mocked(isRunningInExpoGo).mockReset();
    });

    afterEach(() => {
      Constants.executionEnvironment = originalEnv;
      Constants.appOwnership = originalOwnership;
    });

    test('detects Expo Go even when native constants report bare and no ownership', () => {
      jest.mocked(isRunningInExpoGo).mockReturnValue(true);
      Constants.executionEnvironment = ExecutionEnvironment.Bare;
      Constants.appOwnership = null;
      expect(isExpoGo()).toBe(true);
      expect(audioModeFor(isExpoGo()).allowsBackgroundRecording).toBe(false);
    });

    test('returns false in a development build', () => {
      jest.mocked(isRunningInExpoGo).mockReturnValue(false);
      Constants.executionEnvironment = ExecutionEnvironment.Bare;
      expect(isExpoGo()).toBe(false);
      expect(audioModeFor(isExpoGo()).allowsBackgroundRecording).toBe(true);
    });

    test('returns false in a standalone build', () => {
      jest.mocked(isRunningInExpoGo).mockReturnValue(false);
      Constants.executionEnvironment = ExecutionEnvironment.Standalone;
      expect(isExpoGo()).toBe(false);
      expect(audioModeFor(isExpoGo()).allowsBackgroundRecording).toBe(true);
    });
  });

  describe('audioModeFor', () => {
    test('disables background recording and playback in Expo Go', () => {
      const mode = audioModeFor(true);
      expect(mode.allowsRecording).toBe(true);
      expect(mode.allowsBackgroundRecording).toBe(false);
      expect(mode.shouldPlayInBackground).toBe(false);
      expect(mode.playsInSilentMode).toBe(true);
      expect(mode.interruptionMode).toBe('doNotMix');
      expect(mode.shouldRouteThroughEarpiece).toBe(false);
    });

    test('enables background recording and playback outside Expo Go', () => {
      const mode = audioModeFor(false);
      expect(mode.allowsRecording).toBe(true);
      expect(mode.allowsBackgroundRecording).toBe(true);
      expect(mode.shouldPlayInBackground).toBe(true);
      expect(mode.playsInSilentMode).toBe(true);
      expect(mode.interruptionMode).toBe('doNotMix');
      expect(mode.shouldRouteThroughEarpiece).toBe(false);
    });
  });

  describe('shouldPauseOnReturn', () => {
    test.each([
      [true, true, true],
      [true, false, false],
      [false, true, false],
      [false, false, false],
    ])(
      'given isExpoGo=%p and wasBackgrounded=%p returns %p',
      (expoGo, wasBackgrounded, expected) => {
        expect(shouldPauseOnReturn(expoGo, wasBackgrounded)).toBe(expected);
      },
    );
  });
});
