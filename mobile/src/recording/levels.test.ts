import { dbfsToLevel } from './levels';

describe('dbfsToLevel', () => {
  test.each([
    [-160, 0],
    [-50, 0],
    [-25, 0.5],
    [0, 1],
    [3, 1],
    [undefined, 0],
    [Number.NaN, 0],
  ])('maps %p dBFS to level %p', (db, expected) => {
    expect(dbfsToLevel(db)).toBeCloseTo(expected, 5);
  });

  test('clamps values below -50 dBFS to 0', () => {
    expect(dbfsToLevel(-100)).toBe(0);
    expect(dbfsToLevel(-51)).toBe(0);
  });

  test('clamps values above 0 dBFS to 1', () => {
    expect(dbfsToLevel(1)).toBe(1);
    expect(dbfsToLevel(10)).toBe(1);
  });

  test('interpolates linearly between -50 and 0 dBFS', () => {
    expect(dbfsToLevel(-50)).toBe(0);
    expect(dbfsToLevel(-40)).toBeCloseTo(0.2, 5);
    expect(dbfsToLevel(-25)).toBeCloseTo(0.5, 5);
    expect(dbfsToLevel(-10)).toBeCloseTo(0.8, 5);
    expect(dbfsToLevel(0)).toBe(1);
  });
});
