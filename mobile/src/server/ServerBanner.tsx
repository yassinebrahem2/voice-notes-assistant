import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { spacing } from '../theme/tokens';
import { useReduceMotion } from '../theme/useReduceMotion';
import { useServerStatus } from './useServerStatus';

type Problem = 'unreachable' | 'no_server';

const messages: Record<Problem, string> = {
  unreachable: "Can't reach the server",
  no_server: 'Set the server address in Settings',
};

// Mounted once at the root: it also runs the only health poller (useServerStatus).
export function ServerBanner() {
  const { tape } = useTheme<TapeTheme>();
  const insets = useSafeAreaInsets();
  const status = useServerStatus();
  const reduceMotion = useReduceMotion();
  const target: Problem | null =
    status === 'unreachable' || status === 'no_server' ? status : null;
  // The last problem is kept so the text stays readable while the banner animates out.
  const [last, setLast] = useState<Problem | null>(target);
  const [gone, setGone] = useState(target === null);
  const [progress] = useState(() => new Animated.Value(target ? 1 : 0));
  if (target && target !== last) setLast(target);
  if (target && gone) setGone(false);

  useEffect(() => {
    // Unknown setting: jump rather than animate, so a user who turned motion off never sees movement.
    if (reduceMotion !== false) {
      progress.setValue(target ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: target ? 1 : 0,
      duration: motion.durations.base,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !target) setGone(true);
    });
    return () => animation.stop();
  }, [target, reduceMotion, progress]);

  const shown = target ?? last;
  if (!shown || (!target && (gone || reduceMotion !== false))) return null;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.root,
        {
          backgroundColor: tape.raised,
          borderBottomColor: tape.signal,
          paddingTop: insets.top,
          paddingLeft: spacing.md + insets.left,
          paddingRight: spacing.md + insets.right,
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-spacing.md, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.row}>
        <Text
          variant="bodyMedium"
          style={[styles.message, { color: tape.ink }]}
        >
          {messages[shown]}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Settings"
          onPress={() => router.push('/settings')}
          android_ripple={{ color: tape.line }}
          style={styles.link}
        >
          <Text
            variant="labelLarge"
            style={[styles.linkText, { color: tape.ink }]}
          >
            Settings
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  message: { flex: 1 },
  link: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { textDecorationLine: 'underline' },
});
