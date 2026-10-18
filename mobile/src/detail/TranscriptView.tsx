import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useReducedMotion } from 'react-native-reanimated';

import type { Schemas } from '../api/client';
import { formatDuration } from '../library/PendingRow';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { SpeakerRenameDialog } from './SpeakerRenameDialog';
import type { Turn } from './turns';

export interface TranscriptViewProps {
  turns: Turn[];
  activeSegmentId?: string | null;
  onSelectSegment?: (segmentId: string) => void;
  speakers?: Schemas['SpeakerOut'][];
  kind?: 'meeting' | 'note';
  recordingId?: string;
  onShowSnackbar?: (message: string) => void;
  onRenameSpeaker?: (speaker: Schemas['SpeakerOut']) => void;
}

export function TranscriptView({
  turns,
  activeSegmentId,
  onSelectSegment,
  speakers = [],
  kind = 'meeting',
  recordingId,
  onShowSnackbar,
  onRenameSpeaker,
}: TranscriptViewProps) {
  const { tape } = useTheme<TapeTheme>();
  const reducedMotion = useReducedMotion();
  const [selectedSpeaker, setSelectedSpeaker] = useState<
    Schemas['SpeakerOut'] | null
  >(null);
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const turnPositions = useRef<number[]>([]);
  const segmentOffsets = useRef<Record<string, number>>({});
  const scrolledSegmentId = useRef<string | null>(null);

  const scrollToSegment = useCallback(
    (segmentId: string) => {
      const turnIdx = turns.findIndex((t) =>
        t.segments.some((s) => s.id === segmentId),
      );
      if (turnIdx === -1) return;

      const turnY = turnPositions.current[turnIdx];
      const segmentY = segmentOffsets.current[segmentId];

      if (turnY !== undefined && segmentY !== undefined) {
        const targetY = turnY + segmentY;
        scrolledSegmentId.current = segmentId;
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, targetY - 20),
          animated: !reducedMotion,
        });
      }
    },
    [turns, reducedMotion],
  );

  useEffect(() => {
    if (activeSegmentId && scrolledSegmentId.current !== activeSegmentId) {
      scrollToSegment(activeSegmentId);
    }
  }, [activeSegmentId, scrollToSegment]);

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
              <Pressable
                key={spk.id}
                accessibilityRole="button"
                accessibilityLabel={`Rename speaker ${name}`}
                onPress={() => setSelectedSpeaker(spk)}
                android_ripple={{ color: tape.line }}
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
              </Pressable>
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
            <View
              key={turnIdx}
              testID={`turn-${turnIdx}`}
              style={styles.turnCard}
              onLayout={(event) => {
                turnPositions.current[turnIdx] = event.nativeEvent.layout.y;
                if (
                  activeSegmentId &&
                  scrolledSegmentId.current !== activeSegmentId &&
                  turn.segments.some((s) => s.id === activeSegmentId)
                ) {
                  scrollToSegment(activeSegmentId);
                }
              }}
            >
              <View style={styles.turnHeader}>
                {kind === 'meeting' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rename speaker ${turn.speakerName}`}
                    onPress={() => {
                      const spk = speakers.find((s) => s.id === turn.speakerId);
                      if (spk) setSelectedSpeaker(spk);
                    }}
                    android_ripple={{ color: tape.line }}
                    style={styles.speakerNamePressable}
                  >
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
                  </Pressable>
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
                        segmentOffsets.current[segment.id] =
                          event.nativeEvent.layout.y;
                        if (
                          activeSegmentId === segment.id &&
                          scrolledSegmentId.current !== activeSegmentId
                        ) {
                          scrollToSegment(activeSegmentId);
                        }
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

      <SpeakerRenameDialog
        visible={selectedSpeaker !== null}
        speaker={selectedSpeaker}
        recordingId={recordingId}
        onDismiss={() => setSelectedSpeaker(null)}
        onShowSnackbar={onShowSnackbar}
        onSave={
          onRenameSpeaker
            ? (_id, name) => {
                if (selectedSpeaker) {
                  onRenameSpeaker({ ...selectedSpeaker, name });
                }
              }
            : undefined
        }
      />
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
  speakerNamePressable: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
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
