/**
 * THE SEND WINDOW for a daytime journey step, in a given IANA zone (the comms
 * build spec 5.6 and 5.18).
 *
 * A path, welcome or joining email waits for the reader's morning: a step
 * whose moment falls before `comms.quiet_start_hour` goes at that hour the same
 * day, and one at or after `comms.quiet_end_hour` goes at the start hour the
 * next day. The dials are named for the quiet that surrounds the window, so
 * "the quiet start" is the hour sending may begin (8 by default) and "the quiet
 * end" is the hour it stops (20).
 *
 * THE ZONE. The reader's own when we know it and the runtime knows it too,
 * else the village's, else UTC, which is what the database stores. A zone a
 * person typed that the runtime cannot read is treated as unknown rather than
 * trusted, so a typo never moves an email to three in the morning.
 *
 * A WINDOW THAT IS NOT ONE IS NO WINDOW. Start must come before end. A start
 * at or after the end (the dials allow it while somebody is midway through
 * changing both) holds nothing, and the step goes at its own moment: an email
 * that arrives at an odd hour is the smaller mistake than one held forever.
 *
 * Pure and isomorphic. The server's planner uses it; nothing here reads a
 * clock or a dial.
 */
import { civilParts, zonedTimeToUtc } from "../lunar";

/** The zone itself when the runtime can read it, or null. */
export function knownZone(zone: string | null | undefined): string | null {
  const z = typeof zone === "string" ? zone.trim() : "";
  if (!z || z.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z }).format(0);
    return z;
  } catch {
    return null;
  }
}

/** The zone a daytime step is held in: the reader's, else the village's, else UTC. */
export function windowZone(readerZone: string | null | undefined, villageZone: string | null | undefined): string {
  return knownZone(readerZone) ?? knownZone(villageZone) ?? "UTC";
}

/** An hour dial as a whole hour, inside its range. */
function hourOf(raw: number, lo: number, hi: number, fallback: number): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The earliest moment at or after `at` that falls inside the window
 * [startHour, endHour) in `zone`. `at` itself when it is already inside, or
 * when the window is not one.
 */
export function nextInWindow(at: Date, zone: string, startHour: number, endHour: number): Date {
  const start = hourOf(startHour, 0, 23, 8);
  const end = hourOf(endHour, 1, 24, 20);
  if (!(start < end) || !Number.isFinite(at.getTime())) return at;
  const tz = knownZone(zone) ?? "UTC";
  const p = civilParts(at, tz);
  const minuteOfDay = p.hour * 60 + p.minute;
  if (minuteOfDay >= start * 60 && minuteOfDay < end * 60) return at;
  let target: Date;
  if (minuteOfDay < start * 60) {
    target = zonedTimeToUtc(p.year, p.month, p.day, start, 0, tz);
  } else {
    // The next civil day, walked on the calendar and never by adding 24 hours,
    // which a daylight change would put an hour off.
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    target = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), start, 0, tz);
  }
  // A start hour that a daylight change skipped can resolve a moment early;
  // a window never sends anything before its own step.
  return target.getTime() >= at.getTime() ? target : at;
}
