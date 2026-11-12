/**
 * The map's lights (Phase D, D2): which circles meet today, and how many
 * fireflies gather at each hearth. The rules are shared/mapLight.ts; this
 * applies them to the village's own day.
 *
 * ── WHAT MAKES A LIGHT ───────────────────────────────────────────────────
 *
 * A member who joined a circle's live session today, whose own setting is on
 * (`readMapLight`, strictly `true`), and who is a present member
 * (`isPresent`: not an example, not a tombstone, a working credential). Each
 * person counts once per circle. The count then goes through `lightsShown`,
 * so one person alone shows nothing and a crowd shows at most the cap.
 *
 * ── WHAT NEVER LEAVES ────────────────────────────────────────────────────
 *
 * Ids, names, join times and which session. The answer is a number per
 * circle id, and a circle's id is the village's, never a person's.
 *
 * ── MEETS TODAY ──────────────────────────────────────────────────────────
 *
 * The circle's rhythm names today, or a session of it opened today. Not the
 * circle's own imported calendar: reading that is a network fetch per
 * circle, and the hearth's glow is not worth one. "Coming up" still reads it.
 */
import type { Pool } from "mysql2/promise";
import { lightsShown, readMapLight, type HearthToday } from "../../shared/mapLight";
import { addDays, meetingAt, nextMeetings, villageKey } from "../../shared/sessionRhythm";
import * as repo from "../repos/mapLight";
import * as rhythms from "../repos/sessionRhythm";
import { mapRhythm } from "./sessionRhythm";
import { villageTimezone } from "./villageReaders";

export interface HearthDeps {
  /** The live circles. A circle not here draws no hearth. */
  circles: () => { id: string }[];
  /** A member record by id, as the users repository reads it. */
  memberById: (id: string) => Promise<any | null>;
  /** The host's present-member test (server/lib/memberPresence.ts). */
  isPresent: (member: any) => boolean;
  /** For a test: the village's zone. Absent: the village's own. */
  zone?: string;
}

/** The village day `now` falls in, as its date and its two edges. */
export function villageDay(now: Date, zone: string): { day: string; from: Date; to: Date } {
  const day = villageKey(now, zone);
  return { day, from: meetingAt(day, "00:00", zone), to: meetingAt(addDays(day, 1), "00:00", zone) };
}

/** Every circle with something to draw today, ordered by circle id so the answer is stable. */
export async function hearthsToday(pool: Pool, deps: HearthDeps, now = new Date()): Promise<{ day: string; hearths: HearthToday[] }> {
  const zone = deps.zone ?? villageTimezone();
  const { day, from, to } = villageDay(now, zone);
  const live = new Set(deps.circles().map((c) => String(c.id)));

  const meets = new Set<string>();
  for (const row of await repo.circlesMetInWindow(pool, from, to)) {
    const id = String(row.circle_id);
    if (live.has(id)) meets.add(id);
  }
  for (const row of await rhythms.rhythmRows(pool)) {
    const r = mapRhythm(row);
    if (!live.has(r.circleId)) continue;
    // From the day's first instant, so a meeting already over today still counts.
    if (nextMeetings(r, from, zone, 1)[0]?.key === day) meets.add(r.circleId);
  }

  // Each opted-in present member once per circle. One read per person, cached.
  const verdict = new Map<string, Promise<boolean>>();
  const lit = (userId: string): Promise<boolean> => {
    if (!verdict.has(userId)) {
      verdict.set(
        userId,
        deps.memberById(userId).then((m) => !!m && readMapLight(m.prefs) && deps.isPresent(m)).catch(() => false),
      );
    }
    return verdict.get(userId)!;
  };
  const people = new Map<string, number>();
  for (const row of await repo.joinedInWindow(pool, from, to)) {
    const circleId = String(row.circle_id);
    if (!live.has(circleId) || !(await lit(String(row.user_id)))) continue;
    people.set(circleId, (people.get(circleId) ?? 0) + 1);
  }

  const ids = Array.from(new Set([...Array.from(meets), ...Array.from(people.keys())])).sort();
  const hearths = ids
    .map((circleId) => ({ circleId, meetsToday: meets.has(circleId), lights: lightsShown(people.get(circleId) ?? 0) }))
    .filter((h) => h.meetsToday || h.lights > 0);
  return { day, hearths };
}
