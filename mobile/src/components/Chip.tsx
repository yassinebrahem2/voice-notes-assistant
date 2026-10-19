import type React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from 'react-native-paper';

import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface ChipProps {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'checkbox';
  selected?: boolean;
  selectedVariant?: 'signal' | 'outline';
  leading?: React.ReactNode;
}

export function Chip({
  label,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  selected,
  selectedVariant = 'signal',
  leading,
}: ChipProps): React.JSX.Element {
  const { tape } = useTheme<TapeTheme>();
  const isSelected = selected === true;

  let backgroundColor: string;
  let borderColor: string;
  let textColor: string;

  if (selectedVariant === 'signal') {
    if (isSelected) {
      backgroundColor = tape.signal;
      borderColor = tape.signal;
      textColor = tape.onSignal;
    } else {
      backgroundColor = tape.surface;
      borderColor = tape.line;
      textColor = tape.ink;
    }
  } else {
    if (isSelected) {
      backgroundColor = tape.raised;
      borderColor = tape.ink;
      textColor = tape.ink;
    } else {
      backgroundColor = 'transparent';
      borderColor = tape.line;
      textColor = tape.ink;
    }
  }

  const fontFamily = isSelected ? fontFamilies.semibold : fontFamilies.regular;

  const accessibilityState =
    accessibilityRole === 'checkbox'
      ? { checked: isSelected }
      : selected !== undefined
        ? { selected: isSelected }
        : undefined;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      onPress={onPress}
      android_ripple={{ color: tape.line, borderless: false }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor,
          borderColor,
          transform: [{ scale: pressed ? motion.press.scale : 1 }],
        },
      ]}
    >
      {leading}
      <Text style={[styles.label, { color: textColor, fontFamily }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.chip,
    borderCurve: 'continuous',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  label: {
    fontSize: typeScale.small,
  },
});
