/**
 * Maintains a fixed-size buffer of audio metering levels for live visualization.
 * Designed to be worklet-safe so it can run on the UI thread inside Reanimated.
 */
export function pushLevel(
  buffer: number[],
  level: number,
  size = 48,
): number[] {
  'worklet';
  if (size <= 0) {
    return [];
  }

  const clamped =
    Number.isNaN(level) || level == null || level <= 0
      ? 0
      : level >= 1
        ? 1
        : level;

  const result: number[] = new Array(size);
  const needed = size - 1;
  const bufLen = buffer ? buffer.length : 0;
  const startOffset = needed - bufLen;

  for (let i = 0; i < needed; i++) {
    if (i < startOffset) {
      result[i] = 0;
    } else {
      const bufIdx = bufLen - (needed - i);
      result[i] = buffer[bufIdx] ?? 0;
    }
  }

  result[size - 1] = clamped;
  return result;
}
