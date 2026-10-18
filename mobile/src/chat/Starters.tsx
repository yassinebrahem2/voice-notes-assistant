import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

// From HELP in backend/app/agents/citations.py (agents plan)
export const STARTERS = [
  'What was decided in our last sync?',
  'What are my open action items?',
  'Summarize my notes on architecture.',
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
