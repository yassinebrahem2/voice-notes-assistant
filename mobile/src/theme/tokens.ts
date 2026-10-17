export interface ThemeColors {
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  inkMuted: string;
  line: string;
  outline: string;
  signal: string;
  onSignal: string;
  speaker: readonly [string, string, string, string, string, string];
}

export const tokens: Record<'light' | 'dark', ThemeColors> = {
  dark: {
    bg: '#121110',
    surface: '#1C1A18',
    raised: '#26231F',
    ink: '#F2EDE4',
    inkMuted: '#A39B90',
    line: '#34302B',
    outline: '#6E665C',
    signal: '#FF4D2E',
    onSignal: '#121110',
    speaker: ['#D98A6C', '#8FB394', '#8EA4C8', '#D4B05E', '#C495C0', '#6FB8B0'],
  },
  light: {
    bg: '#F6F3EE',
    surface: '#FFFFFF',
    raised: '#EDE8E0',
    ink: '#161412',
    inkMuted: '#6B645B',
    line: '#E3DDD3',
    outline: '#8C8378',
    signal: '#C4351A',
    onSignal: '#FFFFFF',
    speaker: ['#A4532F', '#48724F', '#4A6694', '#8A6A12', '#87507F', '#2F7A72'],
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
export const radius = { card: 10, round: 999 } as const;
export const typeScale = {
  small: 12,
  body: 16,
  title: 24,
  display: 32,
} as const;
