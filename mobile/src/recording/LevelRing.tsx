import React from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius } from '../theme/tokens';

export interface LevelRingProps {
  level: SharedValue<number>;
  size?: number;
  testID?: string;
}

export function LevelRing({
  level,
  size = 88,
  testID = 'level-ring',
}: LevelRingProps) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => {
    if (reducedMotion) {
      return {
        transform: [{ scale: 1 }],
      };
    }
    const clampedLevel = Math.max(0, Math.min(1, level.value));
    const targetScale = 1 + clampedLevel * 0.25;
    return {
      transform: [
        {
          scale: withSpring(targetScale, motion.spring),
        },
      ],
    };
  });

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: radius.round,
          borderColor: tape.signal,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
});
