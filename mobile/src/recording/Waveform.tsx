import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';
import { pushLevel } from './levelBuffer';

export interface WaveformProps {
  level: SharedValue<number>;
  count?: number;
  testID?: string;
}

interface WaveformBarProps {
  buffer: SharedValue<number[]>;
  index: number;
  color: string;
}

function WaveformBar({ buffer, index, color }: WaveformBarProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const rawLevel = buffer.value[index] ?? 0;
    const scale = Math.max(0.06, rawLevel);
    return {
      transform: [{ scaleY: scale }],
    };
  });

  return (
    <Animated.View
      testID="waveform-bar"
      style={[styles.bar, { backgroundColor: color }, animatedStyle]}
    />
  );
}

export function Waveform({
  level,
  count = 48,
  testID = 'waveform',
}: WaveformProps) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const buffer = useSharedValue<number[]>(new Array(count).fill(0));

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => {
      buffer.value = pushLevel(buffer.value, level.value, count);
    }, 50);
    return () => clearInterval(interval);
  }, [reducedMotion, buffer, level, count]);

  const colors = useMemo(() => {
    if (count <= 1) return [tape.signal];
    return Array.from({ length: count }, (_, i) =>
      interpolateColor(i / (count - 1), [0, 1], [tape.inkMuted, tape.signal]),
    );
  }, [count, tape.inkMuted, tape.signal]);

  const singleBarStyle = useAnimatedStyle(() => {
    const clamped = Math.max(0, Math.min(1, level.value));
    return {
      width: `${clamped * 100}%`,
    };
  });

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Audio waveform"
      style={[
        styles.container,
        { backgroundColor: tape.raised, borderColor: tape.line },
      ]}
    >
      {reducedMotion ? (
        <View
          testID="waveform-track"
          style={[styles.track, { backgroundColor: tape.line }]}
        >
          <Animated.View
            testID="waveform-single-bar"
            style={[
              styles.singleBar,
              { backgroundColor: tape.signal },
              singleBarStyle,
            ]}
          />
        </View>
      ) : (
        <View style={styles.barsContainer}>
          {colors.map((color, index) => (
            <WaveformBar
              key={index}
              buffer={buffer}
              index={index}
              color={color}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 96,
    borderRadius: radius.card,
    borderWidth: 1,
    marginTop: spacing.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  bar: {
    flex: 1,
    height: 64,
    marginHorizontal: 1,
    borderRadius: radius.round,
  },
  track: {
    height: spacing.sm,
    marginHorizontal: spacing.md,
    borderRadius: radius.round,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  singleBar: {
    height: '100%',
    borderRadius: radius.round,
  },
});
