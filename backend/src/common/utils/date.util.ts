import { BadRequestException } from '@nestjs/common';

/**
 * All dates in this system are UTC-midnight "day buckets".
 *
 * Why: `number` resets per date and payment weeks are date ranges, so "which day is this row in?" must
 * be a single unambiguous answer regardless of the browser's timezone. Storing a local-midnight
 * timestamp would put a row in the wrong day (and wrong payment week) for anyone in a different
 * offset — and would break the `(workspace_id, date, number)` unique index by creating two "Aug 25"s.
 */

/** Accepts `YYYY-MM-DD`, an ISO datetime, a Date, or an Excel serial-parsed Date. */
export function toDayStart(input: string | Date): Date {
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) throw new BadRequestException('Unrecognised date');
    return calendarDay(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
  }
  const s = String(input).trim();

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    return calendarDay(+dateOnly[1], +dateOnly[2], +dateOnly[3]);
  }

  // US-style M/D/YYYY, common in exported spreadsheets.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    return calendarDay(+us[3], +us[1], +us[2]);
  }

  // Date.parse also rolls invalid ISO calendar dates forward before applying the time-zone offset.
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)/i.exec(s);
  if (isoDay) calendarDay(+isoDay[1], +isoDay[2], +isoDay[3]);
  const usDay = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:T|\s)/i.exec(s);
  if (usDay) calendarDay(+usDay[3], +usDay[1], +usDay[2]);
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Unrecognised date: "${s}"`);
  }
  return calendarDay(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function calendarDay(year: number, month: number, day: number): Date {
  const result = new Date(0);
  // setUTCFullYear preserves years 0000-0099, unlike Date.UTC's implicit 1900 offset.
  result.setUTCFullYear(year, month - 1, day);
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
    throw new BadRequestException('Unrecognised date: day or month is outside the calendar');
  }
  return result;
}

export function todayUtc(): Date {
  return toDayStart(new Date());
}

/** Monday 00:00 UTC of the week containing `d`. ISO weeks: Monday is day 1. */
export function startOfWeekMonday(d: Date): Date {
  const day = toDayStart(d);
  const dow = day.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  return new Date(day.getTime() + delta * 86400000);
}

/** Sunday 00:00 UTC — the last day bucket of the week containing `d`. */
export function endOfWeekSunday(d: Date): Date {
  return new Date(startOfWeekMonday(d).getTime() + 6 * 86400000);
}

/**
 * The week to pay out when running on `asOf` (normally a Monday).
 * Running Monday Aug 31 pays the week Mon Aug 24 – Sun Aug 30, exactly as specified.
 */
export function previousWeekRange(asOf: Date = new Date()): { start: Date; end: Date } {
  const thisMonday = startOfWeekMonday(asOf);
  const start = new Date(thisMonday.getTime() - 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start, end };
}

/** Inclusive upper bound for a `date` (day-bucket) range filter: end-of-day. */
export function endOfDay(d: Date): Date {
  return new Date(toDayStart(d).getTime() + 86400000 - 1);
}

export function formatWeekLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} - ${fmt(end)}`;
}
