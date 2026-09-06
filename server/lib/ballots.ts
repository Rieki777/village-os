/**
 * Ballots: the on-site decision engine's conduct (round 5, lane G1).
 *
 * The rules this file exists to hold, each enforced mechanically:
 *
 *  - THE SNAPSHOT LAW. Method, dials, electorate and weights freeze inside
 *    the open transaction. Every later evaluation reads the ballot's own
 *    columns and the frozen electorate, never live settings or balances —
 *    "A vote is counted against the day it opened" (Ring 0).
 *  - ONE OPEN BALLOT PER SUBJECT. `open_key` is UNIQUE NOT NULL and holds
 *    `${subject_type}:${subject_ref}` while open; the close rewrites it to
 *    carry the ballot id, freeing the key for a fresh ballot. Double-open is
 *    a race-free no-op on the index, never an application-level check.
 *  - VOTES ARE CHANGEABLE UNTIL CLOSE. A vote is a PK upsert, refused once
 *    the ballot left `open` or the clock passed `closes_at` (harvest 2:
 *    "You can change your vote until the voting period closes").
 *  - CLOSING IS A HUMAN ACT. Nothing auto-executes at expiry. The close is
 *    one guarded UPDATE (`WHERE status='open'`); zero rows affected means
 *    someone else closed it first — return the current state, execute
 *    nothing. An `outcome_note` is required on every close (the Loomio
 *    stated outcome). WHO may close, and when, is the route's judgment:
 *    after `closes_at` the proposer joins the closers; while the ballot is
 *    still running only a `proposal.decide` holder or an admin may close
 *    early, and a consent ballot never passes before its window ends.
 *  - A GOVERNANCE WINDOW GATES THE OPENING, NEVER THE VOTE (19E, windows
 *    lane). `openBallot` asks `server/lib/governanceWindows.ts` whether this
 *    village lets this kind of proposal open today, and refuses with the next
 *    window's instants when it does not. Nothing else in this file reads a
 *    window: a ballot already open runs to its own `closes_at` whatever the
 *    calendar does, and a vote already cast is never touched.
 *  - A DELEGATED VOTE IS A ROW FOR THE DELEGATOR (0174). Casting copies the
 *    choice to everyone whose chain ends at the voter, stamped with who
 *    decided it, and the weight never moves. The rule itself lives in
 *    server/lib/delegation.ts; this file calls it from one place, after the
 *    upsert, so the derivation and the vote cannot disagree.
 *
 * Callers hand this file a pool and plain inputs. Variables, capabilities
 * and subject-table flips live with the routes (server/index.ts), which is
 * what lets the unit tests prove the snapshot law by handing in dials and
 * then "changing the village settings" without a registry in sight.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  evaluateBallot,
  quorumPctOf,
  unityPctOf,
  VOTE_CHOICES,
  type BallotMethod,
  type BallotOutcome,
  type BallotTallies,
  type HeadCounts,
  type VoteChoice,
} from "../../shared/governanceEngine";
import {
  applyDelegatedVotes,
  deleteDelegatedRow,
  hiddenChoiceView,
  revokeDelegation,
  type OwnVoteFacts,
} from "./delegation";
import {
  consecutiveNoQuorum,
  delegatedRowsCountOn,
  evaluationRulesFor,
  quorumMissReading,
  type QuorumMissReading,
} from "../../shared/ballotSubjects";
// THRESHOLDS LANE (19G): whose weight the quorum counts, and the seat facts
// that answer it. The clock turns "silent for N cycles" into an instant.
import {
  quorumBaseOf,
  quorumPctOn,
  type AbstainPolicy,
  type QuorumArithmetic,
  type QuorumBase,
} from "../../shared/governanceEngine";
import { clockFor } from "../../shared/cycleClock";
import { quorumPolicyFrom, seatFacts, ABSENT_CYCLES_DEFAULT } from "./nonHumanSeats";
import { numberVar, stringVar } from "./variables";
// Dispatcher lane: the proposal timing 0172 freezes onto the ballot at open.
import { defaultTimingFor, kindOfSubject, noCloserRefusal, timingOf, type ProposalTiming } from "../../shared/governanceKinds";
// Windows lane: the open path is gated, and only the open path (19E).
import { openingRefusal } from "./governanceWindows";
import type { WeightMode } from "./governanceWeights";

export interface BallotRow {
  id: string;
  subjectType: string;
  subjectRef: string;
  openKey: string;
  title: string;
  docMarkdown: string;
  method: BallotMethod;
  weightMode: WeightMode;
  weightToken: string | null;
  unityPct: number;
  quorumPct: number;
  totalWeight: number;
  electorateCount: number;
  openedBy: string;
  opensAt: string;
  closesAt: string;
  status: "open" | "passed" | "failed" | "no_quorum" | "withdrawn";
  /** Dispatcher lane, 0172: the timing FROZEN at open, like the dials. */
  timing: ProposalTiming;
  outcomeNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
  createdAt: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export function rowToBallot(r: RowDataPacket): BallotRow {
  return {
    id: String(r.id),
    subjectType: String(r.subject_type),
    subjectRef: String(r.subject_ref),
    openKey: String(r.open_key),
    title: String(r.title),
    docMarkdown: String(r.doc_markdown),
    method: r.method as BallotMethod,
    weightMode: r.weight_mode as WeightMode,
    weightToken: r.weight_token ?? null,
    unityPct: Number(r.unity_pct),
    quorumPct: Number(r.quorum_pct),
    totalWeight: Number(r.total_weight),
    electorateCount: Number(r.electorate_count),
    openedBy: String(r.opened_by),
    opensAt: iso(r.opens_at),
    closesAt: iso(r.closes_at),
    status: r.status,
    timing: timingOf(r.timing),
    outcomeNote: r.outcome_note ?? null,
    closedBy: r.closed_by ?? null,
    closedAt: r.closed_at === null || r.closed_at === undefined ? null : iso(r.closed_at),
    createdAt: iso(r.created_at),
  };
}

export async function ballotById(pool: Pool, id: string): Promise<BallotRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM ballots WHERE id = ?", [id]);
  return rows[0] ? rowToBallot(rows[0]) : null;
}

/** The open ballot on a subject, if one is running. */
export async function openBallotFor(pool: Pool, subjectType: string, subjectRef: string): Promise<BallotRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ballots WHERE open_key = ? AND status = 'open'",
    [`${subjectType}:${subjectRef}`],
  );
  return rows[0] ? rowToBallot(rows[0]) : null;
}

export async function ballotsFor(pool: Pool, subjectType: string, subjectRef: string): Promise<BallotRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ballots WHERE subject_type = ? AND subject_ref = ? ORDER BY created_at DESC, id DESC",
    [subjectType, subjectRef],
  );
  return rows.map(rowToBallot);
}

/**
 * WHICH DIALS A BALLOT ACTUALLY MOVED, READ BACK OUT OF THE LEDGER.
 *
 * The apply path stamps every amendment row with `gm:<proposal> bal:<ballot>`
 * (`applyMechanicsProposal`, server/index.ts), so the ballot that decided a
 * change is already written next to the change. Nothing has ever read it in
 * that direction. The outcome card's "What changed" came off the close
 * response instead, which means it existed only in the browser session that
 * closed the vote and was gone by the next morning, on exactly the decisions
 * worth coming back to.
 *
 * This is the permanent answer to the same question. It reports what the
 * ledger holds and never what a proposal asked for: a change the apply pass
 * refused is absent here, correctly, because it did not happen.
 *
 * `LIKE` because the reference is a composite of up to three parts and the
 * ballot marker sits at the end of it. The id is escaped for LIKE's own
 * wildcards before it goes in, so an id is matched as characters and not as
 * a pattern, whatever future ids turn out to contain.
 *
 * A LEADING WILDCARD SCANS, and that is the right trade here rather than an
 * oversight. `mechanics_changes` holds one row per dial a village has ever
 * moved, so it is hundreds of rows on an old village and a handful on a young
 * one, and this runs once when somebody opens one decision. The alternative
 * is a column duplicating a fact the reference already carries, which is a
 * second copy of one truth waiting to disagree with the first.
 */
export async function amendedKeysFor(pool: Pool, ballotId: string): Promise<string[]> {
  const escaped = ballotId.replace(/([\\%_])/g, "\\$1");
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT config_key FROM mechanics_changes WHERE source = 'governance' AND proposal_ref LIKE ? ORDER BY config_key",
    [`%bal:${escaped}%`],
  );
  return rows.map((r) => String(r.config_key));
}

/**
 * DOES THIS SUBJECT TYPE HAVE A CLOSER? Registered by `server/index.ts` at
 * boot, the same shape `setVetoWindowCheck` uses and for the same reason: the
 * closer table lives beside the executors it dispatches to, and this module
 * asks it rather than keeping a second list that would drift the day a lane
 * adds a subject.
 */
let closerCheck: ((subjectType: string) => boolean) | null = null;

export function setSubjectCloserCheck(fn: ((subjectType: string) => boolean) | null): void {
  closerCheck = fn;
}

export interface OpenBallotInput {
  subjectType: string;
  subjectRef: string;
  title: string;
  docMarkdown: string;
  method: BallotMethod;
  weightMode: WeightMode;
  weightToken?: string | null;
  unityPct: number;
  quorumPct: number;
  /** Days until closes_at (vote days, or the consent window). */
  durationDays: number;
  openedBy: string;
  /** The frozen who-and-how-much. Weights already resolved by the caller. */
  electorate: Array<{ userId: string; weight: number }>;
  /**
   * Runs INSIDE the open transaction, after the ballot and electorate rows
   * are written: the subject's own status flip, so "a ballot exists" and
   * "the subject says it is being voted on" commit together or never.
   */
  onOpen?: (conn: PoolConnection, ballotId: string) => Promise<void>;
  /** Dispatcher lane, 0172: at_acceptance or next_moon. Defaults to next_moon. */
  timing?: ProposalTiming;
  /**
   * WINDOWS LANE (19E): what this opening carries, for the window gate below.
   *
   * Optional because a ceremony carries nothing beyond its subject type, which
   * `openBallot` already has. A change set passes its element kinds so the
   * strictest element decides, and anything coming back passes the instant the
   * decision it answers closed, so the grace can be measured from it.
   */
  window?: {
    elements?: readonly string[];
    comingBackFrom?: Date | null;
    relation?: string | null;
  };
}

export type OpenBallotResult =
  | { ok: true; ballot: BallotRow }
  | { ok: false; error: string; alreadyOpen?: BallotRow };

/**
 * Open a ballot: one transaction writing the snapshot whole. Fail-closed on
 * an empty electorate or zero total weight, with the sentence saying why —
 * a vote nobody could cast, or one where no cast could count, must refuse to
 * exist rather than sit unwinnable.
 */
export async function openBallot(pool: Pool, input: OpenBallotInput): Promise<OpenBallotResult> {
  /*
   * DISPATCHER LANE: a binding ballot may not open on a subject nobody can
   * close. `server/index.ts` registers the check at boot with its own closer
   * table, so this module holds no second copy of which subjects bind, and a
   * build with no check registered opens exactly as it always did.
   */
  const refusal = closerCheck ? noCloserRefusal(input.subjectType, closerCheck(input.subjectType)) : null;
  if (refusal) return { ok: false, error: refusal };
  const electorate = input.electorate.filter((e) => e.userId);
  if (electorate.length === 0) {
    return { ok: false, error: "Nobody is eligible to vote on this, so the ballot refuses to open. Check who holds ballot.vote and, in custom mode, who holds weight" };
  }
  const totalWeight = electorate.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (!(totalWeight > 0)) {
    return { ok: false, error: "The electorate's total voting weight is zero, so no vote could ever count. Allocate weight before opening a ballot" };
  }
  const days = Math.max(1, Math.min(90, Math.trunc(input.durationDays) || 1));
  const id = `bal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const openKey = `${input.subjectType}:${input.subjectRef}`;
  /*
   * THE VOTING WINDOW IS SET BY THIS PROCESS'S CLOCK, NEVER THE DATABASE'S.
   *
   * These two were `NOW()` and `DATE_ADD(NOW(), INTERVAL ? DAY)`, and every
   * reader compares them against `Date.now()`: whether a vote is still
   * accepted (`castVote`), whether a ballot may be closed early
   * (`closeBallot`), and which bucket it falls in
   * (`ballotsNeedingAttention`). `NOW()` is the database server's wall clock
   * in the database SESSION's zone, so those five comparisons were reading
   * one clock against another and were correct only because
   * `server/db/pool.ts` runs `SET time_zone = '+00:00'` on every connection.
   * A close time that moves with a server setting is a hole in the snapshot
   * law: too early cuts a decision short, too late gives the electorate a
   * window nobody agreed to.
   *
   * `opens_at` and `closes_at` are `datetime`, not `timestamp` (0089), so
   * MySQL applies no zone conversion in either direction and mysql2 renders
   * and parses under `timezone: "Z"`. A bound Date is therefore the same
   * instant coming back out on ANY server, with nothing to configure. The
   * only other place that compares this column is `ballotsNeedingAttention`,
   * which binds its own boundary for exactly this reason; the two agree by
   * construction now instead of by both happening to ask MySQL.
   *
   * Whole seconds because the column holds whole seconds, so the stored value
   * is the value every reader gets rather than a rounded neighbour. (Same
   * truncation as `readInstant` in base-reads.ts, written out here instead of
   * imported: governance has no business depending on the chain-read module.)
   */
  const opensAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  /*
   * THE GOVERNANCE WINDOW GATES THE OPENING, AND ONLY THE OPENING (19E).
   *
   * It sits here rather than in each route so every door into a village-wide
   * vote passes the same gate and a route added later cannot forget it. A
   * village that has set no window reads `always_open` for every kind, which is
   * the platform default, so this is a no-op until somebody chooses otherwise.
   * Nothing below this line ever closes a ballot: a window shutting while a
   * vote runs changes nothing about that vote.
   */
  const closed = openingRefusal({
    subjectType: input.subjectType,
    elements: input.window?.elements,
    durationDays: days,
    at: opensAt,
    comingBackFrom: input.window?.comingBackFrom ?? null,
    relation: input.window?.relation ?? null,
  });
  if (closed) return { ok: false, error: closed };
  const closesAt = new Date(opensAt.getTime() + days * 24 * 60 * 60 * 1000);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, " +
        "weight_mode, weight_token, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, " +
        "opens_at, closes_at, timing, status) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, ?, ?, 'open')",
      [
        id,
        input.subjectType,
        input.subjectRef,
        openKey,
        input.title.slice(0, 200),
        input.docMarkdown,
        input.method,
        input.weightMode,
        input.weightToken ?? null,
        input.unityPct,
        input.quorumPct,
        totalWeight,
        electorate.length,
        input.openedBy,
        opensAt,
        closesAt,
        input.timing ?? defaultTimingFor(kindOfSubject(input.subjectType)),
      ],
    );
    for (const e of electorate) {
      await conn.query("INSERT INTO ballot_electorate (ballot_id, user_id, weight) VALUES (?,?,?)", [ // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
        id,
        e.userId,
        Math.max(0, e.weight),
      ]);
    }
    if (input.onOpen) await input.onOpen(conn, id);
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    conn.release();
    if (e?.code === "ER_DUP_ENTRY") {
      const existing = await openBallotFor(pool, input.subjectType, input.subjectRef);
      return {
        ok: false,
        error: "A ballot is already open on this. One decision, one ballot",
        alreadyOpen: existing ?? undefined,
      };
    }
    throw e;
  }
  conn.release();
  const ballot = await ballotById(pool, id);
  if (!ballot) throw new Error(`ballot ${id} vanished inside its own open`);
  return { ok: true, ballot };
}

/**
 * Weighted sums per choice, read from the frozen electorate.
 *
 * THRESHOLDS LANE: takes the ballot itself where the caller has it, because
 * whether a DELEGATED row counts is a property of the ballot's own bar
 * (`delegatedRowsCountOn`, shared/ballotSubjects.ts): a vote conducted at 100
 * unity asks every member who takes a side to agree in person, so a row
 * carrying a neighbour's choice counts toward nothing there. Handed an id, it
 * reads the row, so no caller can get the arithmetic wrong by passing less.
 */
export async function talliesFor(pool: Pool, ballot: string | BallotRow): Promise<BallotTallies> {
  const row = typeof ballot === "string" ? await ballotById(pool, ballot) : ballot;
  const ballotId = typeof ballot === "string" ? ballot : ballot.id;
  const countsDelegated = row
    ? delegatedRowsCountOn({ subjectType: row.subjectType, unityPct: row.unityPct })
    : true;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT v.choice, COALESCE(SUM(e.weight), 0) AS w FROM ballot_votes v " +
      "JOIN ballot_electorate e ON e.ballot_id = v.ballot_id AND e.user_id = v.user_id " +
      "WHERE v.ballot_id = ?" +
      (countsDelegated ? "" : " AND v.followed_user_id IS NULL") +
      " GROUP BY v.choice",
    [ballotId],
  );
  const t: BallotTallies = { yesW: 0, noW: 0, abstainW: 0 };
  for (const r of rows) {
    if (r.choice === "yes") t.yesW = Number(r.w);
    else if (r.choice === "no") t.noW = Number(r.w);
    else if (r.choice === "abstain") t.abstainW = Number(r.w);
  }
  return t;
}

/**
 * Objections that stand between this ballot and passing: the unruled (`open`)
 * and the upheld (`integrated`). A concern is recorded and does not block; a
 * withdrawal is a retraction. An INTEGRATED objection blocks by design
 * (GOV_DESIGN 2.4): it means the proposal must change, so the ballot closes
 * as failed and the subject returns to staging for a fresh ballot.
 */
export async function standingObjectionCount(pool: Pool, ballotId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM ballot_objections WHERE ballot_id = ? AND status IN ('open','integrated')",
    [ballotId],
  );
  return Number(row.n);
}

export type VoteResult = { ok: true; choice: VoteChoice } | { ok: false; error: string };

/**
 * WHY SOMEBODY IS OFF A ROLL, worked out by the caller and handed in.
 *
 * This file holds no capability context on purpose: variables, capabilities
 * and subject-table flips live with the routes, which is what lets the unit
 * tests prove the snapshot law without a registry in sight. So the route
 * reads the gate and passes the two facts down, and the sentence a member
 * reads stays here beside the rule it explains.
 */
export interface VoterStanding {
  /** Does this member hold `ballot.vote` at this moment? */
  mayVoteNow: boolean;
  /**
   * Is a warning badge the thing refusing it? False for everybody since 0109:
   * a badge can no longer take a voice away, so the gate never reaches its
   * deny step on this key. Kept so the refusal has somewhere to put a cause
   * that is not the clock. See `offRollSentence`.
   */
  deniedByWarning: boolean;
}

/**
 * WHAT TO TELL SOMEBODY WHO IS NOT ON A ROLL, AND WHY THIS TAKES FOUR CASES.
 *
 * This used to be one sentence for every one of them: "Who may vote froze
 * when it opened." That is true of exactly one of the four, and for the
 * others it names TIMING as the cause of something timing did not cause.
 *
 * `buildElectorate` runs the one gate over every member at open. A warning
 * badge used to be able to refuse `ballot.vote` there, so its holder was left
 * off every roll built afterwards, opened the vote, was told the roll froze,
 * and had no way at all to learn from the product that a warning was the
 * reason. The freeze was named and the cause was hidden. That is the same
 * shape as an outcome card telling a village a decision it carried did not
 * carry: a sentence that is true of one situation, served for a different one.
 *
 * R56 is the other half. State what is true, then get out of the way: the
 * reason is a fact somebody is owed, and it is said once, flatly, with
 * nothing in it about what they should have done differently.
 *
 * TWO OF THESE FOUR NOW HAVE NO CALLER, and both are kept on purpose.
 *
 * The warning case is the first. R65/R66 (0109) removed the ability to take a
 * voice away, so `DENIABLE` marks `ballot.vote` as a key no deny may reach
 * and `capabilityDecision` can no longer answer "denied by warning badge" for
 * it. No caller can set `deniedByWarning` any more. The sentence stays
 * because deleting it would leave the next reason the gate refuses this key
 * borrowing the freeze's words, which is the exact defect this function was
 * written to end.
 *
 * The last case is the second: the caller could not work anything out. It
 * says what this file knows for certain and names no cause at all, which is
 * the fail-safe direction for any later caller that cannot read the gate. It
 * is also the first half of the sentence all four of these replace, word for
 * word, because that half was never the part that lied.
 */
export function offRollSentence(standing?: VoterStanding): string {
  if (!standing) return "You are outside this ballot's electorate, so this vote is not open to you";
  if (standing.deniedByWarning) {
    return "A warning on your account is holding voting back at the moment, so you were not on the roll when this vote opened";
  }
  if (!standing.mayVoteNow) {
    return "You are not on this ballot's roll. Voting is not open to your account at the moment, so you were not on the roll when this vote opened";
  }
  return "You are not on this ballot's roll. It froze when this vote opened and you were not on it then. A vote opened from now on takes the roll as it stands at that moment";
}

/**
 * Cast or change a vote: a PK upsert, allowed while the ballot is `open` and
 * the clock has not passed `closes_at`. Only frozen electorate members vote,
 * and their weight is read at tally time from the frozen row — never here.
 * In consent mode a `no` requires a reason and auto-files an objection (one
 * open objection per voter from this path; re-voting `no` updates it).
 */
export async function castVote(
  pool: Pool,
  ballotId: string,
  userId: string,
  choiceRaw: string,
  reason?: string,
  /** The gate's answer about this member, read by the route. See below. */
  standing?: VoterStanding,
): Promise<VoteResult> {
  const choice = String(choiceRaw) as VoteChoice;
  if (!VOTE_CHOICES.includes(choice)) {
    return { ok: false, error: "A vote is yes, no, or abstain" };
  }
  const ballot = await ballotById(pool, ballotId);
  if (!ballot) return { ok: false, error: "No such ballot" };
  if (ballot.status !== "open") {
    return { ok: false, error: `This ballot is ${ballot.status.replace("_", " ")}. Voting ended when it closed` };
  }
  // One clock. `closes_at` is written from this process in `openBallot`, so
  // this subtraction is two readings of the same clock and holds on a database
  // in any zone. It used to hold only while the pool pinned the session.
  if (Date.parse(ballot.closesAt) <= Date.now()) {
    return { ok: false, error: "The voting period has ended. Votes are locked until a human closes the ballot" };
  }
  const [inRoll] = await pool.query<RowDataPacket[]>(
    "SELECT weight FROM ballot_electorate WHERE ballot_id = ? AND user_id = ?",
    [ballotId, userId],
  );
  if (!inRoll[0]) return { ok: false, error: offRollSentence(standing) };
  const cleanReason = String(reason ?? "").trim().slice(0, 2000);
  if (ballot.method === "consent" && choice === "no" && !cleanReason) {
    return { ok: false, error: "A no in consent mode is an objection, and an objection carries its reasoning. Say why" };
  }
  // DELEGATION (0174): `followed_user_id` NULL is what "I decided this myself"
  // means, and it is written explicitly here so that a member who had been
  // following somebody takes their own row back the moment they vote. Every
  // delegation-derived row is guarded on that column being set, so an own vote
  // is never overwritten afterwards.
  await pool.query( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
    "INSERT INTO ballot_votes (ballot_id, user_id, choice, reason, followed_user_id) VALUES (?,?,?,?,NULL) " +
      "ON DUPLICATE KEY UPDATE choice = VALUES(choice), reason = VALUES(reason), followed_user_id = NULL",
    [ballotId, userId, choice, cleanReason || null],
  );
  if (ballot.method === "consent" && choice === "no") {
    const [mine] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM ballot_objections WHERE ballot_id = ? AND user_id = ? AND status = 'open' LIMIT 1",
      [ballotId, userId],
    );
    if (mine[0]) {
      await pool.query("UPDATE ballot_objections SET text = ? WHERE id = ?", [cleanReason, String(mine[0].id)]); // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
    } else {
      await fileObjection(pool, ballotId, userId, cleanReason);
    }
  }
  // DELEGATION (0174): everyone whose chain ends at this voter and who has not
  // decided for themselves now carries this choice, stamped with who decided
  // it. Copying the choice keeps the weight where it froze, so this write
  // moves no frozen column and the participation count stays one row per
  // member. See server/lib/delegation.ts for why one routine derives the whole
  // ballot rather than patching the members who look affected.
  await applyDelegatedVotes(pool, ballotId);
  return { ok: true, choice };
}

export async function fileObjection(
  pool: Pool,
  ballotId: string,
  userId: string,
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "An objection is its reasoning. Say what consequence or risk you see" };
  const ballot = await ballotById(pool, ballotId);
  if (!ballot) return { ok: false, error: "No such ballot" };
  if (ballot.method !== "consent") {
    return { ok: false, error: "Objections belong to consent ballots. On a voting ballot, vote no and say why" };
  }
  if (ballot.status !== "open") return { ok: false, error: "This ballot has closed" };
  const [inRoll] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM ballot_electorate WHERE ballot_id = ? AND user_id = ?",
    [ballotId, userId],
  );
  if (!inRoll[0]) return { ok: false, error: "Objections come from the ballot's own electorate" };
  const id = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
    "INSERT INTO ballot_objections (id, ballot_id, user_id, text, status) VALUES (?,?,?,?,'open')",
    [id, ballotId, userId, clean],
  );
  return { ok: true, id };
}

export const OBJECTION_RULINGS = ["integrated", "concern", "withdrawn"] as const;
export type ObjectionRuling = (typeof OBJECTION_RULINGS)[number];

/**
 * Rule an objection (S3.0 step 6, "test arguments as objections"). Every
 * ruling writes who, when and why: the judgment is on the record, which is
 * what keeps a facilitator honest. Only `open` objections take a ruling.
 */
export async function ruleObjection(
  pool: Pool,
  input: { objectionId: string; ruling: string; ruledBy: string; note: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ruling = String(input.ruling) as ObjectionRuling;
  if (!OBJECTION_RULINGS.includes(ruling)) {
    return { ok: false, error: "A ruling is integrated, concern, or withdrawn" };
  }
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (!note) return { ok: false, error: "Every ruling carries its reasoning. Say why" };
  const [result] = await pool.query<any>(
    "UPDATE ballot_objections SET status = ?, ruled_by = ?, ruled_at = NOW(), ruling_note = ? " +
      "WHERE id = ? AND status = 'open'",
    [ruling, input.ruledBy, note, input.objectionId],
  );
  if (Number(result.affectedRows) === 0) {
    return { ok: false, error: "That objection is already ruled, or does not exist" };
  }
  return { ok: true };
}

export async function objectionsFor(pool: Pool, ballotId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ballot_objections WHERE ballot_id = ? ORDER BY created_at, id",
    [ballotId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    text: String(r.text),
    status: String(r.status) as "open" | ObjectionRuling,
    ruledBy: r.ruled_by ?? null,
    ruledAt: r.ruled_at ? iso(r.ruled_at) : null,
    rulingNote: r.ruling_note ?? null,
    createdAt: iso(r.created_at),
  }));
}

/**
 * ── THE QUORUM FRACTION WHEN PART OF THE ROLL IS OUTSIDE IT (19G) ───────────
 *
 * THRESHOLDS LANE, minimal named edit. A village that has seated a voice for a
 * being that is not a person decides, through
 * `governance.nonhuman_in_quorum`, whether that seat's weight is part of the
 * count. Off is the shipped answer, and it takes the weight out of BOTH sides
 * of the fraction: numerator and denominator move together, because taking it
 * out of one alone would either report more than 100% turnout or ask the
 * remaining seats to carry weight nobody can cast.
 *
 * Unity is untouched, so the being's cast vote still counts toward agreement.
 * That is 19G's own sentence and it is why the exclusion cannot simply be a
 * zero weight on the frozen electorate row.
 *
 * WHAT THIS READS LIVE, AND WHY IT IS SAID OUT LOUD. The frozen roll and its
 * weights come from `ballot_electorate` and are as immutable as ever. Which
 * seats speak for a being, and the village's own setting, are read at close,
 * because neither `ballots` nor `ballot_electorate` has a column to freeze
 * them into and this lane writes no migration. A lane that does should freeze
 * the quorum base on the ballot row at open and this function should read it;
 * until then, a village that seats a being mid-ballot changes that ballot's
 * denominator, which is a smaller drift than the snapshot law usually allows
 * and is recorded here so nobody has to rediscover it.
 */
export interface QuorumFacts {
  arithmetic: QuorumArithmetic;
  base: QuorumBase;
  /**
   * Whether the roles plane could answer at all. False means the flag is not
   * on this database yet, which is "could not tell" and never "no seat speaks
   * for a being".
   */
  known: boolean;
  /** True when some of the frozen weight is outside the count. */
  reduced: boolean;
}

export async function quorumFactsFor(
  pool: Pool,
  ballot: BallotRow,
  abstainPolicy: AbstainPolicy = "counts_toward_quorum",
): Promise<QuorumFacts> {
  const [rollRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
    "SELECT user_id, weight FROM ballot_electorate WHERE ballot_id = ?",
    [ballot.id],
  );
  const roll = rollRows.map((r) => ({ userId: String(r.user_id), weight: Number(r.weight) || 0 }));
  const policy = quorumPolicyFrom((key) => stringVar(key));
  const facts = await seatFacts(pool, {
    roll,
    absentCycles: Number(numberVar("governance.absent_cycles")) || ABSENT_CYCLES_DEFAULT,
    clock: clockFor(stringVar("cycle.mode")),
  });
  const base = quorumBaseOf(facts.seats, policy);
  const excluded = new Set(
    facts.seats
      .filter((seat) => (seat.nonHuman && !policy.nonHumanInQuorum) || seat.canVote === false)
      .map((seat) => seat.userId),
  );
  let answeredWeight = 0;
  if (base.excludedWeight > 0) {
    const countsDelegated = delegatedRowsCountOn({
      subjectType: ballot.subjectType,
      unityPct: ballot.unityPct,
    });
    const [voteRows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
      "SELECT v.user_id, v.choice, e.weight FROM ballot_votes v " +
        "JOIN ballot_electorate e ON e.ballot_id = v.ballot_id AND e.user_id = v.user_id " +
        "WHERE v.ballot_id = ?" +
        (countsDelegated ? "" : " AND v.followed_user_id IS NULL"),
      [ballot.id],
    );
    for (const r of voteRows) {
      if (excluded.has(String(r.user_id))) continue;
      if (abstainPolicy === "no_answer" && r.choice === "abstain") continue;
      answeredWeight += Math.max(0, Number(r.weight) || 0);
    }
  }
  return {
    arithmetic: { answeredWeight, baseWeight: base.baseWeight },
    base,
    known: facts.known,
    reduced: base.excludedWeight > 0,
  };
}

/**
 * ── HOW MANY TIMES IN A ROW THIS SUBJECT MISSED QUORUM (19F, 20.11) ─────────
 *
 * THRESHOLDS LANE, minimal named edit. The founder's sentence, "if there is 3
 * cycles without quorum it just doesn't pass", needed a counter and had none.
 * The closes are already on the record, so the counter is a read of them:
 * every ballot ever opened on this subject, newest close first, counted until
 * one of them was decided.
 *
 * `open_key` is rewritten at close to free the subject, so the pair that
 * identifies a subject across its ballots is (`subject_type`, `subject_ref`),
 * which is what `ballotsFor` already keys on.
 */
export async function noQuorumStreak(
  pool: Pool,
  subjectType: string,
  subjectRef: string,
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home (the intents.ts pattern; no cache sits above them)
    "SELECT status FROM ballots WHERE subject_type = ? AND subject_ref = ? " +
      "ORDER BY COALESCE(closed_at, opens_at) DESC, id DESC",
    [subjectType, subjectRef],
  );
  return consecutiveNoQuorum(rows.map((r) => ({ status: String(r.status) })));
}

export interface CloseBallotInput {
  ballotId: string;
  closedBy: string;
  outcomeNote: string;
  /** True when the closer holds proposal.decide or is an admin. */
  closerMayCloseEarly: boolean;
}

export type CloseBallotResult =
  | {
      ok: true;
      outcome: BallotOutcome;
      ballot: BallotRow;
      tallies: BallotTallies;
      unity: number;
      quorum: number;
      /**
       * THRESHOLDS LANE (19G): the weight outside the quorum count, so a
       * surface can say it beside the people count without asking again.
       */
      quorumBase: QuorumBase;
      /**
       * THRESHOLDS LANE (19F, 20.11): where this subject stands against the
       * three-misses rule, present only on a close that missed quorum.
       */
      quorumMiss?: QuorumMissReading;
    }
  | { ok: false; error: string; alreadyClosed?: BallotRow };

/**
 * The guarded human close (GOV_DESIGN 2.5). Computes the outcome from the
 * frozen snapshot, then takes the one transition:
 *
 *   UPDATE ballots SET status=?, outcome_note=?, closed_by=?, closed_at=NOW(),
 *          open_key=CONCAT(open_key, ':', id)
 *    WHERE id=? AND status='open'
 *
 * Zero rows affected = someone else closed it first: return the current
 * state, execute nothing. The open_key rewrite frees the subject for a
 * fresh ballot; snapshots are immutable, so an amendment is a NEW ballot.
 */
export async function closeBallot(pool: Pool, input: CloseBallotInput): Promise<CloseBallotResult> {
  const note = String(input.outcomeNote ?? "").trim().slice(0, 4000);
  if (!note) {
    return { ok: false, error: "Closing a ballot records the outcome in a human sentence. The note is required" };
  }
  const ballot = await ballotById(pool, input.ballotId);
  if (!ballot) return { ok: false, error: "No such ballot" };
  if (ballot.status !== "open") {
    return { ok: false, error: `This ballot is already ${ballot.status.replace("_", " ")}`, alreadyClosed: ballot };
  }
  // Same one clock as `castVote` (see `openBallot`). This flag decides who may
  // close and whether a consent ballot may pass, so an offset here would hand
  // or withhold that right by accident.
  const expired = Date.parse(ballot.closesAt) <= Date.now();
  const tallies = await talliesFor(pool, ballot);
  const openObjections = ballot.method === "consent" ? await standingObjectionCount(pool, ballot.id) : 0;
  /*
   * WHAT THIS SUBJECT ASKS BEYOND THE DIALS.
   *
   * The dials were frozen at open and the snapshot law protects them. These
   * two are not dials: they are what the SUBJECT means by an abstention and
   * by agreement, and they are read from the registry rather than the row
   * because they are the platform's reading of the founder's sentence, not a
   * number the village set. The Birthing asks every seat for a yes; every
   * other subject keeps the Hypha rule and this changes nothing about it.
   */
  const subjectRules = evaluationRulesFor(ballot.subjectType);
  const heads = subjectRules.minYesHeads === undefined ? undefined : await headsFor(pool, ballot);
  if (!expired && !input.closerMayCloseEarly) {
    return {
      ok: false,
      error: "The voting period is still running. Before it ends, only a proposal.decide holder or an admin may close a ballot",
    };
  }
  /*
   * THRESHOLDS LANE (19G). The quorum fraction, worked out over the seats this
   * village counts. A ballot with nothing excluded gets `reduced: false` and
   * the engine falls back to the frozen total, so every existing village's
   * arithmetic is byte for byte what it was.
   */
  const quorumFacts = await quorumFactsFor(pool, ballot, subjectRules.abstainPolicy);
  const outcome = evaluateBallot({
    method: ballot.method,
    unityPct: ballot.unityPct,
    quorumPct: ballot.quorumPct,
    totalWeight: ballot.totalWeight,
    tallies,
    openObjections,
    abstainPolicy: subjectRules.abstainPolicy,
    minYesHeads: subjectRules.minYesHeads,
    heads,
    quorum: quorumFacts.reduced ? quorumFacts.arithmetic : undefined,
  });
  if (!expired && outcome === "passed") {
    /*
     * A BALLOT PASSES WHEN ITS WINDOW ENDS AND NEVER BEFORE (dispatcher lane).
     *
     * This was the consent method's rule alone, and the reason it gave was
     * about silence. There is a second reason now and it applies to every
     * method: `lands_at` derives from the frozen `closes_at`, so an early
     * close would hand the steward's window to whoever pressed the button.
     * The proposer would choose which three days a steward got. So the
     * refusal covers every method, and the settlement path closes ballots on
     * the clock instead.
     */
    return {
      ok: false,
      error:
        ballot.method === "consent"
          ? "A consent ballot passes only after its window ends. It can close early only against a standing objection"
          : "A ballot passes when its window ends and not before. The clock closes it, so nobody chooses the moment",
    };
  }
  const [result] = await pool.query<any>(
    "UPDATE ballots SET status=?, outcome_note=?, closed_by=?, closed_at=NOW(), open_key=CONCAT(open_key, ':', id) " +
      "WHERE id=? AND status='open'",
    [outcome, note, input.closedBy, ballot.id],
  );
  if (Number(result.affectedRows) === 0) {
    const current = await ballotById(pool, ballot.id);
    return { ok: false, error: "Someone else closed this ballot first", alreadyClosed: current ?? undefined };
  }
  const closed = await ballotById(pool, ballot.id);
  /*
   * THRESHOLDS LANE (19F, 20.11). The three-misses rule needs the count AFTER
   * this close is on the record, so it is read here and never before the
   * UPDATE. A close that reached quorum says nothing about it, because the
   * counter measures a bar nobody can reach and this one was reached.
   */
  const quorumMiss =
    outcome === "no_quorum"
      ? quorumMissReading({
          subjectType: ballot.subjectType,
          misses: await noQuorumStreak(pool, ballot.subjectType, ballot.subjectRef),
          quorumPct: ballot.quorumPct,
        })
      : undefined;
  return {
    ok: true,
    outcome,
    ballot: closed!,
    tallies,
    unity: unityPctOf(tallies),
    // The same abstain policy the outcome was decided under, and the same
    // quorum base, so the number the close reports and the number that
    // decided are one number.
    quorum: quorumFacts.reduced
      ? quorumPctOn(quorumFacts.arithmetic)
      : quorumPctOf(tallies, ballot.totalWeight, subjectRules.abstainPolicy),
    quorumBase: quorumFacts.base,
    quorumMiss,
  };
}

/**
 * The same question as `talliesFor`, counted in PEOPLE.
 *
 * Weight answers "how much of the village" and heads answer "how many of us",
 * and the founder's Birthing rule is written in heads: at least three
 * different parties, every one of them saying yes. `evaluateBallot` is the
 * one place that decides an outcome, so it is handed both.
 *
 * `electorate_count` is already frozen on the ballot row at open, so the
 * denominator needs no query and cannot drift from the roll the vote was
 * asked of.
 */
export async function headsFor(pool: Pool, ballot: BallotRow): Promise<HeadCounts> {
  // THRESHOLDS LANE: the same delegated-row rule `talliesFor` applies, for the
  // same reason. A head that was never lifted is not a head.
  const countsDelegated = delegatedRowsCountOn({
    subjectType: ballot.subjectType,
    unityPct: ballot.unityPct,
  });
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT v.choice, COUNT(*) AS n FROM ballot_votes v " +
      "JOIN ballot_electorate e ON e.ballot_id = v.ballot_id AND e.user_id = v.user_id " +
      "WHERE v.ballot_id = ?" +
      (countsDelegated ? "" : " AND v.followed_user_id IS NULL") +
      " GROUP BY v.choice",
    [ballot.id],
  );
  const heads: HeadCounts = {
    yesHeads: 0,
    noHeads: 0,
    abstainHeads: 0,
    electorateCount: Number(ballot.electorateCount) || 0,
  };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (r.choice === "yes") heads.yesHeads = n;
    else if (r.choice === "no") heads.noHeads = n;
    else if (r.choice === "abstain") heads.abstainHeads = n;
  }
  return heads;
}

/** How many votes stand on a ballot. Cheap, and it decides who may withdraw. */
export async function voteCount(pool: Pool, ballotId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM ballot_votes WHERE ballot_id = ?",
    [ballotId],
  );
  return Number(row.n);
}

export interface WithdrawBallotInput {
  ballotId: string;
  withdrawnBy: string;
  /** Required, same posture as an outcome note: a cancellation is a record. */
  reason: string;
  /**
   * True when the withdrawer holds proposal.decide or is an admin. Only they
   * may withdraw a ballot people have already voted on.
   */
  withdrawerMayDiscardVotes: boolean;
}

export type WithdrawBallotResult =
  | { ok: true; ballot: BallotRow; votesDiscarded: number }
  | { ok: false; error: string; alreadyClosed?: BallotRow };

/**
 * Call a ballot off (0089 declared `status='withdrawn'` and gave it UI
 * treatment; no route ever wrote it, so a vote opened in error had no way out
 * and the interface implied one).
 *
 * A withdrawal is a close that decides NOTHING. It takes the same guarded
 * single transition the close takes, records who and when and why in the same
 * three columns the decision page already reads, and rewrites `open_key` so
 * the subject is free for a fresh ballot immediately. It never evaluates,
 * never executes, and never writes an outcome: `status='withdrawn'` is its own
 * fact and reads as neither passed nor failed.
 *
 * WHO MAY, and the reason the rule is not just "whoever opened it": a
 * withdrawal throws away votes that members already cast, and cast votes are
 * the one thing in this engine that belongs to somebody other than the opener.
 * So an opener may call off a ballot NOBODY HAS ANSWERED YET, which is the
 * opened-in-error case this exists for, and once even one vote stands the act
 * needs a proposal.decide holder or an admin. `votesDiscarded` comes back so
 * the caller can say in words what the withdrawal cost.
 */
export async function withdrawBallot(pool: Pool, input: WithdrawBallotInput): Promise<WithdrawBallotResult> {
  const reason = String(input.reason ?? "").trim().slice(0, 4000);
  if (!reason) {
    return { ok: false, error: "Calling off a vote records why, in a human sentence. The reason is required" };
  }
  const ballot = await ballotById(pool, input.ballotId);
  if (!ballot) return { ok: false, error: "No such ballot" };
  if (ballot.status !== "open") {
    return {
      ok: false,
      error: `This ballot is already ${ballot.status.replace("_", " ")}, so there is nothing to call off`,
      alreadyClosed: ballot,
    };
  }
  const votes = await voteCount(pool, ballot.id);
  if (votes > 0 && !input.withdrawerMayDiscardVotes) {
    return {
      ok: false,
      error: `${votes} member(s) have already voted on this. Discarding votes that are already cast takes a proposal.decide holder or an admin. Close it and record the outcome instead`,
    };
  }
  const [result] = await pool.query<any>(
    "UPDATE ballots SET status='withdrawn', outcome_note=?, closed_by=?, closed_at=NOW(), " +
      "open_key=CONCAT(open_key, ':', id) WHERE id=? AND status='open'",
    [reason, input.withdrawnBy, ballot.id],
  );
  if (Number(result.affectedRows) === 0) {
    const current = await ballotById(pool, ballot.id);
    return { ok: false, error: "Someone else closed this ballot first", alreadyClosed: current ?? undefined };
  }
  const withdrawn = await ballotById(pool, ballot.id);
  return { ok: true, ballot: withdrawn!, votesDiscarded: votes };
}

export interface UncastResult {
  /** 1 when a delegated row went, 0 when there was none to take back. */
  removed: number;
  /**
   * False when the ballot is not taking votes. A caller reporting "0 removed"
   * has to be able to say whether nothing was following here or whether the
   * window had already shut, and those read the same in a count.
   */
  eligible: boolean;
  /** True when this act also ended the member's live delegation. */
  delegationEnded: boolean;
  /** Set only when the act was refused, in the sentence the member reads. */
  error?: string;
}

/**
 * TAKE MY VOTE BACK: the guarded door onto the one DELETE this engine
 * performs against `ballot_votes`.
 *
 * Both ways a copied choice can be repudiated end at
 * `deleteDelegatedRow` in server/lib/delegation.ts, which is the only
 * statement that removes a vote row and is guarded on `followed_user_id IS
 * NOT NULL` so it can never reach a vote somebody made themselves. Withdrawing
 * a delegation reaches it through the derivation, which finds nobody deciding
 * that member any more and removes the row; this function is the per-ballot
 * door, for a member who wants their voice back on one open vote.
 *
 * WHY IT ENDS THE DELEGATION TOO, by default. A row taken back while the
 * delegation still carries is a row the very next derivation writes again,
 * because the delegation is what put it there. A member who presses "take my
 * vote back" and watches the same choice reappear an instant later has been
 * told the control works when it does not. So the act takes the whole voice
 * back, and the answer says so in `delegationEnded`. A caller that wants the
 * bare delete (the derivation does) passes `endDelegation: false`.
 *
 * AND WHY QUORUM FALLS. The seat is not cast afterwards. It is not an
 * abstain: an abstain is a choice somebody made, and nobody made one here.
 * That is the same empty-versus-zero rule the rest of this file keeps.
 */
export async function uncastDelegatedVote(
  pool: Pool,
  ballotId: string,
  userId: string,
  opts?: { endDelegation?: boolean },
): Promise<UncastResult> {
  const ballot = await ballotById(pool, ballotId);
  if (!ballot) return { removed: 0, eligible: false, delegationEnded: false, error: "No such ballot" };
  if (ballot.status !== "open") {
    return {
      removed: 0,
      eligible: false,
      delegationEnded: false,
      error: `This ballot is ${ballot.status.replace("_", " ")}. Votes are on the record once it closes`,
    };
  }
  // One clock, the same subtraction castVote makes.
  if (Date.parse(ballot.closesAt) <= Date.now()) {
    return {
      removed: 0,
      eligible: false,
      delegationEnded: false,
      error: "The voting period has ended. Votes are locked until a human closes the ballot",
    };
  }
  // THE DELETE COMES FIRST, AND THE DELEGATION GOES ONLY IF SOMETHING WENT.
  // A member who delegated to somebody who has not voted has no row here to
  // take back, and revoking anyway would end their delegation while the
  // answer said "there was nothing here". Two different acts, and the caller
  // gets told which one happened.
  const removed = await deleteDelegatedRow(pool, ballotId, userId);
  const endDelegation = opts?.endDelegation !== false;
  const delegationEnded = removed > 0 && endDelegation ? await revokeDelegation(pool, userId) : false;
  // Everyone downstream of this member moves too, so the whole ballot is
  // re-derived rather than this one row patched. Same reason as everywhere
  // else: a routine that worked out who was affected would be a second copy
  // of the resolution rule.
  if (delegationEnded) await applyDelegatedVotes(pool, ballotId);
  return { removed, eligible: true, delegationEnded };
}

/**
 * A member's own vote, RAW, for the derivation and for anything counting.
 *
 * DELEGATION (0174): `followedUserId` is null on a vote this member made, and
 * otherwise names the member whose choice was copied here, at the END of the
 * chain. A member who handed their voice to B and was decided by C four hops
 * away reads C, because C is the concentration a delegator is owed a sight of.
 *
 * SERVE `ownVoteView` BELOW, NEVER THIS (0175). This function answers what is
 * in the row. While a ballot is open and choices are hidden, a delegated row's
 * choice is not the delegator's to read yet, and `ownVoteView` is the path
 * that holds it back. Sending this straight to a page reopens the disclosure
 * channel that acceptance and suppression were built to close.
 */
export async function voteOf(pool: Pool, ballotId: string, userId: string): Promise<{ choice: VoteChoice; reason: string | null; followedUserId: string | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT choice, reason, followed_user_id FROM ballot_votes WHERE ballot_id = ? AND user_id = ?",
    [ballotId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    choice: r.choice as VoteChoice,
    reason: r.reason ?? null,
    followedUserId: r.followed_user_id === null || r.followed_user_id === undefined ? null : String(r.followed_user_id),
  };
}

/**
 * A MEMBER'S OWN ROW AS A PAGE MAY READ IT (0175). The serving path.
 *
 * `voteOf` says what is in the row; this says what the member is owed right
 * now. The difference is one rule and it is the whole of it: while a ballot is
 * OPEN and the village hides choices, a row somebody else decided reports that
 * it was cast and who decided it, and not what it said. At the close the
 * choice arrives with everybody else's.
 *
 * `choicesHidden` DEFAULTS TO HIDDEN, which is the founder's ruling (Q12) and
 * the fail-safe direction: a caller that forgets to read the village's setting
 * holds a choice back, and a caller that forgets it in the other design leaks
 * one. The lane that builds the voter-identity control passes the village's
 * answer here; `voterIdentityNow()` in server/lib/delegation.ts resolves it.
 *
 * `nameOf` is optional because most callers already have a name resolver and
 * a member reading "Cast, following Ren" is owed a person rather than an id.
 * Without one the sentence names no id at all, which is the safe shape: an id
 * in player-facing copy is not a name, it is a leak of the identifier.
 *
 * `have` EXISTS FOR THE LIST PATHS. A page of ballot cards already reads the
 * viewer's row in the join that fetches their weight, and it cannot afford a
 * second query per card. Handing that row in skips the read and runs the same
 * one rule, which is the point: a list that shaped its own answer would be a
 * second copy of the suppression and would leak the first time the two drift.
 */
export async function ownVoteView(
  pool: Pool,
  ballot: Pick<BallotRow, "id" | "status">,
  userId: string,
  opts?: {
    nameOf?: (id: string) => Promise<string> | string;
    choicesHidden?: boolean;
    have?: { choice: unknown; reason?: unknown; followed_user_id?: unknown } | null;
  },
): Promise<OwnVoteFacts | null> {
  // `have: null` MEANS "I looked and there was no row", which is a different
  // answer from not passing `have` at all. Reading it as the second would send
  // a list path back to the database once per card to be told the same thing.
  const supplied = opts !== undefined && opts.have !== undefined;
  const raw = opts?.have ?? null;
  const row = supplied
    ? raw && raw.choice
      ? {
          choice: String(raw.choice) as VoteChoice,
          reason: raw.reason === null || raw.reason === undefined ? null : String(raw.reason),
          followedUserId:
            raw.followed_user_id === null || raw.followed_user_id === undefined
              ? null
              : String(raw.followed_user_id),
        }
      : null
    : await voteOf(pool, ballot.id, userId);
  if (!row) return null;
  const followedName =
    row.followedUserId && opts?.nameOf ? await opts.nameOf(row.followedUserId) : null;
  return hiddenChoiceView({
    ballotStatus: ballot.status,
    choicesHidden: opts?.choicesHidden !== false,
    choice: row.choice,
    reason: row.reason,
    followedUserId: row.followedUserId,
    followedName,
  });
}

/** Every vote, with weight: the Hypha voter-list posture, votes on the record. */
export async function votesFor(pool: Pool, ballotId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT v.user_id, v.choice, v.cast_at, v.updated_at, v.followed_user_id, e.weight FROM ballot_votes v " +
      "JOIN ballot_electorate e ON e.ballot_id = v.ballot_id AND e.user_id = v.user_id " +
      "WHERE v.ballot_id = ? ORDER BY v.cast_at, v.user_id",
    [ballotId],
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    choice: String(r.choice) as VoteChoice,
    weight: Number(r.weight),
    castAt: iso(r.cast_at),
    // DELEGATION (0174): who decided this row, or null when the member did.
    followedUserId: r.followed_user_id === null || r.followed_user_id === undefined ? null : String(r.followed_user_id),
  }));
}

// ── Who to tell, and when (round 5, lane NOTIFY) ─────────────────────────────
//
// The engine froze an electorate at open and then told nobody. A vote opened,
// ran its window and closed, and the only member who ever heard about it in
// the bell was the proposer. These three readers are what the notification
// spine needs to reach the people a ballot is actually asking.
//
// All three read the FROZEN roll (`ballot_electorate`), never a live member
// list, for the same reason every other evaluation does: the people asked are
// the people who were asked, and somebody who joined yesterday was not.

/** Everyone on the frozen roll. */
export async function electorateOf(pool: Pool, ballotId: string): Promise<string[]> {
  /*
   * ORDER BY is not decoration. Without it MySQL returns primary-key order,
   * (ballot_id, user_id), so the roll came back sorted by the SHAPE of the id
   * string: registration mints `user-<epoch>-<rand>` and bootstrap mints
   * `usr-<epoch>-<rand>`, and "user-" sorts before "usr-", so every ordinary
   * member was notified before the founder in every village, by accident.
   * Anything that walks this list sequentially (notifyRoll does) therefore had
   * a first and a last member decided by a naming convention nobody chose.
   * Stating the order does not make it meaningful; it makes it stable, which
   * is what a reader of position 1 of 4 needs.
   */
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM ballot_electorate WHERE ballot_id = ? ORDER BY user_id",
    [ballotId],
  );
  return rows.map((r) => String(r.user_id));
}

/**
 * On the roll, and still owes an answer. A LEFT JOIN and not a NOT IN: a
 * ballot with no votes at all makes `NOT IN (empty)` behave differently
 * across engines, and this shape reads the same everywhere.
 */
export async function awaitingVote(pool: Pool, ballotId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT e.user_id FROM ballot_electorate e " +
      "LEFT JOIN ballot_votes v ON v.ballot_id = e.ballot_id AND v.user_id = e.user_id " +
      "WHERE e.ballot_id = ? AND v.user_id IS NULL",
    [ballotId],
  );
  return rows.map((r) => String(r.user_id));
}

/**
 * Open ballots whose window shuts inside `hours`, and open ballots whose
 * window already shut. The second set is not a failure: closing is a human
 * act by design, so an expired-but-open ballot is a ballot waiting for a
 * person, and somebody has to be told which person.
 */
export async function ballotsNeedingAttention(
  pool: Pool,
  hours: number,
): Promise<{ closingSoon: BallotRow[]; pastWindow: BallotRow[] }> {
  /*
   * THE ONLY PLACE `closes_at` IS COMPARED INSIDE SQL, and it binds its
   * boundary from this process for the same reason `openBallot` writes the
   * column from this process. It read `closes_at <= (NOW() + INTERVAL ? HOUR)`
   * while the two filters below read `Date.parse(b.closesAt)` against
   * `Date.now()`, so one prefilter asked the database's clock and the split it
   * feeds asked this one. With the column now written process-side, asking
   * MySQL here would be the same mismatch pointing the other way: a whole
   * offset's worth of ballots would fall out of the prefilter before either
   * filter ever saw them, and a steward would simply never be told.
   *
   * One clock, three comparisons, and the boundary is visible in the code.
   */
  const horizon = new Date(Date.now() + Math.max(1, Math.floor(hours)) * 60 * 60 * 1000);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ballots WHERE status = 'open' AND closes_at <= ? ORDER BY closes_at",
    [horizon],
  );
  const now = Date.now();
  const all = rows.map(rowToBallot);
  return {
    closingSoon: all.filter((b) => Date.parse(b.closesAt) > now),
    pastWindow: all.filter((b) => Date.parse(b.closesAt) <= now),
  };
}
