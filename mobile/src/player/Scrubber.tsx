import { useMemo, useRef, useState } from 'react';
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
  const trackWidthRef = useRef<number>(0);
  const [dragPositionMs, setDragPositionMs] = useState<number | null>(null);

  const currentPositionMs = dragPositionMs ?? positionMs;
  const progressRatio =
    durationMs > 0
      ? Math.min(1, Math.max(0, currentPositionMs / durationMs))
      : 0;

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

  const calculateTargetMs = (locationX: number) => {
    const width = trackWidthRef.current || trackWidth || 100;
    if (durationMs <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, locationX / width));
    return Math.round(ratio * durationMs);
  };

  const handleGrant = (locationX: number) => {
    const targetMs = calculateTargetMs(locationX);
    setDragPositionMs(targetMs);
  };

  const handleMove = (locationX: number) => {
    const targetMs = calculateTargetMs(locationX);
    setDragPositionMs(targetMs);
  };

  const handleRelease = (locationX: number) => {
    const targetMs = calculateTargetMs(locationX);
    setDragPositionMs(null);
    onSeek(targetMs);
  };

  const handleTerminate = () => {
    setDragPositionMs(null);
  };

  return (
    <View
      testID="player-scrubber"
      accessibilityRole="adjustable"
      accessibilityLabel="Audio scrubber"
      accessibilityValue={{ min: 0, max: durationMs, now: currentPositionMs }}
      accessibilityActions={[
        { name: 'increment', label: 'Fast-forward 5 seconds' },
        { name: 'decrement', label: 'Rewind 5 seconds' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') {
          onSeek(Math.min(durationMs, positionMs + 5000));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onSeek(Math.max(0, positionMs - 5000));
        }
      }}
      onLayout={(e) => {
        trackWidthRef.current = e.nativeEvent.layout.width;
        setTrackWidth(e.nativeEvent.layout.width);
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => handleGrant(e.nativeEvent.locationX)}
      onResponderMove={(e) => handleMove(e.nativeEvent.locationX)}
      onResponderRelease={(e) => handleRelease(e.nativeEvent.locationX)}
      onResponderTerminate={handleTerminate}
      style={styles.container}
    >
      {sampledPeaks ? (
        <View pointerEvents="none" style={styles.barsContainer}>
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
        <View
          pointerEvents="none"
          style={[styles.track, { backgroundColor: tape.line }]}
        >
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
