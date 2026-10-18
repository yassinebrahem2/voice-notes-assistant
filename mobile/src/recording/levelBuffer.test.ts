import { pushLevel } from './levelBuffer';

describe('pushLevel', () => {
  test('maintains buffer size with default size 48', () => {
    const initial = new Array(48).fill(0);
    const result = pushLevel(initial, 0.5);
    expect(result).toHaveLength(48);
  });

  test('maintains custom buffer size', () => {
    const initial = [0.1, 0.2, 0.3];
    const result = pushLevel(initial, 0.4, 3);
    expect(result).toHaveLength(3);
  });

  test('appends newest sample at the end and drops the oldest', () => {
    const initial = [0.1, 0.2, 0.3];
    const result = pushLevel(initial, 0.4, 3);
    expect(result).toEqual([0.2, 0.3, 0.4]);
  });

  test('pads with zeros when buffer is shorter than size', () => {
    const emptyResult = pushLevel([], 0.5, 4);
    expect(emptyResult).toEqual([0, 0, 0, 0.5]);

    const partialResult = pushLevel([0.2, 0.3], 0.7, 4);
    expect(partialResult).toEqual([0, 0.2, 0.3, 0.7]);
  });

  test('slices from end when buffer is longer than size', () => {
    const largeBuffer = [0.1, 0.2, 0.3, 0.4, 0.5];
    const result = pushLevel(largeBuffer, 0.9, 3);
    expect(result).toEqual([0.4, 0.5, 0.9]);
  });

  test('clamps level to 0..1', () => {
    expect(pushLevel([], -0.5, 2)).toEqual([0, 0]);
    expect(pushLevel([], 1.5, 2)).toEqual([0, 1]);
    expect(pushLevel([], 0, 2)).toEqual([0, 0]);
    expect(pushLevel([], 1, 2)).toEqual([0, 1]);
    expect(pushLevel([], 0.65, 2)).toEqual([0, 0.65]);
    expect(pushLevel([], Number.NaN, 2)).toEqual([0, 0]);
    expect(pushLevel([], undefined as unknown as number, 2)).toEqual([0, 0]);
    expect(pushLevel([], null as unknown as number, 2)).toEqual([0, 0]);
    expect(pushLevel([], Number.POSITIVE_INFINITY, 2)).toEqual([0, 1]);
    expect(pushLevel([], Number.NEGATIVE_INFINITY, 2)).toEqual([0, 0]);
  });

  test('returns empty array when size <= 0', () => {
    expect(pushLevel([0.1, 0.2], 0.5, 0)).toEqual([]);
    expect(pushLevel([0.1, 0.2], 0.5, -4)).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const input = [0.1, 0.2, 0.3];
    const copy = [...input];
    pushLevel(input, 0.4, 3);
    expect(input).toEqual(copy);
  });
});
