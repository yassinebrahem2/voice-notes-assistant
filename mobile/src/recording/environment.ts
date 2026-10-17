import type { AudioMode } from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Returns true if the app is currently executing inside the Expo Go app.
 */
export function isExpoGo(): boolean {
  const c = Constants as unknown as {
    executionEnvironment?: ExecutionEnvironment | string;
    appOwnership?: string;
  };
  return (
    c.executionEnvironment === ExecutionEnvironment.StoreClient ||
    c.executionEnvironment === 'storeClient' ||
    c.appOwnership === 'expo'
  );
}

/**
 * Audio mode configuration based on whether the app runs in Expo Go or a standalone build.
 * Background audio recording is not supported in Expo Go, so it is disabled there.
 */
export function audioModeFor(isExpoGoClient: boolean): Partial<AudioMode> {
  return {
    allowsRecording: true,
    allowsBackgroundRecording: !isExpoGoClient,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: !isExpoGoClient,
    shouldRouteThroughEarpiece: false,
  };
}

/**
 * Decides whether the recorder should pause upon returning to foreground.
 * Only returns true if the app was backgrounded while running in Expo Go.
 */
export function shouldPauseOnReturn(
  isExpoGoClient: boolean,
  wasBackgrounded: boolean,
): boolean {
  return isExpoGoClient && wasBackgrounded;
}
