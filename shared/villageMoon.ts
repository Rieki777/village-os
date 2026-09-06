/**
 * EVERY VILLAGE COUNTS ITS OWN MOONS, AND THE COUNT IS NEVER STORED.
 *
 * A village's first moon is Moon 1, the next is Moon 2, and the count runs on
 * from there for as long as the village does. That ordinal is what a member
 * reads. It is NOT what the database holds.
 *
 * ── WHY THE ORDINAL IS PRESENTATION AND CAN NEVER BECOME STORAGE ────────────
 *
 * `server/lib/gratitude-cycles.ts` carries the reason at length, and it cost a
 * village real money. Two spellings of the same lunation once shared one
 * `cycle_id` column: `moon-329` beside `lunar-000329`. A member's spending was
 * counted against both halves, and a settlement that only matched `lunar-`
 * read 100 of 130 units and reported the missing 30 to nobody.
 *
 * So the absolute lunation number stays the one storage key forever. This file
 * holds a MAPPING computed on read: ordinal = cycleNumber - moonOneCycle + 1.
 * Nothing here is ever written to a column, an idempotency key or an id. That
 * is also what makes the anchor safely movable: a founder who shifts Moon 1
 * changes what the labels say and touches no stored row at all.
 *
 * ── THE THREE STANDINGS, AND WHY THERE ARE THREE ────────────────────────────
 *
 * A count needs a beginning, and a village does not always have one yet. Two
 * of the three states here exist because the honest answer to "which moon is
 * this" is sometimes "this village is not counting yet" and sometimes "this
 * one came before the count started". Neither of those is Moon 0, and neither
 * of them is a negative number. A surface that printed either would be stating
 * a fact about the village that is not true.
 *
 *   counted     the ordinal is 1 or more; the village has a moon number
 *   before      the village has a Moon 1 and this lunation precedes it
 *   unanchored  the village has no first moon yet, so there is no count
 *
 * ── NO LUNAR TABLE IN HERE, DELIBERATELY ────────────────────────────────────
 *
 * This module does arithmetic on a cycle number and formats two instants. It
 * imports nothing, `shared/lunar.ts` included, so the client pays no bundle
 * for the 383 new moons it does not need on a profile page. The sky lives in
 * `shared/lunar.ts` and the anchor lives in `server/lib/villageMoon.ts`; both
 * hand this file numbers that are already resolved.
 */

/** Which of the three states a lunation is in for this village. */
export type MoonStanding = "counted" | "before" | "unanchored";

export interface VillageMoon {
  /**
   * This village's own count, 1-based. Null whenever there is no honest
   * number: `standing` says which of the two reasons applies.
   */
  ordinal: number | null;
  standing: MoonStanding;
  /**
   * The absolute lunation number, which is the storage key. Carried so a
   * support conversation and an admin screen can still name a row. Never
   * printed to a member by anything in this file.
   */
  cycleNumber: number;
  /** ISO instant the lunation opens (a new moon). */
  startsAt: string;
  /** ISO instant it closes (the next new moon). */
  endsAt: string;
  /**
   * The full moon inside the window, when one is known. A DISPLAY LANDMARK
   * only: cycle boundaries stay new moon to new moon and nothing settles on
   * this instant. Null when the caller had no table to read it from.
   */
  fullMoonAt: string | null;
}

/**
 * The ordinal, or null when there is not one.
 *
 * `moonOneCycle` is the absolute lunation number the village calls Moon 1.
 * Null means the village has no first moon yet.
 */
export function villageMoonOrdinal(cycleNumber: number, moonOneCycle: number | null): number | null {
  if (moonOneCycle === null || !Number.isFinite(moonOneCycle) || !Number.isFinite(cycleNumber)) return null;
  const ordinal = Math.trunc(cycleNumber) - Math.trunc(moonOneCycle) + 1;
  return ordinal >= 1 ? ordinal : null;
}

/** Which standing a lunation is in, from the same two numbers. */
export function moonStanding(cycleNumber: number, moonOneCycle: number | null): MoonStanding {
  if (moonOneCycle === null || !Number.isFinite(moonOneCycle) || !Number.isFinite(cycleNumber)) return "unanchored";
  return villageMoonOrdinal(cycleNumber, moonOneCycle) === null ? "before" : "counted";
}

/** Assemble one presentable moon from parts a caller already holds. */
export function villageMoon(input: {
  cycleNumber: number;
  moonOneCycle: number | null;
  startsAt: Date | string;
  endsAt: Date | string;
  fullMoonAt?: Date | string | null;
}): VillageMoon {
  // `toISOString` THROWS on an invalid Date, and this runs on display paths.
  // A cycle number far enough out of range overflows the Date epoch, which is
  // reachable from a corrupt stored id, and a label is never worth a 500.
  const iso = (v: Date | string | null | undefined): string => {
    if (!(v instanceof Date)) return String(v ?? "");
    return Number.isFinite(v.getTime()) ? v.toISOString() : "";
  };
  return {
    ordinal: villageMoonOrdinal(input.cycleNumber, input.moonOneCycle),
    standing: moonStanding(input.cycleNumber, input.moonOneCycle),
    cycleNumber: input.cycleNumber,
    startsAt: iso(input.startsAt),
    endsAt: iso(input.endsAt),
    fullMoonAt: input.fullMoonAt ? iso(input.fullMoonAt) : null,
  };
}

// ── The words ───────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Formatted IN UTC, on purpose, and hand-rolled rather than left to Intl.
 *
 * A moon window is one fact about the whole village, so two members in two
 * time zones have to read the same range or they will disagree about which
 * days a moon covered. And `Intl` short month names vary with the runtime's
 * ICU build, which would make the same village read differently in a browser
 * and in a test. Twelve strings settle both.
 */
function dayMonth(t: number): { day: number; month: string; year: number } {
  const d = new Date(t);
  return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
}

/**
 * "12 Mar to 10 Apr 2026", and "12 Dec 2025 to 10 Jan 2026" across a new year.
 *
 * The year is always printed once. These ranges sit in lists that reach years
 * back and, on the launch dry run, two years forward, and a range with no year
 * in such a list is a date the reader has to guess at.
 *
 * Returns an empty string for an instant this cannot read, so a label degrades
 * to the part it does know rather than printing "Invalid Date" at a member.
 */
export function formatMoonWindow(startsAt: Date | string, endsAt: Date | string): string {
  const a = new Date(startsAt).getTime();
  const b = new Date(endsAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const from = dayMonth(a);
  // THE LAST INSTANT INSIDE, never the boundary. A lunation is half open: it
  // ends AT the next new moon. Reading the end instant directly would hand a
  // moon closing at midnight a whole day belonging to the next one, while a
  // moon closing at 11:52 does own that morning and keeps the date.
  const to = dayMonth(b - 1);
  const head = from.year === to.year ? `${from.day} ${from.month}` : `${from.day} ${from.month} ${from.year}`;
  return `${head} to ${to.day} ${to.month} ${to.year}`;
}

/**
 * THE COUNT ON ITS OWN, and the one place the three standings become words.
 *
 * "Moon 47" when there is a count, "Before Moon 1" for a lunation earlier than
 * the anchor, and NOTHING AT ALL for a village that has not set one. That
 * empty string is the point of the function: a surface with no count prints no
 * moon number instead of "Moon 0" or a negative, and every caller composes
 * around whatever it gets back.
 *
 * Keyed by the standing union rather than typed `Record<string, string>`, so
 * a fourth standing added later is a compile error here instead of an empty
 * span on somebody's profile.
 */
export function moonOrdinalWords(standing: MoonStanding, ordinal: number | null): string {
  const forms: Record<MoonStanding, () => string> = {
    counted: () => `Moon ${ordinal}`,
    before: () => "Before Moon 1",
    unanchored: () => "",
  };
  return forms[standing]();
}

/**
 * The same words, for a caller holding a lunation number and the anchor.
 *
 * This is what the calendar surfaces call. They know which lunation a day
 * falls in (`shared/lunar.ts` hands them `cycleNumber` on every month) and
 * they are handed the anchor once with their payload, so they never assemble
 * a whole `VillageMoon` just to print four characters.
 */
export function moonCountLabel(cycleNumber: number, moonOneCycle: number | null): string {
  return moonOrdinalWords(
    moonStanding(cycleNumber, moonOneCycle),
    villageMoonOrdinal(cycleNumber, moonOneCycle),
  );
}

/**
 * The short label, the one that replaces every cycle id a member used to see.
 *
 * The count comes from `moonOrdinalWords` and is never spelled out again here:
 * two functions deciding what an unanchored village reads is two functions
 * that can disagree about it.
 */
export function villageMoonLabel(moon: VillageMoon | null | undefined): string {
  if (!moon) return "";
  const window = formatMoonWindow(moon.startsAt, moon.endsAt);
  return [moonOrdinalWords(moon.standing, moon.ordinal), window].filter(Boolean).join(", ");
}

/**
 * The same three states as a whole sentence, for the surfaces with room to
 * say what is going on rather than only which moon it is.
 */
export function villageMoonSentence(moon: VillageMoon | null | undefined): string {
  if (!moon) return "";
  const window = formatMoonWindow(moon.startsAt, moon.endsAt);
  const runs = window ? `This moon runs ${window}.` : "";
  const forms: Record<MoonStanding, () => string> = {
    counted: () => (window ? `This is Moon ${moon.ordinal}, ${window}.` : `This is Moon ${moon.ordinal}.`),
    before: () => `${runs} It falls before this village's Moon 1.`.trim(),
    unanchored: () => `${runs} This village has not set the moon it counts from yet.`.trim(),
  };
  return forms[moon.standing]();
}

// ── Reading the anchor a founder typed ──────────────────────────────────────

/**
 * A date a founder may have typed into the first-moon override, or null.
 *
 * Accepts a plain civil date (`2026-03-19`, read as midnight UTC) and a full
 * ISO instant, and nothing else. Blank means "no override", which is the
 * ordinary state of every village that has not moved its first moon.
 *
 * An unreadable value is NOT quietly treated as blank by the caller. See
 * `server/lib/villageMoon.ts`: falling back to the launch instant would print
 * numbers that are wrong by an unknown amount, and the whole point of this
 * mapping is that it never does that.
 */
export function parseAnchorDate(raw: string | null | undefined): Date | null {
  const value = String(raw ?? "").trim();
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return null;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(at.getTime()) ? at : null;
}

/**
 * Is this a value the override will accept? Blank counts, because blank is how
 * a village goes back to its launch instant. Shared with the variables
 * registry so Admin refuses a typo in the same words the server would.
 */
export function isAnchorDateAcceptable(raw: string): boolean {
  return String(raw ?? "").trim() === "" || parseAnchorDate(raw) !== null;
}
