import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export function LibrarySkeleton() {
  const { tape } = useTheme<TapeTheme>();

  return (
    <View style={styles.container}>
      {[1, 2, 3].map((key) => (
        <View
          key={key}
          style={[
            styles.card,
            { backgroundColor: tape.surface, borderColor: tape.line },
          ]}
        >
          <View style={[styles.lineLong, { backgroundColor: tape.raised }]} />
          <View style={[styles.lineShort, { backgroundColor: tape.raised }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  card: {
    minHeight: 80,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  lineLong: {
    height: 16,
    borderRadius: 4,
    width: '75%',
  },
  lineShort: {
    height: 12,
    borderRadius: 4,
    width: '40%',
  },
});
