import {
  configureFonts,
  MD3DarkTheme,
  MD3LightTheme,
  type MD3Theme,
} from 'react-native-paper';

import { fontConfig } from './fonts';
import { radius, tokens, type ThemeColors } from './tokens';

export type TapeTheme = MD3Theme & { tape: ThemeColors };

export function paperTheme(scheme: 'light' | 'dark'): TapeTheme {
  const base = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const colors = tokens[scheme];
  return {
    ...base,
    roundness: radius.card,
    tape: colors,
    fonts: configureFonts({ config: fontConfig }),
    colors: {
      ...base.colors,
      primary: colors.signal,
      onPrimary: colors.onSignal,
      primaryContainer: colors.raised,
      onPrimaryContainer: colors.ink,
      secondary: colors.inkMuted,
      onSecondary: colors.bg,
      secondaryContainer: colors.raised,
      onSecondaryContainer: colors.ink,
      tertiary: colors.inkMuted,
      onTertiary: colors.bg,
      tertiaryContainer: colors.raised,
      onTertiaryContainer: colors.ink,
      background: colors.bg,
      onBackground: colors.ink,
      surface: colors.surface,
      onSurface: colors.ink,
      surfaceVariant: colors.raised,
      onSurfaceVariant: colors.inkMuted,
      surfaceDisabled: colors.raised,
      onSurfaceDisabled: colors.inkMuted,
      outline: colors.outline,
      outlineVariant: colors.line,
      error: colors.signal,
      onError: colors.onSignal,
      errorContainer: colors.raised,
      onErrorContainer: colors.ink,
      inverseSurface: colors.ink,
      inverseOnSurface: colors.bg,
      inversePrimary: tokens[scheme === 'dark' ? 'light' : 'dark'].signal,
      elevation: {
        level0: colors.bg,
        level1: colors.surface,
        level2: colors.raised,
        level3: colors.raised,
        level4: colors.raised,
        level5: colors.raised,
      },
    },
  };
}
