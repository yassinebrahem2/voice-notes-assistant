import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export const STARTERS = [
  'What did I decide this week?',
  'What action items are still open?',
  'Summarize my latest meeting.',
  'What did I note about ideas?',
] as const;

export function Starters({ onPick }: { onPick: (question: string) => void }) {
  const { tape } = useTheme<TapeTheme>();
  return (
    <View style={styles.list}>
      {STARTERS.map((question) => (
        <Pressable
          key={question}
          testID="starter"
          accessibilityRole="button"
          accessibilityLabel={question}
          onPress={() => onPick(question)}
          android_ripple={{ color: tape.line }}
          style={[styles.card, { borderColor: tape.line }]}
        >
          <Text variant="bodyMedium">{question}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
});
