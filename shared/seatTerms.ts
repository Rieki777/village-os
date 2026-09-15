/**
 * EVERY SEAT HAS A TERM, AND BY DEFAULT IT ENDS WITH THE SEASON.
 *
 * Rye, 2026-09-13: "no seat may enter with an indefinite time. We can let
 * communities set whatever time they want ... but we caution anything that's
 * set for more than 4 seasons or 13 lunar cycles (whatever pattern they're
 * using)."
 *
 * Rye, 2026-09-14: "By default seats should end with the ending of a season
 * unless a date is added otherwise ... this includes stewards where all seats
 * are reset each season at a max but could often be set for shorter
 * durations. And we have a seasonal schedule set up and need to make sure
 * these are talking."
 *
 * Read as three rules, and this module is the one place each is decided:
 *
 *   1. A seat with no date asked ends when the running season ends.
 *   2. A seat that carries the steward veto ends with the season AT THE
 *      LATEST. Any earlier date is fine.
 *   3. Any other seat may run as long as the village likes. Past four seasons
 *      of the village's own schedule, or past thirteen moons when the schedule
 *      does not reach that far, the seat carries a CAUTION. A caution rides
 *      the ballot and never blocks, which is the standing rule for every
 *      warning in this Game.
 *
 * ── WHY A SEASON-SHAPED TERM IS SAFE NOW, WHEN THE AUDIT SAID IT WAS NOT ────
 *
 * The audit of 2026-09-03 found that a term hung on the season list is a term
 * that never comes due, because a season can be open-ended and the list can
 * simply run out. That finding still holds, and it shapes everything here:
 *
 *   - The season's end is RESOLVED TO AN INSTANT when the seat is made, and
 *     the instant is what gets stored. A seat never reads "until the season
 *     ends" at the moment the capability gate asks.
 *   - An open-ended season, or no running season, is a REFUSAL with a
 *     sentence, never a null term. There is no path through this module that
 *     produces a seat with no end.
 *   - "Talking" is a restamp: when an admin moves a season's end, every seat
 *     that follows that season is rewritten to the new instant
 *     (`restampsFor`). A season that becomes open-ended, or is deleted, leaves
 *     its seats on the last date they had, so editing the calendar can shorten
 *     or move a term but can never make one indefinite.
 *
 * Pure. The caller hands in the calendar and the clock.
 */
import { cycleBoundsFor, cycleStartMs, zonedTimeToUtc } from "./lunar";

/** Past this many seasons of the village's schedule, a seat carries a caution. */
export const CAUTION_SEASONS = 4;
/** Past this many moons, when the schedule does not reach four seasons ahead. */
export const CAUTION_MOONS = 13;

export interface CalendarSeason {
  id: string;
  startsOn: string;
  /** Civil date, exclusive: the day the season turns. Empty means open-ended. */
  endsOn?: string | null;
}

export interface SeatCalendar {
  seasons: readonly CalendarSeason[];
  currentSeasonId: string | null;
  timezone: string;
}

/**
 * The first moment of a civil date where the village lives, or null.
 *
 * The same instant `seasonEndInstant` in server/lib/governanceWindows.ts gives a
 * season's end, so a seat that ends "on the day the season turns" ends at the
 * same moment the season does. This one also refuses a date the calendar does
 * not have (2027-02-30), because a seat is written from a form and a season is
 * not.
 */
export function civilDateInstant(date: unknown, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return zonedTimeToUtc(y, mo, d, 0, 0, timezone || "UTC");
}

/**
 * Where the caution starts, measured the way the village measures time.
 *
 * The schedule wins when it reaches far enough: the end of the fourth season,
 * counting the running one as the first. A village that has only written the
 * next season or two is measured in moons instead, which is the other pattern
 * Rye named. Thirteen moons is the start of the thirteenth cycle from now, the
 * same boundary arithmetic `termEndsAtFromCycles` uses.
 */
export function cautionLine(calendar: SeatCalendar, now: Date): { at: Date; measure: "seasons" | "moons" } {
  const tz = calendar.timezone || "UTC";
  const sorted = calendar.seasons
    .filter((s) => s.startsOn)
    .slice()
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const i = sorted.findIndex((s) => s.id === calendar.currentSeasonId);
  if (i >= 0) {
    const fourth = sorted[i + CAUTION_SEASONS - 1];
    const at = fourth ? civilDateInstant(fourth.endsOn, tz) : null;
    if (at) return { at, measure: "seasons" };
  }
  const here = cycleBoundsFor(now);
  return { at: new Date(Math.ceil(cycleStartMs(here.cycleNumber + CAUTION_MOONS))), measure: "moons" };
}

export interface SeatTermAsk {
  /** A civil date (YYYY-MM-DD). Absent or empty means "with the season". */
  requestedEndsOn?: unknown;
  calendar: SeatCalendar;
  /** True for a seat that carries the steward veto. */
  capAtSeasonEnd: boolean;
  now: Date;
  /**
   * The earliest the seat can actually start. A vote lands days after it
   * opens, and a seat that would end before it lands is a seat nobody sits in.
   */
  startsNoEarlierThan?: Date | null;
}

export type SeatTermRefusal =
  | "unreadable_date"
  | "no_season"
  | "no_next_season"
  | "open_ended_season"
  | "past_season_end"
  | "already_over"
  | "ends_before_it_starts";

export type SeatTerm =
  | {
      ok: true;
      endsAt: Date;
      /** The civil date the seat ends on, in the village's zone. */
      endsOn: string;
      /** The season running when the seat was asked for, or null. */
      seasonId: string | null;
      /** True when this seat moves if an admin moves the season's end. */
      followsSeason: boolean;
      /** One sentence for the ballot and the form, or null. Never blocks. */
      caution: string | null;
    }
  | { ok: false; code: SeatTermRefusal; error: string };

/**
 * THE SEASON THE SEAT WILL ACTUALLY SIT IN.
 *
 * A seat vote cannot seat anybody before it lands, and a vote opened in the
 * last vote-length of a season lands after that season has turned. Measured
 * against the running season, its default end falls on or before the day it
 * starts and every such vote refuses; for a steward, whose seat is capped at
 * the season's end, no vote could open at all. Main went red on exactly this
 * on 2026-09-15, one week before a derived season turned, and it recurs every
 * season, so it is a rule and never a fixture.
 *
 * So when the running season ends at or before the seat could start, the seat
 * is measured against the season it starts in: the first scheduled season,
 * dated and ended, whose end is after the start. Null when nothing is
 * scheduled after the running season, which the caller refuses in words.
 */
function seasonTheSeatStartsIn(
  calendar: SeatCalendar,
  running: CalendarSeason | null,
  starts: Date | null,
): { season: CalendarSeason | null; rolledOver: boolean } {
  if (!running || !starts) return { season: running, rolledOver: false };
  const tz = calendar.timezone || "UTC";
  const runningEnd = running.endsOn ? civilDateInstant(running.endsOn, tz) : null;
  if (!runningEnd || runningEnd.getTime() > starts.getTime()) return { season: running, rolledOver: false };
  const next = calendar.seasons
    .map((s) => ({ s, from: civilDateInstant(s.startsOn, tz), to: civilDateInstant(s.endsOn, tz) }))
    .filter((x) => x.from && x.to && x.from.getTime() >= runningEnd.getTime() && x.to.getTime() > starts.getTime())
    .sort((a, b) => a.from!.getTime() - b.from!.getTime())[0];
  return { season: next?.s ?? null, rolledOver: true };
}

/** Decide a seat's term. See the header for the three rules. */
export function resolveSeatTerm(ask: SeatTermAsk): SeatTerm {
  const { calendar, capAtSeasonEnd, now } = ask;
  const tz = calendar.timezone || "UTC";
  const running = calendar.currentSeasonId
    ? calendar.seasons.find((s) => s.id === calendar.currentSeasonId) ?? null
    : null;
  const { season: current, rolledOver } = seasonTheSeatStartsIn(calendar, running, ask.startsNoEarlierThan ?? null);
  const seasonEndsOn = current?.endsOn ? String(current.endsOn).trim() : "";
  const seasonEnd = seasonEndsOn ? civilDateInstant(seasonEndsOn, tz) : null;

  const raw = String(ask.requestedEndsOn ?? "").trim();
  const asked = raw !== "";

  let endsAt: Date | null = null;
  let endsOn = "";
  if (asked) {
    endsAt = civilDateInstant(raw, tz);
    if (!endsAt) {
      return {
        ok: false,
        code: "unreadable_date",
        error: "That end date could not be read. Send a date like 2027-03-21, or leave it out and the seat ends with the season.",
      };
    }
    endsOn = raw;
  }

  // A season end is needed whenever nothing was asked, and always for a
  // steward, whose seat can never outlast the season it was given in.
  if (!asked || capAtSeasonEnd) {
    if (!current && rolledOver) {
      return {
        ok: false,
        code: "no_next_season",
        error: capAtSeasonEnd
          ? "A steward's seat ends with the season at the latest, and this season ends before the vote could land with no next season set. Add the next season in Admin first."
          : "This season ends before the vote could land, and no next season is set, so there is no season end for this seat to end with. Add the next season in Admin, or give the seat its own end date.",
      };
    }
    if (!current) {
      return {
        ok: false,
        code: "no_season",
        error: capAtSeasonEnd
          ? "A steward's seat ends with the season at the latest, and no season is running. Start the next season in Admin first."
          : "No season is running, so there is no season end for this seat to end with. Start the next season in Admin, or give the seat its own end date.",
      };
    }
    if (!seasonEnd) {
      return {
        ok: false,
        code: "open_ended_season",
        error: capAtSeasonEnd
          ? "A steward's seat ends with the season at the latest, and the running season has no end date. Give the season an end date in Admin first."
          : "The running season has no end date, so there is no season end for this seat to end with. Give the season an end date in Admin, or give the seat its own end date.",
      };
    }
  }

  if (!asked) {
    endsAt = seasonEnd;
    endsOn = seasonEndsOn;
  }
  const end = endsAt as Date;

  if (capAtSeasonEnd && seasonEnd && end.getTime() > seasonEnd.getTime()) {
    return {
      ok: false,
      code: "past_season_end",
      error: `A steward's seat ends with the season at the latest. This season ends on ${seasonEndsOn}, so pick that date or an earlier one.`,
    };
  }
  if (end.getTime() <= now.getTime()) {
    return { ok: false, code: "already_over", error: "That end date has already passed. Pick a date after today." };
  }
  const starts = ask.startsNoEarlierThan ?? null;
  if (starts && end.getTime() <= starts.getTime()) {
    return {
      ok: false,
      code: "ends_before_it_starts",
      error: `This seat would end on ${endsOn}, before the vote could seat anybody (the earliest it can land is ${starts.toISOString().slice(0, 10)}). Pick a later end date.`,
    };
  }

  const line = cautionLine(calendar, now);
  const caution =
    end.getTime() > line.at.getTime()
      ? line.measure === "seasons"
        ? `This seat runs until ${endsOn}, past the end of the fourth season from now. Seats usually come back to the village every season, so make sure this length is intended.`
        : `This seat runs until ${endsOn}, more than thirteen moons from now. Seats usually come back to the village every season, so make sure this length is intended.`
      : null;

  return {
    ok: true,
    endsAt: end,
    endsOn,
    seasonId: current?.id ?? null,
    followsSeason: !!seasonEnd && end.getTime() === seasonEnd.getTime(),
    caution,
  };
}

export interface FollowingHolding {
  id: string;
  seasonId: string | null;
  termEndsAt: Date | string | null;
  followsSeason: boolean;
}

export interface Restamp {
  id: string;
  from: Date;
  to: Date;
}

/**
 * The seats an edit to the calendar moves.
 *
 * Only a seat that FOLLOWS its season moves, and only while it is still
 * running: a term that has already ended stays ended, so an admin tidying last
 * year's dates cannot quietly hand anybody their powers back. A season that is
 * now open-ended or gone moves nothing, and its seats keep the last date they
 * had.
 *
 * Moving a season LATER lengthens the seats that follow it, stewards included.
 * That is the rule as ruled, and the caller tells every holder it moves.
 */
export function restampsFor(holdings: readonly FollowingHolding[], calendar: SeatCalendar, now: Date): Restamp[] {
  const tz = calendar.timezone || "UTC";
  const out: Restamp[] = [];
  for (const h of holdings) {
    if (!h.followsSeason || !h.seasonId || !h.termEndsAt) continue;
    const from = h.termEndsAt instanceof Date ? h.termEndsAt : new Date(String(h.termEndsAt));
    if (Number.isNaN(from.getTime()) || from.getTime() <= now.getTime()) continue;
    const season = calendar.seasons.find((s) => s.id === h.seasonId);
    if (!season?.endsOn) continue;
    const to = civilDateInstant(season.endsOn, tz);
    if (!to || to.getTime() === from.getTime()) continue;
    out.push({ id: h.id, from, to });
  }
  return out;
}
