import type { Schemas } from '../api/client';

export function activeSegmentIndex(
  segments: Schemas['SegmentOut'][],
  positionMs: number,
): number {
  if (segments.length === 0) return -1;
  if (positionMs < segments[0].start_ms) return -1;
  if (positionMs >= segments[segments.length - 1].end_ms) return -1;

  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const seg = segments[mid];

    if (positionMs >= seg.start_ms && positionMs < seg.end_ms) {
      return mid;
    } else if (positionMs < seg.start_ms) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return -1;
}
