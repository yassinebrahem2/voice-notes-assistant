import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export interface RecorderBannerProps {
  theme: TapeTheme;
  onResume: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function RecorderBanner({
  theme,
  onResume,
  onStop,
  disabled = false,
}: RecorderBannerProps) {
  const { tape } = theme;
  return (
    <View
      testID="paused-banner"
      style={[
        styles.pausedBanner,
        {
          backgroundColor: tape.surface,
          borderColor: tape.line,
        },
      ]}
    >
      <Text
        variant="bodyMedium"
        style={[styles.pausedText, { color: tape.ink }]}
      >
        Paused while the app was in the background
      </Text>
      <View style={styles.pausedActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume recording"
          disabled={disabled}
          onPress={onResume}
          android_ripple={{ color: tape.line }}
          style={[
            styles.bannerButton,
            { borderColor: tape.outline, borderWidth: 1 },
          ]}
        >
          <Text variant="labelLarge" style={{ color: tape.ink }}>
            Resume
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
          disabled={disabled}
          onPress={onStop}
          android_ripple={{ color: tape.line }}
          style={[styles.bannerButton, { backgroundColor: tape.signal }]}
        >
          <Text variant="labelLarge" style={{ color: tape.onSignal }}>
            Stop
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pausedBanner: {
    marginHorizontal: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pausedText: {
    textAlign: 'center',
  },
  pausedActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  bannerButton: {
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
