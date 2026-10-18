import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { errorMessage } from '../api/errorMessages';
import { openFanOut } from '../recording/fanOutStore';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface LibraryEmptyStateProps {
  kind: 'meeting' | 'note';
  isNoServer: boolean;
  error: Error | null;
  isFilterActive: boolean;
  onClearFilters: () => void;
  onRetryQuery: () => void;
}

export function LibraryEmptyState({
  kind,
  isNoServer,
  error,
  isFilterActive,
  onClearFilters,
  onRetryQuery,
}: LibraryEmptyStateProps) {
  const { tape } = useTheme<TapeTheme>();

  if (isNoServer) {
    return (
      <View style={styles.centerContainer}>
        <MaterialCommunityIcons
          name="server-network-off"
          size={48}
          color={tape.inkMuted}
          style={styles.emptyIcon}
        />
        <Text
          style={[
            styles.emptyTitle,
            { color: tape.ink, fontFamily: fontFamilies.semibold },
          ]}
        >
          {error?.message || 'Set a server URL in Settings.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          onPress={() => router.push('/settings')}
          android_ripple={{ color: tape.onSignal, borderless: false }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: tape.signal,
              transform: [{ scale: pressed ? motion.press.scale : 1 }],
            },
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              { color: tape.onSignal, fontFamily: fontFamilies.semibold },
            ]}
          >
            Open Settings
          </Text>
        </Pressable>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text
          style={[
            styles.emptyTitle,
            { color: tape.signal, fontFamily: fontFamilies.semibold },
          ]}
        >
          {errorMessage(error)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={onRetryQuery}
          android_ripple={{ color: tape.line, borderless: false }}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              backgroundColor: tape.raised,
              borderColor: tape.line,
              transform: [{ scale: pressed ? motion.press.scale : 1 }],
            },
          ]}
        >
          <Text
            style={[
              styles.secondaryButtonText,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (isFilterActive) {
    return (
      <View style={styles.centerContainer}>
        <MaterialCommunityIcons
          name="magnify-close"
          size={48}
          color={tape.inkMuted}
          style={styles.emptyIcon}
        />
        <Text
          style={[
            styles.emptyTitle,
            { color: tape.ink, fontFamily: fontFamilies.semibold },
          ]}
        >
          No matching recordings
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          onPress={onClearFilters}
          android_ripple={{ color: tape.line, borderless: false }}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              backgroundColor: tape.raised,
              borderColor: tape.line,
              transform: [{ scale: pressed ? motion.press.scale : 1 }],
            },
          ]}
        >
          <Text
            style={[
              styles.secondaryButtonText,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Clear filters
          </Text>
        </Pressable>
      </View>
    );
  }

  const emptyActionTitle =
    kind === 'meeting' ? 'Record your first meeting' : 'Record your first note';

  return (
    <View style={styles.centerContainer}>
      <MaterialCommunityIcons
        name="microphone-outline"
        size={48}
        color={tape.inkMuted}
        style={styles.emptyIcon}
      />
      <Text
        style={[
          styles.emptyTitle,
          { color: tape.ink, fontFamily: fontFamilies.semibold },
        ]}
      >
        {emptyActionTitle}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record"
        onPress={openFanOut}
        android_ripple={{ color: tape.onSignal, borderless: false }}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: tape.signal,
            transform: [{ scale: pressed ? motion.press.scale : 1 }],
          },
        ]}
      >
        <Text
          style={[
            styles.primaryButtonText,
            { color: tape.onSignal, fontFamily: fontFamilies.semibold },
          ]}
        >
          Record
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: typeScale.body,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.card,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: typeScale.body,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typeScale.body,
  },
});
