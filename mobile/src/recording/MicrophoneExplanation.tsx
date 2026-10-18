import { useEffect } from 'react';
import {
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export interface MicrophoneExplanationProps {
  reason: 'denied' | 'error';
  onClose: () => void;
  onSettingsError: () => void;
}

export function MicrophoneExplanation({
  reason,
  onClose,
  onSettingsError,
}: MicrophoneExplanationProps) {
  const { tape } = useTheme<TapeTheme>();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View
      testID="microphone-explanation"
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss microphone explanation"
        onPress={onClose}
        android_ripple={{ color: tape.line }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          sheetStyles.sheet,
          {
            backgroundColor: tape.surface,
            borderColor: tape.outline,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
      >
        <Text variant="titleLarge">Microphone access</Text>
        <Text variant="bodyLarge">
          {reason === 'denied'
            ? 'Microphone access is needed to record meetings and notes. Allow it in Settings.'
            : "Couldn't check microphone access. Try again."}
        </Text>
        {reason === 'denied' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            android_ripple={{ color: tape.line }}
            onPress={() => {
              void Linking.openSettings().catch(onSettingsError);
            }}
            style={sheetStyles.action}
          >
            <Text style={{ color: tape.signal }}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close microphone explanation"
          android_ripple={{ color: tape.line }}
          onPress={onClose}
          style={sheetStyles.action}
        >
          <Text>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    gap: spacing.md,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  action: {
    minHeight: spacing.xxl,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.card,
    overflow: 'hidden',
  },
});
