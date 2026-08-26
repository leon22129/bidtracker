import {
  endOfWeekSunday,
  formatWeekLabel,
  previousWeekRange,
  startOfWeekMonday,
  toDayStart,
} from './date.util';

describe('date.util', () => {
  it('buckets a date-only string to UTC midnight', () => {
    expect(toDayStart('2026-08-25').toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('parses US spreadsheet dates', () => {
    expect(toDayStart('8/25/2026').toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('finds Monday for any day of the week', () => {
    // 2026-08-24 is a Monday; 2026-08-30 is the Sunday of that week.
    for (const d of ['2026-08-24', '2026-08-27', '2026-08-30']) {
      expect(startOfWeekMonday(toDayStart(d)).toISOString()).toBe('2026-08-24T00:00:00.000Z');
    }
    expect(endOfWeekSunday(toDayStart('2026-08-24')).toISOString()).toBe('2026-08-30T00:00:00.000Z');
  });

  it('pays the previous Mon-Sun week when run on a Monday (the spec example)', () => {
    const { start, end } = previousWeekRange(toDayStart('2026-08-31'));
    expect(start.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(formatWeekLabel(start, end)).toBe('Aug 24 - Aug 30');
  });
});
