import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';

import type { PendingUpload } from '../recording/pending';
import { fontFamilies } from '../theme/fonts';
import { motion } from '../theme/motion';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface PendingRowProps {
  item: PendingUpload;
  onRetry: (id: string) => Promise<unknown> | void;
  onDelete: (id: string) => Promise<unknown> | void;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function PendingRow({ item, onRetry, onDelete }: PendingRowProps) {
  const { tape } = useTheme<TapeTheme>();
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleRetry = async () => {
    if (retrying || deleting) return;
    setRetrying(true);
    try {
      await onRetry(item.clientUploadId);
    } finally {
      setRetrying(false);
    }
  };

  const handleDelete = async () => {
    if (retrying || deleting) return;
    setDeleting(true);
    try {
      await onDelete(item.clientUploadId);
    } catch {
      // Failed delete keeps item in pending list
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tape.surface,
          borderColor: tape.line,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleArea}>
          <Text
            style={[
              styles.kindLabel,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            {item.kind === 'meeting' ? 'Meeting' : 'Note'}
          </Text>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: tape.raised,
                borderColor: tape.signal,
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: tape.signal, fontFamily: fontFamilies.semibold },
              ]}
            >
              Not uploaded
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry upload"
            disabled={retrying || deleting}
            onPress={handleRetry}
            android_ripple={{ color: tape.line, borderless: false }}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: tape.raised,
                borderColor: tape.line,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            {retrying ? (
              <ActivityIndicator size={16} color={tape.signal} />
            ) : (
              <View style={styles.buttonContent}>
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={18}
                  color={tape.ink}
                  accessible={false}
                />
                <Text
                  style={[
                    styles.buttonLabel,
                    { color: tape.ink, fontFamily: fontFamilies.regular },
                  ]}
                >
                  Retry
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete pending recording"
            disabled={retrying || deleting}
            onPress={handleDelete}
            android_ripple={{ color: tape.line, borderless: false }}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: tape.raised,
                borderColor: tape.line,
                transform: [{ scale: pressed ? motion.press.scale : 1 }],
              },
            ]}
          >
            {deleting ? (
              <ActivityIndicator size={16} color={tape.signal} />
            ) : (
              <View style={styles.buttonContent}>
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={18}
                  color={tape.inkMuted}
                  accessible={false}
                />
                <Text
                  style={[
                    styles.buttonLabel,
                    { color: tape.inkMuted, fontFamily: fontFamilies.regular },
                  ]}
                >
                  Delete
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text
          style={[
            styles.duration,
            { color: tape.inkMuted, fontFamily: fontFamilies.mono },
          ]}
        >
          {formatDuration(item.durationMs)}
        </Text>
        {item.createdAt ? (
          <Text
            style={[
              styles.date,
              { color: tape.inkMuted, fontFamily: fontFamilies.regular },
            ]}
          >
            {formatDate(item.createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    flex: 1,
  },
  kindLabel: {
    fontSize: typeScale.body,
  },
  badge: {
    borderRadius: radius.round,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typeScale.small,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  buttonLabel: {
    fontSize: typeScale.small,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  duration: {
    fontSize: typeScale.small,
  },
  date: {
    fontSize: typeScale.small,
  },
});
