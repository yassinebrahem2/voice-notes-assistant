import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
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

function interpolateColor(
  color1: string,
  color2: string,
  factor: number,
): string {
  if (factor <= 0) return color1;
  if (factor >= 1) return color2;
  const c1 = parseInt(color1.replace('#', ''), 16);
  const c2 = parseInt(color2.replace('#', ''), 16);

  const r1 = (c1 >> 16) & 255;
  const g1 = (c1 >> 8) & 255;
  const b1 = c1 & 255;

  const r2 = (c2 >> 16) & 255;
  const g2 = (c2 >> 8) & 255;
  const b2 = c2 & 255;

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return `#${hex.toUpperCase()}`;
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
      interpolateColor(tape.inkMuted, tape.signal, i / (count - 1)),
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
      <View
        testID="level-placeholder"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
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
