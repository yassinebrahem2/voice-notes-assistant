import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';

import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius } from '../theme/tokens';
import { openFanOut } from './fanOutStore';

export function RecordAction() {
  const { tape } = useTheme<TapeTheme>();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record"
      onPress={openFanOut}
      android_ripple={{ color: tape.onSignal, borderless: false }}
      style={({ pressed }) => [
        styles.disc,
        {
          backgroundColor: tape.signal,
          transform: [{ scale: pressed ? motion.press.scale : 1 }],
        },
      ]}
    >
      <MaterialCommunityIcons
        name="microphone-outline"
        size={28}
        color={tape.onSignal}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 64,
    height: 64,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
