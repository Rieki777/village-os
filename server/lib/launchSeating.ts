/**
 * THE FOUNDERS TAKE THE STEWARD'S SEAT WHEN THE VILLAGE STARTS ITS GAME.
 *
 * ── THE RULE, IN THE FOUNDER'S WORDS ───────────────────────────────────────
 *
 * Rye, 2026-09-23: "Seat them at launch." Asked who holds the seat when the
 * launch vote carries, and it is the village's founders, by inheritance and
 * not by standing for it.
 *
 * Rye, 2026-09-14: "By default seats should end with the ending of a season
 * ... this includes stewards where all seats are reset each season at a max."
 * No seat may enter with an indefinite time, ever.
 *
 * ── WHY THIS MODULE EXISTS AT ALL, WHICH IS THE INTERESTING PART ───────────
 *
 * `seatCatalystsAsStewards` in server/lib/stewardship.ts has said in its own
 * header since it was written that it is "Called by the launch closer once the
 * Birthing carries". Nothing outside the test suite ever called it. So every
 * village that has started its Game has started it with an empty steward seat,
 * with a fully built, fully tested seating function sitting one import away.
 *
 * That was survivable while the seat's only power was the veto, because an
 * empty seat is a healthy state and `vacancyState` says so. It stopped being
 * survivable on 2026-09-21, when Rye ruled that a founder may reach past a
 * power the village holds ONLY while seated as a steward with the veto
 * (`BREAK_GLASS_SEAT`, PR #312). A launch that seats nobody now takes the
 * break-glass away from everybody in the same moment it takes the founder's
 * standing powers away (`founderPowerStands` in server/lib/gameStart.ts), and
 * a village discovers that the first time it needs it.
 *
 * ── WHAT THIS MODULE DOES AND WHAT IT DELIBERATELY LEAVES ALONE ────────────
 *
 * It is the launch closer's half of the seating: the TERM, the NOTICES, the
 * PUBLIC RECORD and the CACHE RELOAD. The writes themselves stay where they
 * already are, in `seatCatalystsAsStewards`, which is idempotent on every one
 * of them and whose header carries the reasoning for each.
 *
 * ── THE TERM IS DECIDED THE SAME WAY A VOTED SEAT'S IS ─────────────────────
 *
 * `resolveSeatTerm` (shared/seatTerms.ts) and no second copy of the rule. A
 * `role_seat` ballot asks it when the vote opens and `termForCarriedSeat`
 * corrects it at landing; this asks it once, at the close, because a launch
 * seating has no vote of its own to freeze a term at and no gap between
 * deciding and seating.
 *
 * `capAtSeasonEnd` is TRUE and never read off the role. It is true because the
 * seat this module fills is the one that carries `steward.veto`, which is rule
 * 2 of shared/seatTerms.ts, and reading it off the role's stored capability
 * list would make the cap depend on a row this same call is about to create.
 *
 * Nothing is passed for `requestedEndsOn`: there is no form and no ballot
 * asking for a date, so the seat ends with the season, which is the default.
 * Nothing is passed for `startsNoEarlierThan` either: a `role_seat` vote lands
 * weeks after it opens and needs that guard, and this seating happens in the
 * same instant it is decided.
 *
 * ── WHEN THE CALENDAR CANNOT GIVE A TERM ───────────────────────────────────
 *
 * `resolveSeatTerm` refuses in words when no season is running, when the
 * running season is open-ended, or when the season's end is past what a
 * TIMESTAMP column can hold. Three answers were possible and two are wrong:
 *
 *   REFUSING THE LAUNCH is wrong. The launch is the village's most consequential
 *   decision and it has already carried; `recordGameStart` has already run and
 *   there is deliberately no function that un-starts a Game. Throwing here
 *   would also park the close for retry (`AT_CLOSE_RETRY_SAFE_SUBJECTS` in
 *   server/lib/atCloseLanding.ts names `village_launch`), and the landing job
 *   would then retry a calendar problem every five minutes forever, telling
 *   the whole village the launch has not taken effect when it has.
 *
 *   SEATING NOBODY SILENTLY is wrong, and it is what the code did before this
 *   module existed. A village that thinks it has stewards and has none finds
 *   out at the worst possible moment.
 *
 *   SO: the Game starts, nobody is seated, and the village is TOLD, in the
 *   refusal's own words, with the way out. `stewardsHeld` carries that
 *   sentence; the closer puts it on the public pulse and rings the
 *   administrators. The seat then stands empty exactly as it does in any
 *   village that has not voted one in, which `vacancyState` renders as healthy
 *   rather than as a fault, and the village can vote its stewards in through
 *   an ordinary `role_seat` ballot once the season has an end date.
 *
 * ── RUNNING TWICE ──────────────────────────────────────────────────────────
 *
 * The launch closer can run twice: a failure anywhere in it parks the ballot
 * and the landing job re-runs `execute`. Every part of this is written for
 * that.
 *
 *   The WRITES are idempotent in `seatCatalystsAsStewards`: find-or-create on
 *   the role, a set union on the capability, `INSERT ... ON DUPLICATE KEY
 *   UPDATE` on `(role_id, user_id)`, and a read-then-skip on the open term.
 *
 *   The NOTICES are sent only to `report.seated`, which is the list of people
 *   this call actually seated. A second run finds them in `alreadySeated` and
 *   sends nothing. Belt and braces, each notice is also keyed on the holding
 *   row id, which `stewardHoldingId` derives from the member so the retry
 *   computes the same key.
 *
 *   The PULSE LINE is written only when somebody was seated, for the same
 *   reason. A close that threw between the seating and the pulse would lose
 *   the line on the retry; that is the same exposure the launch closer's own
 *   pulse line already carries, and it is a missing sentence rather than a
 *   wrong one.
 *
 * ── THE CACHES, WHICH ARE WHY THE ORDER HERE MATTERS ───────────────────────
 *
 * `seatCatalystsAsStewards` writes UNDERNEATH `rolesRepo` and
 * `roleHoldersRepo`, the in-process caches the capability gate reads
 * (`roleCapabilitiesFor` in server/index.ts). Two consequences, and this
 * module owes both:
 *
 *   RELOAD, or the gate serves the old answer until the process restarts and
 *   the founders hold a seat nothing can see.
 *
 *   TAKE THE role_holders LOCK AROUND BOTH. `withRoleHolderLock` serialises
 *   every snapshot→mutate→`replaceAll` cycle on that table, and `replaceAll`
 *   writes a whole-table snapshot taken before this seating. A concurrent
 *   seating through the admin or ballot path would otherwise erase these rows
 *   from the database as well as the cache. The notices are sent OUTSIDE the
 *   lock, which is that function's own standing rule.
 */
import type { Pool } from "mysql2/promise";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import {
  seatCatalystsAsStewards,
  stewardHoldingId,
  STEWARD_ROLE_ID,
  STEWARD_ROLE_NAME,
  type SeatingReport,
} from "./stewardship";

export interface LaunchSeatingDeps {
  pool: Pool;
  /** The village's season list, as every other seat's term is decided against. */
  calendar: SeatCalendar;
  /** The ballot that carried. It is the grantor on every seat this writes. */
  ballotId: string;
  /** Whoever closed the vote. Attribution only; the village did the seating. */
  actorId?: string | null;
  now?: Date;
  /** Serialises this against every other `role_holders` writer. */
  withRoleHolderLock<T>(fn: () => Promise<T>): Promise<T>;
  /** Rebuild `rolesRepo` and `roleHoldersRepo`, which the capability gate reads. */
  reloadRoleCaches(): Promise<void>;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }): Promise<unknown>;
  /** One line on the public pulse. */
  addActivity(text: string, entityRef: string): Promise<void>;
  /** The admin-only event spine. Fire-and-forget, like every other audit line. */
  audit(text: string): void;
  /** The admin bell, for the two things only an administrator can fix. */
  notifyAdmins(title: string, dedupeKey: string): Promise<void>;
}

export interface LaunchSeatingOutcome {
  /** True when a term was found and the seating ran. */
  ok: boolean;
  /** User ids this call seated. Empty on a retry, which is not a failure. */
  seated: string[];
  /** User ids that already held the seat, left exactly as they were. */
  alreadySeated: string[];
  /** The civil date every new seat ends on, in the village's zone. */
  termEndsOn: string | null;
  /** Why nobody was seated, in the village's words. Null when the seating ran. */
  held: string | null;
  /** The report from the writes, when they ran. */
  report: SeatingReport | null;
}

/**
 * What a village reads when its calendar could not give the seat a term.
 *
 * The refusal's own sentence is carried through rather than rewritten, because
 * `resolveSeatTerm` is the one place that decides this and its wording already
 * names the exact admin screen. This adds only what that sentence cannot know:
 * that the Game did start, and what the village can do next.
 */
export function stewardsHeld(refusal: string): string {
  return (
    `The village started its Game, and nobody was seated as a ${STEWARD_ROLE_NAME}. ${refusal} ` +
    `Until then the seat stands empty, which stops nothing: decisions land at their landing time either way. ` +
    `The village can vote anybody into the seat whenever it likes.`
  );
}

/**
 * Seat the founders as stewards, at the moment the launch vote carries.
 *
 * Never throws for a calendar that cannot give a term: see the header for why
 * a launch that has already carried must not be refused or retried over one.
 */
export async function seatFoundersAtLaunch(deps: LaunchSeatingDeps): Promise<LaunchSeatingOutcome> {
  const now = deps.now ?? new Date();
  const nothing = { ok: false, seated: [], alreadySeated: [], termEndsOn: null, report: null };

  const term = resolveSeatTerm({ calendar: deps.calendar, capAtSeasonEnd: true, now });
  if (!term.ok) {
    const held = stewardsHeld(term.error);
    await deps.addActivity(held, STEWARD_ROLE_ID);
    await deps.notifyAdmins(
      `The Game started with nobody in the ${STEWARD_ROLE_NAME}'s seat`,
      `bal:${deps.ballotId}:launch-seating-held`,
    );
    return { ...nothing, held };
  }

  const report = await deps.withRoleHolderLock(async () => {
    const r = await seatCatalystsAsStewards(deps.pool, deps.ballotId, {
      currentSeasonId: term.seasonId,
      seasonEndsAt: term.endsAt,
      now,
    });
    // Reload whether or not anything was seated: the role and its capability
    // can move on a run that seats nobody new.
    await deps.reloadRoleCaches();
    return r;
  });

  if (!report.ok) {
    /*
     * Unreachable from here in practice: this function's own refusal is the
     * same question asked one layer up, and `resolveSeatTerm` already said
     * yes. Reported rather than swallowed, because the alternative is a
     * village that hears nothing about an empty seat.
     */
    const held = stewardsHeld(String(report.error ?? ""));
    await deps.addActivity(held, STEWARD_ROLE_ID);
    await deps.notifyAdmins(
      `The Game started with nobody in the ${STEWARD_ROLE_NAME}'s seat`,
      `bal:${deps.ballotId}:launch-seating-held`,
    );
    return { ...nothing, held, report };
  }

  /*
   * The veto crossing to the village failed. The seats stand and the term is
   * real, so this is not a held seating; what is missing is the row that makes
   * an administrator meet a break-glass instead of walking through. An
   * administrator is the only person who can fix it, so they are the ones told.
   */
  if (!report.holdingMoved) {
    await deps.notifyAdmins(
      `The ${STEWARD_ROLE_NAME}'s seat was filled, and the veto did not cross to the village`,
      `bal:${deps.ballotId}:launch-veto-uncrossed`,
    );
  }

  for (const userId of report.seated) {
    await deps.notify({
      userId,
      type: "role_appointed",
      title: `The village started its Game, and you hold the ${STEWARD_ROLE_NAME}'s seat`,
      body:
        `You can stop a decision the village has already carried, inside the window before it lands, and you have to say why. ` +
        `The seat ends on ${term.endsOn}, with the season, and after that the village votes on who holds it.`,
      link: "/roles",
      actorUserId: deps.actorId ?? null,
      // The same key shape `role_seat` uses, on an id derived from the member
      // so a retried close computes the same one and rings nobody twice.
      dedupeKey: `role:${stewardHoldingId(userId)}`,
    });
    deps.audit(`role:seated-at-launch:${STEWARD_ROLE_ID}:${userId}:${deps.ballotId}`);
  }

  if (report.seated.length > 0) {
    await deps.addActivity(
      `The village's founders hold the ${STEWARD_ROLE_NAME}'s seat until ${term.endsOn}, by the vote that started the Game.`,
      STEWARD_ROLE_ID,
    );
  }

  return {
    ok: true,
    seated: report.seated,
    alreadySeated: report.alreadySeated,
    termEndsOn: term.endsOn,
    held: null,
    report,
  };
}
