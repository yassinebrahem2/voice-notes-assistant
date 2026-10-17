import type React from 'react';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { formatDuration } from '../library/PendingRow';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import type { Turn } from './turns';

export interface TranscriptViewProps {
  turns: Turn[];
  activeSegmentId?: string | null;
  onSelectSegment?: (segmentId: string) => void;
  speakers?: Schemas['SpeakerOut'][];
  kind?: 'meeting' | 'note';
}

export function TranscriptView({
  turns,
  activeSegmentId,
  onSelectSegment,
  speakers = [],
  kind = 'meeting',
}: TranscriptViewProps) {
  const { tape } = useTheme<TapeTheme>();
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const itemPositions = useRef<Record<string, number>>({});

  useEffect(() => {
    if (
      activeSegmentId &&
      itemPositions.current[activeSegmentId] !== undefined
    ) {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, itemPositions.current[activeSegmentId] - 20),
        animated: true,
      });
    }
  }, [activeSegmentId]);

  const showSpeakerChips = kind === 'meeting' && speakers.length > 0;

  return (
    <View style={styles.container}>
      {showSpeakerChips ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.speakerChipsRow}
          style={styles.speakerChipsScrollView}
        >
          {speakers.map((spk, idx) => {
            const color = tape.speaker[idx % 6];
            const name = spk.name?.trim() || spk.display_name.trim();

            return (
              <View
                key={spk.id}
                style={[
                  styles.speakerChip,
                  { backgroundColor: tape.surface, borderColor: tape.line },
                ]}
              >
                <View style={[styles.speakerDot, { backgroundColor: color }]} />
                <Text
                  style={[
                    styles.speakerChipText,
                    { color: tape.ink, fontFamily: fontFamilies.regular },
                  ]}
                >
                  {name}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.turnsContainer}
      >
        {turns.map((turn, turnIdx) => {
          const speakerIdx = turn.speakerId
            ? speakers.findIndex((s) => s.id === turn.speakerId)
            : -1;
          const speakerColor =
            speakerIdx >= 0 ? tape.speaker[speakerIdx % 6] : tape.inkMuted;

          return (
            <View key={turnIdx} style={styles.turnCard}>
              <View style={styles.turnHeader}>
                {kind === 'meeting' ? (
                  <Text
                    style={[
                      styles.speakerName,
                      {
                        color: speakerColor,
                        fontFamily: fontFamilies.semibold,
                      },
                    ]}
                  >
                    {turn.speakerName}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.timestamp,
                    { color: tape.inkMuted, fontFamily: fontFamilies.mono },
                  ]}
                >
                  {formatDuration(turn.startMs)}
                </Text>
              </View>

              <View style={styles.segmentsWrapper}>
                {turn.segments.map((segment) => {
                  const isHighlighted = segment.id === activeSegmentId;

                  return (
                    <Pressable
                      key={segment.id}
                      testID={`segment-${segment.id}${
                        isHighlighted ? '-highlighted' : ''
                      }`}
                      accessibilityRole="button"
                      accessibilityLabel={`Segment at ${formatDuration(
                        segment.start_ms,
                      )}`}
                      onPress={() => onSelectSegment?.(segment.id)}
                      android_ripple={{ color: tape.line }}
                      onLayout={(event) => {
                        itemPositions.current[segment.id] =
                          event.nativeEvent.layout.y;
                      }}
                      style={[
                        styles.segmentBox,
                        {
                          backgroundColor: isHighlighted
                            ? tape.raised
                            : 'transparent',
                          borderColor: isHighlighted
                            ? tape.signal
                            : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          { color: tape.ink, fontFamily: fontFamilies.regular },
                        ]}
                      >
                        {segment.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  speakerChipsScrollView: {
    maxHeight: 52,
    marginBottom: spacing.md,
  },
  speakerChipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  speakerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.round,
    borderWidth: 1,
  },
  speakerDot: {
    width: 10,
    height: 10,
    borderRadius: radius.round,
  },
  speakerChipText: {
    fontSize: typeScale.small,
  },
  turnsContainer: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  turnCard: {
    gap: spacing.xs,
  },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  speakerName: {
    fontSize: typeScale.body,
  },
  timestamp: {
    fontSize: typeScale.small,
  },
  segmentsWrapper: {
    gap: spacing.xs,
  },
  segmentBox: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  segmentText: {
    fontSize: typeScale.body,
    lineHeight: 24,
  },
});
