import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { setUpTests } from 'react-native-reanimated';

setUpTests();

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Under Jest (Node.js), stub ExpoAudio native module so expo-audio can load
const g = globalThis as unknown as {
  expo?: { modules?: Record<string, unknown> };
};
g.expo = g.expo ?? {};
g.expo.modules = g.expo.modules ?? {};
if (!g.expo.modules.ExpoAudio) {
  class MockAudioPlayer {
    id = 'mock-audio-player';
    currentStatus = {
      id: 'mock-audio-player',
      currentTime: 0,
      duration: 0,
      playing: false,
      isLoaded: true,
      isBuffering: false,
      playbackState: 'idle',
      timeControlStatus: 'paused',
      reasonForWaitingToPlay: '',
      mute: false,
      loop: false,
      didJustFinish: false,
      playbackRate: 1,
      shouldCorrectPitch: true,
      isLive: false,
    };
    replace() {}
    setPlaybackRate() {}
    play() {}
    pause() {}
    seekTo() {
      return Promise.resolve();
    }
    addListener() {
      return { remove: () => {} };
    }
    removeListener() {}
    release() {}
  }
  class MockAudioRecorder {
    prepareToRecordAsync() {
      return Promise.resolve();
    }
    record() {}
    pause() {}
    stop() {
      return Promise.resolve();
    }
    getStatus() {
      return {
        canRecord: true,
        isRecording: false,
        durationMillis: 0,
        metering: -160,
        fileSize: 0,
      };
    }
    addListener() {
      return { remove: () => {} };
    }
    removeListener() {}
    release() {}
  }
  g.expo.modules.ExpoAudio = {
    AudioPlayer: MockAudioPlayer,
    AudioRecorder: MockAudioRecorder,
    setAudioModeAsync: async () => {},
  };
}
