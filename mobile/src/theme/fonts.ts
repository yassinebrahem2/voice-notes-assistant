import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';

import { typeScale } from './tokens';

export const fontAssets = {
  IBMPlexSans_400Regular,
  IBMPlexSans_600SemiBold,
  IBMPlexMono_500Medium,
};
export const fontFamilies = {
  regular: 'IBMPlexSans_400Regular',
  semibold: 'IBMPlexSans_600SemiBold',
  mono: 'IBMPlexMono_500Medium',
} as const;

function font(fontFamily: string, fontSize: number) {
  // Each weight has its own loaded family on Android.
  return {
    fontFamily,
    fontSize,
    fontWeight: '400' as const,
    lineHeight: fontSize * 1.5,
    letterSpacing: 0,
  };
}

export const fontConfig = {
  default: font(fontFamilies.regular, typeScale.body),
  displayLarge: font(fontFamilies.semibold, typeScale.display),
  displayMedium: font(fontFamilies.semibold, typeScale.display),
  displaySmall: font(fontFamilies.semibold, typeScale.display),
  headlineLarge: font(fontFamilies.semibold, typeScale.title),
  headlineMedium: font(fontFamilies.semibold, typeScale.title),
  headlineSmall: font(fontFamilies.semibold, typeScale.title),
  titleLarge: font(fontFamilies.semibold, typeScale.title),
  titleMedium: font(fontFamilies.semibold, typeScale.body),
  titleSmall: font(fontFamilies.semibold, typeScale.body),
  labelLarge: font(fontFamilies.semibold, typeScale.body),
  labelMedium: font(fontFamilies.semibold, typeScale.small),
  labelSmall: font(fontFamilies.mono, typeScale.small),
  bodyLarge: font(fontFamilies.regular, typeScale.body),
  bodyMedium: font(fontFamilies.regular, typeScale.body),
  bodySmall: font(fontFamilies.regular, typeScale.small),
};
