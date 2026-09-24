/**
 * THE FOUNDERS THE PROPOSAL NAMED, AND WHO ACCEPTED, TAKE THE STEWARD'S SEAT,
 * WITH ALL NINETEEN POWERS, WHEN THE VILLAGE STARTS ITS GAME.
 *
 * ── THE RULE, IN THE FOUNDER'S WORDS ───────────────────────────────────────
 *
 * Rye, 2026-09-23: "Seat them at launch."
 *
 * Rye, 2026-09-24: "The founders automatically become stewards and hold all
 * powers at launch for whomever of the founding members (3 minimum) carry the
 * inaugural role of steward for the first season. Any of the founding 3 can
 * apply for this role by self signaling at founding they want it." And, asked
 * whether that closes the door afterwards: "But after the launch Vote people
 * can still sign signal that they want to be a steward. It's just that's how
 * the founding stewards are selected at the launch Vote."
 *
 * Three readings were put back to him and answered. ALL POWERS is all nineteen
 * entrustable powers, not a named subset. The signalling happens at the launch
 * vote, so the roll and the stewards are decided in one moment. And the
 * ONGOING case needs no new machinery: after launch, wanting the seat is the
 * path that already exists, where a member raises a hand and a `role_seat`
 * ballot seats them. The founding mechanism is a one-time one and there is
 * deliberately no second door beside the one that is already there.
 *
 * ── AND THE FOUNDING MECHANISM CHANGED SHAPE LATER THE SAME DAY ───────────
 *
 * Rye, 2026-09-24, choosing between two designs: "is whoever is clicking the
 * 'launch village' button then selects from a list of members in the proposal
 * to carry the steward role so then it's there in the proposal to be voted on.
 * I like this second route better." And: "founders only for this first season
 * (after that anyone can raise their hand for a steward role and fill it if
 * voted in), and show the declines".
 *
 * So a founder no longer volunteers. The PROPOSAL names them
 * (`ballot_steward_slate`, 0220) and they answer, and both halves of the
 * answer are visible to the whole village. Nothing above changes: it is still
 * a one-time founding mechanism, still founders only, still no second door.
 * What changed is who does the asking, and therefore that a consent step is
 * now load-bearing rather than implied. A slate chosen by one hand can name
 * somebody who does not want nineteen powers, and being handed them anyway is
 * exactly what the morning's opt-in ruling was protecting against.
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
 * ── WHAT AN EMPTY SEAT COSTS NOW, WHICH IS LESS THAN IT SOUNDS ─────────────
 *
 * Since the ruling of 2026-09-24 the seat carries all nineteen, so "seats
 * nobody" is a bigger sentence than it was. It is not a bigger DANGER, and the
 * reason is in `seatCatalystsAsStewards`: with nobody seated, not one of the
 * nineteen crosses to the village. They stay with the scaffolding, which is
 * where every village keeps them until it launches, and the admin panel goes
 * on working. A village that seats nobody at launch is one ordinary `role_seat`
 * ballot away from its stewards, not locked out of its own panel.
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
  /**
   * True when a term was found and the writes ran.
   *
   * IT DOES NOT MEAN ANYBODY WAS SEATED, and the two facts came apart when the
   * seat became opt-in. A launch nobody accepted runs every write it has to
   * run, finds nobody to seat, and is `ok` with an empty `seated` and a `held`
   * sentence. Read `seated` for who holds the seat and `held` for what to tell
   * the village.
   */
  ok: boolean;
  /** User ids this call seated. Empty on a retry, which is not a failure. */
  seated: string[];
  /** User ids that already held the seat, left exactly as they were. */
  alreadySeated: string[];
  /** Everyone the launch PROPOSAL named for the seat, whatever they answered (0220). */
  slate: string[];
  /**
   * The named members who said NO, which Rye asked for by name.
   *
   * "show the declines" (2026-09-24). Carried up out of the report so the
   * closer and the ballot page read one list, and so a decline is never
   * quietly folded into "did not accept".
   */
  declined: string[];
  /** The civil date every new seat ends on, in the village's zone. */
  termEndsOn: string | null;
  /**
   * Why nobody was seated, in the village's words. Null when somebody was.
   *
   * Two things reach it: a calendar that could not give the seat a term, and
   * a launch whose slate seated nobody. Both are said out loud on the public pulse,
   * because a village that believes it has stewards and has none finds out at
   * the worst possible moment.
   */
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
 * WHAT A VILLAGE READS WHEN THE LAUNCH CARRIED AND THE SEAT IS STILL EMPTY.
 *
 * Rye made the inaugural seat something a launch PROPOSAL offers and a named
 * member answers, so a launch that seats nobody is a real outcome rather than
 * a fault. It is still said out loud, for the reason every other branch in
 * this module is said out loud: a village that believes it has stewards and
 * has none finds out at the worst possible moment.
 *
 * THREE DIFFERENT THINGS CAN PUT A VILLAGE HERE AND THEY ARE NOT THE SAME
 * SENTENCE. One sentence for all three is how "show the declines" becomes "we
 * mentioned it somewhere". So this takes the two counts it needs to tell them
 * apart:
 *
 *   NOBODY WAS NAMED. The proposal put nobody forward, so there was nothing
 *   to accept. Nothing happened to anybody and the village chose this.
 *
 *   EVERYBODY NAMED DECLINED. People were asked and said no, which is the
 *   case Rye specifically wanted visible, and the village should hear that
 *   its offer was refused rather than that nothing happened.
 *
 *   NAMED, AND NOT EVERYBODY ANSWERED. The vote carried before the answers
 *   came in. Nobody refused anything; the seat is simply unfilled.
 *
 * IT NAMES THE ORDINARY DOOR AND BUILDS NO SECOND ONE. Rye's clarification is
 * that after the launch vote people can still signal they want the seat, and
 * that path already exists and is a `role_seat` ballot. So this sentence
 * points at it rather than at anything new.
 *
 * It says what is NOT lost, deliberately. Nothing is stuck, nothing is
 * waiting, and none of the village's powers have moved anywhere a member
 * cannot reach. Read the crossing in `seatCatalystsAsStewards` for why the
 * last of those is true.
 */
export function nobodyStood(named: number, declined: number): string {
  const opening =
    named === 0
      ? `The village started its Game, and its proposal named nobody for the ${STEWARD_ROLE_NAME}'s seat.`
      : declined >= named
        ? `The village started its Game, and everybody its proposal named for the ${STEWARD_ROLE_NAME}'s seat declined it.`
        : `The village started its Game, and nobody its proposal named for the ${STEWARD_ROLE_NAME}'s seat accepted it.`;
  return (
    `${opening} ` +
    `The seat stands empty, which stops nothing: decisions land at their landing time either way. ` +
    `The village can vote anybody into it whenever it likes, and whoever wants it can say so.`
  );
}

/**
 * Seat the founders the proposal named who accepted, at the moment the launch
 * vote carries.
 *
 * Never throws for a calendar that cannot give a term, and never refuses a
 * launch because nobody accepted: see the header for why a launch that has
 * already carried must not be refused or retried over either.
 */
export async function seatFoundersAtLaunch(deps: LaunchSeatingDeps): Promise<LaunchSeatingOutcome> {
  const now = deps.now ?? new Date();
  const nothing = {
    ok: false,
    seated: [],
    alreadySeated: [],
    slate: [],
    declined: [],
    termEndsOn: null,
    report: null,
  };

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

  const holdsTheSeat = report.seated.length + report.alreadySeated.length > 0;

  /*
   * AN ACCEPTANCE THAT SEATED NOBODY IS RECORDED, never dropped.
   *
   * Somebody the proposal named and who accepted can still fail the founder
   * test, because `users.role` can move between the vote opening and carrying
   * and the ruling asks the question at the close. They are not left to find
   * out by noticing they have no seat: the admin spine carries their names,
   * and the ordinary `role_seat` ballot is the same door for them as for
   * anybody else. This is a line on the audit trail rather than a notice,
   * because the surface that offered them the seat is the place to say who it
   * is for, and a product this lane does not own should not start apologising
   * on its behalf.
   *
   * The key keeps the word it has always had. It is an audit string a village
   * may already have rows of, and renaming one is a search that silently
   * stops finding the old ones.
   */
  for (const userId of report.acceptedNotFounding) {
    deps.audit(`role:stood-not-founding:${STEWARD_ROLE_ID}:${userId}:${deps.ballotId}`);
  }

  /*
   * NOBODY ACCEPTED. The Game started, the term was real, every write ran, and
   * the seat is empty because nobody took it. That is an outcome and not
   * a fault, so no administrator is rung: there is nothing for one to fix, and
   * a bell for a village's own choice is noise. The village hears it instead,
   * on the pulse, the same way it hears everything else about the launch.
   */
  if (!holdsTheSeat) {
    const held = nobodyStood(report.slate.length, report.declined.length);
    await deps.addActivity(held, STEWARD_ROLE_ID);
    return {
      ok: true,
      seated: [],
      alreadySeated: [],
      slate: report.slate,
      declined: report.declined,
      termEndsOn: term.endsOn,
      held,
      report,
    };
  }

  /*
   * The powers did not all cross to the village. The seats stand and the term
   * is real, so this is not a held seating; what is missing is the row that
   * makes an administrator meet a break-glass instead of walking through. An
   * administrator is the only person who can fix it, so they are the ones told.
   *
   * Unreachable while nobody is seated, because `holdsTheSeat` returned above,
   * which is the point: the one state where `holdingMoved` is false and no
   * administrator can do anything about it is the one state this does not ring
   * about.
   */
  if (!report.holdingMoved) {
    await deps.notifyAdmins(
      `The ${STEWARD_ROLE_NAME}'s seat was filled, and the village's powers did not all cross to it`,
      `bal:${deps.ballotId}:launch-veto-uncrossed`,
    );
  }

  for (const userId of report.seated) {
    await deps.notify({
      userId,
      type: "role_appointed",
      title: `The village started its Game, and you hold the ${STEWARD_ROLE_NAME}'s seat`,
      body:
        `The launch proposal named you for this seat, you accepted, and the village started its Game, so you hold it. ` +
        `You can stop a decision the village has already carried, inside the window before it lands, and you have to say why. ` +
        `The seat also holds every power this village has to give, until it hands them on. ` +
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
      `The founders this village named and who accepted hold the ${STEWARD_ROLE_NAME}'s seat until ${term.endsOn}, with every power this village has to give, by the vote that started the Game.`,
      STEWARD_ROLE_ID,
    );
  }

  return {
    ok: true,
    seated: report.seated,
    alreadySeated: report.alreadySeated,
    slate: report.slate,
    declined: report.declined,
    termEndsOn: term.endsOn,
    held: null,
    report,
  };
}
