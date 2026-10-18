import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { queryClient } from '../api/queryClient';
import { recordingQuery } from '../detail/useRecording';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { formatDate, formatDuration } from './PendingRow';
import { rowStatus } from './rowStatus';
import { WaveThumb } from './WaveThumb';

export interface RecordingRowProps {
  recording: Schemas['RecordingOut'];
  onPress?: (id: string) => void;
}

export function RecordingRow({ recording, onPress }: RecordingRowProps) {
  const { tape } = useTheme<TapeTheme>();
  const status = rowStatus(recording);
  const title = recording.title?.trim() || 'Untitled recording';

  const handlePressIn = () => {
    void queryClient.prefetchQuery(recordingQuery(recording.id));
  };

  const handlePress = () => {
    if (onPress) {
      onPress(recording.id);
    } else {
      router.push({
        pathname: '/recording/[id]',
        params: { id: recording.id },
      });
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPressIn={handlePressIn}
      onPress={handlePress}
      android_ripple={{ color: tape.line, borderless: false }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tape.surface,
          borderColor: tape.line,
          transform: [{ scale: pressed ? motion.press.scale : 1 }],
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            { color: tape.ink, fontFamily: fontFamilies.semibold },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.duration,
            { color: tape.inkMuted, fontFamily: fontFamilies.mono },
          ]}
        >
          {formatDuration(recording.duration_ms)}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {recording.created_at ? (
          <Text
            style={[
              styles.date,
              { color: tape.inkMuted, fontFamily: fontFamilies.regular },
            ]}
          >
            {formatDate(recording.created_at)}
          </Text>
        ) : null}

        {recording.waveform_peaks && recording.waveform_peaks.length > 0 ? (
          <WaveThumb peaks={recording.waveform_peaks} />
        ) : null}

        {recording.tags && recording.tags.length > 0 ? (
          <View style={styles.tagChips}>
            {recording.tags.map((tag) => (
              <View
                key={tag.id}
                style={[
                  styles.tagChip,
                  {
                    backgroundColor: tape.raised,
                    borderColor: tape.line,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                  ]}
                >
                  {tag.name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {status ? (
        <View style={styles.statusSection}>
          <Text
            numberOfLines={1}
            style={[
              styles.statusLabel,
              {
                color: status.tone === 'error' ? tape.signal : tape.inkMuted,
                fontFamily: fontFamilies.regular,
              },
            ]}
          >
            {status.label}
          </Text>
          {status.progress !== null ? (
            <View
              style={[styles.progressBarTrack, { backgroundColor: tape.line }]}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: tape.signal,
                    width: `${Math.round(status.progress * 100)}%`,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: typeScale.body,
  },
  duration: {
    fontSize: typeScale.small,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  date: {
    fontSize: typeScale.small,
  },
  tagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tagChip: {
    borderRadius: radius.round,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: typeScale.small,
  },
  statusSection: {
    marginTop: spacing.sm,
  },
  statusLabel: {
    fontSize: typeScale.small,
    marginBottom: spacing.xs,
  },
  progressBarTrack: {
    height: 3,
    borderRadius: radius.round,
    overflow: 'hidden',
    width: '100%',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radius.round,
  },
});
