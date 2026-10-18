import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { RecordingKind } from './fanOut';
import { enqueue, type PendingUpload } from './pending';
import type { RecorderErrorState } from './RecorderErrorView';
import { uploadPending } from './upload';
import type { UseRecorderResult } from './useRecorder';

export type ScreenState =
  'recording' | 'uploading' | 'error' | 'success' | RecorderErrorState;

export function useRecordFlow(
  recordingKind: RecordingKind,
  recorder: UseRecorderResult,
  isMounted: () => boolean,
) {
  const [screenState, setScreenState] = useState<ScreenState>('recording');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);

  const pendingItemRef = useRef<PendingUpload | null>(null);
  const lastRecordedRef = useRef<{ uri: string; durationMs: number } | null>(
    null,
  );

  const startUpload = useCallback(
    async (item: PendingUpload) => {
      setScreenState('uploading');
      setUploadProgress(0);
      try {
        const recording = await uploadPending(item, (fraction) => {
          if (isMounted()) setUploadProgress(fraction);
        });
        if (!isMounted()) return;
        setScreenState('success');
        setTimeout(() => {
          if (isMounted()) {
            router.replace({
              pathname: '/recording/[id]',
              params: { id: recording.id },
            });
          }
        }, 500);
      } catch (error) {
        console.warn('Upload failed', error);
        if (isMounted()) setScreenState('error');
      }
    },
    [isMounted],
  );

  const handleStop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() =>
      console.warn('Haptic feedback is unavailable.'),
    );

    let uri = '';
    let durationMs = 0;
    try {
      const res = await recorder.stop();
      uri = res.uri;
      durationMs = res.durationMs;
      lastRecordedRef.current = { uri, durationMs };
    } catch (error) {
      console.warn('Failed to stop recording', error);
      setScreenState('error');
      return;
    }

    try {
      const item = await enqueue(uri, recordingKind, durationMs);
      pendingItemRef.current = item;
      await startUpload(item);
    } catch (error) {
      console.warn('Failed to enqueue recording', error);
      setScreenState('enqueue_failed');
    }
  }, [recorder, recordingKind, startUpload]);

  const handleRetry = useCallback(async () => {
    if (pendingItemRef.current) {
      void startUpload(pendingItemRef.current);
    } else if (lastRecordedRef.current) {
      try {
        const item = await enqueue(
          lastRecordedRef.current.uri,
          recordingKind,
          lastRecordedRef.current.durationMs,
        );
        pendingItemRef.current = item;
        await startUpload(item);
      } catch (error) {
        console.warn('Retry enqueue failed', error);
        setScreenState('enqueue_failed');
      }
    }
  }, [recordingKind, startUpload]);

  const handleSaveRecovered = useCallback(async () => {
    if (!recorder.uri) return;
    try {
      const item = await enqueue(
        recorder.uri,
        recordingKind,
        recorder.elapsedMs,
      );
      pendingItemRef.current = item;
      await startUpload(item);
    } catch (error) {
      console.warn('Failed to save recovered recording', error);
      setScreenState('enqueue_failed');
    }
  }, [recorder.uri, recordingKind, recorder.elapsedMs, startUpload]);

  const handleDiscardRecovered = useCallback(async () => {
    try {
      if (recorder.uri) {
        const file = new File(recorder.uri);
        if (file.exists) file.delete();
      }
    } catch (err) {
      console.warn('Could not delete cache file on discard', err);
    }
    router.back();
  }, [recorder.uri]);

  return {
    screenState,
    setScreenState,
    uploadProgress,
    stopping,
    handleStop,
    handleRetry,
    handleSaveRecovered,
    handleDiscardRecovered,
  };
}
