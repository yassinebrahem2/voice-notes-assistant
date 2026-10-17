import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { formatDuration } from '../library/PendingRow';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';

export interface NoteViewProps {
  note: Schemas['NoteContent'];
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
        {
          backgroundColor: tape.raised,
          borderColor: tape.line,
        },
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

export function NoteView({ note, onSelectSegment }: NoteViewProps) {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View style={styles.container}>
      {note.key_points && note.key_points.length > 0 ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Key Points
          </Text>
          {note.key_points.map((item, idx) => (
            <View
              key={idx}
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
                {item.text}
              </Text>
              {item.citations && item.citations.length > 0 ? (
                <View style={styles.citationRow}>
                  {item.citations.map((c, cIdx) => (
                    <CitationChip
                      key={cIdx}
                      citation={c}
                      onPress={onSelectSegment}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {note.clean_text?.trim() ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tape.ink, fontFamily: fontFamilies.semibold },
            ]}
          >
            Clean Note
          </Text>
          <View
            style={[
              styles.cleanTextCard,
              { backgroundColor: tape.surface, borderColor: tape.line },
            ]}
          >
            <Text
              style={[
                styles.cleanText,
                { color: tape.ink, fontFamily: fontFamilies.regular },
              ]}
            >
              {note.clean_text}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typeScale.body,
    lineHeight: 24,
  },
  itemCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  itemText: {
    fontSize: typeScale.body,
    lineHeight: 22,
  },
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
  citationText: {
    fontSize: typeScale.small,
  },
  cleanTextCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
  },
  cleanText: {
    fontSize: typeScale.body,
    lineHeight: 24,
  },
});
