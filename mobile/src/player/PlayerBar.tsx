import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import { formatDuration } from '../format';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { Scrubber } from './Scrubber';
import type { UsePlayerResult } from './usePlayer';

export interface PlayerBarProps {
  player: UsePlayerResult;
  peaks?: number[] | null;
}

export function PlayerBar({ player, peaks }: PlayerBarProps) {
  const { tape } = useTheme<TapeTheme>();

  if (player.error) {
    return (
      <View
        testID="player-bar-error"
        style={[
          styles.container,
          { backgroundColor: tape.surface, borderTopColor: tape.line },
        ]}
      >
        <View style={styles.errorRow}>
          <Text
            style={[
              styles.errorText,
              { color: tape.signal, fontFamily: fontFamilies.regular },
            ]}
          >
            {player.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={player.retry}
            android_ripple={{ color: tape.line }}
            style={[
              styles.retryButton,
              { backgroundColor: tape.raised, borderColor: tape.line },
            ]}
          >
            <Text
              style={[
                styles.retryText,
                { color: tape.ink, fontFamily: fontFamilies.semibold },
              ]}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      testID="player-bar"
      style={[
        styles.container,
        { backgroundColor: tape.surface, borderTopColor: tape.line },
      ]}
    >
      <Scrubber
        peaks={peaks}
        positionMs={player.positionMs}
        durationMs={player.durationMs}
        onSeek={player.seekTo}
      />
      <View style={styles.controlsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
          onPress={player.toggle}
          android_ripple={{ color: tape.line, borderless: true }}
          style={styles.playButton}
        >
          <MaterialCommunityIcons
            name={player.isPlaying ? 'pause' : 'play'}
            size={28}
            color={tape.ink}
            accessible={false}
          />
        </Pressable>

        <Text
          style={[
            styles.timeText,
            { color: tape.inkMuted, fontFamily: fontFamilies.mono },
          ]}
        >
          {`${formatDuration(player.positionMs)} / ${formatDuration(
            player.durationMs,
          )}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.round,
  },
  timeText: {
    fontSize: typeScale.small,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: typeScale.body,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
  },
  retryText: {
    fontSize: typeScale.body,
  },
});
