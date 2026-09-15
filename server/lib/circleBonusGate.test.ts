/**
 * THE COMPLETION VOTE, READ OFF REAL BALLOTS ON A REAL SCHEMA.
 *
 * Every ballot in this file is opened, voted on and closed through the
 * governance engine's own functions. There is no hand-written row in `ballots`
 * and no stub of one: the seam under test is whether a vote about ONE circle's
 * commitment is found for that circle and for nothing else, and a test that
 * inserted its own rows would be proving something about a table nobody's code
 * produces.
 *
 * What is under test, in the order the questions were asked:
 *   1. a completion vote filed against one circle's record appears in that
 *      circle's reading and in no other's;
 *   2. never asked, running, passed, failed and quorum missed come back as
 *      five different states off five real ballots;
 *   3. the subject key fits the column AT THE WIDEST RECORD ID THE SCHEMA
 *      ALLOWS, and the column really is the limit, proven by a refused write;
 *   4. a commitment reader that hands back another circle's row is refused
 *      instead of being used;
 *   5. re-running a vote is visible, and a running vote outranks a closed one;
 *   6. the composed reading refuses when the record is missing, and the refusal
 *      names the record before it names the vote.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, withdrawBallot } from "./ballots";
import {
  bonusGateFor,
  completionRefProblem,
  completionVoteFor,
  COMPLETION_SUBJECT,
  MAX_SUBJECT_REF,
  pickCompletionBallot,
  type GateDeps,
} from "./circleBonusGate";
import type { CommitmentRecord } from "../../shared/circleBonusGate";
import type { CircleBurnReading } from "../../shared/circleBurn";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[circleBonusGate.test] TEST_DATABASE_URL not set. The completion seam is UNCHECKED here.");
}

const PERIOD_START = "2026-06-01T00:00:00.000Z";
const PERIOD_END = "2026-09-01T00:00:00.000Z";

/** A burn reading that says "under a real cap", so the spend never blocks. */
const UNDER_CAP: CircleBurnReading = {
  kind: "metered",
  circleId: "kitchen",
  unit: "token:credits",
  takenAt: PERIOD_END,
  askMinor: 0,
  cycle: {
    scope: "cycle", state: "no_cap", window: null, capMinor: null, spentMinor: null,
    remainingMinor: null, perDayMinor: null, projectedMinor: null, exhaustsAt: null,
    askFits: null, askShare: null,
  },
  season: {
    scope: "season", state: "burning",
    window: { id: "rooting-2026", startsAt: PERIOD_START, endsAt: PERIOD_END },
    capMinor: 10_000, spentMinor: 4_000, remainingMinor: 6_000, perDayMinor: 44,
    projectedMinor: 4_000, exhaustsAt: null, askFits: true, askShare: 0.4,
  },
  binds: "season",
  fits: true,
};

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

function record(over: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: `cm-${++n}`,
    circleId: "kitchen",
    periodId: "rooting-2026",
    startsAt: PERIOD_START,
    endsAt: PERIOD_END,
    statement: "Cook three feast days and keep the pantry stocked.",
    recordedAt: "2026-06-02T00:00:00.000Z",
    ...over,
  };
}

function deps(over: Partial<GateDeps> = {}): GateDeps {
  return {
    conn: pool,
    commitmentFor: async () => null,
    burnFor: async () => UNDER_CAP,
    electorate: "village",
    ...over,
  };
}

/** Open a completion ballot on a record, with a roll of `heads` equal voices. */
async function open(recordId: string, heads = 1, quorumPct = 50) {
  const electorate = Array.from({ length: heads }, (_, i) => ({ userId: `voter-${i}`, weight: 1 }));
  const res = await openBallot(pool, {
    subjectType: COMPLETION_SUBJECT,
    subjectRef: recordId,
    title: "Did this circle complete what it took on?",
    docMarkdown: "The commitment, as it was written down.",
    method: "majority",
    weightMode: "equal",
    unityPct: 50,
    quorumPct,
    durationDays: 1,
    openedBy: "steward-1",
    electorate,
  });
  if (!res.ok) throw new Error(res.error);
  return res.ballot;
}

/** Push a ballot's closes_at into the past: the clock, not a status change. */
async function expire(ballotId: string) {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

/*
 * A COMPLETION VOTE CLOSES ON THE CLOCK, and this helper used to ask to close
 * early instead.
 *
 * `closerMayCloseEarly` is still a real door, so the old fixture looked
 * harmless; what it could not do is PASS. `closeBallot` refuses a passing
 * outcome before the window ends whatever the closer is allowed, because
 * `lands_at` derives from the frozen `closes_at` and an early pass would hand
 * the steward's veto window to whoever pressed the button. Three of the tests
 * below need a pass, so they were asking for exactly the thing the engine
 * exists to refuse.
 *
 * Expiring first is not a workaround for that refusal, it is the production
 * path written down: the settlement job closes ballots when their windows end.
 * A fixture that closed early would prove the seam reads an outcome nobody in
 * a real village can produce, which is the more expensive kind of green.
 */
async function close(ballotId: string, note: string) {
  await expire(ballotId);
  const res = await closeBallot(pool, {
    ballotId,
    closedBy: "steward-1",
    outcomeNote: note,
    closerMayCloseEarly: false,
  });
  if (!res.ok) throw new Error(res.error);
  return res;
}

describe.skipIf(!configured)("the completion vote seam", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the ledger.test.ts shape
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("finds a circle's vote for that circle and for no other", async () => {
    const kitchen = record({ id: "cm-kitchen-a" });
    const land = record({ id: "cm-land-a", circleId: "land" });
    const b = await open(kitchen.id);
    await castVote(pool, b.id, "voter-0", "yes");
    await close(b.id, "The feasts happened.");

    const mine = await completionVoteFor(pool, kitchen.id);
    const theirs = await completionVoteFor(pool, land.id);
    expect(mine.state).toBe("said_yes");
    expect(mine.ballotId).toBe(b.id);
    expect(theirs.state).toBe("never_asked");
    expect(theirs.ballotId).toBeNull();
    expect(theirs.attempts).toBe(0);
  });

  it("comes back as five different states off five real ballots", async () => {
    const unasked = await completionVoteFor(pool, "cm-unasked");
    expect(unasked.state).toBe("never_asked");

    const running = await open("cm-running");
    expect((await completionVoteFor(pool, "cm-running")).state).toBe("open");

    const yes = await open("cm-yes");
    await castVote(pool, yes.id, "voter-0", "yes");
    await close(yes.id, "Done.");
    expect((await completionVoteFor(pool, "cm-yes")).state).toBe("said_yes");

    const no = await open("cm-no");
    await castVote(pool, no.id, "voter-0", "no");
    await close(no.id, "Not done.");
    expect((await completionVoteFor(pool, "cm-no")).state).toBe("said_no");

    // Three on the roll, quorum 100, one answer: quiet, and never a refusal.
    const quiet = await open("cm-quiet", 3, 100);
    await castVote(pool, quiet.id, "voter-0", "yes");
    const closed = await close(quiet.id, "Too few answered.");
    expect(closed.outcome).toBe("no_quorum");
    const quietRead = await completionVoteFor(pool, "cm-quiet");
    expect(quietRead.state).toBe("no_quorum");
    expect(quietRead.onTheRoll).toBe(3);
    expect(quietRead.rollWeight).toBe(3);

    // The running one is still running, so reading the others changed nothing.
    expect((await completionVoteFor(pool, "cm-running")).ballotId).toBe(running.id);
  });

  it("reports a withdrawn vote as producing no answer", async () => {
    const b = await open("cm-withdrawn");
    const res = await withdrawBallot(pool, {
      ballotId: b.id,
      withdrawnBy: "steward-1",
      reason: "Opened against the wrong period.",
      withdrawerMayDiscardVotes: true,
    });
    expect(res.ok).toBe(true);
    expect((await completionVoteFor(pool, "cm-withdrawn")).state).toBe("withdrawn");
  });

  it("counts re-runs, and a running vote outranks a closed one", async () => {
    const first = await open("cm-again");
    await castVote(pool, first.id, "voter-0", "no");
    await close(first.id, "Not yet.");
    const second = await open("cm-again");

    const read = await completionVoteFor(pool, "cm-again");
    expect(read.attempts).toBe(2);
    expect(read.state).toBe("open");
    expect(read.ballotId).toBe(second.id);
    expect(pickCompletionBallot([])).toBeNull();
  });

  /**
   * THE COLUMN IS THE LIMIT, AND THE PROOF IS A REFUSED WRITE.
   *
   * A guard that only compares numbers proves the guard agrees with itself. The
   * second half of this test hands the widest legal id to the engine, watches
   * it open, then hands one character more and watches strict MySQL refuse the
   * row. That is what makes `MAX_SUBJECT_REF` a measurement of the schema.
   */
  it("fits the widest record id the column holds, and refuses one wider", async () => {
    const widest = "c".repeat(MAX_SUBJECT_REF);
    expect(completionRefProblem(widest)).toBeNull();
    const b = await open(widest);
    expect(b.subjectRef).toBe(widest);
    expect((await completionVoteFor(pool, widest)).ballotId).toBe(b.id);

    const tooWide = "c".repeat(MAX_SUBJECT_REF + 1);
    expect(completionRefProblem(tooWide)).toContain(String(MAX_SUBJECT_REF));
    // The database refuses it, and this is the assertion that makes
    // MAX_SUBJECT_REF a measurement of the schema instead of a number in a file.
    await expect(open(tooWide)).rejects.toMatchObject({ code: "ER_DATA_TOO_LONG" });
    await expect(completionVoteFor(pool, tooWide)).rejects.toThrow(/subject_ref/);
  });

  it("refuses a blank record id before it reaches the database", async () => {
    expect(completionRefProblem("")).toContain("has to name the record");
    await expect(completionVoteFor(pool, "  ")).rejects.toThrow();
  });

  it("refuses a commitment record that belongs to another circle", async () => {
    await expect(
      bonusGateFor(
        { circleId: "kitchen", periodId: "rooting-2026", at: new Date(PERIOD_END) },
        deps({ commitmentFor: async () => record({ id: "cm-wrong", circleId: "land" }) }),
      ),
    ).rejects.toThrow(/belongs to circle/);
  });

  it("names the missing record before the missing vote, and pays nothing", async () => {
    const nothing = await bonusGateFor(
      { circleId: "kitchen", periodId: "rooting-2026", at: new Date(PERIOD_END) },
      deps(),
    );
    expect(nothing.commitment.state).toBe("none");
    expect(nothing.vote.state).toBe("never_asked");
    expect(nothing.blocking).toHaveLength(1);
    expect(nothing.blocking[0]).toContain("Nothing records what this circle took on");
    expect(nothing.blindSpot).toContain("care, mediation or hosting");
    expect(JSON.stringify(nothing)).not.toMatch(/"(eligible|payout|bonusMinor|score)"/);
  });

  it("composes a clear reading only once the record, the vote and the cap all hold", async () => {
    const rec = record({ id: "cm-clear" });
    const b = await open(rec.id);
    await castVote(pool, b.id, "voter-0", "yes");
    await close(b.id, "The feasts happened and the pantry held.");

    const clear = await bonusGateFor(
      { circleId: "kitchen", periodId: "rooting-2026", at: new Date(PERIOD_END) },
      deps({ commitmentFor: async () => rec }),
    );
    expect(clear.commitment.state).toBe("recorded");
    expect(clear.vote.state).toBe("said_yes");
    expect(clear.vote.judgedBy).toBe("village");
    expect(clear.spend.state).toBe("under_cap");
    expect(clear.blocking).toEqual([]);
    expect(clear.periodId).toBe("rooting-2026");
  });
});
