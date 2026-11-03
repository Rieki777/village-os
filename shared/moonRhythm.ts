/**
 * THE MOON RHYTHM: the dates the end-of-moon review keeps (spec section 17,
 * B1, as section 18 settles it). Pure; reads the one lunar clock
 * (`shared/lunar.ts`) and the village time zone.
 *
 *   End-of-moon Friday  the last Friday whose civil date is before the civil
 *                       date of the cycle's closing new moon. The prepare-by day.
 *   Circle Monday       the first Monday after that Friday. The send-by day.
 *   Halfway day         the civil date of the cycle's full moon.
 *
 * Any one cycle's Friday or Monday can be moved by the village (a holiday,
 * an all-staff on another day) in the `moon_rhythm` document in `app_config`,
 * which also holds the hour reminders go out. It ships empty, and its editor
 * sits with the other moon-review settings (decision 22).
 *
 * Expected in a UTC-6 village: the moon of 10 October to 9 November 2026 gives
 * Friday 6 November and Monday 9 November; the November moon gives Friday 4
 * December and Monday 7 December; the December moon gives Friday 1 January
 * 2027, which a village is expected to override.
 */
import type { CycleBounds } from "./cycleClock";
import { civilDateKey, fullMoonsBetween } from "./lunar";

/** The `app_config` key of the rhythm overrides. */
export const RHYTHM_DOC_KEY = "moon_rhythm";

/** The hour, in village time, reminders go out when the village sets none. */
export const DEFAULT_SEND_HOUR = 9;

export interface RhythmDoc {
  /** 0 to 23, village time. */
  sendHour: number;
  /** Per cycle id: a moved Friday or Monday, YYYY-MM-DD. */
  cycles: Record<string, { friday?: string; monday?: string }>;
}

export const EMPTY_RHYTHM: RhythmDoc = { sendHour: DEFAULT_SEND_HOUR, cycles: {} };

export type RhythmBounds = Pick<CycleBounds, "id" | "clock" | "startsAt" | "endsAt">;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The zone a cycle's dates are read in: the calendar clock's boundaries are UTC instants. */
function zoneFor(bounds: RhythmBounds, timeZone: string): string {
  return bounds.clock === "calendar" ? "UTC" : timeZone || "UTC";
}

/** The civil date of the closing new moon (the cycle's end). */
export function closingNewMoonDay(bounds: RhythmBounds, timeZone: string): string {
  return civilDateKey(bounds.endsAt, zoneFor(bounds, timeZone));
}

/** The last Friday before the closing new moon's civil date, unless the village moved it. */
export function endOfMoonFriday(bounds: RhythmBounds, timeZone: string, rhythm: RhythmDoc = EMPTY_RHYTHM): string {
  const moved = rhythm.cycles[bounds.id]?.friday;
  if (moved) return moved;
  const before = addDays(closingNewMoonDay(bounds, timeZone), -1);
  return addDays(before, -((weekdayOf(before) - 5 + 7) % 7));
}

/** The first Monday after the end-of-moon Friday, unless the village moved it. The send-by day. */
export function circleMonday(bounds: RhythmBounds, timeZone: string, rhythm: RhythmDoc = EMPTY_RHYTHM): string {
  const moved = rhythm.cycles[bounds.id]?.monday;
  if (moved) return moved;
  const friday = endOfMoonFriday(bounds, timeZone, rhythm);
  const next = addDays(friday, 1);
  return addDays(next, (1 - weekdayOf(next) + 7) % 7);
}

/** The civil date of the cycle's full moon, or null when the lunar table has none in it. */
export function halfwayDay(bounds: RhythmBounds, timeZone: string): string | null {
  const full = fullMoonsBetween(bounds.startsAt, bounds.endsAt)[0];
  return full ? civilDateKey(full, timeZone || "UTC") : null;
}

/** The Wednesday before the end-of-moon Friday: the `eom_prep` reminder's day. */
export function prepReminderDay(bounds: RhythmBounds, timeZone: string, rhythm: RhythmDoc = EMPTY_RHYTHM): string {
  return addDays(endOfMoonFriday(bounds, timeZone, rhythm), -2);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

/** Read the rhythm document, from storage or from its editor. */
export function parseRhythm(raw: unknown): Parsed<RhythmDoc> {
  if (raw === undefined || raw === null) return { ok: true, value: EMPTY_RHYTHM };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "rhythm", error: "The moon rhythm is a set of fields." };
  const r = raw as Record<string, unknown>;
  const hour = r.sendHour === undefined || r.sendHour === null ? DEFAULT_SEND_HOUR : Number(r.sendHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, field: "sendHour", error: "The send hour runs from 0 to 23." };
  const cycles: RhythmDoc["cycles"] = {};
  const given = r.cycles && typeof r.cycles === "object" && !Array.isArray(r.cycles) ? (r.cycles as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(given)) {
    if (!/^[a-z]+-[0-9-]{1,12}$/.test(id) || !v || typeof v !== "object") return { ok: false, field: "cycles", error: "Each moved moon names its cycle id." };
    const o = v as Record<string, unknown>;
    const out: { friday?: string; monday?: string } = {};
    for (const k of ["friday", "monday"] as const) {
      if (o[k] === undefined || o[k] === null || o[k] === "") continue;
      if (typeof o[k] !== "string" || !DATE_RE.test(o[k] as string)) return { ok: false, field: k, error: "A moved day is written YYYY-MM-DD." };
      out[k] = o[k] as string;
    }
    if (out.friday && out.monday && out.monday <= out.friday) return { ok: false, field: "monday", error: "The circle day comes after the end-of-moon Friday." };
    if (out.friday || out.monday) cycles[id] = out;
  }
  return { ok: true, value: { sendHour: hour, cycles } };
}
