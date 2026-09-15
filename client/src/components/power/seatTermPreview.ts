/**
 * WHAT A SEAT'S TERM WILL BE, SAID BEFORE ANYBODY PRESSES THE BUTTON.
 *
 * Rye, 2026-09-14: "we need to have the UI created when applying for a seat to
 * have the end date." The server decides every seat's term with
 * `resolveSeatTerm` (shared/seatTerms.ts). This runs that same function in the
 * browser, against the same season list `GET /api/season` serves, so the
 * sentence under a date picker is the rule itself and never a copy of it that
 * can drift from the route.
 *
 * The server still decides. A preview is a forecast made a moment before the
 * write, and when the two disagree (a season edited in another tab, a vote
 * that lands later than the date allows) the route's own refusal is what the
 * form shows.
 *
 * A SEAT VOTE STARTS WHEN IT LANDS. `POST /api/governance/role-seats` measures
 * the term from the instant the vote would land (`seatVoteLandsAt`,
 * server/lib/seatTermLanding.ts), which can be a whole cycle after it closes,
 * and `GET /api/season` carries that same forecast. A form that opens a seat
 * vote passes it here; a form that seats somebody now passes nothing.
 *
 * Pure. The caller hands in the season payload and the clock.
 */
import { civilDateKey } from "@shared/lunar";
import { resolveSeatTerm, type CalendarSeason, type SeatCalendar } from "@shared/seatTerms";

/** The parts of `GET /api/season` a term is decided against. */
export interface SeasonPayload {
  current?: { id: string; endsOn?: string | null } | null;
  seasons?: readonly CalendarSeason[] | null;
  timezone?: string | null;
  /** The village's civil date today, in its own zone. */
  today?: string | null;
  /** When a seat vote opened now would land, as the server forecasts it. */
  seatVoteLandsAt?: string | null;
}

export function calendarFrom(season: SeasonPayload): SeatCalendar {
  return {
    seasons: season.seasons ?? [],
    currentSeasonId: season.current?.id ?? null,
    timezone: season.timezone || "UTC",
  };
}

/** The instant a seat starts: the forecast landing for a vote, or null for a seating made now. */
export function voteStartsAt(season: SeasonPayload, byVote: boolean): Date | null {
  if (!byVote || !season.seatVoteLandsAt) return null;
  const at = new Date(season.seatVoteLandsAt);
  return Number.isNaN(at.getTime()) ? null : at;
}

export type SeatTermPreview =
  | { state: "ok"; line: string; endsOn: string; followsSeason: boolean; caution: string | null }
  | { state: "refused"; code: string; error: string };

export function previewSeatTerm(
  season: SeasonPayload,
  ask: { requestedEndsOn?: string | null; capAtSeasonEnd?: boolean; now?: Date; startsNoEarlierThan?: Date | null },
): SeatTermPreview {
  const t = resolveSeatTerm({
    requestedEndsOn: ask.requestedEndsOn ?? "",
    calendar: calendarFrom(season),
    capAtSeasonEnd: !!ask.capAtSeasonEnd,
    now: ask.now ?? new Date(),
    startsNoEarlierThan: ask.startsNoEarlierThan ?? null,
  });
  if (!t.ok) return { state: "refused", code: t.code, error: t.error };
  return {
    state: "ok",
    line: t.followsSeason ? `Ends with the season on ${t.endsOn}.` : `Ends on ${t.endsOn}.`,
    endsOn: t.endsOn,
    followsSeason: t.followsSeason,
    caution: t.caution,
  };
}

/** The civil date after `date`, or undefined for anything that is not one. */
function dayAfter(date: string | null | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/**
 * What a native date picker can offer: tomorrow at the earliest, because a
 * seat ending today has already ended, and the running season's end at the
 * latest for a steward. The picker's bounds are a convenience; the preview
 * and the route are what hold the rule.
 *
 * For a seat vote, pass the forecast landing. The earliest date becomes the
 * day after the vote lands, because a seat ending on or before that day seats
 * nobody, and a steward's latest date is the end of the season the seat STARTS
 * in, which `resolveSeatTerm` itself picks.
 */
export function pickerBounds(
  season: SeasonPayload,
  capAtSeasonEnd: boolean,
  startsNoEarlierThan: Date | null = null,
): { min?: string; max?: string } {
  const tomorrow = dayAfter(season.today);
  if (!startsNoEarlierThan) {
    const seasonEnd = season.current?.endsOn ? String(season.current.endsOn) : "";
    return { min: tomorrow, max: capAtSeasonEnd && seasonEnd ? seasonEnd : undefined };
  }
  const calendar = calendarFrom(season);
  const afterLanding = dayAfter(civilDateKey(startsNoEarlierThan, calendar.timezone));
  const min = tomorrow && afterLanding ? (tomorrow > afterLanding ? tomorrow : afterLanding) : tomorrow ?? afterLanding;
  if (!capAtSeasonEnd) return { min, max: undefined };
  const cap = resolveSeatTerm({ calendar, capAtSeasonEnd: true, now: startsNoEarlierThan, startsNoEarlierThan });
  return { min, max: cap.ok ? cap.endsOn : undefined };
}
