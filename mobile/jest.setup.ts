import { setUpTests } from 'react-native-reanimated';

setUpTests();

// Under Jest (Node.js), stub ExpoAudio native module so expo-audio can load
const g = globalThis as unknown as {
  expo?: { modules?: Record<string, unknown> };
};
g.expo = g.expo ?? {};
g.expo.modules = g.expo.modules ?? {};
if (!g.expo.modules.ExpoAudio) {
  class MockAudioPlayer {
    replace() {}
    setPlaybackRate() {}
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
