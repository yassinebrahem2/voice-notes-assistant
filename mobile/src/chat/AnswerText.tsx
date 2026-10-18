import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing, typeScale } from '../theme/tokens';
import { citationLabel, citationTime, splitAnswer } from './citations';

export function AnswerText({ message }: { message: Schemas['MessageOut'] }) {
  const { tape } = useTheme<TapeTheme>();
  // Only a model answer carries [n] markers; fixed replies are shown exactly as the server wrote them.
  if (message.reply_type !== 'answer') {
    return <Text variant="bodyMedium">{message.text}</Text>;
  }

  const parts = splitAnswer(message.text, message.citations);
  const cited = parts.flatMap((part) =>
    'citation' in part ? [part.citation] : [],
  );
  const chips = cited.filter(
    (c, i) => cited.findIndex((o) => o.n === c.n) === i,
  );

  return (
    <View style={styles.answer}>
      <Text variant="bodyMedium">
        {parts.map((part, i) =>
          'citation' in part ? (
            <Text key={i} style={styles.marker}>
              [{part.citation.n}]
            </Text>
          ) : (
            part.text
          ),
        )}
      </Text>
      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((c) => (
            <Pressable
              key={c.n}
              accessibilityRole="button"
              accessibilityLabel={`Open ${citationLabel(c)}`}
              onPress={() =>
                router.push({
                  pathname: '/recording/[id]',
                  params: { id: c.recording_id, segment: c.segment_id },
                })
              }
              android_ripple={{ color: tape.line }}
              style={[styles.chip, { borderColor: tape.line }]}
            >
              <Text variant="labelSmall">{c.n}</Text>
              <Text variant="bodySmall" numberOfLines={1} style={styles.label}>
                {c.recording_title} ·{' '}
                <Text style={styles.marker}>{citationTime(c.start_ms)}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  answer: { gap: spacing.sm },
  marker: { fontFamily: fontFamilies.mono, fontSize: typeScale.small },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.round,
    overflow: 'hidden',
  },
  label: { flexShrink: 1 },
});
