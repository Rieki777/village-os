/**
 * A seat's term at the three moments around its vote: when the vote OPENS and
 * the term is frozen, when a carried seat vote lands, and when an admin moves
 * the season the seat ends with.
 *
 * The rules are in shared/seatTerms.ts and are not restated here. This module
 * applies them to what is stored, and when it cannot give a seat a term it
 * says so in a sentence the village reads, because a seat is never written
 * without one.
 *
 * ── A SEAT VOTE STARTS WHEN IT LANDS, AND THAT IS OFTEN WEEKS AFTER IT CLOSES ─
 *
 * `role_seat` left `NO_WINDOW_SUBJECTS` on 2026-09-04 (Rye: seatings take the
 * window and stay un-vetoable). So a carried seat vote is stamped at close like
 * any Game change: kind game_change, timing frozen at open as `next_moon`, and
 * `landingFor` rule 4 lands it at the LATER of the active clock's next boundary
 * after the close and the close plus `governance.veto_hours` (floored at 72).
 * The closer seats nobody until then: `twoPhase` runs the seating at `execute`,
 * and `termForCarriedSeat` below asks whether the term is still running at
 * that moment.
 *
 * The role-seat route used to hand `resolveSeatTerm` the vote's CLOSE as the
 * earliest start. A vote opened close enough to a season's end that it closes
 * before the turn and lands after it therefore froze the RUNNING season's end,
 * a date on or before the day the seat could start, and at landing the seat
 * was held with "the term ended before the vote could land". A steward seat,
 * capped at that same season, could never be voted in across the turn.
 *
 * `seatVoteLandsAt` answers the instant the closer will stamp, using the same
 * inputs: `ballotWindow` for the close `openBallot` freezes, the timing
 * `openBallot` freezes for this subject, and `landingOf` with the landing deps
 * the close path reads, so the rules live in `landingFor` alone. The close path
 * also passes four facts that cannot move a seat's instant: `notVetoable` is
 * already true for every seat subject, so `stewardConsent` is ignored and the
 * two tier facts only choose a sentence; and a seat carries no change set, so
 * nothing snaps it to a boundary.
 *
 * It is a forecast of the opening instant. A vote read late at close is
 * restamped from the moment it is read, which only moves the landing later.
 */
import type { Pool } from "mysql2/promise";
import { civilDateKey } from "../../shared/lunar";
import { civilDateInstant, RECORD_LIMIT, resolveSeatTerm, restampsFor, type Restamp, type SeatCalendar } from "../../shared/seatTerms";
import { defaultTimingFor, kindOfSubject } from "../../shared/governanceKinds";
import { villageBallotMethod } from "../../shared/governanceEngine";
import { landingOf, type LandingDeps } from "./applyDue";
import { ballotWindow, type BallotRow } from "./ballots";
import { numberVar, stringVar } from "./variables";
import { frozenSeatTerm } from "../repos/ballotSeatTerms";
import { restampOpenTerm } from "../repos/roleHolderTerms";
import { followingOrgSeatings, restampOrgSeating } from "../repos/orgSeatTerms";

/**
 * How many days a vote the role ceremonies open stays open: the consent window
 * for a consent village, the ordinary vote length for every other. Read here so
 * `roleBallotSetup` and the season payload's forecast cannot disagree.
 */
export function roleVoteDays(): number {
  const method = villageBallotMethod(stringVar("governance.default_method"));
  return Math.max(1, numberVar(method === "consent" ? "governance.consent_window_days" : "governance.vote_days"));
}

/**
 * The instant a `role_seat` vote opened at `now` would land, if it carries and
 * is closed on time. See the header for why this, and never the close, is when
 * a voted seat starts.
 */
export function seatVoteLandsAt(
  deps: Pick<LandingDeps, "vetoHours" | "nextBoundaryAfter" | "consentNoticeHours">,
  durationDays: number,
  now: Date = new Date(),
): Date {
  const { opensAt, closesAt } = ballotWindow(durationDays, now.getTime());
  const ballot = {
    subjectType: "role_seat",
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    // What `openBallot` freezes when the route passes no timing, which it does not.
    timing: defaultTimingFor(kindOfSubject("role_seat")),
  } as BallotRow;
  return landingOf(deps, { ballot }).landsAt ?? closesAt;
}

export type CarriedSeatTerm =
  | { ok: true; endsAt: Date; endsOn: string; seasonId: string | null; followsSeason: boolean }
  | { ok: false; held: string };

/**
 * The term a carried seat vote seats somebody with.
 *
 * The vote froze its term when it opened (0199), and that is the term, with
 * two corrections the calendar is owed:
 *
 *   - A term that FOLLOWS its season takes the season's end as it stands now,
 *     so a season moved while the vote ran is the season the seat ends with.
 *   - A steward's seat is held to its season's end even when the vote asked
 *     for an earlier date and the season has since moved earlier still.
 *
 * A term that has already run out by the close seats nobody, and the reason is
 * the held sentence. A ballot with no frozen term was opened before every seat
 * carried one; it gets the season's end now, or is held if the season cannot
 * give one.
 */
export async function termForCarriedSeat(
  pool: Pool,
  ballotId: string,
  calendar: SeatCalendar,
  capAtSeasonEnd: boolean,
  now: Date = new Date(),
): Promise<CarriedSeatTerm> {
  const tz = calendar.timezone || "UTC";
  const frozen = await frozenSeatTerm(pool, ballotId);
  if (!frozen) {
    const t = resolveSeatTerm({ calendar, capAtSeasonEnd, now });
    if (!t.ok) {
      return { ok: false, held: `This vote opened before every seat carried a term, and the season cannot give it one now. ${t.error}` };
    }
    return { ok: true, endsAt: t.endsAt, endsOn: t.endsOn, seasonId: t.seasonId, followsSeason: t.followsSeason };
  }

  const season = frozen.seasonId ? calendar.seasons.find((s) => s.id === frozen.seasonId) : undefined;
  const seasonEnd = season?.endsOn ? civilDateInstant(season.endsOn, tz) : null;
  let endsAt = frozen.endsAt;
  // A season moved past what the record can hold keeps the frozen date, as `restampsFor` does.
  if (frozen.followsSeason && seasonEnd && seasonEnd.getTime() <= RECORD_LIMIT.getTime()) endsAt = seasonEnd;
  if (capAtSeasonEnd && seasonEnd && endsAt.getTime() > seasonEnd.getTime()) endsAt = seasonEnd;

  if (endsAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      held: `The term this vote gave the seat ended on ${civilDateKey(endsAt, tz)}, before the vote could land, so nobody was seated. The village can ask again with a later end date.`,
    };
  }
  return {
    ok: true,
    endsAt,
    endsOn: civilDateKey(endsAt, tz),
    seasonId: frozen.seasonId,
    followsSeason: frozen.followsSeason && !!seasonEnd && endsAt.getTime() === seasonEnd.getTime(),
  };
}

export interface PermissionHoldingRow {
  id: string;
  roleId: string;
  userId: string;
  seasonId?: string | null;
  termEndsAt?: string | Date | null;
  termFollowsSeason?: boolean;
}

export interface RestampDeps {
  pool: Pool;
  calendar: SeatCalendar;
  now?: Date;
  /** The permission plane as the capability gate reads it. */
  permissionHoldings(): readonly PermissionHoldingRow[];
  /**
   * Write new term ends onto `role_holders`, THROUGH the cache the gate reads.
   * A statement underneath that cache would leave the gate on the old date
   * until the process restarts, so this module never writes the table itself.
   */
  writePermissionTerms(restamps: readonly Restamp[]): Promise<void>;
  roleName(roleId: string): string;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<unknown>;
}

/**
 * Move every seat that follows its season onto the calendar as it now stands.
 *
 * Run after every save of the season list. `restampsFor` answers nothing when
 * nothing moved, so a save that changed a season's name moves no seat and tells
 * nobody anything. Each holder a move reaches hears the old date and the new
 * one, stewards included, because a seat lengthened by an edit to the calendar
 * is a fact the person holding it should never have to discover.
 */
export async function restampSeatsToCalendar(deps: RestampDeps): Promise<{ permission: number; org: number }> {
  const now = deps.now ?? new Date();
  const tz = deps.calendar.timezone || "UTC";

  const holdings = deps.permissionHoldings();
  const permissionMoves = restampsFor(
    holdings.map((h) => ({
      id: h.id,
      seasonId: h.seasonId ?? null,
      termEndsAt: h.termEndsAt ?? null,
      followsSeason: !!h.termFollowsSeason,
    })),
    deps.calendar,
    now,
  );
  if (permissionMoves.length) {
    await deps.writePermissionTerms(permissionMoves);
    const byId = new Map(holdings.map((h) => [h.id, h]));
    for (const move of permissionMoves) {
      const h = byId.get(move.id);
      if (!h) continue;
      await restampOpenTerm(deps.pool, h.roleId, h.userId, move.to);
      await deps.notify({
        userId: h.userId,
        type: "term_expiring",
        title: `Your term as ${deps.roleName(h.roleId)} now ends on ${civilDateKey(move.to, tz)}`,
        body: `This seat ends with the season, and the season's end date moved, so the seat moved with it. It used to end on ${civilDateKey(move.from, tz)}.`,
        link: "/roles",
        dedupeKey: `seat-restamp:${move.id}:${move.to.toISOString().slice(0, 10)}`,
      });
    }
  }

  const seatings = await followingOrgSeatings(deps.pool, now);
  const orgMoves = restampsFor(
    seatings.map((a) => ({ id: a.id, seasonId: a.seasonId, termEndsAt: a.termEndsAt, followsSeason: true })),
    deps.calendar,
    now,
  );
  const seatingById = new Map(seatings.map((a) => [a.id, a]));
  for (const move of orgMoves) {
    await restampOrgSeating(deps.pool, move.id, move.to);
    const a = seatingById.get(move.id);
    if (!a?.userId || a.holderKind !== "member") continue;
    await deps.notify({
      userId: a.userId,
      type: "term_expiring",
      title: `Your term on ${a.roleName} now ends on ${civilDateKey(move.to, tz)}`,
      body: `This seat ends with the season, and the season's end date moved, so the seat moved with it. It used to end on ${civilDateKey(move.from, tz)}.`,
      link: "/roles",
      dedupeKey: `org-seat-restamp:${move.id}:${move.to.toISOString().slice(0, 10)}`,
    });
  }

  return { permission: permissionMoves.length, org: orgMoves.length };
}
