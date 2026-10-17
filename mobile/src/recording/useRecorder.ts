import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { audioModeFor, isExpoGo, shouldPauseOnReturn } from './environment';
import type { RecordingKind } from './fanOut';
import { dbfsToLevel } from './levels';

import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

export interface UseRecorderResult {
  level: SharedValue<number>;
  elapsedMs: number;
  paused: boolean;
  isRecording: boolean;
  prepare: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<{ uri: string; durationMs: number }>;
  discard: () => Promise<void>;
  pause: () => Promise<void> | void;
  resume: () => Promise<void> | void;
}

export function useRecorder(_kind: RecordingKind): UseRecorderResult {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  const level = useSharedValue(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastElapsedDurationRef = useRef(0);
  const wasBackgroundedRef = useRef(false);

  const clearIntervalTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    clearIntervalTimer();
    intervalRef.current = setInterval(() => {
      const status = recorder.getStatus();
      level.set(dbfsToLevel(status.metering));
      const duration = status.durationMillis ?? 0;
      if (
        duration - lastElapsedDurationRef.current >= 250 ||
        duration < lastElapsedDurationRef.current
      ) {
        lastElapsedDurationRef.current = duration;
        setElapsedMs(duration);
      }
    }, 50);
  }, [recorder, clearIntervalTimer, level]);

  const prepare = useCallback(async () => {
    await setAudioModeAsync(audioModeFor(isExpoGo()));
    await recorder.prepareToRecordAsync();
  }, [recorder]);

  const start = useCallback(async () => {
    await activateKeepAwakeAsync();
    recorder.record();
    setIsRecording(true);
    setPaused(false);
    lastElapsedDurationRef.current = 0;
    startInterval();
  }, [recorder, startInterval]);

  const pause = useCallback(() => {
    recorder.pause();
    clearIntervalTimer();
    setPaused(true);
  }, [recorder, clearIntervalTimer]);

  const resume = useCallback(() => {
    recorder.record();
    setPaused(false);
    startInterval();
  }, [recorder, startInterval]);

  const stop = useCallback(async () => {
    clearIntervalTimer();
    deactivateKeepAwake();
    const status = recorder.getStatus();
    const durationMs = status.durationMillis ?? 0;
    await recorder.stop();
    setIsRecording(false);
    return {
      uri: recorder.uri ?? '',
      durationMs,
    };
  }, [recorder, clearIntervalTimer]);

  const discard = useCallback(async () => {
    clearIntervalTimer();
    deactivateKeepAwake();
    try {
      await recorder.stop();
    } catch {
      // Ignore if recorder is already stopped
    }
    level.set(0);
    setElapsedMs(0);
    setPaused(false);
    setIsRecording(false);
    lastElapsedDurationRef.current = 0;
  }, [recorder, clearIntervalTimer, level]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        wasBackgroundedRef.current = true;
      } else if (nextState === 'active') {
        if (shouldPauseOnReturn(isExpoGo(), wasBackgroundedRef.current)) {
          wasBackgroundedRef.current = false;
          const status = recorder.getStatus();
          if (status.isRecording) {
            recorder.pause();
            clearIntervalTimer();
            setPaused(true);
          }
        } else {
          wasBackgroundedRef.current = false;
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [recorder, clearIntervalTimer]);

  useEffect(() => {
    return () => {
      clearIntervalTimer();
      deactivateKeepAwake();
    };
  }, [clearIntervalTimer]);

  return {
    level,
    elapsedMs,
    paused,
    isRecording,
    prepare,
    start,
    stop,
    discard,
    pause,
    resume,
  };
}
