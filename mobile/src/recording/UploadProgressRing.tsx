import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export type UploadStatus = 'uploading' | 'success' | 'error';

export interface UploadProgressRingProps {
  progress: number;
  status: UploadStatus;
  onRetry?: () => void;
  size?: number;
  testID?: string;
}

export function UploadProgressRing({
  progress,
  status,
  onRetry,
  size = 72,
  testID = 'upload-progress-ring',
}: UploadProgressRingProps) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(reducedMotion ? 1 : 0.8);

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const percent = Math.round(clampedProgress * 100);

  useEffect(() => {
    if (reducedMotion) {
      scale.set(1);
    } else {
      scale.set(withSpring(1, motion.spring));
    }
  }, [status, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  if (status === 'success') {
    return (
      <Animated.View
        testID={testID}
        accessibilityRole="image"
        accessibilityLabel="Upload complete"
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: radius.round,
            backgroundColor: tape.signal,
          },
          animatedStyle,
        ]}
      >
        <MaterialCommunityIcons
          testID="upload-success-icon"
          name="check"
          size={Math.round(size * 0.44)}
          color={tape.onSignal}
          accessible={false}
        />
      </Animated.View>
    );
  }

  if (status === 'error') {
    return (
      <Animated.View style={animatedStyle}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          onPress={onRetry}
          android_ripple={{ color: tape.onSignal }}
          style={({ pressed }) => [
            styles.container,
            styles.errorButton,
            {
              width: size,
              height: size,
              borderRadius: radius.round,
              backgroundColor: tape.signal,
              transform: [{ scale: pressed ? motion.press.scale : 1 }],
            },
          ]}
        >
          <MaterialCommunityIcons
            testID="upload-retry-icon"
            name="reload"
            size={Math.round(size * 0.38)}
            color={tape.onSignal}
            accessible={false}
          />
          <Text
            variant="labelSmall"
            style={[styles.retryText, { color: tape.onSignal }]}
          >
            Retry
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={`Uploading ${percent}%`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius.round,
          borderWidth: 3,
          borderColor: tape.signal,
          backgroundColor: tape.surface,
        },
        animatedStyle,
      ]}
    >
      <Text
        testID="upload-progress-percent"
        variant="labelMedium"
        style={[
          styles.percentText,
          {
            color: tape.ink,
            fontFamily: fontFamilies.mono,
            fontVariant: ['tabular-nums'],
          },
        ]}
      >
        {`${percent}%`}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minWidth: 48,
    minHeight: 48,
  },
  errorButton: {
    gap: 2,
  },
  retryText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
  },
  percentText: {
    paddingHorizontal: spacing.xs,
  },
});
