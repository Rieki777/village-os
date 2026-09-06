/**
 * WHERE A VILLAGE'S MOON 1 IS, and the one function that turns an instant into
 * the moon a member reads.
 *
 * `shared/villageMoon.ts` holds the arithmetic and the words. This file holds
 * the two things that arithmetic needs and that only a server can answer:
 * which lunation this village calls Moon 1, and which lunation a given instant
 * falls in.
 *
 * ── THE ANCHOR, IN PRECEDENCE ORDER ─────────────────────────────────────────
 *
 *   1. `village.first_moon_at`, the founder's override, when it is set.
 *   2. `launch-state.launchedAt`, the instant the launch vote carried.
 *   3. Nothing. The village is not counting yet, and every surface says so
 *      instead of inventing a Moon 0.
 *
 * In both live cases Moon 1 is THE LUNATION CONTAINING that instant, which is
 * the new moon at or before it. A village does not start counting from the
 * next new moon: the moon it launched under is its first one.
 *
 * ── AN UNREADABLE OVERRIDE STOPS THE COUNT, IT DOES NOT FALL THROUGH ────────
 *
 * The write path validates, so a value that cannot be read got there some
 * other way. Quietly falling back to `launchedAt` at that point would print a
 * moon number for every row in the village that is wrong by an unknown amount,
 * and nothing on any screen would say so. Every count in this build is allowed
 * to be absent and is never allowed to be wrong, so an unreadable override
 * leaves the village unanchored and says why in the log.
 *
 * ── WHY THIS READS THE DATABASE INSTEAD OF CACHING THE ANSWER ───────────────
 *
 * The same reasoning `server/lib/gameStart.ts` sets out at length: the
 * deployment runs more than one process, and a flag cached at boot would be
 * wrong in every sibling from the moment a launch vote carries. The read is
 * one primary-key lookup on `app_config`, on display paths that already do
 * more work than that.
 *
 * The override half is a game variable and therefore comes from the process's
 * own boot-loaded cache, which is how every variable in this platform behaves.
 * A founder changing it is visible to the process that took the write at once
 * and to its siblings at their next boot, exactly like the sending allowance.
 */
import type { Pool } from "mysql2/promise";
import { cycleBoundsFor, cycleBoundsByNumber, fullMoonsBetween } from "../../shared/lunar";
import {
  parseAnchorDate,
  villageMoon,
  type VillageMoon,
} from "../../shared/villageMoon";
import { parseCycleId } from "./gratitude-cycles";
import { launchedAtOf } from "./launch";
import { stringVar } from "./variables";

/** The game variable a founder sets to move Moon 1. */
export const FIRST_MOON_KEY = "village.first_moon_at";

/**
 * Resolve the anchor from its two raw inputs. Pure, so the precedence and the
 * refusal are testable without a database or a clock.
 *
 * Returns the absolute lunation number of Moon 1, or null when the village is
 * not counting. `problem` carries the sentence for the log when an override
 * could not be read.
 */
export function anchorCycleFrom(
  overrideRaw: string | null | undefined,
  launchedAt: string | null | undefined,
): { moonOneCycle: number | null; problem: string | null } {
  const typed = String(overrideRaw ?? "").trim();
  if (typed !== "") {
    const at = parseAnchorDate(typed);
    if (!at) {
      return {
        moonOneCycle: null,
        problem:
          `The first-moon setting holds "${typed}", which is not a date this build can read. ` +
          `Until it is a plain date such as 2026-03-19, or blank, this village shows its moon ` +
          `windows with no moon number on them. A moon number counted from a guessed start ` +
          `would be wrong on every screen and say so on none of them.`,
      };
    }
    return { moonOneCycle: cycleBoundsFor(at).cycleNumber, problem: null };
  }

  const launched = launchedAt ? new Date(launchedAt) : null;
  if (launched && Number.isFinite(launched.getTime())) {
    return { moonOneCycle: cycleBoundsFor(launched).cycleNumber, problem: null };
  }
  return { moonOneCycle: null, problem: null };
}

let warned = "";

/**
 * The lunation this village calls Moon 1, or null.
 *
 * One `app_config` read per call. Callers that label a list of moons resolve
 * it once and pass the number down rather than asking per row.
 */
export async function moonOneCycle(pool: Pool): Promise<number | null> {
  const override = stringVar(FIRST_MOON_KEY);
  const { moonOneCycle: anchor, problem } = anchorCycleFrom(override, await launchedAtOf(pool));
  // Once per distinct bad value, so a village that cannot start counting says
  // so in the log without filling it on every page load.
  if (problem && warned !== problem) {
    warned = problem;
    console.warn(`[villageMoon] ${problem}`);
  }
  if (!problem) warned = "";
  return anchor;
}

/** The full moon inside a window, the display landmark, or null. */
function fullMoonInside(startsAt: Date, endsAt: Date): Date | null {
  return fullMoonsBetween(startsAt, endsAt)[0] ?? null;
}

/**
 * THE FUNCTION. The village moon an instant falls in.
 *
 * The window comes from the SETTLEMENT clock (`cycleBoundsFor`), never from
 * `trueLunationFor`, because every surface that shows this also shows totals
 * settled against a stored `cycle_id`, and a label drawn from a second clock
 * would eventually name a different month than the money did.
 */
export function villageMoonFor(date: Date, anchor: number | null): VillageMoon {
  const b = cycleBoundsFor(date);
  return villageMoon({
    cycleNumber: b.cycleNumber,
    moonOneCycle: anchor,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    fullMoonAt: fullMoonInside(b.startsAt, b.endsAt),
  });
}

/** The same, for a lunation number already in hand (a stored cycle id). */
export function villageMoonForCycle(cycleNumber: number, anchor: number | null): VillageMoon {
  const b = cycleBoundsByNumber(cycleNumber);
  return villageMoon({
    cycleNumber,
    moonOneCycle: anchor,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    fullMoonAt: fullMoonInside(b.startsAt, b.endsAt),
  });
}

/**
 * The same, from a stored `lunar-NNNNNN` id. Returns null for an id this build
 * cannot read, which is the one answer `gratitude-cycles.ts` insists on: a row
 * nobody can place gets no label rather than somebody else's label.
 *
 * The id is parsed by that file's own `parseCycleId` and never by a regex of
 * this file's own. A second reader of the cycle-id spelling is how the
 * `moon-329` beside `lunar-000329` split began, and one of the two readers
 * always ends up a release behind the other.
 */
export function villageMoonForCycleId(cycleId: string, anchor: number | null): VillageMoon | null {
  const n = parseCycleId(String(cycleId ?? ""));
  return n === null ? null : villageMoonForCycle(n, anchor);
}

// ── Labelling a payload ─────────────────────────────────────────────────────
//
// Both of these live here so a route stays one line: `server/index.ts` is
// under a ratchet that only turns down, and a feature that decorated four
// payloads inline would have spent that budget on repetition. They also read
// the anchor ONCE for a whole list, which is the behaviour a per-row helper
// would quietly lose.

/** Rows carrying a lunation number, each with the village moon it names. */
export async function withVillageMoons<T extends { cycleNumber: number }>(
  pool: Pool,
  rows: readonly T[],
): Promise<Array<T & { moon: VillageMoon }>> {
  const anchor = await moonOneCycle(pool);
  return rows.map((r) => ({ ...r, moon: villageMoonForCycle(Number(r.cycleNumber), anchor) }));
}

/** One member's settled moons, newest first, each labelled and none named by id. */
export async function memberMoonFlows(
  pool: Pool,
  distributions: ReadonlyArray<{ userId: string; cycleId: string; received: number; distinctSenders: number }>,
  userId: string,
): Promise<Array<{ cycleId: string; received: number; distinctSenders: number; moon: VillageMoon | null }>> {
  const anchor = await moonOneCycle(pool);
  return distributions
    .filter((d) => d.userId === userId)
    // The stored id sorts chronologically because it is zero padded, which is
    // exactly what `formatCycleId` was padded FOR. Sorting by the ordinal
    // would sort a village's unnumbered moons into a heap.
    .sort((a, b) => String(b.cycleId).localeCompare(String(a.cycleId)))
    .map((d) => ({
      cycleId: d.cycleId,
      received: d.received,
      distinctSenders: d.distinctSenders,
      moon: villageMoonForCycleId(d.cycleId, anchor),
    }));
}
