import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { File } from 'expo-file-system';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { audioModeFor, isExpoGo, shouldPauseOnReturn } from './environment';
import type { RecordingKind } from './fanOut';
import { dbfsToLevel } from './levels';

import {
  RecordingPresets,
  type RecordingStatus,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

export interface UseRecorderResult {
  level: SharedValue<number>;
  elapsedMs: number;
  paused: boolean;
  isRecording: boolean;
  error: string | null;
  uri: string | null;
  prepare: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<{ uri: string; durationMs: number }>;
  discard: () => Promise<void>;
  pause: () => Promise<void> | void;
  resume: () => Promise<void> | void;
}

export function useRecorder(_kind: RecordingKind): UseRecorderResult {
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ReturnType<typeof useAudioRecorder> | null>(null);

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

  const statusListener = useCallback(
    (status: RecordingStatus) => {
      if (status.hasError) {
        clearIntervalTimer();
        try {
          if (recorderRef.current) {
            void recorderRef.current.stop();
          }
        } catch (err) {
          console.warn('Failed to stop recorder after status error', err);
        }
        setIsRecording(false);
        setError(status.error ?? 'Recording error');
      }
    },
    [clearIntervalTimer],
  );

  const recorder = useAudioRecorder(
    {
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    },
    statusListener,
  );
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

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
    setError(null);
    await setAudioModeAsync(audioModeFor(isExpoGo()));
    await recorder.prepareToRecordAsync();
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);
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
    } catch (err) {
      try {
        const status = recorder.getStatus();
        if (status.isRecording) {
          console.warn('Failed to stop recorder on discard', err);
        }
      } catch {
        console.warn('Failed to stop recorder on discard', err);
      }
    }
    try {
      const uri = recorder.uri;
      if (uri) {
        const file = new File(uri);
        if (file.exists) {
          file.delete();
        }
      }
    } catch (err) {
      console.warn('Failed to delete cache file on discard', err);
    }
    level.set(0);
    setElapsedMs(0);
    setPaused(false);
    setIsRecording(false);
    setError(null);
    lastElapsedDurationRef.current = 0;
  }, [recorder, clearIntervalTimer, level]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        wasBackgroundedRef.current = true;
      } else if (nextState === 'active') {
        if (shouldPauseOnReturn(isExpoGo(), wasBackgroundedRef.current)) {
          wasBackgroundedRef.current = false;
          try {
            recorder.pause();
          } catch (err) {
            console.warn('Failed to pause recorder on foreground return', err);
          }
          clearIntervalTimer();
          level.set(0);
          setPaused(true);
        } else {
          wasBackgroundedRef.current = false;
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [recorder, clearIntervalTimer, level]);

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
    error,
    uri: recorder.uri ?? null,
    prepare,
    start,
    stop,
    discard,
    pause,
    resume,
  };
}
