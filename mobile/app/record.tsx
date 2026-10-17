import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { closeFanOut } from '../src/recording/fanOutStore';
import { motion } from '../src/theme/motion';
import type { TapeTheme } from '../src/theme/paperTheme';
import { radius, spacing } from '../src/theme/tokens';

export default function RecordScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { tape } = useTheme<TapeTheme>();
  const mounted = useRef(false);
  const opacity = useSharedValue(1);
  const veil = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <View
      testID="record-screen"
      style={[styles.root, { backgroundColor: tape.bg }]}
      onLayout={() => {
        if (mounted.current) return;
        mounted.current = true;
        // Keep the root cover until this identical colour has laid out behind it.
        closeFanOut();
        opacity.set(
          withTiming(0, {
            duration: motion.durations.base,
            reduceMotion: ReduceMotion.Never,
          }),
        );
      }}
    >
      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Text variant="titleLarge">
            {kind === 'note' ? 'Note' : 'Meeting'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close recorder"
            onPress={() => router.back()}
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
      </SafeAreaView>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: tape.signal },
          veil,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, padding: spacing.md },
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
});
