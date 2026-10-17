import { StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { TapeTheme } from '../theme/paperTheme';
import { spacing } from '../theme/tokens';

export function PlaceholderScreen({ title }: { title: string }) {
  const theme = useTheme<TapeTheme>();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: theme.tape.bg }]}
    >
      <Text accessibilityRole="header" variant="headlineLarge">
        {title}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
});
