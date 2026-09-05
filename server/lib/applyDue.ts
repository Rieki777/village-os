/**
 * THE LANDING PATH: when a carried decision actually happens, who may stop it,
 * and the one routine that decides what is due.
 *
 * ── THE RULING ─────────────────────────────────────────────────────────────
 *
 * 2026-09-03: a decision that SENDS TOKENS executes the moment its ballot
 * closes passed, when its timing is at_acceptance. A decision that CHANGES THE
 * GAME never executes at close: it is stamped with a landing instant and lands
 * there by itself unless a seated steward stops it inside the window. A seated
 * steward's no vote on an open ballot fails it outright at close, with the
 * steward named and their reason recorded as the veto reason.
 *
 * ── WHY THIS IS ONE ROUTINE AND NOT TWO ────────────────────────────────────
 *
 * There used to be two. `applyDueGovernance` was planned to run inside the
 * hourly settlement job, and a separate inline block inside the admin cycle
 * close selected `status IN ('passed_verified','passed_onsite')` with no
 * landing predicate and no veto join and applied whatever it found. Two
 * routines that both decide what is due disagree eventually, and here the
 * disagreement is a change landing inside the window a steward was promised.
 * The inline block is deleted and the cycle close calls this.
 *
 * ── WHY ITS OWN JOB ────────────────────────────────────────────────────────
 *
 * Hanging it on the settlement job would make landing inherit `economyReady`,
 * whose first act is to return early when a village has no enabled mint rules
 * or an unregistered recognition token. A young village that turned its seeded
 * rules off would then land nothing, forever, and be told nothing. Governance
 * landing has no economic precondition, so it has no economic early return: it
 * is registered as its own five-minute job.
 *
 * ── "NOTHING DUE" IS NOT "DID NOT RUN" ─────────────────────────────────────
 *
 * Every report this module returns says which of the two happened, in a field
 * a caller cannot ignore. A count that cannot tell the difference is a count
 * nobody can act on, and both states look identical from the outside: quiet.
 *
 * ── THE ELECTION ───────────────────────────────────────────────────────────
 *
 * Exactly one executor runs a due row. It is chosen by a guarded claim UPDATE
 * whose `affectedRows` picks the winner, the same shape `closeBallot` uses.
 * "Read the status, then write it" loses that race silently, and the two
 * callers here (a five-minute job and a human pressing cycle close) genuinely
 * do arrive at one row in the same second at a moon turn.
 *
 * ── THE TOTAL ORDER FOR ROWS DUE AT ONE INSTANT ────────────────────────────
 *
 * Several rows can fall due in the same second, and one of them can change the
 * dials another is priced or timed by. So the order is STATED here rather than
 * left to whatever the database hands back, and it is TOTAL: no two rows can
 * tie on the whole key, so two servers reading the same table apply them in the
 * same sequence.
 *
 *   1. `lands_at` ascending. The earlier instant goes first, always.
 *   2. SOURCE TABLE, in this fixed sequence, which is the tie-break that
 *      matters and the one a later lane must not reorder:
 *        a. scheduled reversions (`governance_scheduled_reversions`, Phase 2)
 *        b. carried proposals (`ballots`)
 *      A reversion is the fulfilment of an OLDER vote whose term simply ran
 *      out, and the new decision due in the same second is the village's
 *      current mind. Running the reversion first means the new decision writes
 *      last and stands; running it second would silently undo the thing the
 *      village just decided. Phase 2 adds the reversion table and inherits this
 *      sentence rather than choosing again.
 *   3. `id` ascending inside a table, which is unique, so the order is total.
 *
 * ── THE DIGEST ─────────────────────────────────────────────────────────────
 *
 * Composed HERE and not by the settlement path, because this is the routine
 * that knows whether every row due inside the closed cycle has actually been
 * dealt with. It runs when a tick crosses a cycle boundary, after that
 * assertion, once per cycle id. See `server/lib/moonDigest.ts`.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  defaultTimingFor,
  executesAtPassWithNoWindow,
  isSeatSubject,
  kindOfSet,
  kindOfSubject,
  landingFor,
  lateVetoRefusal,
  timingOf,
  vetoHoursFrom,
  vetoIsInTime,
  type GovernanceKind,
  type Landing,
  type ProposalTiming,
} from "../../shared/governanceKinds";
import { ballotById, votesFor, type BallotRow } from "./ballots";
import { floorForCriticality, thresholdSettingsFrom, type ThresholdSettings } from "../../shared/ballotSubjects";
import type { Criticality } from "../../shared/governanceEngine";
import { numberVar, stringVar } from "./variables";
import { keyIsVetoMap, recordVeto as recordStewardAct, stewardNoBlocks, stewardsSeated, tierIsInStewardReach, vetoWatchMarksDue, type VetoWindowVerdict } from "./stewardship";
import { asChangeItem, pricingOf, type ChangeInput } from "./mechanics";
import { criticalityOfItems } from "../../shared/ballotSubjects";
/*
 * The digest composer is re-exported from beside the `composeDigest` dep that
 * takes it, so a caller wiring the landing job reaches one module for the job
 * and the thing the job is handed. `server/lib/moonDigest.ts` is its home.
 */
export { digestComposerFor } from "./moonDigest";

/** What a subject's closer hands back. Mirrors the dispatcher's own shape. */
export interface CloseRouting {
  applied: string[];
  held: string | null;
  proposerTold: string | null;
  /** Set when the close itself changed the outcome, as a steward's no does. */
  outcome?: "passed" | "failed" | "no_quorum";
}

/**
 * A subject type's two halves.
 *
 * `settle` records the outcome on the subject: the status flips, the notices,
 * the return to the proposer. It runs for EVERY outcome and it changes nothing
 * about the world outside the decision.
 *
 * `execute` is the world-changing part, and it runs only when a passed decision
 * is actually due. A subject with no `execute` conducts a real decision and
 * changes nothing, which is what makes an advisory vote possible on the real
 * engine.
 *
 * `onWithdraw` puts the subject back where it stood before the ballot opened.
 * It lives beside the closer because the withdraw route used to carry its own
 * hardcoded list of subject types, which was a second routing table nobody
 * remembered to extend.
 */
export interface SubjectCloser {
  settle: (b: BallotRow, outcome: "passed" | "failed" | "no_quorum", outcomeNote: string, actorId: string) => Promise<CloseRouting>;
  execute?: (b: BallotRow, actorId: string) => Promise<CloseRouting>;
  onWithdraw?: (b: BallotRow) => Promise<void>;
}

/** The narrow half: enough to read a landing and to stop one. */
export interface VetoDeps {
  pool: Pool;
  now?: () => Date;
}

export interface LandingDeps extends VetoDeps {
  /** The village's veto window, already floored at 72 hours. */
  vetoHours: () => number;
  /** Is the founder's brake off? */
  autoApplyEnabled: () => boolean;
  /** Does a veto need a majority of the seated stewards? */
  stewardCouncil: () => boolean;
  /**
   * Which SIZES of decision the village has put in the seat's reach, raw text
   * from `governance.steward_veto_tiers`. Parsed by `stewardVetoTiersFrom`,
   * which fails closed to the empty set, so an unreadable value takes reach
   * away and never grants it.
   */
  stewardVetoTiers: () => string;
  /**
   * The first boundary of the ACTIVE clock strictly after an instant.
   *
   * Wired to `activeClock().nextBoundaryAfter`, never to the lunar arithmetic
   * directly: a village that keeps calendar months would otherwise have watched
   * every landing wait for a moon its settlement no longer uses, which is the
   * defect migration 0108 retired and section 13.7 warned would come back.
   */
  nextBoundaryAfter: (after: Date) => Date;
  /** The lunation number a landing instant falls in, for a queued minting rule. */
  cycleNumberAt: (at: Date) => number;
  /** How many boundaries a passed row may miss before it is written off. */
  landingExpiryCycles: () => number;
  /** The closer table, so this module never holds a second copy of it. */
  closerFor: (subjectType: string) => SubjectCloser | undefined;
  /** Tell one member something, through the notification spine. */
  notify: (input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => Promise<void>;
  /** True while a cycle has ended and nobody has closed it yet. */
  endedUnclosedCycle: () => Promise<boolean>;
  /** Does this change set hold a cycle-timed dial or a minting rule? */
  waitsForCycleClose: (changeSet: unknown[]) => boolean;
  /**
   * Does this change set move a number the running cycle is being settled
   * against? A cycle-timed dial, a minting rule or a stage multiplier. Such a
   * set may only land ON a boundary, on every path.
   */
  snapsToBoundary: (changeSet: unknown[]) => boolean;
  /**
   * Compose the digest for a cycle that has just ended. Optional so a caller
   * with no feed (a test, a fixture) still runs the landing loop.
   */
  composeDigest?: (input: { pool: Pool; endedAt: Date; at: Date }) => Promise<{ composed: boolean; why: string }>;
}

const nowOf = (deps: VetoDeps): Date => (deps.now ? deps.now() : new Date());

const sqlInstant = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

/** Is this subject's ballot backed by a mechanics proposal row? */
const hasProposal = (subjectType: string): boolean => subjectType === "mechanics" || subjectType === "mint_rule";

// ── Stamping ────────────────────────────────────────────────────────────────

export interface StampInput {
  ballot: BallotRow;
  /** The change set, when the subject has one, so a bundle takes one clock. */
  itemKinds?: readonly string[];
  /**
   * True when an element of the set edits the map that says what a steward may
   * stop. Such a set KEEPS its timing and its window and is simply not
   * vetoable (section 20.11), for the same reason `role_unseat` on a
   * steward-capable role is not: a seat that could stop the edit narrowing its
   * own reach would hold the village. It is not the same thing as no window,
   * and Phase 1b conflated them.
   */
  editsVetoMap?: boolean;
  /**
   * True when the village has not put decisions of THIS SIZE in the seat's
   * reach (`governance.steward_veto_tiers`, Rye 2026-09-04). It reaches the
   * same flag as `editsVetoMap` on purpose: the veto route and the notices need
   * one fact, and two columns holding one fact is how the notice came to
   * promise a door the route refused. Only the sentence differs.
   */
  outOfTierReach?: boolean;
  /** True when the set moves a number the running cycle is being settled against. */
  snapToBoundary?: boolean;
}

/**
 * WHEN THIS DECISION LANDS, computed from the ballot's FROZEN `closes_at`.
 *
 * Never from the moment a human pressed close. A landing derived from the press
 * lets the proposer choose which three days a steward gets, and lets a passed
 * ballot be parked until the one seat holder posts about a trip.
 */
export function landingOf(deps: LandingDeps, input: StampInput): Landing {
  const b = input.ballot;
  const kind: GovernanceKind = kindOfSetOrSubject(b.subjectType, input.itemKinds);
  return landingFor({
    closesAt: new Date(b.closesAt),
    kind,
    timing: timingOfBallot(b, kind),
    vetoHours: vetoHoursFrom(deps.vetoHours()),
    nextBoundaryAfter: deps.nextBoundaryAfter,
    noWindow: executesAtPassWithNoWindow(b.subjectType),
    // A seating waits its window and admits no veto (2026-09-04). It reaches
    // the same flag as the other two, because all three are one fact to the
    // route and the notice: no steward may stop this row.
    notVetoable: !!input.editsVetoMap || !!input.outOfTierReach || isSeatSubject(b.subjectType),
    // The veto-map carve-out names itself first: a set that is BOTH edits the
    // seat's own limits, and that is the more specific thing to tell a member.
    notVetoableReason: input.editsVetoMap || isSeatSubject(b.subjectType) ? "veto_map" : "out_of_tier_reach",
    snapToBoundary: !!input.snapToBoundary,
  });
}

/**
 * IS THIS DECISION'S SIZE INSIDE THE SEAT'S REACH?
 *
 * The tier is recomputed from the STORED change set rather than read from a
 * column, because there is no column: the tier is a property of the elements,
 * and `pricingOf` is the one function that prices them. A subject with no
 * elements behind it is `routine`, which is the same answer `pricingOf` gives
 * an unknown dial and the same answer the pricing path already relies on.
 *
 * The answer is taken ONCE, at close, and frozen into `ballots.veto_locked`
 * with everything else the ballot freezes. A village that narrows the seat's
 * reach tomorrow does not retroactively unlock a decision that carried today,
 * which is the same discipline the electorate, the weights and the thresholds
 * already follow.
 */
export async function outOfStewardTierReach(deps: LandingDeps, b: BallotRow): Promise<boolean> {
  const set = await changeSetOf(deps.pool, b);
  const tiers = set.map((c) => pricingOf(asChangeItem(c as ChangeInput)).criticality);
  const tier: Criticality = criticalityOfItems(tiers);
  return !tierIsInStewardReach(tier, deps.stewardVetoTiers());
}

/** A bundle takes its set's kind; a subject with no set takes the subject's. */
function kindOfSetOrSubject(subjectType: string, itemKinds?: readonly string[]): GovernanceKind {
  if (!itemKinds || itemKinds.length === 0) return kindOfSubject(subjectType);
  // 19F: "who bundle waits". Any Game-change element makes the whole set one.
  return kindOfSet(itemKinds);
}

/**
 * The timing frozen on the ballot at open, total over anything stored.
 *
 * The fallback is the KIND's default and not one word for everything: a token
 * send that says nothing means at acceptance, a Game change that says nothing
 * means the next boundary. The column itself is NOT NULL with a default, so
 * this fallback only ever answers for a row written before the column existed.
 */
export function timingOfBallot(b: BallotRow & { timing?: unknown }, kind: GovernanceKind = "game_change"): ProposalTiming {
  return timingOf((b as { timing?: unknown }).timing, defaultTimingFor(kind));
}

/**
 * Write the landing instant onto the ballot, and onto the proposal when the
 * subject has one, so both the vote and the thing a member actually reads carry
 * the same date.
 */
export async function stampLanding(deps: LandingDeps, b: BallotRow, landing: Landing): Promise<void> {
  const at = landing.landsAt ? sqlInstant(landing.landsAt) : null;
  await deps.pool.query(
    "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, landing_status = ?, veto_locked = ? WHERE id = ?",
    [at, at, landing.executesAtClose ? "not_applicable" : "pending", landing.vetoable ? 0 : 1, b.id],
  );
  if (hasProposal(b.subjectType)) {
    await deps.pool.query(
      "UPDATE mechanics_proposals SET lands_at = ?, veto_closes_at = ? WHERE id = ?",
      [at, at, b.subjectRef],
    );
  }
}

/** A row that never lands: an advisory vote, a failed vote, a withdrawn one. */
export async function markNotApplicable(pool: Pool, ballotId: string): Promise<void> {
  await pool.query("UPDATE ballots SET landing_status = 'not_applicable' WHERE id = ?", [ballotId]);
}

// ── The steward's two doors ─────────────────────────────────────────────────

export interface StewardVeto {
  stewardIds: string[];
  reason: string;
  /** How many seats were filled when the veto was counted. */
  seated: number;
}

/**
 * A SEATED STEWARD'S NO VOTE FAILS A TOKEN SEND AT THE CLOSE.
 *
 * The founder: "if a steward votes down on a token payment proposal than it
 * fails automatically". This function reads the rows; the RULE is
 * `stewardNoBlocks` in server/lib/stewardship.ts, which owns the four
 * narrowings the second audit required (token sends only, never a ballot the
 * steward is the subject of, a reason under the veto's own rule, and the
 * council majority). Keeping the rule there and the SQL here is what stops the
 * steward's two doors, the vote and the veto, from being two different rules.
 *
 * A LAPSED HOLDING IS NOT A SEAT. `stewardsSeated` returns lapsed rows so a
 * surface can say who held the seat until when; a block counts only the ones
 * still holding it.
 */
export async function stewardNoVote(
  deps: LandingDeps,
  b: BallotRow,
  itemKinds?: readonly string[],
): Promise<StewardVeto | null> {
  const seated = (await stewardsSeated(deps.pool, nowOf(deps))).filter((h) => !h.lapsed);
  if (seated.length === 0) return null;
  const seatIds = new Set(seated.map((h) => h.userId));
  const cast = await votesFor(deps.pool, b.id);
  const noes = cast.filter((v) => v.choice === "no" && seatIds.has(v.userId));
  if (noes.length === 0) return null;
  // The reason lives on the vote row and `votesFor` does not carry it, so the
  // stewards' rows are read once each. Only their rows: the rule counts only a
  // seated steward's no, so nobody else's words are read here at all.
  const votes: Array<{ userId: string; choice: string; reason: string | null }> = [];
  for (const v of noes) {
    const [rows] = await deps.pool.query<RowDataPacket[]>(
      "SELECT reason FROM ballot_votes WHERE ballot_id = ? AND user_id = ?",
      [b.id, v.userId],
    );
    votes.push({ userId: v.userId, choice: "no", reason: rows[0]?.reason == null ? null : String(rows[0].reason) });
  }
  const verdict = stewardNoBlocks({
    ballot: { subjectType: b.subjectType, subjectRef: b.subjectRef, itemKinds },
    votes,
    seated: seated.map((h) => ({ userId: h.userId })),
    council: deps.stewardCouncil(),
  });
  if (!verdict.blocks) return null;
  return { stewardIds: verdict.stewardIds, reason: verdict.reason, seated: verdict.seated };
}

export type VetoResult =
  | { ok: true; landsAt: string | null; stewardId: string }
  | { ok: false; error: string };

/**
 * THE VETO INSIDE THE WINDOW.
 *
 * Marks the row, records the name, the reason and the instant, and returns the
 * proposal to its proposer with its backers intact, which is exactly the
 * `no_quorum` path: a decision that did not take effect is not a decision the
 * author has to write again.
 *
 * A veto AFTER `lands_at` is refused naming the instant. The window is
 * closed-open on that instant on purpose: the same moment is when the apply job
 * may claim the row, and a rule that allowed both would decide by tick phase.
 */
export async function recordVeto(
  deps: VetoDeps,
  input: { ballotId: string; stewardId: string; reason: string; councilOverride?: boolean },
): Promise<VetoResult> {
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    return { ok: false, error: "A veto carries a reason. Say what you saw, so the village can answer it." };
  }
  if (reason.length > 4000) {
    return { ok: false, error: "That is longer than the record holds. 4000 characters maximum." };
  }
  const b = await ballotById(deps.pool, input.ballotId);
  if (!b) return { ok: false, error: "No such ballot" };
  const row = await landingRow(deps.pool, input.ballotId);
  if (!row) return { ok: false, error: "No such ballot" };
  if (row.vetoedAt) return { ok: false, error: "This one was already stopped." };
  if (b.status !== "passed") {
    return { ok: false, error: `A ${b.status.replace("_", " ")} decision has nothing to stop.` };
  }
  if (row.landingStatus === "applied") {
    return { ok: false, error: "This one has already landed. Bringing it back is a new proposal." };
  }
  if (!row.landsAt) {
    return { ok: false, error: "This one took effect the moment it carried, so there is no window on it." };
  }
  /*
   * THE ROW NOBODY MAY STOP, and it still has a window and a countdown.
   *
   * A change set editing `governance.steward_subjects`, `steward_council` or
   * `veto_hours` is the village deciding what its own training wheels reach.
   * It waits like any Game change so everybody can read it coming, and the one
   * act it does not admit is the seat stopping it.
   */
  if (row.vetoLocked) {
    return {
      ok: false,
      error:
        "This decision is about what a steward may stop, so no steward may stop it. It still waits its window and " +
        "the village can read it coming, and it lands when the window shuts.",
    };
  }
  const at = nowOf(deps);
  if (!vetoIsInTime(row.landsAt, at)) {
    return { ok: false, error: lateVetoRefusal(row.landsAt) };
  }
  /*
   * AN OVERRIDE CANNOT BE STOPPED AGAIN.
   *
   * The village already heard the objection, brought the proposal back, and
   * passed it at the highest bar it has set for itself. A second veto would
   * make that bar mean nothing and leave the seat holding the village.
   */
  const override = await isOverride(deps.pool, b.subjectType, b.subjectRef);
  if (override) {
    return {
      ok: false,
      error:
        "The village brought this one back after it was stopped and passed it again at the highest bar it has set. " +
        "It lands whatever any steward says, and the reason it was stopped the first time stays on the record beside it.",
    };
  }

  const [res] = await deps.pool.query<any>(
    "UPDATE ballots SET vetoed_at = ?, vetoed_by = ?, veto_reason = ?, landing_status = 'vetoed' " +
      "WHERE id = ? AND vetoed_at IS NULL AND landing_status = 'pending'",
    [sqlInstant(at), input.stewardId, reason, b.id],
  );
  if (Number(res.affectedRows) === 0) {
    return { ok: false, error: "Somebody got to this one first, or it landed while you were reading it." };
  }
  /*
   * THE VETO LIVES ON THE BALLOT AND NOWHERE ELSE.
   *
   * It used to be stamped onto `mechanics_proposals` as well, and that copy was
   * a trap with two ends. The proposal was set to `vetoed` and then straight
   * back to `open`, so the word never survived to be read; and the columns that
   * DID survive were `vetoed_at`, `vetoed_by` and `veto_reason`, which nobody
   * ever cleared. A village that answered its steward's objection, passed the
   * same proposal again and watched it carry would then find it unlandable
   * forever, because every landing predicate reads `vetoed_at IS NULL`.
   *
   * A veto answers a BALLOT: this vote, at this bar, on this text. A proposal
   * brought back opens a new ballot and is a new question. So the proposal is
   * returned to its proposer with its backers standing, the way a missed quorum
   * returns it, and its veto display is derived from its current ballot by
   * `vetoDisplayFor` below.
   */
  if (hasProposal(b.subjectType)) {
    await deps.pool.query(
      "UPDATE mechanics_proposals SET status = 'open' WHERE id = ? AND status IN ('passed_onsite','passed_verified','onsite_vote')",
      [b.subjectRef],
    );
  }
  return { ok: true, landsAt: row.landsAt.toISOString(), stewardId: input.stewardId };
}

export interface LandingRow {
  ballotId: string;
  subjectType: string;
  subjectRef: string;
  landsAt: Date | null;
  vetoedAt: Date | null;
  vetoedBy: string | null;
  vetoReason: string | null;
  landingStatus: string;
  status: string;
  timing: ProposalTiming;
  /** True when no steward may stop this one, window or no window. */
  vetoLocked: boolean;
  /** Set when the row reached passed with its instant already behind it. */
  lateSettledAt: Date | null;
}

export async function landingRow(pool: Pool, ballotId: string): Promise<LandingRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, subject_ref, lands_at, vetoed_at, vetoed_by, veto_reason, landing_status, status, timing, " +
      "veto_locked, late_settled_at FROM ballots WHERE id = ?",
    [ballotId],
  );
  const r = rows[0];
  if (!r) return null;
  const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
  return {
    ballotId: String(r.id),
    subjectType: String(r.subject_type),
    subjectRef: String(r.subject_ref),
    landsAt: asDate(r.lands_at),
    vetoedAt: asDate(r.vetoed_at),
    vetoedBy: r.vetoed_by === null || r.vetoed_by === undefined ? null : String(r.vetoed_by),
    vetoReason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
    landingStatus: String(r.landing_status),
    status: String(r.status),
    timing: timingOf(r.timing),
    vetoLocked: Number(r.veto_locked ?? 0) === 1,
    lateSettledAt: asDate(r.late_settled_at),
  };
}

/**
 * A PROPOSAL'S VETO DISPLAY, DERIVED FROM ITS CURRENT BALLOT.
 *
 * The veto columns live on the ballot alone. A surface asking "was this
 * proposal stopped, and why" reads the newest ballot held on it, which is the
 * only answer that stays true through a veto, a return to the proposer and a
 * second pass: the old ballot keeps its veto on the record, and the new one
 * carries no veto, so the proposal reads as standing again.
 */
export async function vetoDisplayFor(
  pool: Pool,
  subjectType: string,
  subjectRef: string,
): Promise<{ vetoedAt: string; vetoedBy: string | null; reason: string | null; ballotId: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, vetoed_at, vetoed_by, veto_reason FROM ballots " +
      "WHERE subject_type = ? AND subject_ref = ? ORDER BY opens_at DESC, id DESC LIMIT 1",
    [subjectType, subjectRef],
  );
  const r = rows[0];
  if (!r || !r.vetoed_at) return null;
  const at = r.vetoed_at instanceof Date ? r.vetoed_at : new Date(String(r.vetoed_at));
  return {
    ballotId: String(r.id),
    vetoedAt: at.toISOString(),
    vetoedBy: r.vetoed_by === null || r.vetoed_by === undefined ? null : String(r.vetoed_by),
    reason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
  };
}

// ── The election, and the executor-pending row ──────────────────────────────

/**
 * Claim one due row. `affectedRows` picks the single executor.
 *
 * The predicate is the whole rule: the vote passed, the row is still waiting,
 * its instant has come, and nobody stopped it. Anything that fails any clause
 * belongs to somebody else or to nobody.
 */
export async function claimDue(pool: Pool, ballotId: string, at: Date): Promise<boolean> {
  const [res] = await pool.query<any>(
    "UPDATE ballots SET landing_status = 'applying' " +
      "WHERE id = ? AND status = 'passed' AND landing_status = 'pending' AND lands_at <= ? AND vetoed_at IS NULL",
    [ballotId, sqlInstant(at)],
  );
  return Number(res.affectedRows) === 1;
}

/**
 * The durable trace that survives a throw between the claim and the return.
 *
 * ONE ROW PER ATTEMPT, and the table keys on its own id for that reason. It
 * used to key on the ballot and upsert, so a second attempt overwrote the
 * failure the table exists to record: the row that said "this threw, here is
 * what it said" became a row that said "this is running", and the only trace of
 * why the first run died was a counter. `attempts` still counts, read off the
 * rows that came before.
 */
export async function openPending(pool: Pool, ballotId: string): Promise<void> {
  const [prior] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM governance_executor_pending WHERE ballot_id = ?",
    [ballotId],
  );
  await pool.query(
    "INSERT INTO governance_executor_pending (ballot_id, claimed_at, attempts) VALUES (?, NOW(), ?)",
    [ballotId, Number(prior[0]?.n ?? 0) + 1],
  );
}

/** Close, or annotate, the newest open attempt on this ballot. */
export async function clearPending(pool: Pool, ballotId: string, error?: string): Promise<void> {
  if (error) {
    await pool.query(
      "UPDATE governance_executor_pending SET last_error = ? WHERE ballot_id = ? AND cleared_at IS NULL " +
        "ORDER BY id DESC LIMIT 1",
      [error.slice(0, 1000), ballotId],
    );
    return;
  }
  await pool.query(
    "UPDATE governance_executor_pending SET cleared_at = NOW(), last_error = NULL WHERE ballot_id = ? " +
      "AND cleared_at IS NULL ORDER BY id DESC LIMIT 1",
    [ballotId],
  );
}

/** Decisions that started landing and never finished. A human can act on these. */
export async function unfinishedLandings(pool: Pool, olderThanMs = 10 * 60 * 1000): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT ballot_id FROM governance_executor_pending WHERE cleared_at IS NULL AND claimed_at < ? " +
      "ORDER BY ballot_id",
    [sqlInstant(new Date(Date.now() - olderThanMs))],
  );
  return rows.map((r) => String(r.ballot_id));
}

// ── The job ─────────────────────────────────────────────────────────────────

export type ApplyDueReport =
  | {
      ran: true;
      /** Rows whose instant had come. Zero means nothing due, which is an answer. */
      due: number;
      landed: number;
      failed: number;
      /** Rows whose instant elapsed while the brake was off. */
      stalled: number;
      /** Rows refused because a cycle has ended and nobody has closed it. */
      deferred: number;
      /** Rows written off after too many boundaries without landing. */
      expired: number;
      /** What the digest did on this tick, in one word a caller cannot ignore. */
      digest: "not_asked" | "no_boundary_crossed" | "composed" | "already_composed" | "held";
      notes: string[];
    }
  | { ran: false; why: string };

/**
 * THE FIVE-MINUTE JOB, AND THE HUMAN CYCLE CLOSE. One routine, both callers.
 *
 * A row whose `lands_at` elapsed while `governance.auto_apply_enabled` was off
 * is marked STALLED rather than applied in a sweep the moment the brake comes
 * back on. Landing a backlog whose windows all closed weeks ago is the exact
 * shape of the harm the window exists to prevent, so the window is REOPENED for
 * `veto_hours` from the moment applying resumes and every steward is told.
 */
export async function applyDueGovernance(deps: LandingDeps, at: Date = new Date()): Promise<ApplyDueReport> {
  /*
   * THE TOTAL ORDER, stated in the module header and written here once.
   * `lands_at` first, then the id, which is unique, so no two rows can tie.
   * Phase 2's reversion table joins this sequence AHEAD of the ballots at the
   * same instant; the header says why.
   */
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','stalled') " +
      "AND lands_at IS NOT NULL AND lands_at <= ? AND vetoed_at IS NULL ORDER BY lands_at ASC, id ASC",
    [sqlInstant(at)],
  );
  const dueIds = rows.map((r) => String(r.id));

  if (!deps.autoApplyEnabled()) {
    // The brake is ON. Nothing lands, and every row that came due while it was
    // on is marked so the reopened window can be honest about it later.
    let stalled = 0;
    for (const id of dueIds) {
      const [res] = await deps.pool.query<any>(
        "UPDATE ballots SET landing_status = 'stalled' WHERE id = ? AND landing_status = 'pending'",
        [id],
      );
      if (Number(res.affectedRows) === 1) stalled += 1;
    }
    return {
      ran: true,
      due: dueIds.length,
      landed: 0,
      failed: 0,
      stalled,
      deferred: 0,
      expired: 0,
      digest: "held",
      notes: [
        dueIds.length === 0
          ? "Nothing was due. Applying is switched off, so nothing would have landed either."
          : `${dueIds.length} decision(s) came due while applying is switched off. They are held and their windows reopen when it comes back on.`,
        "No digest was composed: applying is switched off, so the moon that ended has rows nobody has dealt with.",
      ],
    };
  }

  const endedUnclosed = dueIds.length === 0 ? false : await deps.endedUnclosedCycle();
  const notes: string[] = [];
  let landed = 0;
  let failed = 0;
  let stalled = 0;
  let deferred = 0;

  for (const id of dueIds) {
    const before = await landingRow(deps.pool, id);
    const b = await ballotById(deps.pool, id);
    if (!b || !before) continue;

    /*
     * A ROW THAT STALLED GETS ITS WINDOW BACK BEFORE IT LANDS.
     *
     * The steward never had the notice the ruling promised, because the brake
     * was on when their window ran. Reopening it costs the village 72 hours and
     * costs the steward nothing they were not already owed.
     */
    if (before.landingStatus === "stalled") {
      /*
       * ONCE PER STALL, and no more. A window handed back on every tick of a
       * brake that keeps going off is a decision that never lands and never
       * fails, and a member watching it reads a countdown that resets. The
       * second time a row stalls it goes to `writeOffExpired` instead.
       */
      const reopened = await snappedWindowEnd(deps, b, at);
      const [res] = await deps.pool.query<any>(
        "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, landing_status = 'pending', " +
          "stall_reopens = stall_reopens + 1 WHERE id = ? AND landing_status = 'stalled' AND stall_reopens < 1",
        [sqlInstant(reopened), sqlInstant(reopened), id],
      );
      if (Number(res.affectedRows) !== 1) {
        notes.push(
          `${b.title}: applying was off when this came due for the second time. Its window was already reopened once, ` +
            "so it stays held until somebody looks at it.",
        );
        continue;
      }
      if (hasProposal(b.subjectType)) {
        await deps.pool.query("UPDATE mechanics_proposals SET lands_at = ?, veto_closes_at = ? WHERE id = ?", [
          sqlInstant(reopened),
          sqlInstant(reopened),
          b.subjectRef,
        ]);
      }
      await tellStewards(deps, b, reopened, "reopened");
      stalled += 1;
      notes.push(`${b.title}: applying was off when this came due, so its window is open again until ${reopened.toISOString()}.`);
      continue;
    }

    /*
     * A CYCLE-TIMED DIAL OR A MINTING RULE CANNOT LAND OVER AN UNSETTLED MOON.
     *
     * The lunation that ended was played under the old numbers and has not been
     * paid yet. Changing what it pays before it is settled pays a moon at a rate
     * nobody played at.
     */
    if (endedUnclosed && (await touchesCycleTimed(deps, b))) {
      deferred += 1;
      notes.push(`${b.title}: waiting for the moon that ended to be closed before it lands.`);
      continue;
    }

    if (!(await claimDue(deps.pool, id, at))) continue;
    await openPending(deps.pool, id);
    const closer = deps.closerFor(b.subjectType);
    if (!closer?.execute) {
      // Nothing to run. That is the advisory shape and it is not a failure.
      await deps.pool.query("UPDATE ballots SET landing_status = 'applied' WHERE id = ?", [id]);
      await clearPending(deps.pool, id);
      landed += 1;
      continue;
    }
    try {
      const routing = await closer.execute(b, before.vetoedBy ?? "governance");
      await deps.pool.query("UPDATE ballots SET landing_status = 'applied' WHERE id = ?", [id]);
      await clearPending(deps.pool, id);
      landed += 1;
      if (routing.held) notes.push(`${b.title}: ${routing.held}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Back to pending, so the next tick tries again and a human can see the
      // pending row and its last error in the meantime.
      await deps.pool.query("UPDATE ballots SET landing_status = 'pending' WHERE id = ? AND landing_status = 'applying'", [id]);
      await clearPending(deps.pool, id, message);
      failed += 1;
      notes.push(`${b.title}: landing failed and will be tried again. ${message}`);
    }
  }

  const expired = await writeOffExpired(deps, at, notes);
  const digest = await composeDigestIfBoundaryCrossed(deps, at, notes);

  if (dueIds.length === 0 && expired === 0) {
    notes.unshift("Nothing was due.");
  }
  return { ran: true, due: dueIds.length, landed, failed, stalled, deferred, expired, digest, notes };
}

/**
 * A PASSED ROW THAT NEVER LANDS EVENTUALLY STOPS BEING A PROMISE.
 *
 * `governance.landing_expiry_cycles` (default 3). A decision that has sat
 * passed and unlanded through that many boundaries is not waiting any more, it
 * is stuck, and leaving it in `pending` forever means a member reads a
 * countdown that will never reach zero. So it closes as a named terminal state
 * with one door: withdraw and rewrite, which carries the backers.
 *
 * A STALLED ROW REOPENS ITS WINDOW AT MOST ONCE PER STALL. The reopen path
 * above sets `pending` and stamps a fresh instant; `stall_reopens` counts them,
 * and a row that has already been given its window back once is written off
 * here instead of being given a third and a fourth. A window reopened
 * endlessly is a decision that never happens and never fails, which is the one
 * outcome nobody can act on.
 */
async function writeOffExpired(deps: LandingDeps, at: Date, notes: string[]): Promise<number> {
  const cycles = Math.max(1, Math.trunc(deps.landingExpiryCycles()) || 3);
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT id, title, lands_at FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','stalled') " +
      "AND lands_at IS NOT NULL AND lands_at <= ? ORDER BY lands_at ASC, id ASC",
    [sqlInstant(at)],
  );
  let expired = 0;
  for (const r of rows) {
    const landsAt = r.lands_at instanceof Date ? r.lands_at : new Date(String(r.lands_at));
    // The deadline is N boundaries of the ACTIVE clock after the instant it was
    // supposed to land, so a village on calendar months gets months.
    let deadline = landsAt;
    for (let i = 0; i < cycles; i += 1) deadline = deps.nextBoundaryAfter(deadline);
    if (at.getTime() < deadline.getTime()) continue;
    const [res] = await deps.pool.query<any>(
      "UPDATE ballots SET landing_status = 'expired' WHERE id = ? AND landing_status IN ('pending','stalled')",
      [String(r.id)],
    );
    if (Number(res.affectedRows) !== 1) continue;
    expired += 1;
    notes.push(
      `${String(r.title)}: this one carried and then sat unlanded through ${cycles} cycle(s), so it is closed. ` +
        "Withdraw and rewrite it to bring it back, and it keeps the people who backed it.",
    );
  }
  return expired;
}

/**
 * THE DIGEST, COMPOSED BY THIS JOB AND BY NOTHING ELSE.
 *
 * Only when this tick crossed a cycle boundary, and only after every row due
 * INSIDE the cycle that ended has been applied, vetoed or stalled. Composing it
 * with rows still resting in `pending` would publish "what changed this moon"
 * with the changes missing, and the digest is the one page a returning player
 * reads first.
 *
 * "No digest composed" and "the digest was empty" are different answers and are
 * logged apart, because a village whose moon really did nothing and a village
 * whose digest never ran look identical from the feed.
 */
async function composeDigestIfBoundaryCrossed(
  deps: LandingDeps,
  at: Date,
  notes: string[],
): Promise<"not_asked" | "no_boundary_crossed" | "composed" | "already_composed" | "held"> {
  if (!deps.composeDigest) return "not_asked";
  /*
   * DID THIS TICK CROSS A BOUNDARY? The job runs every five minutes, so the
   * boundary that ended the last cycle is the one strictly before now and at or
   * after the previous tick. Asking the clock for the boundary after "one tick
   * ago" answers it with no state kept anywhere.
   */
  const lookBack = new Date(at.getTime() - TICK_MS);
  const boundary = deps.nextBoundaryAfter(lookBack);
  if (boundary.getTime() > at.getTime()) return "no_boundary_crossed";

  const [unfinished] = await deps.pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','applying') " +
      "AND lands_at IS NOT NULL AND lands_at < ?",
    [sqlInstant(boundary)],
  );
  if (Number(unfinished[0]?.n ?? 0) > 0) {
    notes.push(
      `No digest was composed for the cycle that ended at ${boundary.toISOString()}: ` +
        `${Number(unfinished[0]?.n ?? 0)} decision(s) due inside it are neither applied, vetoed nor stalled.`,
    );
    return "held";
  }
  const result = await deps.composeDigest({ pool: deps.pool, endedAt: boundary, at });
  notes.push(result.why);
  return result.composed ? "composed" : "already_composed";
}

/** How often the landing job ticks, and the window the digest looks back over. */
export const TICK_MS = 5 * 60 * 1000;

/**
 * A FRESH WINDOW FROM `at`, SNAPPED FORWARD WHEN THE SET DEMANDS IT.
 *
 * The two paths that recompute an instant after the close (a stalled row whose
 * window is handed back, and a row restamped because it was read late) have to
 * obey the same boundary rule the original stamp obeyed. A set holding a
 * cycle-timed dial, a minting rule or a stage multiplier may only land ON a
 * boundary, and "every path" in section 20.11 means these two as well: a
 * reopened window that lands mid-cycle moves a ceiling under somebody already
 * spending against it exactly as the first stamp would have.
 */
async function snappedWindowEnd(deps: LandingDeps, b: BallotRow, at: Date): Promise<Date> {
  const end = new Date(at.getTime() + vetoHoursFrom(deps.vetoHours()) * 60 * 60 * 1000);
  if (!(await snapsToBoundary(deps, b))) return end;
  const boundary = deps.nextBoundaryAfter(new Date(end.getTime() - 1));
  return boundary.getTime() >= end.getTime() ? boundary : end;
}

/** Does this decision move a cycle-timed dial or a minting rule? */
async function touchesCycleTimed(deps: LandingDeps, b: BallotRow): Promise<boolean> {
  if (b.subjectType === "mint_rule") return true;
  if (b.subjectType !== "mechanics") return false;
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT change_set FROM mechanics_proposals WHERE id = ?",
    [b.subjectRef],
  );
  const raw = rows[0]?.change_set;
  if (!raw) return false;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(set) ? deps.waitsForCycleClose(set) : false;
}

// ── Telling the stewards ────────────────────────────────────────────────────

export type StewardMoment = "carry" | "halfway" | "two_hours" | "reopened" | "late_settled";

const MOMENT_TITLE: Readonly<Record<StewardMoment, (title: string) => string>> = {
  carry: (t) => `The village carried this, and you can stop it: ${t}`,
  halfway: (t) => `Half your window has gone on: ${t}`,
  two_hours: (t) => `Two hours left to stop this: ${t}`,
  reopened: (t) => `Applying is back on and your window is open again: ${t}`,
  late_settled: (t) => `This was read late, so your window starts now: ${t}`,
};

/**
 * THE SAME MOMENTS, FOR THE ROW NO STEWARD MAY STOP.
 *
 * A veto-locked decision keeps its instant, its countdown and these notices,
 * and the one thing it does not have is the door. Sending the ordinary text
 * offered a steward a stop that `vetoBallot` refuses in the same breath, which
 * is worse than telling them nothing: a steward who trusts the notice waits
 * for a window they cannot use and finds out at the moment they try.
 *
 * These say what is true instead. The steward still needs the notice, because
 * a change to what stewards may stop is exactly the change they should be
 * reading before it lands, and because knowing early is what lets them argue
 * for it in the open while it is still a decision the village can revisit.
 */
const MOMENT_TITLE_LOCKED: Readonly<Record<StewardMoment, (title: string) => string>> = {
  carry: (t) => `The village carried this, and it is not yours to stop: ${t}`,
  halfway: (t) => `Half the wait has gone on: ${t}`,
  two_hours: (t) => `Two hours until this takes effect: ${t}`,
  reopened: (t) => `Applying is back on and this is due again: ${t}`,
  late_settled: (t) => `This was read late, so its wait starts now: ${t}`,
};

/**
 * STEWARD-VETO LANE: each moment takes its own notification type.
 *
 * All four used to go out as `governance`, which resolves to the governance
 * email preference, which defaults to daily. So the two-hours-left warning
 * arrived hours after the change had landed. The three window moments are
 * pinned to "immediate" in `emailCadenceFor` through these types. A reopened
 * window is the carry notice arriving a second time, and takes the same type.
 *
 * THE STRINGS ARE LITERALS HERE and the same three are named in
 * `VETO_WATCH_NOTICE_TYPES` in server/lib/stewardship.ts, which is the module
 * that owns them. `applyDue.test.ts` pins the two equal, so the duplication
 * cannot drift. It is written out because the notification catalogue's own
 * guard reads the server's source for the types it sends, and a type reached
 * through another module's constant is invisible to it: the alternative was a
 * blurb with no producer, which is exactly the check that guard exists for.
 */
export const MOMENT_TYPE: Readonly<Record<StewardMoment, string>> = {
  carry: "veto_window_opened",
  halfway: "veto_window_halfway",
  two_hours: "veto_window_closing",
  reopened: "veto_window_opened",
  // A late settle is the window opening for the first time this steward could
  // act on, so it carries the carry type rather than a fourth name nothing
  // pins to immediate. `MOMENT_TITLE` is where the two read differently.
  late_settled: "veto_window_opened",
};

/**
 * In-app through the notification spine, to every seated steward, naming the
 * proposal and the instant. The email hook is the spine's own cadence, so a
 * lane wiring email for governance wires it there rather than here.
 */
export async function tellStewards(deps: LandingDeps, b: BallotRow, landsAt: Date, moment: StewardMoment): Promise<number> {
  /*
   * READ THE SAME COLUMN THE REFUSAL READS, rather than taking a flag from the
   * caller. `vetoBallot` refuses on `ballots.veto_locked` (the row it loads at
   * `ballotLanding`), so the notice asks that column and nothing else. A flag
   * computed beside this call and passed in would be a second copy of the
   * answer, and the defect being fixed here IS a second copy that drifted: the
   * notice promised a door the route had already been refusing.
   */
  const [lockRows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT veto_locked FROM ballots WHERE id = ?",
    [b.id],
  );
  const locked = Number(lockRows[0]?.veto_locked ?? 0) === 1;
  const titles = locked ? MOMENT_TITLE_LOCKED : MOMENT_TITLE;
  const body = locked
    ? `It takes effect at ${landsAt.toISOString()}. This decision is about what a steward may stop, so no steward may stop it, and it lands when the window shuts.`
    : `It takes effect at ${landsAt.toISOString()} unless you stop it before then, with a reason the village can read.`;
  const seated = (await stewardsSeated(deps.pool, nowOf(deps))).filter((h) => !h.lapsed);
  for (const holding of seated) {
    await deps.notify({
      userId: holding.userId,
      type: MOMENT_TYPE[moment],
      title: titles[moment](b.title),
      body,
      link: `/governance/ballots/${b.id}`,
      dedupeKey: `bal:${b.id}:veto-window:${moment}`,
    });
  }
  return seated.length;
}

export interface WatchReport {
  ran: true;
  /** Windows still open. */
  open: number;
  halfway: number;
  twoHours: number;
}

/**
 * THE VETO WATCH. Halfway, and two hours out.
 *
 * The carry notice is sent by the close path, because that is the moment it is
 * about. These two are the ones only a clock can send, and the dedupe key makes
 * them exactly-once per ballot per moment however often the job ticks.
 *
 * WHICH MARKS ARE DUE IS NOT DECIDED HERE. `vetoWatchMarksDue` in
 * `server/lib/stewardship.ts` is the one definition of the three moments, and
 * this job asks it rather than doing the arithmetic a second time: two copies
 * of "halfway" drift the day somebody changes what the window is counted from,
 * and the steward reads a countdown the server does not believe.
 *
 * A MARK WHOSE MOMENT HAS PASSED IS SUPPRESSED, NOT SENT LATE. The helper
 * returns every mark whose instant is behind us, so a window that opened while
 * the job was down reports "carried, halfway, two-hours-left" all at once. Only
 * the LAST of those is still true, and sending the earlier two would tell a
 * steward they have half a window left when they have minutes.
 */
export async function runVetoWatch(deps: LandingDeps, at: Date = new Date()): Promise<WatchReport> {
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT id, closes_at, lands_at, late_settled_at FROM ballots " +
      "WHERE status = 'passed' AND landing_status = 'pending' AND lands_at IS NOT NULL AND lands_at > ? AND vetoed_at IS NULL",
    [sqlInstant(at)],
  );
  let halfway = 0;
  let twoHours = 0;
  for (const r of rows) {
    const b = await ballotById(deps.pool, String(r.id));
    if (!b) continue;
    const landsAt = r.lands_at instanceof Date ? r.lands_at : new Date(String(r.lands_at));
    // The window was carried FROM the late-settle instant when there was one,
    // because that is the moment the steward was actually told.
    const late = r.late_settled_at ? (r.late_settled_at instanceof Date ? r.late_settled_at : new Date(String(r.late_settled_at))) : null;
    const carriedAt = late ?? new Date(b.closesAt);
    const marks = vetoWatchMarksDue({ carriedAt, landsAt }, at);
    const latest = marks[marks.length - 1];
    if (latest === "two-hours-left") {
      await tellStewards(deps, b, landsAt, "two_hours");
      twoHours += 1;
      continue;
    }
    if (latest === "halfway") {
      await tellStewards(deps, b, landsAt, "halfway");
      halfway += 1;
    }
  }
  return { ran: true, open: rows.length, halfway, twoHours };
}

// ── The close route's own half ──────────────────────────────────────────────

/**
 * WHAT A CLOSE DOES, AFTER THE OUTCOME IS KNOWN.
 *
 * One function, called from the close route and from the auto-settle path, so
 * a ballot closed by a human and a ballot closed by the clock take exactly the
 * same road. Splitting the two was how the old engine came to have one rule
 * about the steward on one path and another on the other.
 */
export async function routeOutcome(
  deps: LandingDeps,
  b: BallotRow,
  outcome: "passed" | "failed" | "no_quorum",
  outcomeNote: string,
  actorId: string,
  itemKinds?: readonly string[],
): Promise<CloseRouting> {
  const closer = deps.closerFor(b.subjectType);

  // A seated steward's no is the block, and it lands while the ballot is open,
  // which is the only door a token send ever has.
  let stewardVeto: StewardVeto | null = null;
  if (outcome === "passed") stewardVeto = await stewardNoVote(deps, b, itemKinds);
  const effective: "passed" | "failed" | "no_quorum" = stewardVeto ? "failed" : outcome;

  const note = stewardVeto
    ? `A steward voted against this one, so it does not carry. ${stewardVeto.reason}`
    : outcomeNote;

  const routing: CloseRouting = closer
    ? await closer.settle(b, effective, note, actorId)
    : { applied: [], held: null, proposerTold: null };
  routing.outcome = effective;

  if (stewardVeto) {
    const at = nowOf(deps);
    await deps.pool.query(
      "UPDATE ballots SET status = 'failed', outcome_note = ?, vetoed_at = ?, vetoed_by = ?, veto_reason = ?, landing_status = 'vetoed' " +
        "WHERE id = ? AND status = 'passed'",
      [note.slice(0, 4000), sqlInstant(at), stewardVeto.stewardIds[0], stewardVeto.reason.slice(0, 4000), b.id],
    );
    if (hasProposal(b.subjectType)) {
      await deps.pool.query(
        "UPDATE mechanics_proposals SET vetoed_at = ?, vetoed_by = ?, veto_reason = ? WHERE id = ?",
        [sqlInstant(at), stewardVeto.stewardIds[0], stewardVeto.reason.slice(0, 4000), b.subjectRef],
      );
    }
    /*
     * STEWARD-VETO LANE: the block is written as a VETO ACT as well as a set
     * of columns, one row per steward who blocked it.
     *
     * The columns are what the landing gate and the override read. The acts
     * are what a member reads: `vetoesFor` is the list every surface renders,
     * `stewardVetoStands` is what the dashboard's blocked-payouts row counts,
     * and `redactVetoReason` is the door the words can be taken back through.
     * Stamping only the columns left a payout that died with a named steward
     * and a public reason and no act anywhere a person could see it.
     */
    for (const stewardId of stewardVeto.stewardIds) {
      await recordStewardAct(deps.pool, { ballotId: b.id, decidedBy: stewardId, reason: stewardVeto.reason });
    }
    routing.held = "A steward voted against this one while it was open, so it did not carry.";
    return routing;
  }

  if (effective !== "passed") {
    await markNotApplicable(deps.pool, b.id);
    return routing;
  }

  /*
   * A SUBJECT WITH NO EXECUTOR IS NEVER STAMPED WITH A LANDING INSTANT.
   *
   * An advisory vote conducts a real decision on the real engine and changes
   * nothing, which is the whole promise it makes. Stamping it would put a
   * countdown and a veto door on a page where nothing is going to happen, and
   * "it lands on the 30th" would be false about a vote that lands never.
   */
  if (!closer?.execute) {
    await markNotApplicable(deps.pool, b.id);
    return routing;
  }

  const landing = landingOf(deps, {
    ballot: b,
    itemKinds,
    editsVetoMap: await editsVetoMap(deps, b),
    outOfTierReach: await outOfStewardTierReach(deps, b),
    snapToBoundary: await snapsToBoundary(deps, b),
  });
  await stampLanding(deps, b, landing);

  /*
   * A ROW THAT REACHES PASSED WITH ITS INSTANT ALREADY BEHIND IT.
   *
   * `lands_at` is derived from the ballot's frozen `closes_at`, which is right
   * and is what stops a proposer choosing which three days a steward gets. It
   * also means that any delay between `closes_at` and the actual close longer
   * than the window produces a row whose window is over at the moment stewards
   * are told it began: a scheduler outage, a late human close, a village that
   * came back online after a week. The change would land within five minutes of
   * carrying and the record would report the window as honoured.
   *
   * So the window is restamped from NOW, the row is marked late-settled with
   * the reason, and every steward is told. The village loses nothing it was
   * promised; it gains the notice it was promised.
   */
  if (landing.landsAt && landing.landsAt.getTime() <= nowOf(deps).getTime()) {
    const at = nowOf(deps);
    const restamped = await snappedWindowEnd(deps, b, at);
    const why =
      `The vote's window ended at ${new Date(b.closesAt).toISOString()} and it was not read until ` +
      `${at.toISOString()}, so the instant it should have landed at was already past. ` +
      "The window is counted from now instead, so nobody loses the notice they were owed.";
    await deps.pool.query(
      "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, late_settled_at = ?, late_settled_reason = ? WHERE id = ?",
      [sqlInstant(restamped), sqlInstant(restamped), sqlInstant(at), why.slice(0, 1000), b.id],
    );
    if (hasProposal(b.subjectType)) {
      await deps.pool.query("UPDATE mechanics_proposals SET lands_at = ?, veto_closes_at = ? WHERE id = ?", [
        sqlInstant(restamped),
        sqlInstant(restamped),
        b.subjectRef,
      ]);
    }
    await tellStewards(deps, b, restamped, "late_settled");
    routing.held = `${why} It lands at ${restamped.toISOString()}.`;
    return routing;
  }

  if (landing.executesAtClose) {
    await openPending(deps.pool, b.id);
    try {
      const done = await closer.execute(b, actorId);
      await deps.pool.query("UPDATE ballots SET landing_status = 'applied' WHERE id = ?", [b.id]);
      await clearPending(deps.pool, b.id);
      return { ...done, proposerTold: done.proposerTold ?? routing.proposerTold, outcome: effective };
    } catch (e) {
      await clearPending(deps.pool, b.id, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  // It waits. Say when, in the sentence the decision page already renders.
  routing.held = landing.landsAt
    ? `${landing.because} It lands at ${landing.landsAt.toISOString()}.`
    : landing.because;
  if (landing.landsAt) await tellStewards(deps, b, landing.landsAt, "carry");
  return routing;
}

/**
 * A ballot whose window has ended is closed by the clock, with the engine's own
 * outcome and a note that says who closed it.
 *
 * This is what makes `lands_at` derivable from `closes_at` honestly: nobody
 * chooses when a vote closes, so nobody chooses which three days a steward
 * gets. The human close route stays, for a facilitator who wants to close a
 * ballot whose window has already ended and say something about it.
 */
export const AUTO_CLOSE_NOTE =
  "The voting window ended and the village's own engine read the result. Nobody chose the moment.";

export interface AutoSettleReport {
  ran: true;
  /** Ballots whose window had ended. Zero means none, which is an answer. */
  expired: number;
  closed: number;
  failed: number;
  notes: string[];
}

/**
 * CLOSE EVERY BALLOT WHOSE WINDOW HAS ENDED, through the settlement path.
 *
 * The close used to be a human act with no deadline, and the proposer joined
 * the closers after expiry. So the proposer chose whether a steward got three
 * days and which three calendar days those were, and could park a passed ballot
 * until the one seat holder posted about a trip. Closing on the clock removes
 * the choice entirely, and `lands_at` derives from the frozen `closes_at`, so
 * the instant a steward is promised is the instant the ballot itself named when
 * it opened.
 *
 * `closeBallot` is the same guarded transition a human close takes, so a ballot
 * a facilitator closed a second earlier is already closed here and returns
 * `alreadyClosed` rather than closing twice.
 */
export async function autoSettleExpired(
  deps: LandingDeps,
  closeBallot: (
    pool: Pool,
    input: { ballotId: string; closedBy: string; outcomeNote: string; closerMayCloseEarly: boolean },
  ) => Promise<{ ok: boolean; outcome?: "passed" | "failed" | "no_quorum"; ballot?: BallotRow; error?: string }>,
  at: Date = new Date(),
): Promise<AutoSettleReport> {
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE status = 'open' AND closes_at <= ? ORDER BY closes_at, id",
    [sqlInstant(at)],
  );
  const notes: string[] = [];
  let closed = 0;
  let failed = 0;
  for (const r of rows) {
    const id = String(r.id);
    const b = await ballotById(deps.pool, id);
    if (!b) continue;
    let itemKinds: string[] | undefined;
    if (hasProposal(b.subjectType)) itemKinds = await itemKindsOf(deps, b);
    try {
      const result = await closeBallot(deps.pool, {
        ballotId: id,
        closedBy: "governance",
        outcomeNote: AUTO_CLOSE_NOTE,
        closerMayCloseEarly: false,
      });
      if (!result.ok || !result.ballot || !result.outcome) {
        notes.push(`${b.title}: ${result.error ?? "could not be closed"}`);
        continue;
      }
      await routeOutcome(deps, result.ballot, result.outcome, AUTO_CLOSE_NOTE, "governance", itemKinds);
      closed += 1;
    } catch (e) {
      failed += 1;
      notes.push(`${b.title}: closing threw. ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (rows.length === 0) notes.push("No ballot's window had ended.");
  return { ran: true, expired: rows.length, closed, failed, notes };
}

/** The change-set item kinds behind a mechanics ballot, for the bundle rule. */
export async function itemKindsOf(deps: LandingDeps, b: BallotRow): Promise<string[] | undefined> {
  if (!hasProposal(b.subjectType)) return undefined;
  const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT change_set FROM mechanics_proposals WHERE id = ?", [
    b.subjectRef,
  ]);
  const raw = rows[0]?.change_set;
  if (!raw) return undefined;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(set)) return undefined;
  return set.map((c: { kind?: string }) => String(c?.kind ?? "dial"));
}

/**
 * DOES THIS SET EDIT THE MAP THAT SAYS WHAT A STEWARD MAY STOP?
 *
 * `server/lib/stewardship.ts` owns the key lists and `keyIsVetoMap` is its
 * answer to this narrower question. It asks the MAP question rather than the
 * wider `keyIsVetoLocked` one on purpose: `keyIsVetoLocked` says which keys no
 * steward may veto, which is five keys, and every one of them still waits out
 * its window like any other Game change (20.11). Only the map itself carries
 * the older no-window reading, and the dispatcher lane owns whether that
 * survives at all.
 */
export async function snapsToBoundary(deps: LandingDeps, b: BallotRow): Promise<boolean> {
  if (b.subjectType === "mint_rule") return true;
  if (!hasProposal(b.subjectType)) return false;
  const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT change_set FROM mechanics_proposals WHERE id = ?", [
    b.subjectRef,
  ]);
  const raw = rows[0]?.change_set;
  if (!raw) return false;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(set)) return false;
  return deps.snapsToBoundary(set);
}

/**
 * DOES THIS SET MOVE A NUMBER THE RUNNING CYCLE IS SETTLED AGAINST?
 *
 * A cycle-timed dial, a minting rule, a stage multiplier. Such a set may only
 * land ON a boundary, on EVERY path, `at_acceptance` included. The older guard
 * (refuse to apply while a cycle has ended and nobody has closed it) is a
 * different thing and does not cover this: it stops a landing over an unsettled
 * moon, and says nothing about a landing halfway through a live one, which
 * moves a ceiling under a member already spending against it.
 */
export async function editsVetoMap(deps: LandingDeps, b: BallotRow): Promise<boolean> {
  const set = await changeSetOf(deps.pool, b);
  return set.some((c: { key?: unknown }) => keyIsVetoMap(String(c?.key ?? "")));
}

/**
 * THE ELEMENTS A BALLOT CARRIES, or an empty list when it carries none.
 *
 * One reader, so the veto route and the landing path ask the same question of
 * the same column. A subject with no proposal row behind it answers with an
 * empty list, which is honest: it carries no elements, as opposed to elements
 * nobody could read.
 */
export async function changeSetOf(
  pool: Pool,
  b: { subjectType: string; subjectRef: string },
): Promise<Array<{ key?: unknown; kind?: unknown }>> {
  if (!hasProposal(b.subjectType)) return [];
  const [rows] = await pool.query<RowDataPacket[]>("SELECT change_set FROM mechanics_proposals WHERE id = ?", [
    b.subjectRef,
  ]);
  const raw = rows[0]?.change_set;
  if (!raw) return [];
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(set) ? set : [];
}

/**
 * THE WINDOW, ASKED BY THE VETO ROUTE.
 *
 * The seat, the reason and the record live in `server/lib/stewardship.ts`;
 * the instant a decision lands lives here. `setVetoWindowCheck` is registered
 * with this function at boot, so the two modules hold one answer between them
 * rather than two copies of the arithmetic that would disagree eventually.
 */
export async function vetoWindowOn(pool: Pool, ballotId: string, now: Date = new Date()): Promise<VetoWindowVerdict> {
  const row = await landingRow(pool, ballotId);
  if (!row) return { open: true, known: false };
  if (row.landingStatus === "applied") {
    return { open: false, known: true, error: "This one has already landed. Bringing it back is a new proposal." };
  }
  if (!row.landsAt) {
    return { open: false, known: true, error: "This one took effect the moment it carried, so there is no window on it." };
  }
  if (!vetoIsInTime(row.landsAt, now)) return { open: false, known: true, error: lateVetoRefusal(row.landsAt) };
  return { open: true, known: true };
}

/**
 * THE VETO OVERRIDE.
 *
 * The founder: "We can have a veto override if it goes up to the highest tier
 * they have set as a village (this is also a setting that can change at the
 * highest tier set)."
 *
 * A proposal brought back pointing at the one a steward stopped is priced at
 * `governance.highest_tier`, and when it carries at that bar it lands whatever
 * any steward says. The original's veto reason stays visible beside it: an
 * override is the village answering the objection out loud, and hiding what was
 * objected to would make the answer unreadable.
 */
export async function isOverride(pool: Pool, subjectType: string, subjectRef: string): Promise<{ of: string } | null> {
  if (!hasProposal(subjectType)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.supersedes_proposal_id AS sup, p.supersedes_relation AS rel FROM mechanics_proposals p WHERE p.id = ?",
    [subjectRef],
  );
  const r = rows[0];
  /*
   * THE RELATION IS EXPLICIT, and that is the fix.
   *
   * `supersedes_proposal_id` alone conferred steward-proof landing on anything
   * that pointed at a vetoed row, and three different writers set that column:
   * an override, a renewal of an expiring setting (21.2) and the
   * withdraw-and-rewrite clone. Two of the three were never the village
   * answering a veto at its highest bar, and both would have landed regardless
   * of any steward at whatever tier they happened to be priced at.
   */
  if (!r?.sup || String(r.rel ?? "") !== "overrides") return null;
  if (!(await wasVetoed(pool, String(r.sup)))) return null;
  return { of: String(r.sup) };
}

/** Was any ballot ever held on this proposal stopped by a steward? */
export async function wasVetoed(pool: Pool, proposalId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'mechanics' AND subject_ref = ? AND vetoed_at IS NOT NULL",
    [proposalId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * THE OVERRIDE IS DECIDED BY THE TIER THE RESUBMISSION ACTUALLY CARRIED AT.
 *
 * `overrideDials` raises the bar a resubmission is CONDUCTED at. This answers
 * the other half: did the ballot that carried actually sit at the village's
 * highest set tier? The two dials are frozen on the ballot at open, so this
 * reads the vote that happened rather than the intention behind it. A ballot
 * opened before the override rule existed, or priced by a hand that did not
 * raise it, does not land regardless of a steward just because a column points
 * somewhere.
 */
export function ballotPricedAtOrAbove(
  ballot: { unityPct: number; quorumPct: number },
  tier: Criticality,
  settings: ThresholdSettings,
): boolean {
  const floor = floorForCriticality(tier, settings);
  return ballot.unityPct >= floor.unityPct && ballot.quorumPct >= floor.quorumPct;
}

/**
 * A RENEWAL MAY NOT POINT AT A VETOED ROW.
 *
 * 21.2's renewal keeps an expiring change alive, and the village already said
 * no to this one. Letting a renewal point at it would carry a stopped decision
 * back into force at the setting's ordinary bar, which is the override without
 * the override's price. Returns the refusal, or null.
 */
export async function supersedesRefusal(
  pool: Pool,
  relation: string,
  supersedesProposalId: string | null | undefined,
): Promise<string | null> {
  const rel = String(relation ?? "").trim().toLowerCase();
  if (!supersedesProposalId) return null;
  if (rel !== "renews") return null;
  if (!(await wasVetoed(pool, String(supersedesProposalId)))) return null;
  return (
    "That decision was stopped by a steward, so it cannot be renewed: there is nothing running to keep running. " +
    "Bring it back as an override instead, which the village passes at the highest bar it has set for itself."
  );
}

/**
 * The dials a resubmission is conducted at: the village's highest set tier when
 * it supersedes a vetoed proposal, and the price the set already carried
 * otherwise. Returns the higher of the two on each dial, never a lower one.
 */
export async function overrideDials(
  pool: Pool,
  proposal: { id: string; supersedesProposalId?: string | null },
  priced: { unityPct: number; quorumPct: number },
  highestTier: Criticality = tierOf(stringVar("governance.highest_tier")),
  settings: ThresholdSettings = thresholdSettingsFrom((key) => Number(numberVar(key))),
): Promise<{ unityPct: number; quorumPct: number }> {
  const override = await isOverride(pool, "mechanics", proposal.id);
  if (!override) return priced;
  const floor = floorForCriticality(highestTier, settings);
  return {
    unityPct: Math.max(priced.unityPct, floor.unityPct),
    quorumPct: Math.max(priced.quorumPct, floor.quorumPct),
  };
}

/** Read the village's highest set tier, total over anything stored. */
function tierOf(raw: unknown): Criticality {
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "routine" || text === "structural" || text === "constitutional" ? text : "constitutional";
}
