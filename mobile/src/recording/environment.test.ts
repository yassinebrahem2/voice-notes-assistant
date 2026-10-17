import Constants, { ExecutionEnvironment } from 'expo-constants';

import {
  audioModeFor,
  isExpoGo,
  markAsExpoGo,
  resetExpoGoDetection,
  shouldPauseOnReturn,
} from './environment';

describe('environment', () => {
  describe('isExpoGo', () => {
    const originalEnv = Constants.executionEnvironment;

    afterEach(() => {
      Constants.executionEnvironment = originalEnv;
      resetExpoGoDetection();
    });

    test('returns true when executionEnvironment is storeClient', () => {
      Constants.executionEnvironment = ExecutionEnvironment.StoreClient;
      expect(isExpoGo()).toBe(true);
    });

    test('returns false when executionEnvironment is bare', () => {
      Constants.executionEnvironment = ExecutionEnvironment.Bare;
      expect(isExpoGo()).toBe(false);
    });

    test('returns false when executionEnvironment is standalone', () => {
      Constants.executionEnvironment = ExecutionEnvironment.Standalone;
      expect(isExpoGo()).toBe(false);
    });

    test('returns true when markAsExpoGo is called', () => {
      Constants.executionEnvironment = ExecutionEnvironment.Bare;
      expect(isExpoGo()).toBe(false);
      markAsExpoGo();
      expect(isExpoGo()).toBe(true);
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
