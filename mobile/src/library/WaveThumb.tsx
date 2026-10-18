import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius } from '../theme/tokens';

export interface WaveThumbProps {
  peaks: number[];
}

const BAR_COUNT = 24;
const MAX_BAR_HEIGHT = 20;
const MIN_BAR_HEIGHT = 3;

export function WaveThumb({ peaks }: WaveThumbProps) {
  const { tape } = useTheme<TapeTheme>();

  const sampledBars = useMemo(() => {
    if (!peaks || peaks.length === 0) return [];
    if (peaks.length <= BAR_COUNT) return peaks;

    const result: number[] = [];
    const step = peaks.length / BAR_COUNT;
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = Math.floor(i * step);
      const end = Math.floor((i + 1) * step);
      let maxVal = 0;
      for (let j = start; j < end && j < peaks.length; j++) {
        const val = peaks[j] ?? 0;
        if (val > maxVal) maxVal = val;
      }
      result.push(maxVal);
    }
    return result;
  }, [peaks]);

  if (!peaks || peaks.length === 0 || sampledBars.length === 0) {
    return null;
  }

  return (
    <View
      testID="wave-thumb"
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel="Waveform thumbnail"
      style={styles.container}
    >
      {sampledBars.map((peak, idx) => {
        const height = Math.max(
          MIN_BAR_HEIGHT,
          Math.min(MAX_BAR_HEIGHT, Math.round(peak * MAX_BAR_HEIGHT)),
        );
        return (
          <View
            key={idx}
            testID="wave-thumb-bar"
            style={[
              styles.bar,
              {
                height,
                backgroundColor: tape.inkMuted,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 64,
    height: MAX_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 1,
  },
  bar: {
    flex: 1,
    borderRadius: radius.round,
  },
});
