/**
 * THE PLAYER CARD'S HERO AND ITS MOON TRACK, for the view model
 * (`shared/playerCard.ts`), from the approved design
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22: "When I
 * okay a design that is the design we ship").
 *
 * The hero reads, top to bottom:
 *
 *   the moon pill    "October Moon · Day 22 of 92": the moon named by the
 *                    month its new moon falls in, in the village's zone, and
 *                    the day of the owner's adopted term, or of the season
 *                    when no adopted term covers today;
 *   the eyebrow      "Riverbend · Season of Foundations";
 *   the tagline      "Three roles in the Community Anchor · Full-time";
 *   the span         "1 October to 31 December 2026", the same term or season.
 *
 * MOONS ARE NAMED HERE, ON PURPOSE. The model used to date every moon and
 * name none (the CycleClock ruling). The design Rye approved names them by
 * month ("October Moon"), and the card ships the design, so a moon's DATES
 * stay in its label and its NAME is its title. Nothing else in the product
 * changes how it speaks of moons.
 *
 * THE TIME on the tagline is read from the roles' own time chips
 * (`timeCommitment`, CCOS Time Commitment), never guessed: "Full-time" when a
 * chip says full time ("Part of a full-time season" does), "About N hours a
 * week" when every chip reads as hours (`hoursAWeek`, the load check's
 * reader), the chip's own words when every role says the same thing, and
 * nothing at all otherwise.
 *
 * Pure: the clock is `input.now`, the zone is `input.timeZone`.
 */
import { LUNAR_CLOCK } from "./cycleClock";
import { civilDate, civilDaysBetween, fullMoonsBetween, newMoonsBetween, zonedTimeToUtc } from "./lunar";
import { CARD_WORDS as W } from "./playerCardWords";
import { FULL_SEASON_HOURS, hoursAWeek } from "./roleProposalLoad";
import { formatDay, joinList, type Read } from "./roleSheet";

/** A number and the field it came from, as the model's `Figure`. */
interface Figure {
  n: number;
  source: string;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"] as const;

/** "Three", or "13" past twelve. Capitalised: it starts the tagline. */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

const clean = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A civil date ("2026-12-31") or an instant, as the instant it names in the zone. */
function instantOf(iso: string | null | undefined, timeZone: string): Date | null {
  const s = clean(iso);
  if (!s) return null;
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (civil) return zonedTimeToUtc(Number(civil[1]), Number(civil[2]), Number(civil[3]), 0, 0, timeZone);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

/** "October Moon": the moon a new moon starts, named by the month it falls in, in the zone. */
export function moonNameOf(newMoon: Date, timeZone: string): string {
  return W.moonName(MONTH_NAMES[civilDate(newMoon, timeZone).month - 1] ?? "");
}

/** "October Moon, 10 Oct to 8 Nov": the moon `now` sits in, for this moon's tasks. */
export function moonLineOf(now: Date, timeZone: string): string {
  const b = LUNAR_CLOCK.boundsFor(now);
  const last = new Date(b.endsAt.getTime() - 1);
  return W.moonLine(moonNameOf(b.startsAt, timeZone), formatDay(b.startsAt.toISOString(), false, timeZone) ?? "", formatDay(last.toISOString(), false, timeZone) ?? "");
}

/** "1 October to 31 December 2026": the year once when both ends share it. */
export function spanWords(start: Date, end: Date, timeZone: string): string {
  const a = civilDate(start, timeZone);
  const b = civilDate(end, timeZone);
  const day = (c: { year: number; month: number; day: number }, year: boolean) =>
    `${c.day} ${MONTH_NAMES[c.month - 1]}${year ? ` ${c.year}` : ""}`;
  return W.heroSpan(day(a, a.year !== b.year), day(b, true));
}

// ── Inputs: only what the hero reads ───────────────────────────────────────

export interface HeroRoleIn {
  name: string;
  circle: Read<{ id: string; name: string } | null>;
  timeCommitment?: Read<string | null>;
}

export interface HeroApplicationIn {
  candidate_user_id: string;
  status: string;
  decided_at: string | null;
  starts_at: string | null;
  term_ends_at: string | null;
}

export interface HeroIn {
  now: Date;
  timeZone: string;
  ownerUserId: string;
  villageName: Read<string | null>;
  season: Read<{ name: string | null; startsOn: string | null; endsOn: string | null } | null>;
  roles: Read<HeroRoleIn[]>;
  applications: Read<HeroApplicationIn[]>;
  proposal: boolean;
}

export interface HeroOut {
  /** "Riverbend · Season of Foundations"; empty when neither was read. */
  eyebrow: string;
  /** "Three roles in the Community Anchor · Full-time". Empty while the roles are unread. */
  tagline: string;
  /** "1 October to 31 December 2026", or null with no term and no season. */
  span: string | null;
  /** The pill under the portrait. Always shown: with no term and no season it is the moon's name alone. */
  moon: { words: string; name: string; day: Figure | null; of: Figure | null; over: "term" | "season" | null };
}

/**
 * The owner's adopted term that covers today: from the earliest adopted
 * application's start to the latest end, or null when none covers today.
 * A term with no end of its own runs to the season's end.
 */
function adoptedTerm(input: HeroIn, seasonEnd: Date | null): { start: Date; end: Date } | null {
  const now = input.now.getTime();
  const spans = (input.applications ?? [])
    .filter((a) => a.candidate_user_id === input.ownerUserId && a.status === "adopted")
    .map((a) => {
      const start = instantOf(a.starts_at ?? a.decided_at, input.timeZone);
      const end = instantOf(a.term_ends_at, input.timeZone) ?? seasonEnd;
      return start && end && start.getTime() <= now && now < end.getTime() + 86_400_000 ? { start, end } : null;
    })
    .filter((s): s is { start: Date; end: Date } => s !== null);
  if (!spans.length) return null;
  return {
    start: new Date(Math.min(...spans.map((s) => s.start.getTime()))),
    end: new Date(Math.max(...spans.map((s) => s.end.getTime()))),
  };
}

/** The time words on the tagline, from the roles' own time chips. Null when they say nothing usable. */
export function personTime(roles: readonly HeroRoleIn[]): string | null {
  const words = roles.map((r) => clean(r.timeCommitment ?? null)).filter((w): w is string => w !== null);
  if (!words.length) return null;
  if (words.some((w) => /\bfull[- ]?time\b/i.test(w))) return W.fullTime;
  if (words.length === roles.length) {
    const hours = words.map(hoursAWeek);
    if (hours.every((h): h is number => h !== null && Number.isFinite(h))) {
      const sum = Math.round(hours.reduce((n, h) => n + h, 0));
      return sum >= FULL_SEASON_HOURS ? W.fullTime : W.aboutHours(sum);
    }
    const distinct = new Set(words.map((w) => w.toLowerCase()));
    if (distinct.size === 1) return words[0];
  }
  return null;
}

/** "the Community Anchor", "the Land and the Water circles"... each circle once, in role order. */
function circlesPhrase(roles: readonly HeroRoleIn[]): string | null {
  const names: string[] = [];
  for (const r of roles) {
    const n = clean(r.circle?.name ?? null);
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return null;
  return joinList(names.map((n) => (/^the\s/i.test(n) ? n : `the ${n}`)));
}

export function heroOf(input: HeroIn): HeroOut {
  const tz = input.timeZone;
  const season = input.season ?? null;
  const seasonStart = season ? instantOf(season.startsOn, tz) : null;
  // A season's `endsOn` is the day the NEXT one starts (`seasonState` runs a
  // season while `today < endsOn`), so its last day is the day before.
  const seasonEndsAt = season ? instantOf(season.endsOn, tz) : null;
  const seasonEnd = seasonEndsAt ? new Date(seasonEndsAt.getTime() - 1) : null;

  const eyebrow = [clean(input.villageName ?? null), clean(season?.name ?? null)].filter((s): s is string => s !== null).join(" · ");

  const roles = input.roles;
  let tagline = "";
  if (roles !== undefined) {
    if (!roles.length) tagline = W.holdsNoRoles;
    else {
      const count = input.proposal ? countWord(roles.length).toLowerCase() : countWord(roles.length);
      tagline = W.tagline(count, roles.length, circlesPhrase(roles), personTime(roles), input.proposal);
    }
  }

  const term = input.proposal ? null : adoptedTerm(input, seasonEnd);
  const span = term ? { ...term, over: "term" as const } : seasonStart && seasonEnd ? { start: seasonStart, end: seasonEnd, over: "season" as const } : null;
  const name = moonNameOf(LUNAR_CLOCK.boundsFor(input.now).startsAt, tz);
  let moon: HeroOut["moon"] = { words: name, name, day: null, of: null, over: null };
  // A day is counted only inside the span (E9): a proposal card drawn in a
  // season not begun, or one since ended, names today's moon alone rather
  // than "Day 1" of a season nobody is in.
  // A term runs through its last day, as `adoptedTerm` reads it; a season's
  // end is already the last instant before the next one starts.
  const nowMs = input.now.getTime();
  const inside = !!span && nowMs >= span.start.getTime() && nowMs < span.end.getTime() + (span.over === "term" ? 86_400_000 : 1);
  if (span && inside && span.end.getTime() >= span.start.getTime()) {
    const of = civilDaysBetween(span.start, span.end, tz) + 1;
    const d = Math.min(of, Math.max(1, civilDaysBetween(span.start, input.now, tz) + 1));
    const source = span.over === "term" ? "applications.starts_at, applications.term_ends_at" : "season.startsOn, season.endsOn";
    moon = { words: W.moonPill(name, d, of), name, day: { n: d, source }, of: { n: of, source }, over: span.over };
  }
  return { eyebrow, tagline, span: span ? spanWords(span.start, span.end, tz) : null, moon };
}

// ── The moon track ─────────────────────────────────────────────────────────

export type TrackMarkKind = "new" | "full" | "invoice";

export interface TrackOut {
  /** "1 Oct", the first day the track draws. */
  startLabel: string;
  /** "7 Jan", the last day of the last moon. */
  endLabel: string;
  /** Where each marker sits along the track, 0 to 100, one decimal. */
  marks: { kind: TrackMarkKind; at: string; pct: number }[];
  /** Today along the track, 0 to 100, or null when today is off it. */
  today: number | null;
  /** Which kinds the legend names: only what the track draws. */
  kinds: TrackMarkKind[];
}

const pctOf = (t: number, from: number, to: number) => Math.round(((t - from) / (to - from)) * 1000) / 10;

/**
 * The track under "My moon cycle": the season's span, from the first moon's
 * first day to the last moon's last day, with its new and full moons, any
 * invoice the terms set, and today. Null when there is nothing to draw.
 */
export function trackOf(
  spans: ReadonlyArray<{ start: Date; end: Date }>,
  invoices: readonly string[],
  now: Date,
  timeZone: string,
): TrackOut | null {
  if (!spans.length) return null;
  const from = spans[0].start.getTime();
  const to = spans[spans.length - 1].end.getTime();
  if (!(to > from)) return null;
  const marks: TrackOut["marks"] = [];
  const add = (kind: TrackMarkKind, t: number) => {
    if (t < from || t > to) return;
    marks.push({ kind, at: new Date(t).toISOString(), pct: pctOf(t, from, to) });
  };
  for (const d of newMoonsBetween(new Date(from), new Date(to + 1))) add("new", d.getTime());
  for (const d of fullMoonsBetween(new Date(from), new Date(to))) add("full", d.getTime());
  for (const iso of invoices) {
    const t = new Date(iso).getTime();
    if (!Number.isNaN(t)) add("invoice", t);
  }
  const t = now.getTime();
  const kinds = (["new", "full", "invoice"] as const).filter((k) => marks.some((m) => m.kind === k));
  return {
    startLabel: formatDay(new Date(from).toISOString(), false, timeZone) ?? "",
    endLabel: formatDay(new Date(to - 1).toISOString(), false, timeZone) ?? "",
    marks,
    today: t >= from && t <= to ? pctOf(t, from, to) : null,
    kinds,
  };
}
