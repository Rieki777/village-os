/**
 * Deterministic lunar-cycle math for the Gratitude system, and the sky the
 * village calendar draws.
 *
 * ONE TRUE LUNAR CLOCK (round 4, lane L5a). Two clocks that disagree by a
 * day a few times a year is a settlement bug, so this file is the only
 * lunar arithmetic in the product: gratitude cycles, the pool, the health
 * buckets, the calendar's Moons view and the year wheel all read it.
 *
 * Two layers, deliberately:
 *
 *   1. THE SKY. shared/lunarTable.json holds the true new moons, full moons
 *      and season instants for 2020 to 2050 as epoch minutes, generated once
 *      by scripts/gen-lunar-table.mjs (astronomy-engine, dev only) and
 *      checked in. `moonPhase`, `newMoonsBetween`, `seasonInstants` and the
 *      lunar-month helpers read the table directly. Outside its range they
 *      fall back to the mean formula below.
 *
 *   2. THE SETTLEMENT CLOCK. Cycle numbers are a natural key on distribution
 *      records ("lunar-000328"), so THE PAST IS FROZEN: every cycle below
 *      TRUE_CLOCK_FROM_CYCLE keeps the boundary the mean formula always
 *      gave it, bit for bit, and from that cycle on the boundary is the true
 *      new moon. Cycle numbering never changes: each true instant maps to
 *      exactly one k by round((t - REF) / SYNODIC), tested unique and
 *      consecutive across the table.
 *
 * regen-civics (the hub) reads the same mean formula today and takes this
 * table in its item 17; until then the two products agree on every cycle
 * below TRUE_CLOCK_FROM_CYCLE and by construction on the numbering above it.
 * If the hub ever revises its algorithm, revise this file the same way.
 *
 * The mean formula: the mean synodic month anchored to a reference new moon
 * (2000-01-06 18:14 UTC, Meeus). Measured against the table it drifts up to
 * 17.6 hours from the true instant (the header used to say 14; the table
 * says otherwise), which was fine for a 29.5-day game cycle and is why the
 * freeze costs nothing: no past boundary moves.
 *
 * cycleNumber = whole lunations elapsed since the reference new moon.
 */

import lunarTable from "./lunarTable.json";

export const SYNODIC_MONTH_DAYS = 29.53058867;
export const SYNODIC_MONTH_MS = SYNODIC_MONTH_DAYS * 24 * 60 * 60 * 1000;

/** Reference new moon: 2000-01-06 18:14:00 UTC. */
export const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

/**
 * The first cycle whose boundaries come from the table. The current cycle at
 * merge plus one (cycle 329 was open on 2026-08-16), so no cycle anybody has
 * settled, and none in progress at merge, changes its start.
 */
export const TRUE_CLOCK_FROM_CYCLE = 330;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

// ── The table ───────────────────────────────────────────────────────────────

/** True new-moon instants, ms since epoch, ascending. */
const NEW_MOONS_MS: readonly number[] = lunarTable.newMoons.map((m: number) => m * MINUTE);
/** True full-moon instants, ms since epoch, ascending. */
const FULL_MOONS_MS: readonly number[] = lunarTable.fullMoons.map((m: number) => m * MINUTE);

export interface SeasonInstants {
  year: number;
  marEquinox: Date;
  junSolstice: Date;
  sepEquinox: Date;
  decSolstice: Date;
}

const SEASONS_BY_YEAR: ReadonlyMap<number, SeasonInstants> = new Map(
  (lunarTable.seasons as number[][]).map((row) => [
    row[0],
    {
      year: row[0],
      marEquinox: new Date(row[1] * MINUTE),
      junSolstice: new Date(row[2] * MINUTE),
      sepEquinox: new Date(row[3] * MINUTE),
      decSolstice: new Date(row[4] * MINUTE),
    },
  ]),
);

/** The years the table covers, inclusive. */
export const LUNAR_TABLE_YEARS = { from: lunarTable.fromYear as number, to: lunarTable.toYear as number };

/** Index of the last element <= t, or -1. */
function lastAtOrBefore(sorted: readonly number[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Table instants inside [from, to), ascending. */
function between(sorted: readonly number[], fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  let i = lastAtOrBefore(sorted, fromMs);
  if (i < 0 || sorted[i] < fromMs) i += 1;
  for (; i < sorted.length && sorted[i] < toMs; i++) out.push(sorted[i]);
  return out;
}

/** True new moons in [from, to). Empty outside the table. */
export function newMoonsBetween(from: Date, to: Date): Date[] {
  return between(NEW_MOONS_MS, from.getTime(), to.getTime()).map((ms) => new Date(ms));
}

/** True full moons in [from, to). Empty outside the table. */
export function fullMoonsBetween(from: Date, to: Date): Date[] {
  return between(FULL_MOONS_MS, from.getTime(), to.getTime()).map((ms) => new Date(ms));
}

/** The four season instants of a Gregorian year, or null outside the table. */
export function seasonInstants(year: number): SeasonInstants | null {
  return SEASONS_BY_YEAR.get(year) ?? null;
}

/** True when the table has a lunation containing `date`. */
export function inLunarTable(date: Date): boolean {
  const t = date.getTime();
  const i = lastAtOrBefore(NEW_MOONS_MS, t);
  return i >= 0 && i < NEW_MOONS_MS.length - 1;
}

export interface Lunation {
  /** The cycle number this lunation carries (see cycleNumberOfInstant). */
  cycleNumber: number;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The true lunation (new moon to new moon) containing `date`, from the table.
 * Falls back to the mean lunation outside the table's range. This is the
 * SKY: it never consults TRUE_CLOCK_FROM_CYCLE. For settlement use
 * cycleBoundsFor.
 */
export function trueLunationFor(date: Date): Lunation {
  const t = date.getTime();
  const i = lastAtOrBefore(NEW_MOONS_MS, t);
  if (i >= 0 && i < NEW_MOONS_MS.length - 1) {
    return {
      cycleNumber: cycleNumberOfInstant(NEW_MOONS_MS[i]),
      startsAt: new Date(NEW_MOONS_MS[i]),
      endsAt: new Date(NEW_MOONS_MS[i + 1]),
    };
  }
  const k = Math.floor((t - REFERENCE_NEW_MOON_MS) / SYNODIC_MONTH_MS);
  return { cycleNumber: k, startsAt: new Date(meanStartMs(k)), endsAt: new Date(meanStartMs(k + 1)) };
}

// ── Numbering ───────────────────────────────────────────────────────────────

/**
 * Which cycle number a new-moon instant carries. Nearest mean lunation, so a
 * true instant up to half a lunation off the mean still lands on the k the
 * mean formula would have given that month. Tested unique and consecutive
 * over the whole table.
 */
export function cycleNumberOfInstant(ms: number): number {
  return Math.round((ms - REFERENCE_NEW_MOON_MS) / SYNODIC_MONTH_MS);
}

const meanStartMs = (k: number): number => REFERENCE_NEW_MOON_MS + k * SYNODIC_MONTH_MS;

let trueByCycle: Map<number, number> | null = null;
function trueStartMs(k: number): number | undefined {
  if (!trueByCycle) {
    trueByCycle = new Map();
    for (const ms of NEW_MOONS_MS) trueByCycle.set(cycleNumberOfInstant(ms), ms);
  }
  return trueByCycle.get(k);
}

/**
 * The instant cycle k begins. Mean below TRUE_CLOCK_FROM_CYCLE and wherever
 * the table has no instant; the true new moon otherwise. Monotone in k: the
 * true instant is never more than a day from the mean and lunations are 29
 * days apart, so start(k) < start(k + 1) holds across the switch.
 */
export function cycleStartMs(k: number): number {
  if (k < TRUE_CLOCK_FROM_CYCLE) return meanStartMs(k);
  return trueStartMs(k) ?? meanStartMs(k);
}

/** The mean formula alone, exported so tests can prove the past is frozen. */
export function meanCycleStartMs(k: number): number {
  return meanStartMs(k);
}

// ── Phase ───────────────────────────────────────────────────────────────────

/**
 * Moon phase as a fraction of the lunation containing `date`.
 * 0 = new moon, 0.25 = first quarter, 0.5 = full moon, 0.75 = last quarter.
 * The true lunation inside the table; the mean one outside it.
 */
export function moonPhase(date: Date): number {
  const t = date.getTime();
  const i = lastAtOrBefore(NEW_MOONS_MS, t);
  if (i >= 0 && i < NEW_MOONS_MS.length - 1) {
    return (t - NEW_MOONS_MS[i]) / (NEW_MOONS_MS[i + 1] - NEW_MOONS_MS[i]);
  }
  const elapsed = t - REFERENCE_NEW_MOON_MS;
  const phase = (elapsed % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS;
  return phase < 0 ? phase + 1 : phase;
}

/** Human name for a phase fraction, for UI copy. */
export function moonPhaseName(phase: number): string {
  if (phase < 0.033 || phase >= 0.967) return "New moon";
  if (phase < 0.217) return "Waxing crescent";
  if (phase < 0.283) return "First quarter";
  if (phase < 0.467) return "Waxing gibbous";
  if (phase < 0.533) return "Full moon";
  if (phase < 0.717) return "Waning gibbous";
  if (phase < 0.783) return "Last quarter";
  return "Waning crescent";
}

/** One glyph per eighth of the lunation, for calendar cells. */
export function moonPhaseGlyph(phase: number): string {
  const glyphs = ["\u{1F311}", "\u{1F312}", "\u{1F313}", "\u{1F314}", "\u{1F315}", "\u{1F316}", "\u{1F317}", "\u{1F318}"];
  const idx = Math.round(((phase % 1) + 1) % 1 * 8) % 8;
  return glyphs[idx];
}

// ── The settlement clock ────────────────────────────────────────────────────

export interface LunarCycleBounds {
  /** Whole lunations since the reference new moon. */
  cycleNumber: number;
  startsAt: Date;
  endsAt: Date;
}

/** The lunation with a specific cycle number. */
export function cycleBoundsByNumber(cycleNumber: number): LunarCycleBounds {
  return {
    cycleNumber,
    startsAt: new Date(cycleStartMs(cycleNumber)),
    endsAt: new Date(cycleStartMs(cycleNumber + 1)),
  };
}

/** The lunation containing `date` (new moon to next new moon). */
export function cycleBoundsFor(date: Date): LunarCycleBounds {
  const t = date.getTime();
  let k = Math.floor((t - REFERENCE_NEW_MOON_MS) / SYNODIC_MONTH_MS);
  // Below the switch this IS the original formula, floor and all, so every
  // date the frozen past ever answered still gets the same number. Only a
  // cycle that touches the switch needs the walk: the mean guess is within
  // one cycle of the answer, and two steps cover it.
  if (k + 1 < TRUE_CLOCK_FROM_CYCLE) return cycleBoundsByNumber(k);
  while (t < cycleStartMs(k)) k -= 1;
  while (t >= cycleStartMs(k + 1)) k += 1;
  return cycleBoundsByNumber(k);
}

/** Whole days until the cycle containing `date` ends (rounded up, min 0). */
export function daysRemainingInCycle(date: Date): number {
  const { endsAt } = cycleBoundsFor(date);
  return Math.max(0, Math.ceil((endsAt.getTime() - date.getTime()) / DAY_MS));
}

// ── Village time helpers ────────────────────────────────────────────────────

/** Civil date parts of an instant in an IANA zone. */
export function civilDate(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** `YYYY-MM-DD` of an instant in a zone: the calendar's occurrence key. */
export function civilDateKey(date: Date, timeZone: string): string {
  const c = civilDate(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/** Civil date and clock parts of an instant in a zone. */
export function civilParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: Math.max(0, weekdays.indexOf(get("weekday"))),
  };
}

/**
 * The instant at which a zone's clock reads the given civil date and time.
 * Two passes over the zone's offset so a date on the far side of a daylight
 * change still lands on the wall-clock time asked for; inside a skipped hour
 * it lands on the nearest real minute after it.
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const c = civilParts(new Date(ms), timeZone);
    return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute) - ms;
  };
  let guess = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(guess);
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** Whole civil days from a to b in a zone (b's date minus a's date). */
export function civilDaysBetween(a: Date, b: Date, timeZone: string): number {
  const ca = civilDate(a, timeZone);
  const cb = civilDate(b, timeZone);
  return Math.round((Date.UTC(cb.year, cb.month - 1, cb.day) - Date.UTC(ca.year, ca.month - 1, ca.day)) / DAY_MS);
}

/**
 * "Day N of M" over a span, counting BOTH end days, in the village's own time zone. The one count the role chart's
 * header and the profile's hero both print, so the same season reads the same number in both. N never passes M or drops below 1.
 */
export function daysOfSpan(start: Date, end: Date, now: Date, timeZone: string): { day: number; of: number } {
  const of = civilDaysBetween(start, end, timeZone) + 1;
  return { day: Math.min(of, Math.max(1, civilDaysBetween(start, now, timeZone) + 1)), of };
}

// ── Lunar months: twelve or thirteen moons anchored to a solar event ─────────

export const YEAR_ANCHORS = ["december_solstice", "march_equinox", "june_solstice", "september_equinox"] as const;
export type YearAnchor = (typeof YEAR_ANCHORS)[number];

function anchorInstant(year: number, anchor: YearAnchor): Date | null {
  const s = seasonInstants(year);
  if (!s) return null;
  switch (anchor) {
    case "march_equinox": return s.marEquinox;
    case "june_solstice": return s.junSolstice;
    case "september_equinox": return s.sepEquinox;
    default: return s.decSolstice;
  }
}

export interface LunarMonth {
  /** 1-based position in its lunar year. 13 is the intercalary moon. */
  index: number;
  startsAt: Date;
  endsAt: Date;
  /** The settlement-independent cycle number of this lunation. */
  cycleNumber: number;
}

export interface LunarYear {
  /** The Gregorian year of the anchor event that opened this lunar year. */
  anchorYear: number;
  anchorAt: Date;
  startsAt: Date;
  endsAt: Date;
  months: LunarMonth[];
}

/**
 * The lunar year opened by the anchor event of `anchorYear`: month 1 begins
 * at the first new moon after that event and the year holds every new moon
 * before the first one after the next year's anchor, twelve or thirteen as
 * the sky gives. Null outside the table.
 */
export function lunarYearOf(anchorYear: number, anchor: YearAnchor): LunarYear | null {
  const a0 = anchorInstant(anchorYear, anchor);
  const a1 = anchorInstant(anchorYear + 1, anchor);
  if (!a0 || !a1) return null;
  const startIdx = lastAtOrBefore(NEW_MOONS_MS, a0.getTime()) + 1;
  const endIdx = lastAtOrBefore(NEW_MOONS_MS, a1.getTime()) + 1;
  if (startIdx >= NEW_MOONS_MS.length || endIdx >= NEW_MOONS_MS.length) return null;
  const months: LunarMonth[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    months.push({
      index: i - startIdx + 1,
      startsAt: new Date(NEW_MOONS_MS[i]),
      endsAt: new Date(NEW_MOONS_MS[i + 1]),
      cycleNumber: cycleNumberOfInstant(NEW_MOONS_MS[i]),
    });
  }
  return {
    anchorYear,
    anchorAt: a0,
    startsAt: new Date(NEW_MOONS_MS[startIdx]),
    endsAt: new Date(NEW_MOONS_MS[endIdx]),
    months,
  };
}

/** The lunar year containing `date`, or null outside the table. */
export function lunarYearFor(date: Date, anchor: YearAnchor): LunarYear | null {
  const t = date.getTime();
  const c = civilDate(date, "UTC");
  // The year opened by this Gregorian year's anchor, or the one before it.
  for (const y of [c.year, c.year - 1, c.year - 2]) {
    const ly = lunarYearOf(y, anchor);
    if (ly && ly.startsAt.getTime() <= t && t < ly.endsAt.getTime()) return ly;
  }
  return null;
}

export interface LunarPosition {
  month: LunarMonth;
  /** Twelve or thirteen: how many moons this lunar year holds. */
  monthCount: number;
  /** 1-based day of the lunar month, counted in civil days of the zone. */
  day: number;
  /** Civil days the lunar month spans in the zone (29 or 30). */
  length: number;
  year: LunarYear;
}

/** Where `date` sits in the village's lunar year, in the village zone. */
export function lunarPositionFor(date: Date, anchor: YearAnchor, timeZone: string): LunarPosition | null {
  const year = lunarYearFor(date, anchor);
  if (!year) return null;
  const t = date.getTime();
  const month = year.months.find((m) => m.startsAt.getTime() <= t && t < m.endsAt.getTime());
  if (!month) return null;
  return {
    month,
    monthCount: year.months.length,
    day: civilDaysBetween(month.startsAt, date, timeZone) + 1,
    length: civilDaysBetween(month.startsAt, month.endsAt, timeZone),
    year,
  };
}
