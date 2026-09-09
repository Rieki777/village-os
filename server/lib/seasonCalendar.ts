/**
 * A FRESH VILLAGE'S SEASONS, derived from its own cadence and timezone.
 *
 * ── THE DEFECT THIS REPLACES ───────────────────────────────────────────────
 *
 * The platform shipped two hard-dated seasons, "Season of Foundations" and
 * "Season of Rooting", running 2026-06-21 to 2026-12-21 in
 * `America/Costa_Rica`. Those are one village's dates, and they expire. Every
 * fork provisioned after 2026-12-21 had no current season at all, which is
 * not a cosmetic problem: `org.reassignment_cadence` defaults to
 * `season_turn`, so seat lapse is computed against the current season, and a
 * village with no current season is a village where no seat ever lapses and
 * no term ever ends. The steward seat the governance model rests on would
 * have been unremovable, and every surface would have read it as health.
 *
 * So the seed list is empty now and the season list is DERIVED: from the
 * cadence the village chose, in the timezone the village chose, relative to
 * the day it is asked. `defaultSeasonsFor` answers for any date, past or
 * future, so there is no date on which a fresh village has no season.
 *
 * ── AND "NO SEASON IS RUNNING" IS LOUD ─────────────────────────────────────
 *
 * A derived default cannot help a village that emptied its own list or wrote
 * one that has run out. `seasonRunningProblem` is the sentence for that case,
 * exported here so `term-watch` and the steward surfaces can say it in words
 * rather than treating a silent null as a healthy village.
 *
 * ── AND SEASONS ARE NOT THE TERM CLOCK ANY MORE ────────────────────────────
 *
 * Terms are stamped as instants counted in cycles (`termEndAfter` in
 * `shared/cycleClock.ts`), because a cycle boundary always exists and always
 * arrives. This module keeps seasons honest for the things seasons are still
 * for: banners, patterns, the year's shape, and the reopening cadence a
 * village opts into.
 */
import { civilDate, seasonInstants, zonedTimeToUtc } from "../../shared/lunar";
import { LUNAR_CLOCK, clockFor, type ClockMode } from "../../shared/cycleClock";
import type { SeasonEntry } from "../../shared/gameConfig";

/** How many seasons a derived default lays out. Two years of quarters. */
const DERIVED_SEASON_COUNT = 8;

/** How many lunations one season spans under the `lunar` cadence. */
const MOONS_PER_LUNAR_SEASON = 3;

/**
 * Plain, brand-free names. A village renames these on its first day, and a
 * name that carried somebody else's story would have to be deleted before it
 * could carry the village's own.
 */
const ORDINALS = [
  "First Season", "Second Season", "Third Season", "Fourth Season",
  "Fifth Season", "Sixth Season", "Seventh Season", "Eighth Season",
];

/** `YYYY-MM-DD` of an instant in a zone, which is what a season stores. */
function civilKey(at: Date, timeZone: string): string {
  const c = civilDate(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/**
 * The four solar turnings of a year as instants, from the checked-in table
 * where it reaches and from the canonical civil dates where it does not. The
 * table covers 2020 to 2050; a village provisioned in 2051 still gets a
 * season rather than an empty list.
 */
function turningsOf(year: number): Date[] {
  const s = seasonInstants(year);
  if (s) return [s.marEquinox, s.junSolstice, s.sepEquinox, s.decSolstice];
  return [
    new Date(Date.UTC(year, 2, 20)),
    new Date(Date.UTC(year, 5, 21)),
    new Date(Date.UTC(year, 8, 22)),
    new Date(Date.UTC(year, 11, 21)),
  ];
}

/** Every boundary instant a cadence produces, ascending, spanning `at`. */
function boundariesFor(cadence: string, timeZone: string, at: Date, clockMode: ClockMode): Date[] {
  if (cadence === "lunar") {
    const clock = clockFor(clockMode);
    const here = clock.cycleNumberAt(at);
    // One before the current cycle so `at` always sits inside a season.
    const first = here - (((here % MOONS_PER_LUNAR_SEASON) + MOONS_PER_LUNAR_SEASON) % MOONS_PER_LUNAR_SEASON);
    const out: Date[] = [];
    for (let i = 0; i <= DERIVED_SEASON_COUNT; i++) {
      out.push(clock.startOf(first + i * MOONS_PER_LUNAR_SEASON));
    }
    return out;
  }
  if (cadence === "solstice-equinox") {
    const year = civilDate(at, timeZone).year;
    const all: Date[] = [];
    for (let y = year - 1; y <= year + 3; y++) all.push(...turningsOf(y));
    all.sort((a, b) => a.getTime() - b.getTime());
    let start = 0;
    for (let i = 0; i < all.length; i++) if (all[i].getTime() <= at.getTime()) start = i;
    return all.slice(start, start + DERIVED_SEASON_COUNT + 1);
  }
  // quarterly, custom, and anything a future cadence adds: calendar quarters
  // in the village's own zone, which is the shape a village that has not
  // thought about it expects.
  const c = civilDate(at, timeZone);
  const quarterStartMonth = Math.floor((c.month - 1) / 3) * 3 + 1;
  const out: Date[] = [];
  for (let i = 0; i <= DERIVED_SEASON_COUNT; i++) {
    const months = quarterStartMonth - 1 + i * 3;
    const year = c.year + Math.floor(months / 12);
    const month = ((months % 12) + 12) % 12;
    out.push(zonedTimeToUtc(year, month + 1, 1, 0, 0, timeZone));
  }
  return out;
}

/**
 * The season list a village starts with. Every entry is dated, the list
 * covers `at`, and the last one has an end date, so `needsNextSeason` tells
 * the truth about a village two years from provisioning instead of on the day
 * somebody else's calendar ran out.
 */
export function defaultSeasonsFor(
  cadence: string,
  timeZone: string,
  at: Date = new Date(),
  clockMode: ClockMode = LUNAR_CLOCK.mode,
): SeasonEntry[] {
  const bounds = boundariesFor(cadence, timeZone, at, clockMode);
  const out: SeasonEntry[] = [];
  for (let i = 0; i + 1 < bounds.length && i < DERIVED_SEASON_COUNT; i++) {
    const startsOn = civilKey(bounds[i], timeZone);
    const endsOn = civilKey(bounds[i + 1], timeZone);
    out.push({
      id: `season-${startsOn}`,
      name: ORDINALS[i] ?? `Season ${i + 1}`,
      theme: "",
      focus: "",
      startsOn,
      endsOn,
      patternId: "",
      goals: [],
    });
  }
  return out;
}

/**
 * Suggests the next season's dates from the village's cadence, so an admin
 * gets a draft instead of a blank form.
 *
 * The `lunar` branch used to add 30 civil days and call it "~one synodic
 * month", which is the whole reason Q5 asked for one clock: a village that
 * chose a lunar cadence got a season that drifted away from the moon by half
 * a day every three seasons and lined up with no cycle boundary at all. It
 * reads the clock now.
 */
export function suggestNextSeasonDates(
  cadence: string,
  lastEndsOn: string,
  timeZone = "UTC",
  clockMode: ClockMode = LUNAR_CLOCK.mode,
): { startsOn: string; endsOn: string } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(lastEndsOn) ? lastEndsOn : new Date().toISOString().slice(0, 10);
  const d = new Date(`${start}T00:00:00Z`);
  if (cadence === "lunar") {
    const clock = clockFor(clockMode);
    const end = clock.startOf(clock.cycleNumberAt(d) + MOONS_PER_LUNAR_SEASON);
    return { startsOn: start, endsOn: civilKey(end, timeZone) };
  }
  if (cadence === "solstice-equinox") {
    // Ignore a turning within about six weeks: a season starting the day
    // before an equinox should run to the NEXT one rather than be one day long.
    const floor = d.getTime() + 45 * 86_400_000;
    const year = d.getUTCFullYear();
    const marks = [...turningsOf(year), ...turningsOf(year + 1)]
      .filter((t) => t.getTime() > floor)
      .sort((a, b) => a.getTime() - b.getTime());
    if (marks.length) return { startsOn: start, endsOn: civilKey(marks[0], timeZone) };
  }
  const end = new Date(d);
  end.setUTCMonth(end.getUTCMonth() + 3);
  return { startsOn: start, endsOn: end.toISOString().slice(0, 10) };
}

export interface SeasonRunningState {
  /** The season covering today, or null. */
  currentId: string | null;
  /** How many dated seasons the village has configured. */
  configuredCount: number;
  /** True when every configured season has an end date in the past. */
  allEnded: boolean;
}

/**
 * WHY NO SEASON IS RUNNING, in words, or null when one is.
 *
 * Three different silences used to look the same. A village that has never
 * written a season, a village whose seasons have all run out, and a village
 * holding an open-ended founding season all rendered as an empty banner, and
 * anything reading "the current season" got null from each of them. Seat
 * lapse reads the current season, so the third case is the one that quietly
 * froze every seat.
 *
 * The caller says what it will do with the sentence. `term-watch` prints it
 * as a condition to fix; a banner may prefer to say nothing. What no caller
 * should do is treat null as health.
 */
export function seasonRunningProblem(state: SeasonRunningState): string | null {
  if (state.currentId) return null;
  if (state.configuredCount === 0) {
    return (
      "No season is running and none is configured. Seat terms that expire each season " +
      "cannot come due, so every seat holds indefinitely. Add a season in the Game Mechanics " +
      "section, or move the seats to terms counted in cycles."
    );
  }
  if (state.allEnded) {
    return (
      `All ${state.configuredCount} configured season(s) have ended and no new one has started. ` +
      "Seat terms that expire each season cannot come due until one does."
    );
  }
  return (
    `No season covers today, though ${state.configuredCount} are configured. ` +
    "There is a gap in the season dates. Seat terms that expire each season cannot come due inside it."
  );
}
