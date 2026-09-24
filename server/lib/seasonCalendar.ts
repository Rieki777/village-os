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
import { GAME_CONFIG, type SeasonEntry } from "../../shared/gameConfig";

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

// ── The stored season document ─────────────────────────────────────────────
//
// Moved here from `server/index.ts` with `normalizeSeasonConfig` unchanged in
// what it does to a list, so the two defects below could be measured without
// booting a server, and so the reasoning does not cost the monolith ratchet.
//
// D2-8. A document holding an EMPTY list and a zone the runtime cannot format
// ("", "Bogus/Zone") derived its seasons through `Intl.DateTimeFormat`, which
// throws. Every season read threw, the Season tab that could fix the zone
// among them. `raw?.timezone ?? def.timezone` let both through, because `??`
// only replaces null. So the zone is checked before deriving, and the save
// refuses an unknown zone in words instead of storing one.
//
// D2-9. The Season tab sends back the list it was SHOWN, and for a village
// that never wrote one that list is derived. Storing it froze eight seasons
// dated from the day of the first save, and the village stopped deriving.
// So a save whose list is empty, or is exactly what would be derived for its
// cadence and zone at that moment, stores an empty list.

/** Who said the timezone is right, and when. Absent until somebody says. */
export interface TimezoneAnswer {
  at: string;
  by: string | null;
}

export interface SeasonConfig {
  seasons: any[];
  cadence: string;
  timezone: string;
  /**
   * SOMEBODY HERE CONFIRMED THE ZONE, which the stored zone itself cannot say.
   *
   * The Season tab is handed the NORMALISED document, so a fresh village's form
   * already holds the platform's `America/Costa_Rica` and every save writes it
   * back. A stored zone therefore proves only that somebody once saved this
   * tab, which renaming a season does. This field is written on a real change
   * or on an explicit confirmation, and nothing else touches it, so it is the
   * one honest reading of "a village said where it is".
   *
   * Absent on every document written before it existed, which is the normal
   * case and reads as unanswered: no village's clock changes, and each is
   * asked once.
   */
  timezoneAnswer?: TimezoneAnswer | null;
}

/** Whether this runtime can format a date in the named zone. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The sentence a season save is refused with for an unknown zone, or null. */
export function timeZoneRefusal(tz: unknown): string | null {
  if (isTimeZone(tz)) return null;
  const shown = String(tz ?? "").trim().slice(0, 60);
  return shown
    ? `"${shown}" is not a timezone this server knows. Use a name from the IANA list, like UTC or Europe/Lisbon.`
    : "The timezone is empty. Use a name from the IANA list, like UTC or Europe/Lisbon.";
}

/** Accepts either the new {seasons,cadence,timezone} shape or a single legacy
 *  season object, so existing data/season.json keeps working after deploy. */
export function normalizeSeasonConfig(raw: any, at: Date = new Date()): SeasonConfig {
  const def = GAME_CONFIG.season;
  if (raw && Array.isArray(raw.seasons) && raw.seasons.length > 0) { // an EMPTY list is the platform default's sentinel for "derive", handled at the bottom; every seat's term (0199) needs a season to end with
    return {
      seasons: raw.seasons.map((s: any, i: number) => ({
        id: s.id || `season-${i + 1}`,
        name: s.name ?? "",
        theme: s.theme ?? "",
        focus: s.focus ?? "",
        startsOn: s.startsOn ?? "",
        endsOn: s.endsOn ?? "",
        // 0050. This normaliser rebuilds every season from a FIXED field list
        // and runs on read as well as write, so a field missing from here is
        // a field the village can never store: without this line the pattern
        // id was silently dropped on every save AND every load, and the whole
        // season-pattern system resolved to "no pattern running".
        patternId: s.patternId ?? "",
        goals: Array.isArray(s.goals)
          ? s.goals.map((g: any) => ({ text: String(g?.text ?? ""), done: !!g?.done }))
          : [],
      })),
      cadence: raw.cadence ?? def.cadence,
      timezone: raw.timezone ?? def.timezone,
      // CARRIED IN ALL THREE BRANCHES, because this function rebuilds the
      // document from a fixed field list on read AS WELL AS on write. That is
      // how `patternId` was silently dropped on every save and every load
      // (0050, the note above), and an answer that vanished on the next read
      // would ask a village the same question forever.
      timezoneAnswer: answerOf(raw),
    };
  }
  // Legacy single-season file: lift it into a one-item list.
  if (raw && typeof raw === "object" && raw.name) {
    return {
      seasons: [{
        id: "season-1",
        name: raw.name, theme: raw.theme ?? "", focus: raw.focus ?? "",
        startsOn: raw.startsOn ?? "", endsOn: raw.endsOn ?? "",
        goals: Array.isArray(raw.goals) ? raw.goals : [],
      }],
      cadence: def.cadence,
      timezone: def.timezone,
      timezoneAnswer: answerOf(raw),
    };
  }
  // Written nothing, OR WRITTEN AN EMPTY LIST, gets a list DERIVED from the
  // cadence and timezone. The default document IS the empty list and `get()`
  // returns it when no row exists, so the length test above is what makes this
  // branch reachable: without it no fresh village had a season on any date.
  // The zone is checked first (D2-8, above).
  const cadence = raw?.cadence ?? def.cadence;
  const timezone = isTimeZone(raw?.timezone) ? raw.timezone : isTimeZone(def.timezone) ? def.timezone : "UTC";
  return {
    seasons: (def.seasons.length ? def.seasons : defaultSeasonsFor(cadence, timezone, at)) as any[],
    cadence,
    timezone,
    timezoneAnswer: answerOf(raw),
  };
}

/** The stored answer, kept only when it is the shape this file writes. */
function answerOf(raw: any): TimezoneAnswer | null {
  const a = raw?.timezoneAnswer;
  if (!a || typeof a !== "object") return null;
  const at = typeof a.at === "string" ? a.at : "";
  if (!at) return null;
  return { at, by: typeof a.by === "string" && a.by ? a.by : null };
}

/** Two season lists are the same when every field a season stores matches. */
function sameSeasonList(a: readonly any[], b: readonly any[]): boolean {
  const key = (s: any) =>
    JSON.stringify([
      s?.id ?? "", s?.name ?? "", s?.theme ?? "", s?.focus ?? "", s?.startsOn ?? "", s?.endsOn ?? "",
      s?.patternId ?? "", Array.isArray(s?.goals) ? s.goals.map((g: any) => [String(g?.text ?? ""), !!g?.done]) : [],
    ]);
  return a.length === b.length && a.every((s, i) => key(s) === key(b[i]));
}

/**
 * The document `PUT /api/admin/seasons` stores, or the sentence it refuses
 * with. An empty list, and a list identical to the one that would be derived
 * right now, are both stored as an empty list, so the village keeps deriving.
 *
 * WHEN A VILLAGE HAS ANSWERED ITS TIMEZONE. Two ways, and neither of them is
 * "saved this tab":
 *
 *   - `confirmTimezone: true`, the button beside the field, which is the only
 *     way to agree with a zone that is already showing; and
 *   - a save that genuinely CHANGES the zone, because choosing a different one
 *     is an answer by any reading.
 *
 * Everything else carries the previous answer forward untouched. The tab sends
 * back the normalised document it was given, so treating an ordinary save as an
 * answer would mean a village renaming a season had silently confirmed Costa
 * Rica's clock.
 */
export function seasonDocumentToStore(
  body: any,
  at: Date = new Date(),
  previous?: { timezone?: string; timezoneAnswer?: TimezoneAnswer | null } | null,
  by?: string | null,
): { ok: true; doc: SeasonConfig } | { ok: false; error: string } {
  if (body?.timezone !== undefined) {
    const refusal = timeZoneRefusal(body.timezone);
    if (refusal) return { ok: false, error: refusal };
  }
  const doc = normalizeSeasonConfig(body, at);
  const changed =
    body?.timezone !== undefined &&
    previous?.timezone !== undefined &&
    String(body.timezone) !== String(previous.timezone);
  doc.timezoneAnswer =
    body?.confirmTimezone === true || changed
      ? { at: at.toISOString(), by: by ?? null }
      : previous?.timezoneAnswer ?? null;
  const sent = Array.isArray(body?.seasons) && body.seasons.length > 0;
  if (!sent && !body?.name) return { ok: true, doc: { ...doc, seasons: [] } };
  if (sent) {
    const derived = normalizeSeasonConfig({ cadence: doc.cadence, timezone: doc.timezone }, at).seasons;
    const shown = derived.length ? normalizeSeasonConfig({ ...doc, seasons: derived }, at).seasons : [];
    if (sameSeasonList(doc.seasons, shown)) return { ok: true, doc: { ...doc, seasons: [] } };
  }
  return { ok: true, doc };
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
