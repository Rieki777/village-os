/**
 * THE END DATE A RAISED HAND ASKS FOR.
 *
 * `POST /api/map/roles/:id/raise-hand` writes an application into the
 * submissions inbox, and nobody sits in the seat until an admin seats them.
 * Since 0199 the hand still carries the term the member asked for, decided by
 * the rule every seat is decided by (`resolveSeatTerm`, shared/seatTerms.ts),
 * so the founder reading the inbox sees the date and any caution before they
 * seat anybody, and a date that could never be a term is refused while the
 * member is still looking at the form.
 *
 * `capAtSeasonEnd` is false. A hand is raised on an org seat, and
 * `POST /api/admin/org/roles/:id/holders` seats org seats with the same false.
 *
 * The refusal statuses match that route: a date it cannot read is a 400, and
 * every other refusal is a 409 carrying the sentence and the code.
 */
import { resolveSeatTerm, type SeatCalendar, type SeatTermRefusal } from "../../shared/seatTerms";

export type RaisedHandTerm =
  | { ok: true; data: { termEndsOn: string; followsSeason: boolean; caution: string | null } }
  | { ok: false; status: 400 | 409; body: { error: string; code: SeatTermRefusal } };

export function raisedHandTerm(requestedEndsOn: unknown, calendar: SeatCalendar, now: Date = new Date()): RaisedHandTerm {
  const t = resolveSeatTerm({ requestedEndsOn, calendar, capAtSeasonEnd: false, now });
  if (!t.ok) {
    return { ok: false, status: t.code === "unreadable_date" ? 400 : 409, body: { error: t.error, code: t.code } };
  }
  return { ok: true, data: { termEndsOn: t.endsOn, followsSeason: t.followsSeason, caution: t.caution } };
}
