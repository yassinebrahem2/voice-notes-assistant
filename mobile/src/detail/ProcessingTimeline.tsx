import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { Schemas } from '../api/client';
import { errorMessage } from '../api/errorMessages';
import { ApiError } from '../api/errors';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { useRetryRecording } from './mutations';
import { timelineSteps, type TimelineStepItem } from './timeline';

export interface ProcessingTimelineProps {
  recording: Schemas['RecordingDetailOut'];
}

function StepDot({ step }: { step: TimelineStepItem }) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion || step.state !== 'current') {
      scale.set(1);
      return;
    }
    scale.set(
      withRepeat(
        withSequence(
          withTiming(1.3, { duration: motion.durations.slow }),
          withTiming(1, { duration: motion.durations.slow }),
        ),
        -1,
        true,
      ),
    );
  }, [reducedMotion, step.state, scale]);

  const animatedDotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  if (step.state === 'done') {
    return (
      <View style={[styles.dotBase, { backgroundColor: tape.signal }]}>
        <MaterialCommunityIcons
          name="check"
          size={14}
          color={tape.onSignal}
          accessible={false}
        />
      </View>
    );
  }

  if (step.state === 'current') {
    return (
      <Animated.View
        style={[
          styles.dotBase,
          {
            borderColor: tape.signal,
            backgroundColor: tape.raised,
            borderWidth: 2,
          },
          animatedDotStyle,
        ]}
      >
        <View style={[styles.dotInner, { backgroundColor: tape.signal }]} />
      </Animated.View>
    );
  }

  if (step.state === 'failed') {
    return (
      <View style={[styles.dotBase, { backgroundColor: tape.signal }]}>
        <MaterialCommunityIcons
          name="close"
          size={14}
          color={tape.onSignal}
          accessible={false}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.dotBase,
        {
          borderColor: tape.line,
          backgroundColor: tape.surface,
          borderWidth: 2,
        },
      ]}
    />
  );
}

export function ProcessingTimeline({ recording }: ProcessingTimelineProps) {
  const { tape } = useTheme<TapeTheme>();
  const retryMutation = useRetryRecording();
  const steps = timelineSteps(
    recording.kind,
    recording.status,
    recording.failed_step,
  );

  const isFailed = recording.status === 'failed';
  const resolvedErrorMessage =
    recording.error_message ||
    (recording.error_code
      ? errorMessage(new ApiError(500, recording.error_code, ''))
      : 'Processing failed.');

  return (
    <View style={styles.container}>
      <View style={styles.stepsContainer}>
        {steps.map((item, index) => {
          const isLast = index === steps.length - 1;
          const isHighlight =
            item.state === 'current' || item.state === 'failed';

          return (
            <View key={item.step} style={styles.stepRow}>
              <View style={styles.dotColumn}>
                <StepDot step={item} />
                {!isLast ? (
                  <View
                    style={[
                      styles.connectorLine,
                      {
                        backgroundColor:
                          item.state === 'done' ? tape.signal : tape.line,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.labelColumn}>
                <Text
                  style={[
                    styles.stepLabel,
                    {
                      color: isHighlight ? tape.ink : tape.inkMuted,
                      fontFamily: isHighlight
                        ? fontFamilies.semibold
                        : fontFamilies.regular,
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {isFailed ? (
        <View
          style={[
            styles.failedBox,
            { backgroundColor: tape.surface, borderColor: tape.line },
          ]}
        >
          <View style={styles.errorRow}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={20}
              color={tape.signal}
              accessible={false}
            />
            <Text
              accessibilityRole="alert"
              style={[
                styles.errorText,
                { color: tape.ink, fontFamily: fontFamilies.regular },
              ]}
            >
              {resolvedErrorMessage}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry processing"
            onPress={() => retryMutation.mutate(recording.id)}
            disabled={retryMutation.isPending}
            android_ripple={{ color: tape.line }}
            style={({ pressed }) => [
              styles.retryButton,
              {
                backgroundColor: tape.signal,
                opacity: pressed || retryMutation.isPending ? 0.8 : 1,
              },
            ]}
          >
            {retryMutation.isPending ? (
              <ActivityIndicator color={tape.onSignal} size="small" />
            ) : (
              <Text
                style={[
                  styles.retryText,
                  { color: tape.onSignal, fontFamily: fontFamilies.semibold },
                ]}
              >
                Retry
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md },
  stepsContainer: { marginBottom: spacing.lg },
  stepRow: { flexDirection: 'row', minHeight: 52 },
  dotColumn: { width: 28, alignItems: 'center' },
  labelColumn: { flex: 1, paddingLeft: spacing.sm, paddingTop: 2 },
  connectorLine: { width: 2, flex: 1, marginVertical: 4 },
  dotBase: {
    width: 20,
    height: 20,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: { width: 8, height: 8, borderRadius: radius.round },
  stepLabel: { fontSize: typeScale.body, lineHeight: 22 },
  failedBox: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { flex: 1, fontSize: typeScale.body },
  retryButton: {
    minHeight: 48,
    minWidth: 96,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  retryText: { fontSize: typeScale.body },
});
