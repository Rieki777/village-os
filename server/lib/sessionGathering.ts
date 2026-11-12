/**
 * Live Sessions: "I'LL BE THERE" for a circle's next meeting (Phase C, the
 * Gathering). The shape is `SessionGathering` in shared/sessionRhythm.ts.
 *
 * NO NEW TABLE. A circle's rhythm is already mirrored onto the village
 * calendar as one recurring gathering (`mirrorRhythms`, server/lib/
 * sessionCalendar.ts: source `sessions`, the circle's id), and the calendar
 * expands that gathering into evenings keyed by village date, the same key a
 * rhythm's `Meeting` carries. So the next meeting IS one evening of a
 * gathering, and "I'll be there" is the gatherings' own `going` answer in
 * `event_rsvps`, written through the gatherings' own door
 * (`POST /api/events/:id/rsvp` with `occurrenceKey`), with its capacity lock,
 * its waitlist and its refund discipline untouched.
 *
 * This file only READS: for each row of Coming up whose next meeting comes
 * from the rhythm, the mirrored gathering (when the mirror has written it and
 * it is still on the calendar) and who answered `going` for that evening.
 *
 * WHO SEES NAMES. The count fills the Seed of Life for anybody who may read
 * Coming up. The names of who said they will come are for the circle's own
 * members and admins: where somebody will be on an evening is the circle's
 * business, the way the gatherings keep attendance off the public pulse.
 * Names come back alphabetical, never in any order that measures a person.
 */
import type { Pool } from "mysql2/promise";
import * as store from "../repos/sessionGathering";
import { calendarIdFor } from "./calendar";
import { effectiveLifecycle } from "./modules";
import { boolVar } from "./variables";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import { MIRROR_SOURCE } from "../../shared/sessionCalendar";
import type { ComingUpRow, SessionGathering } from "../../shared/sessionRhythm";

/** How many names travel with a gathering: the seed has seven circles, and a line of names longer than that is a list. */
export const GATHERING_NAMES_MAX = 7;

export interface GatheringDeps {
  /** For a test: whether this viewer may answer gatherings at all. Absent: the events module and its RSVP dial. */
  answersOpen?: (admin: boolean) => boolean;
}

/** May this viewer answer a gathering: the events module open to them, and the village taking answers. */
export function answersOpen(admin: boolean): boolean {
  const lc = effectiveLifecycle("events") as ModuleLifecycle;
  const rank = LIFECYCLE_RANK[lc] ?? 0;
  const open =
    rank >= LIFECYCLE_RANK.members || (admin && rank >= LIFECYCLE_RANK.preview);
  return open && boolVar("events.rsvp_enabled");
}

/** "Ana", from "Ana Lucía Mora": the first word of a name, or null for none. */
export function firstName(name: unknown): string | null {
  const s = typeof name === "string" ? name.trim() : "";
  if (!s) return null;
  return s.split(/\s+/)[0] ?? null;
}

/**
 * Fill `gathering` on each row in place. A row whose next meeting comes from
 * the circle's own calendar, or whose circle's gathering is not on the
 * calendar, gets null; so does every row while the viewer may not answer.
 */
export async function attachGatherings(
  pool: Pool,
  rows: ComingUpRow[],
  who: { userId: string; admin: boolean },
  deps: GatheringDeps = {}
): Promise<ComingUpRow[]> {
  for (const row of rows) row.gathering = null;
  if (!rows.length || !(deps.answersOpen ?? answersOpen)(who.admin))
    return rows;
  const wanted = rows
    .filter(r => r.nextFrom === "rhythm")
    .map(r => ({
      row: r,
      eventId: calendarIdFor({
        sourceModule: MIRROR_SOURCE,
        sourceId: r.circleId,
      }),
    }));
  if (!wanted.length) return rows;

  const live = new Set((await store.liveGatheringRows(pool, wanted.map(w => w.eventId))).map(e => String(e.id)));
  const present = wanted.filter(w => live.has(w.eventId));
  if (!present.length) return rows;
  // One read for every evening: (event, date) pairs, `going` only.
  const answers = await store.goingRows(pool, present.map(w => ({ eventId: w.eventId, occurrenceKey: w.row.next.key })));

  for (const w of present) {
    const mineHere = answers.filter(
      a =>
        String(a.event_id) === w.eventId &&
        String(a.occurrence_key) === w.row.next.key
    );
    const seesNames = w.row.mine || who.admin;
    const names = seesNames
      ? mineHere
          .map(a => firstName(a.name))
          .filter((n): n is string => n != null)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, GATHERING_NAMES_MAX)
      : [];
    const gathering: SessionGathering = {
      eventId: w.eventId,
      occurrenceKey: w.row.next.key,
      going: mineHere.length,
      mine: mineHere.some(a => String(a.user_id) === who.userId),
      names,
    };
    w.row.gathering = gathering;
  }
  return rows;
}
