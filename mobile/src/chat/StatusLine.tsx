import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';
import { useReduceMotion } from './useReduceMotion';

const DOTS = 3;

export function StatusLine({ steps }: { steps: string[] }) {
  const { tape } = useTheme<TapeTheme>();
  const reduceMotion = useReduceMotion();
  const [dots] = useState(() =>
    Array.from({ length: DOTS }, () => new Animated.Value(1)),
  );

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      dots.forEach((dot) => dot.setValue(1));
      return;
    }
    const loop = Animated.loop(
      Animated.stagger(
        motion.durations.base,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 0.2,
              duration: motion.durations.base,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 1,
              duration: motion.durations.base,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots, reduceMotion]);

  const label = steps.at(-1) ?? 'Sending';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={styles.row}
    >
      <Text variant="bodyMedium" style={{ color: tape.inkMuted }}>
        {label}
      </Text>
      {dots.map((opacity, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { backgroundColor: tape.inkMuted, opacity }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: spacing.xs, height: spacing.xs, borderRadius: radius.round },
});
