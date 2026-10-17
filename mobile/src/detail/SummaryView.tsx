import type React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { formatDuration } from '../library/PendingRow';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface SummaryViewProps {
  summary: Schemas['MeetingSummary'];
  speakers: Schemas['SpeakerOut'][];
  onSelectSegment: (segmentId: string) => void;
}

function CitationChip({
  citation,
  onPress,
}: {
  citation: Schemas['Citation'];
  onPress: (segmentId: string) => void;
}) {
  const { tape } = useTheme<TapeTheme>();
  const time = formatDuration(citation.start_ms);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Jump to ${time}`}
      onPress={() => onPress(citation.segment_id)}
      android_ripple={{ color: tape.line }}
      style={[
        styles.citationChip,
        { backgroundColor: tape.raised, borderColor: tape.line },
      ]}
    >
      <Text
        style={[
          styles.citationText,
          { color: tape.signal, fontFamily: fontFamilies.mono },
        ]}
      >
        {time}
      </Text>
    </Pressable>
  );
}

function ItemCard({
  text,
  citations,
  onSelectSegment,
  children,
}: {
  text: string;
  citations?: Schemas['Citation'][];
  onSelectSegment: (segmentId: string) => void;
  children?: React.ReactNode;
}) {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View
      style={[
        styles.itemCard,
        { backgroundColor: tape.surface, borderColor: tape.line },
      ]}
    >
      <Text
        style={[
          styles.itemText,
          { color: tape.ink, fontFamily: fontFamilies.regular },
        ]}
      >
        {text}
      </Text>
      {children}
      {citations && citations.length > 0 ? (
        <View style={styles.citationRow}>
          {citations.map((c, idx) => (
            <CitationChip key={idx} citation={c} onPress={onSelectSegment} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function SummaryView({
  summary,
  speakers,
  onSelectSegment,
}: SummaryViewProps) {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View style={styles.container}>
      {summary.overview?.trim() ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Overview
          </Text>
          <Text
            style={[
              styles.bodyText,
              { color: tape.ink, fontFamily: fontFamilies.regular },
            ]}
          >
            {summary.overview}
          </Text>
        </View>
      ) : null}

      {summary.decisions && summary.decisions.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Decisions
          </Text>
          {summary.decisions.map((item, idx) => (
            <ItemCard
              key={idx}
              text={item.text}
              citations={item.citations}
              onSelectSegment={onSelectSegment}
            />
          ))}
        </View>
      ) : null}

      {summary.action_items && summary.action_items.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Action Items
          </Text>
          {summary.action_items.map((item, idx) => {
            const owner = item.owner_speaker_id
              ? speakers.find((s) => s.id === item.owner_speaker_id)
              : null;
            const ownerName = owner
              ? owner.name?.trim() || owner.display_name.trim()
              : null;

            return (
              <ItemCard
                key={idx}
                text={item.text}
                citations={item.citations}
                onSelectSegment={onSelectSegment}
              >
                {ownerName || item.due ? (
                  <View style={styles.metaRow}>
                    {ownerName ? (
                      <Text
                        style={[
                          styles.metaText,
                          {
                            color: tape.inkMuted,
                            fontFamily: fontFamilies.regular,
                          },
                        ]}
                      >
                        Owner: {ownerName}
                      </Text>
                    ) : null}
                    {item.due ? (
                      <Text
                        style={[
                          styles.metaText,
                          {
                            color: tape.inkMuted,
                            fontFamily: fontFamilies.regular,
                          },
                        ]}
                      >
                        Due: {item.due}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </ItemCard>
            );
          })}
        </View>
      ) : null}

      {summary.open_questions && summary.open_questions.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Open Questions
          </Text>
          {summary.open_questions.map((item, idx) => (
            <ItemCard
              key={idx}
              text={item.text}
              citations={item.citations}
              onSelectSegment={onSelectSegment}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: typeScale.body, lineHeight: 24 },
  bodyText: { fontSize: typeScale.body, lineHeight: 24 },
  itemCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  itemText: { fontSize: typeScale.body, lineHeight: 22 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metaText: { fontSize: typeScale.small },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  citationChip: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  citationText: { fontSize: typeScale.small },
});
