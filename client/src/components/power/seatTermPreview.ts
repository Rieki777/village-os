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
 * Pure. The caller hands in the season payload and the clock.
 */
import { resolveSeatTerm, type CalendarSeason, type SeatCalendar } from "@shared/seatTerms";

/** The parts of `GET /api/season` a term is decided against. */
export interface SeasonPayload {
  current?: { id: string; endsOn?: string | null } | null;
  seasons?: readonly CalendarSeason[] | null;
  timezone?: string | null;
  /** The village's civil date today, in its own zone. */
  today?: string | null;
}

export function calendarFrom(season: SeasonPayload): SeatCalendar {
  return {
    seasons: season.seasons ?? [],
    currentSeasonId: season.current?.id ?? null,
    timezone: season.timezone || "UTC",
  };
}

export type SeatTermPreview =
  | { state: "ok"; line: string; endsOn: string; followsSeason: boolean; caution: string | null }
  | { state: "refused"; code: string; error: string };

export function previewSeatTerm(
  season: SeasonPayload,
  ask: { requestedEndsOn?: string | null; capAtSeasonEnd?: boolean; now?: Date },
): SeatTermPreview {
  const t = resolveSeatTerm({
    requestedEndsOn: ask.requestedEndsOn ?? "",
    calendar: calendarFrom(season),
    capAtSeasonEnd: !!ask.capAtSeasonEnd,
    now: ask.now ?? new Date(),
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
 */
export function pickerBounds(season: SeasonPayload, capAtSeasonEnd: boolean): { min?: string; max?: string } {
  const seasonEnd = season.current?.endsOn ? String(season.current.endsOn) : "";
  return { min: dayAfter(season.today), max: capAtSeasonEnd && seasonEnd ? seasonEnd : undefined };
}
