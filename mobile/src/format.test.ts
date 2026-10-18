import { formatDate, formatDuration } from './format';

describe('formatDuration', () => {
  test('returns dash for null or undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  test('returns 00:00 for negative values or 0', () => {
    expect(formatDuration(-1000)).toBe('00:00');
    expect(formatDuration(0)).toBe('00:00');
  });

  test('formats seconds and minutes as MM:SS under an hour', () => {
    expect(formatDuration(5000)).toBe('00:05');
    expect(formatDuration(65000)).toBe('01:05');
    expect(formatDuration(599000)).toBe('09:59');
    expect(formatDuration(3599000)).toBe('59:59');
  });

  test('formats duration as H:MM:SS past an hour', () => {
    expect(formatDuration(3600000)).toBe('1:00:00');
    expect(formatDuration(3723000)).toBe('1:02:03');
    expect(formatDuration(36723000)).toBe('10:12:03');
  });
});

describe('formatDate', () => {
  test('returns empty string for invalid date', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDate(null as unknown as string)).toBe('');
    expect(formatDate(undefined as unknown as string)).toBe('');
  });

  test('formats valid ISO date string with date and time', () => {
    const formatted = formatDate('2026-10-18T12:30:00Z');
    expect(formatted.length).toBeGreaterThan(0);
    // Should contain month or numeric date and time components
    expect(formatted).toMatch(/\d/);
  });
});
