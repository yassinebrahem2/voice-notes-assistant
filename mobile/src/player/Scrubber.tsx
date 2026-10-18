import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { TapeTheme } from '../theme/paperTheme';
import { radius, spacing } from '../theme/tokens';

export interface ScrubberProps {
  peaks?: number[] | null;
  positionMs: number;
  durationMs: number;
  onSeek: (positionMs: number) => void;
}

const BAR_COUNT = 48;
const MAX_BAR_HEIGHT = 28;
const MIN_BAR_HEIGHT = 4;

export function Scrubber({
  peaks,
  positionMs,
  durationMs,
  onSeek,
}: ScrubberProps) {
  const { tape } = useTheme<TapeTheme>();
  const [trackWidth, setTrackWidth] = useState<number>(0);

  const progressRatio =
    durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

  const sampledPeaks = useMemo(() => {
    if (!peaks || peaks.length === 0) return null;
    if (peaks.length === BAR_COUNT) return peaks;

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

  const handleTouch = (locationX: number) => {
    const width = trackWidth > 0 ? trackWidth : 100;
    if (durationMs <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / width));
    const targetMs = Math.round(ratio * durationMs);
    onSeek(targetMs);
  };

  return (
    <View
      testID="player-scrubber"
      accessibilityRole="adjustable"
      accessibilityLabel="Audio scrubber"
      accessibilityValue={{ min: 0, max: durationMs, now: positionMs }}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => handleTouch(e.nativeEvent.locationX)}
      onResponderMove={(e) => handleTouch(e.nativeEvent.locationX)}
      style={styles.container}
    >
      {sampledPeaks ? (
        <View style={styles.barsContainer}>
          {sampledPeaks.map((peak, idx) => {
            const barRatio = (idx + 0.5) / BAR_COUNT;
            const isPlayed = barRatio <= progressRatio;
            const normalizedHeight = Math.max(
              MIN_BAR_HEIGHT,
              Math.min(MAX_BAR_HEIGHT, Math.round(peak * MAX_BAR_HEIGHT)),
            );

            return (
              <View
                key={idx}
                style={[
                  styles.bar,
                  {
                    height: normalizedHeight,
                    backgroundColor: isPlayed ? tape.signal : tape.line,
                  },
                ]}
              />
            );
          })}
        </View>
      ) : (
        <View style={[styles.track, { backgroundColor: tape.line }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(progressRatio * 100)}%`,
                backgroundColor: tape.signal,
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: MAX_BAR_HEIGHT,
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: radius.round,
  },
  track: {
    height: 4,
    borderRadius: radius.round,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.round,
  },
});
