import { paperTheme } from './paperTheme';

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe.each(['dark', 'light'] as const)('%s Paper theme', (scheme) => {
  test('uses a loaded IBM family for every variant including unqualified Text', () => {
    const theme = paperTheme(scheme);
    for (const font of Object.values(theme.fonts)) {
      expect(font.fontFamily).toMatch(/^IBMPlex(Sans|Mono)_/);
    }
    expect(
      new Set(
        Object.values(theme.fonts)
          .filter((font) => 'fontSize' in font)
          .map((font) => ('fontSize' in font ? font.fontSize : 0)),
      ).size,
    ).toBeLessThanOrEqual(4);
  });

  test('keeps snackbar action text readable on its inverse surface', () => {
    const { colors } = paperTheme(scheme);
    const first = luminance(colors.inversePrimary);
    const second = luminance(colors.inverseSurface);
    expect(
      (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
