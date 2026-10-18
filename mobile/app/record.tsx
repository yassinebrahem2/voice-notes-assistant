import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { closeFanOut } from '../src/recording/fanOutStore';
import { isExpoGo } from '../src/recording/environment';
import { LevelRing } from '../src/recording/LevelRing';
import { checkAudioPlayable } from '../src/recording/playability';
import { UploadProgressRing } from '../src/recording/UploadProgressRing';
import { useRecorder } from '../src/recording/useRecorder';
import { useRecordFlow } from '../src/recording/useRecordFlow';
import { Waveform } from '../src/recording/Waveform';
import { DiscardDialog } from '../src/recording/DiscardDialog';
import { RecorderBanner } from '../src/recording/RecorderBanner';
import { RecorderErrorView } from '../src/recording/RecorderErrorView';
import { fontFamilies } from '../src/theme/fonts';
import { motion } from '../src/theme/motion';
import type { TapeTheme } from '../src/theme/paperTheme';
import { radius, spacing } from '../src/theme/tokens';

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function RecordScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const recordingKind = kind === 'note' ? 'note' : 'meeting';
  const recorder = useRecorder(recordingKind);
  const theme = useTheme<TapeTheme>();
  const { tape } = theme;

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const isMountedRef = useRef(true);
  const mounted = useRef(false);
  const opacity = useSharedValue(1);
  const veil = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const {
    screenState,
    setScreenState,
    uploadProgress,
    stopping,
    handleStop,
    handleRetry,
    handleSaveRecovered,
    handleDiscardRecovered,
  } = useRecordFlow(recordingKind, recorder, () => isMountedRef.current);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleClose = useCallback(() => {
    if (
      screenState === 'recording' &&
      (recorder.isRecording || recorder.elapsedMs > 0)
    ) {
      setShowDiscardDialog(true);
    } else {
      router.back();
    }
  }, [screenState, recorder.isRecording, recorder.elapsedMs]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await recorder.discard();
    router.back();
  }, [recorder]);

  useEffect(() => {
    if (recorder.error && screenState === 'recording') {
      void (async () => {
        const playable = await checkAudioPlayable(recorder.uri);
        if (!isMountedRef.current) return;
        if (playable) {
          setScreenState('offer_save');
        } else {
          try {
            if (recorder.uri) {
              const file = new File(recorder.uri);
              if (file.exists) file.delete();
            }
          } catch {}
          setScreenState('recording_failed');
        }
      })();
    }
  }, [recorder.error, recorder.uri, screenState, setScreenState]);

  useEffect(() => {
    const onBackPress = () => {
      if (
        screenState === 'recording' &&
        (recorder.isRecording || recorder.elapsedMs > 0)
      ) {
        setShowDiscardDialog(true);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [screenState, recorder.isRecording, recorder.elapsedMs]);

  const isErrorState =
    screenState === 'start_failed' ||
    screenState === 'recording_failed' ||
    screenState === 'enqueue_failed' ||
    screenState === 'offer_save';

  const onLayout = useCallback(() => {
    if (mounted.current) return;
    mounted.current = true;
    void (async () => {
      try {
        await recorder.prepare();
        await recorder.start();
      } catch (error) {
        console.warn('Failed to start recording', error);
        setScreenState('start_failed');
      }
      closeFanOut();
      opacity.set(
        withTiming(0, {
          duration: motion.durations.base,
          reduceMotion: ReduceMotion.Never,
        }),
      );
    })();
  }, [recorder, opacity, setScreenState]);

  return (
    <View
      testID="record-screen"
      style={[styles.root, { backgroundColor: tape.bg }]}
      onLayout={onLayout}
    >
      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Text variant="titleLarge">
            {recordingKind === 'note' ? 'Note' : 'Meeting'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close recorder"
            onPress={handleClose}
            android_ripple={{ color: tape.line }}
            style={styles.close}
          >
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={tape.ink}
              accessible={false}
            />
          </Pressable>
        </View>

        {isErrorState ? (
          <RecorderErrorView
            state={screenState}
            theme={theme}
            onClose={() => router.back()}
            onRetry={handleRetry}
            onSave={handleSaveRecovered}
            onDiscard={handleDiscardRecovered}
          />
        ) : (
          <View style={styles.body}>
            <Text
              variant="displayLarge"
              testID="record-timer"
              style={[
                styles.timer,
                {
                  color: tape.ink,
                  fontFamily: fontFamilies.mono,
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {formatDuration(recorder.elapsedMs)}
            </Text>

            {isExpoGo() ? (
              <Text
                variant="bodySmall"
                style={[styles.expoGoNote, { color: tape.inkMuted }]}
              >
                Keep the app open while recording
              </Text>
            ) : null}

            <Waveform level={recorder.level} />
          </View>
        )}

        {screenState === 'recording' && recorder.paused ? (
          <RecorderBanner
            theme={theme}
            disabled={stopping}
            onResume={() => recorder.resume()}
            onStop={handleStop}
          />
        ) : null}

        <View style={styles.footer}>
          {screenState === 'recording' ? (
            <>
              <LevelRing level={recorder.level} />
              <Pressable
                testID="stop-button"
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
                disabled={stopping}
                onPress={handleStop}
                android_ripple={{ color: tape.onSignal }}
                style={({ pressed }) => [
                  styles.stopButton,
                  {
                    backgroundColor: tape.signal,
                    transform: [{ scale: pressed ? motion.press.scale : 1 }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.stopSquare,
                    { backgroundColor: tape.onSignal },
                  ]}
                />
              </Pressable>
            </>
          ) : screenState === 'uploading' ||
            screenState === 'error' ||
            screenState === 'success' ? (
            <UploadProgressRing
              progress={uploadProgress}
              status={screenState}
              onRetry={handleRetry}
            />
          ) : null}
        </View>
      </SafeAreaView>

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: tape.signal },
          veil,
        ]}
      />

      <DiscardDialog
        visible={showDiscardDialog}
        theme={theme}
        onDismiss={() => setShowDiscardDialog(false)}
        onDiscard={handleDiscard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { alignItems: 'center', gap: spacing.lg },
  timer: { textAlign: 'center' },
  expoGoNote: { textAlign: 'center' },
  footer: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 24,
    height: 24,
    borderRadius: radius.card,
  },
});
