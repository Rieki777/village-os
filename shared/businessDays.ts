/**
 * BUSINESS DAYS, ON THE VILLAGE'S OWN CLOCK.
 *
 * "Answered within 2 business days" is a promise a role makes, and the card
 * counts it. A business day is Monday to Friday, read as the civil day in the
 * village's time zone, so an application filed at 23:30 on a Friday in Costa
 * Rica is a Friday application there, whatever UTC says.
 *
 * NO HOLIDAYS, ON PURPOSE. There is no stored holiday calendar for any
 * village, and a list typed here would be one country's calendar applied to
 * every fork. A village that stops for a festival week will see a promise
 * read as missed that week; that is a true reading of the days, and the fix,
 * when it comes, is a village-owned calendar passed in, never a list in code.
 *
 * Pure. The zone arithmetic is `shared/lunar.ts`'s, so a daylight change is
 * handled where the rest of the platform handles it.
 */
import { civilParts, zonedTimeToUtc } from "./lunar";

const DAY_MS = 86_400_000;

/** 0 is Sunday, 6 is Saturday, as `civilParts` reports them. */
export function isBusinessWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/** True when the instant falls on a Monday to Friday in the zone. */
export function isBusinessDay(at: Date, timeZone: string): boolean {
  return isBusinessWeekday(civilParts(at, timeZone).weekday);
}

/**
 * The instant `n` business days after `from`, at the same wall-clock time in
 * the zone. A start on a Saturday or Sunday counts from Monday 00:00, so
 * "2 business days" from a weekend ends at the start of Wednesday: all of
 * Monday and all of Tuesday.
 */
export function addBusinessDays(from: Date, n: number, timeZone: string): Date {
  const whole = Math.max(0, Math.floor(n));
  const p = civilParts(from, timeZone);
  let y = p.year;
  let m = p.month;
  let d = p.day;
  let hour = p.hour;
  let minute = p.minute;
  // Seconds and milliseconds below the minute ride along unchanged.
  let rest = from.getTime() - zonedTimeToUtc(y, m, d, hour, minute, timeZone).getTime();
  if (rest < 0 || rest >= 60_000) rest = 0;

  const step = () => {
    const next = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
    return next.getUTCDay();
  };

  let weekday = p.weekday;
  if (!isBusinessWeekday(weekday)) {
    while (!isBusinessWeekday(weekday)) weekday = step();
    hour = 0;
    minute = 0;
    rest = 0;
  }
  let left = whole;
  while (left > 0) {
    weekday = step();
    if (isBusinessWeekday(weekday)) left -= 1;
  }
  return new Date(zonedTimeToUtc(y, m, d, hour, minute, timeZone).getTime() + rest);
}

/** True when `end` is no later than `n` business days after `start`. */
export function isWithinBusinessDays(start: Date, end: Date, n: number, timeZone: string): boolean {
  if (end.getTime() < start.getTime()) return false;
  return end.getTime() <= addBusinessDays(start, n, timeZone).getTime();
}
