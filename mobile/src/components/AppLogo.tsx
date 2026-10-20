import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import { appInfo } from '../config/appInfo';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';

// Brand colours from the app icon (mobile/assets/icon.png); fixed so the mark looks the same in
// both themes.
const BRAND_ORANGE = '#F75F30';
const BRAND_GREY = '#7F786F';

// Bar heights relative to the tallest bar, matching the icon artwork.
const BARS = [44, 76, 130, 188, 130, 88, 44].map((h) => h / 188);

const SIZES = {
  small: { markHeight: 22, fontSize: 20 },
  large: { markHeight: 44, fontSize: 32 },
} as const;

export interface AppLogoProps {
  size: keyof typeof SIZES;
}

export function AppLogo({ size }: AppLogoProps) {
  const { tape } = useTheme<TapeTheme>();
  const { markHeight, fontSize } = SIZES[size];
  const barWidth = markHeight * 0.066;
  const gap = markHeight * 0.085;

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={appInfo.name}
      style={[styles.row, { gap: markHeight * 0.4 }]}
    >
      <View style={[styles.mark, { height: markHeight, gap }]}>
        {BARS.map((ratio, index) => (
          <View
            key={index}
            testID="app-logo-bar"
            style={{
              width: barWidth,
              height: markHeight * ratio,
              borderRadius: barWidth / 2,
              backgroundColor: index <= 3 ? BRAND_ORANGE : BRAND_GREY,
            }}
          />
        ))}
      </View>
      <Text
        style={{
          color: tape.ink,
          fontFamily: fontFamilies.semibold,
          fontSize,
          lineHeight: fontSize * 1.2,
        }}
      >
        {appInfo.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  mark: { flexDirection: 'row', alignItems: 'center' },
});
