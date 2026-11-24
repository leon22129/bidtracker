import { BadRequestException } from '@nestjs/common';
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

  it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10',
    '2/30/2026', '0/1/2026', '1/0/2026', '2026-02-31T12:00:00Z', '2026-02-31T00:00:00-05:00',
    '2026-02-31 12:00:00', '2/30/2026 12:00:00',
    'invalid', new Date(NaN)])('rejects an impossible date instead of moving it to another day: %s', (input) => {
    expect(() => toDayStart(input)).toThrow(BadRequestException);
  });

  it('preserves leap days and buckets valid timestamps using their UTC date', () => {
    expect(toDayStart('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(toDayStart('2026-03-01T00:30:00+02:00').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(toDayStart('0099-01-01').toISOString()).toBe('0099-01-01T00:00:00.000Z');
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
