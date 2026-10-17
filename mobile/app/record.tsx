import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isExpoGo } from '../src/recording/environment';
import { closeFanOut } from '../src/recording/fanOutStore';
import { useRecorder } from '../src/recording/useRecorder';
import { fontFamilies } from '../src/theme/fonts';
import { motion } from '../src/theme/motion';
import type { TapeTheme } from '../src/theme/paperTheme';
import { radius, spacing } from '../src/theme/tokens';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export default function RecordScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const recordingKind = kind === 'note' ? 'note' : 'meeting';
  const recorder = useRecorder(recordingKind);
  const { tape } = useTheme<TapeTheme>();
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [expoGoClient, setExpoGoClient] = useState(isExpoGo);
  const mounted = useRef(false);
  const opacity = useSharedValue(1);
  const veil = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const handleStop = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() =>
      console.warn('Haptic feedback is unavailable.'),
    );
    await recorder.stop();
    router.back();
  }, [recorder]);

  const handleClose = useCallback(() => {
    if (recorder.isRecording || recorder.elapsedMs > 0) {
      setShowDiscardDialog(true);
    } else {
      router.back();
    }
  }, [recorder.isRecording, recorder.elapsedMs]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await recorder.discard();
    router.back();
  }, [recorder]);

  useEffect(() => {
    const onBackPress = () => {
      if (recorder.isRecording || recorder.elapsedMs > 0) {
        setShowDiscardDialog(true);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [recorder.isRecording, recorder.elapsedMs]);

  return (
    <View
      testID="record-screen"
      style={[styles.root, { backgroundColor: tape.bg }]}
      onLayout={() => {
        if (mounted.current) return;
        mounted.current = true;
        void (async () => {
          try {
            await recorder.prepare();
            setExpoGoClient(isExpoGo());
            await recorder.start();
          } catch (error) {
            console.warn('Failed to start recording', error);
          }
          closeFanOut();
          opacity.set(
            withTiming(0, {
              duration: motion.durations.base,
              reduceMotion: ReduceMotion.Never,
            }),
          );
        })();
      }}
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

          {expoGoClient || isExpoGo() ? (
            <Text
              variant="bodySmall"
              style={[styles.expoGoNote, { color: tape.inkMuted }]}
            >
              Keep the app open while recording
            </Text>
          ) : null}

          <View
            testID="level-placeholder"
            style={[
              styles.levelPlaceholder,
              { backgroundColor: tape.raised, borderColor: tape.line },
            ]}
          />
        </View>

        {recorder.paused ? (
          <View
            testID="paused-banner"
            style={[
              styles.pausedBanner,
              {
                backgroundColor: tape.surface,
                borderColor: tape.line,
              },
            ]}
          >
            <Text
              variant="bodyMedium"
              style={[styles.pausedText, { color: tape.ink }]}
            >
              Paused while the app was in the background
            </Text>
            <View style={styles.pausedActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Resume recording"
                onPress={() => recorder.resume()}
                android_ripple={{ color: tape.line }}
                style={[
                  styles.bannerButton,
                  { borderColor: tape.outline, borderWidth: 1 },
                ]}
              >
                <Text variant="labelLarge" style={{ color: tape.ink }}>
                  Resume
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
                onPress={handleStop}
                android_ripple={{ color: tape.line }}
                style={[styles.bannerButton, { backgroundColor: tape.signal }]}
              >
                <Text variant="labelLarge" style={{ color: tape.onSignal }}>
                  Stop
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            testID="stop-button"
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
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
              style={[styles.stopSquare, { backgroundColor: tape.onSignal }]}
            />
          </Pressable>
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

      <Portal>
        <Dialog
          visible={showDiscardDialog}
          onDismiss={() => setShowDiscardDialog(false)}
          style={{ backgroundColor: tape.surface }}
        >
          <Dialog.Title style={{ color: tape.ink }}>
            Discard recording?
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: tape.inkMuted }}>
              This recording will not be saved.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              textColor={tape.inkMuted}
              onPress={() => setShowDiscardDialog(false)}
              accessibilityLabel="Keep recording"
              style={styles.dialogButton}
            >
              Keep recording
            </Button>
            <Button
              textColor={tape.signal}
              onPress={handleDiscard}
              accessibilityLabel="Discard"
              style={styles.dialogButton}
            >
              Discard
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: spacing.xxl,
    height: spacing.xxl,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  timer: {
    marginBottom: spacing.xs,
  },
  expoGoNote: {
    marginBottom: spacing.md,
  },
  levelPlaceholder: {
    width: '100%',
    height: 96,
    borderRadius: radius.card,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  pausedBanner: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pausedText: {
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  pausedActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  bannerButton: {
    minHeight: spacing.xxl,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  stopButton: {
    width: 72,
    height: 72,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stopSquare: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  dialogButton: {
    minHeight: spacing.xxl,
    justifyContent: 'center',
  },
});
