import type { Schemas } from '../api/client';
import { activeSegmentIndex } from './activeSegment';

describe('activeSegmentIndex', () => {
  const segments: Schemas['SegmentOut'][] = [
    {
      id: 'seg_1',
      idx: 0,
      start_ms: 1000,
      end_ms: 2000,
      text: 'First segment',
      speaker_id: 'spk_1',
    },
    {
      id: 'seg_2',
      idx: 1,
      start_ms: 3000,
      end_ms: 4500,
      text: 'Second segment after a gap',
      speaker_id: 'spk_2',
    },
    {
      id: 'seg_3',
      idx: 2,
      start_ms: 4500,
      end_ms: 6000,
      text: 'Third segment adjacent to second',
      speaker_id: 'spk_1',
    },
  ];

  test('returns -1 for empty segments array', () => {
    expect(activeSegmentIndex([], 1000)).toBe(-1);
    expect(activeSegmentIndex([], 0)).toBe(-1);
  });

  test('returns -1 before the first segment starts', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(-1);
    expect(activeSegmentIndex(segments, 999)).toBe(-1);
  });

  test('returns index 0 at start and middle of first segment', () => {
    expect(activeSegmentIndex(segments, 1000)).toBe(0);
    expect(activeSegmentIndex(segments, 1500)).toBe(0);
    expect(activeSegmentIndex(segments, 1999)).toBe(0);
  });

  test('returns -1 in gap between segments', () => {
    // End of first segment is 2000, second starts at 3000
    expect(activeSegmentIndex(segments, 2000)).toBe(-1);
    expect(activeSegmentIndex(segments, 2500)).toBe(-1);
    expect(activeSegmentIndex(segments, 2999)).toBe(-1);
  });

  test('returns index 1 for second segment', () => {
    expect(activeSegmentIndex(segments, 3000)).toBe(1);
    expect(activeSegmentIndex(segments, 3750)).toBe(1);
    expect(activeSegmentIndex(segments, 4499)).toBe(1);
  });

  test('returns index 2 for third segment which starts immediately at 4500', () => {
    expect(activeSegmentIndex(segments, 4500)).toBe(2);
    expect(activeSegmentIndex(segments, 5500)).toBe(2);
    expect(activeSegmentIndex(segments, 5999)).toBe(2);
  });

  test('returns -1 at or after the end of the last segment', () => {
    expect(activeSegmentIndex(segments, 6000)).toBe(-1);
    expect(activeSegmentIndex(segments, 7000)).toBe(-1);
  });
});
