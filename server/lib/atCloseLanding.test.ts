/**
 * A LANDING THAT SHOULD TAKE EFFECT AT THE CLOSE, AND THROWS.
 *
 * Pins `server/lib/atCloseLanding.ts` against the real landing path on the S5
 * harness:
 *
 *  - a `village_launch` whose executor throws at the close: the close resolves
 *    (a throw out of `routeOutcome` is the close route's 500), the vote stands,
 *    the row waits as pending with the error on its attempt, and the
 *    five-minute landing job lands it once the executor works;
 *  - a token send at acceptance whose executor throws at the close: the close
 *    resolves and the row is stalled with no instant;
 *  - a stalled one is never run again by the landing job, brake on or off,
 *    however far the clock moves;
 *  - both shapes are rows the failed-actions report (PR #247) reads.
 *
 * No TEST_DATABASE_URL: the database cases skip, and an unfiltered run fails on
 * the way out (house rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, type BallotRow } from "./ballots";
import {
  applyDueGovernance,
  autoSettleExpired,
  landingRow,
  routeOutcome,
  type CloseRouting,
  type LandingDeps,
  type SubjectCloser,
} from "./applyDue";
import {
  NOT_YET_NEEDS_A_PERSON,
  NOT_YET_RETRYING,
  atCloseFailureShape,
  notYetInEffectFor,
  notYetInEffectSentence,
} from "./atCloseLanding";
import { sqlInstant } from "../repos/ballotLandings";
import { VILLAGE_LAUNCH } from "../../shared/ballotSubjects";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[atCloseLanding] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");
}

const HOUR = 60 * 60 * 1000;
let db: TestDb;
let pool: mysql.Pool;
let n = 0;

/** How many times each ballot's executor ran, so "never again" is a count. */
const executes = new Map<string, number>();
/** Ballots whose executor throws right now. */
const failing = new Set<string>();

const quietSettle = async (): Promise<CloseRouting> => ({ applied: [], held: null, proposerTold: null });

const executor = (why: string): SubjectCloser["execute"] => async (b) => {
  executes.set(b.id, (executes.get(b.id) ?? 0) + 1);
  if (failing.has(b.id)) throw new Error(why);
  return { applied: [], held: null, proposerTold: null };
};

const CLOSERS: Record<string, SubjectCloser> = {
  [VILLAGE_LAUNCH]: { settle: quietSettle, execute: executor("the launch record could not be written") },
  token_send: { settle: quietSettle, execute: executor("the ledger refused the send") },
};

const deps = (over: Partial<LandingDeps> = {}): LandingDeps => ({
  pool,
  vetoHours: () => 72,
  autoApplyEnabled: () => true,
  stewardCouncil: () => false,
  stewardVetoTiers: () => "all",
  nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * 24 * HOUR),
  cycleNumberAt: () => 1,
  landingExpiryCycles: () => 3,
  closerFor: (subjectType: string) => CLOSERS[subjectType],
  notify: async () => {},
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
  ...over,
});

/** Open a ballot on the subject, everyone votes yes, and its window is moved into the past. */
const openExpired = async (subjectType: string, timing?: "at_acceptance"): Promise<BallotRow> => {
  n += 1;
  const opened = await openBallot(pool, {
    subjectType,
    subjectRef: `${subjectType}-at-close-${n}`,
    title: `At the close ${n}`,
    docMarkdown: "# What the village is deciding",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    ...(timing ? { timing } : {}),
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  for (const voter of ["u-a", "u-b", "u-c"]) {
    const v = await castVote(pool, opened.ballot.id, voter, "yes");
    if (!v.ok) throw new Error(`vote refused: ${v.error}`);
  }
  await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [new Date(Date.now() - 60_000), opened.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return opened.ballot;
};

/** Close it the way the human close route does, and hand back the closed row. */
const carried = async (subjectType: string, timing?: "at_acceptance"): Promise<BallotRow> => {
  const b = await openExpired(subjectType, timing);
  failing.add(b.id);
  const closed = await closeBallot(pool, {
    ballotId: b.id,
    closedBy: "u-a",
    outcomeNote: "The window ended and the village carried it.",
    closerMayCloseEarly: false,
  });
  if (!closed.ok || !closed.ballot || closed.outcome !== "passed") throw new Error(`close refused: ${JSON.stringify(closed)}`);
  return closed.ballot;
};

const attemptsOf = async (ballotId: string) => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id, last_error, cleared_at IS NULL AS still_open FROM governance_executor_pending WHERE ballot_id = ? ORDER BY id",
    [ballotId],
  );
  return rows.map((r) => ({ lastError: r.last_error == null ? null : String(r.last_error), open: Number(r.still_open) === 1 }));
};

/**
 * THE ROWS THE FAILED-ACTIONS REPORT LISTS, by its own statement.
 *
 * Copied from `stuckLandings` on `origin/wt/failed-actions` (PR #247, not on
 * main when this was written) and joined to the landing statuses it counts as
 * still owed, so this file proves the shapes appear on that report without
 * importing a branch that has not landed.
 */
const onFailedActionsReport = async (ballotId: string): Promise<boolean> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, mirrors the report's own read
    "SELECT p.ballot_id FROM governance_executor_pending p " +
      "JOIN (SELECT ballot_id, MAX(id) AS newest FROM governance_executor_pending GROUP BY ballot_id) n " +
      "ON n.ballot_id = p.ballot_id AND n.newest = p.id " +
      "WHERE p.cleared_at IS NULL AND (p.last_error IS NOT NULL OR p.claimed_at <= ?) AND p.ballot_id = ?",
    [sqlInstant(new Date(Date.now() - 10 * 60 * 1000)), ballotId],
  );
  const row = await landingRow(pool, ballotId);
  const owed = new Set(["not_applicable", "pending", "applying", "stalled"]);
  return rows.length === 1 && !!row && owed.has(row.landingStatus);
};

describe("which shape a failed at-close landing takes, and what a member reads", () => {
  it("retries only a subject whose executor was read and found safe to run twice, and stalls everything else", () => {
    expect(atCloseFailureShape("village_launch")).toBe("retrying");
    expect(atCloseFailureShape("token_send")).toBe("stalled");
    expect(atCloseFailureShape("quest_payout")).toBe("stalled");
    expect(atCloseFailureShape("founding_allocation")).toBe("stalled");
    expect(atCloseFailureShape("a_subject_added_next_year")).toBe("stalled");
  });

  it("says nothing unless a carried decision's newest attempt failed and is still open", () => {
    const failed = { lastError: "it broke", cleared: false };
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "pending", landsAt: new Date(), newestAttempt: failed })).toBe(NOT_YET_RETRYING);
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "stalled", landsAt: null, newestAttempt: failed })).toBe(NOT_YET_NEEDS_A_PERSON);
    // The brake's stall carries an instant and the job hands its window back, so it is not a person's to finish.
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "stalled", landsAt: new Date(), newestAttempt: failed })).toBeNull();
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "pending", landsAt: new Date(), newestAttempt: { lastError: "it broke", cleared: true } })).toBeNull();
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "pending", landsAt: new Date(), newestAttempt: { lastError: null, cleared: false } })).toBeNull();
    expect(notYetInEffectSentence({ status: "passed", landingStatus: "pending", landsAt: new Date(), newestAttempt: null })).toBeNull();
    expect(notYetInEffectSentence({ status: "failed", landingStatus: "pending", landsAt: null, newestAttempt: failed })).toBeNull();
  });
});

describe.skipIf(!configured)("a landing that throws inside the close", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  }, 300000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(() => {
    executes.clear();
    failing.clear();
  });

  it("a village_launch that throws at the close answers, stays carried, and the landing job lands it", async () => {
    const b = await carried(VILLAGE_LAUNCH);
    // The close route's own call. It must resolve: a throw here is the 500.
    const routing = await routeOutcome(deps(), b, "passed", "carried", "u-a");
    expect(executes.get(b.id)).toBe(1);
    expect(routing.outcome).toBe("passed");
    expect(routing.landingFailed).toBe("retrying");
    expect(routing.held).toBe(NOT_YET_RETRYING);

    const row = await landingRow(pool, b.id);
    expect(row?.status, "the vote result is recorded").toBe("passed");
    expect(row?.landingStatus).toBe("pending");
    expect(row?.landsAt, "an instant, so the landing job selects it").not.toBeNull();
    expect(await attemptsOf(b.id)).toEqual([{ lastError: "the launch record could not be written", open: true }]);
    expect(await notYetInEffectFor(pool, row!)).toBe(NOT_YET_RETRYING);
    expect(await onFailedActionsReport(b.id), "the failed-actions report lists it").toBe(true);

    // The existing mechanism tries again, and this time the executor works.
    failing.delete(b.id);
    const report = await applyDueGovernance(deps());
    expect(report.ran).toBe(true);
    expect(executes.get(b.id)).toBe(2);
    const landed = await landingRow(pool, b.id);
    expect(landed?.landingStatus).toBe("applied");
    const attempts = await attemptsOf(b.id);
    expect(attempts.length).toBe(2);
    expect(attempts[1]).toEqual({ lastError: null, open: false });
    expect(await notYetInEffectFor(pool, landed!)).toBeNull();
    expect(await onFailedActionsReport(b.id), "and drops it once it has landed").toBe(false);
  });

  it("a token send at acceptance that throws at the close answers and stalls with no instant", async () => {
    const b = await carried("token_send", "at_acceptance");
    const routing = await routeOutcome(deps(), b, "passed", "carried", "u-a");
    expect(executes.get(b.id)).toBe(1);
    expect(routing.outcome).toBe("passed");
    expect(routing.landingFailed).toBe("stalled");
    expect(routing.held).toBe(NOT_YET_NEEDS_A_PERSON);

    const row = await landingRow(pool, b.id);
    expect(row?.status, "the vote result is recorded").toBe("passed");
    expect(row?.landingStatus).toBe("stalled");
    expect(row?.landsAt, "no instant, so no job selects it").toBeNull();
    expect(await attemptsOf(b.id)).toEqual([{ lastError: "the ledger refused the send", open: true }]);
    expect(await notYetInEffectFor(pool, row!)).toBe(NOT_YET_NEEDS_A_PERSON);
    expect(await onFailedActionsReport(b.id), "the failed-actions report lists it").toBe(true);
  });

  it("never runs a stalled one again: not next tick, not across the brake, not months later", async () => {
    const b = await carried("token_send", "at_acceptance");
    await routeOutcome(deps(), b, "passed", "carried", "u-a");
    // Even an executor that would now succeed must not be run by a job.
    failing.delete(b.id);

    await applyDueGovernance(deps());
    await applyDueGovernance(deps({ autoApplyEnabled: () => false }));
    await applyDueGovernance(deps());
    await applyDueGovernance(deps(), new Date(Date.now() + 200 * 24 * HOUR));

    expect(executes.get(b.id), "the executor ran once, at the close, and never again").toBe(1);
    const row = await landingRow(pool, b.id);
    expect(row?.landingStatus).toBe("stalled");
    expect(row?.landsAt).toBeNull();
    expect((await attemptsOf(b.id)).length).toBe(1);
  });

  it("the close by the clock takes the same road, and its report says so", async () => {
    const b = await openExpired(VILLAGE_LAUNCH);
    failing.add(b.id);
    const report = await autoSettleExpired(deps(), closeBallot);
    expect(report.failed).toBe(0);
    expect(report.closed).toBeGreaterThanOrEqual(1);
    expect(report.notes.join("\n")).toContain(NOT_YET_RETRYING);
    expect((await landingRow(pool, b.id))?.landingStatus).toBe("pending");
  });
});
