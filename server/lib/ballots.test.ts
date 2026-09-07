/**
 * The ballot conduct rules, proven against a real MySQL (S5 harness):
 *
 *  - THE SNAPSHOT LAW, the test the constitution names: change the village's
 *    unity dial AND a member's weight mid-ballot, close, and the outcome is
 *    identical to the frozen snapshot.
 *  - Double-open is a no-op on the open_key index; double-close is a no-op on
 *    the guarded UPDATE. Both return the standing state, execute nothing.
 *  - Votes are changeable upserts until closes_at, locked after.
 *  - The consent objection flow: a no auto-files, rulings need notes, a
 *    concern does not block, an integrated objection fails the ballot.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  ballotById,
  castVote,
  closeBallot,
  fileObjection,
  objectionsFor,
  openBallot,
  ruleObjection,
  headsFor,
  noQuorumStreak,
  quorumFactsFor,
  standingObjectionCount,
  talliesFor,
  withdrawBallot,
  type OpenBallotInput,
} from "./ballots";
import { setWeight, weightsFor, weightChangeProblem, allWeights } from "./governanceWeights";
import { NO_QUORUM_ENDED, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

/** A fresh subject ref per ballot, so open_key never collides between cases. */
const openOne = async (over: Partial<OpenBallotInput> = {}) =>
  openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `gmp-test-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
    ...over,
  });

/** Push a ballot's closes_at into the past: the clock, not a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

describe.skipIf(!configured)("ballots (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses to open with an empty electorate or zero total weight, fail closed", async () => {
    const empty = await openOne({ electorate: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("Nobody is eligible");

    const zero = await openOne({
      weightMode: "custom",
      electorate: [
        { userId: "u-a", weight: 0 },
        { userId: "u-b", weight: 0 },
      ],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toContain("total voting weight is zero");
  });

  it("double-open is a race-free no-op on the open_key index", async () => {
    const first = await openOne({ subjectRef: "gmp-double" });
    expect(first.ok).toBe(true);
    const second = await openOne({ subjectRef: "gmp-double" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("already open");
      expect(second.alreadyOpen?.id).toBe(first.ok ? first.ballot.id : "");
    }
    // Exactly one ballot row exists for the subject.
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM ballots WHERE subject_ref = 'gmp-double'");
    expect(Number(rows[0].c)).toBe(1);
  });

  it("a failed open leaves nothing behind: the transaction is whole", async () => {
    const boom = await openOne({
      subjectRef: "gmp-rollback",
      onOpen: async () => {
        throw new Error("subject flip refused");
      },
    }).catch((e) => e);
    expect(boom).toBeInstanceOf(Error);
    const [ballots] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM ballots WHERE subject_ref = 'gmp-rollback'");
    expect(Number(ballots[0].c)).toBe(0);
  });

  it("votes are upserts from the frozen electorate only, changeable until the clock", async () => {
    const opened = await openOne();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;

    const stranger = await castVote(pool, id, "u-nobody", "yes");
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error).toContain("outside this ballot's electorate");

    expect((await castVote(pool, id, "u-a", "maybe")).ok).toBe(false);

    expect((await castVote(pool, id, "u-a", "no")).ok).toBe(true);
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true); // changed their mind
    const t1 = await talliesFor(pool, id);
    expect(t1).toEqual({ yesW: 1, noW: 0, abstainW: 0 }); // one row, latest choice

    await expire(id);
    const late = await castVote(pool, id, "u-b", "yes");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toContain("Votes are locked");
  });

  it("THE SNAPSHOT LAW: a dial and a weight change mid-ballot move nothing", async () => {
    // Custom weights: a=1, b=1, c=2, allocated through the audited path.
    for (const [userId, weight] of [["u-a", 1], ["u-b", 1], ["u-c", 2]] as const) {
      await setWeight(pool, { userId, weight, actorUserId: "u-admin", note: "initial allocation" });
    }
    const weights = await weightsFor(pool, ["u-a", "u-b", "u-c"], { mode: "custom", token: null });
    const opened = await openOne({
      subjectRef: "gmp-snapshot",
      weightMode: "custom",
      unityPct: 80, // the village dial as it stood at open
      electorate: [
        { userId: "u-a", weight: weights.get("u-a")! },
        { userId: "u-b", weight: weights.get("u-b")! },
        { userId: "u-c", weight: weights.get("u-c")! },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect(opened.ballot.totalWeight).toBe(4);

    // a and b say yes (weight 2), c says no (weight 2): unity 50, quorum 100.
    await castVote(pool, id, "u-a", "yes");
    await castVote(pool, id, "u-b", "yes");
    await castVote(pool, id, "u-c", "no");

    // MID-BALLOT, the village moves: c's weight drops to zero (which would
    // make unity 100 if weights were read live) and the unity dial "changes"
    // to 50 (which would pass unity 50 if dials were read live). The ballot
    // must see neither.
    await setWeight(pool, { userId: "u-c", weight: 0, actorUserId: "u-admin", note: "mid-ballot reallocation" });
    // The dial change needs no registry here: closeBallot reads ONLY the
    // ballot's own columns, so the frozen 80 is what evaluates, and there is
    // no argument through which a new value could even arrive.

    await expire(id);
    const closed = await closeBallot(pool, {
      ballotId: id,
      closedBy: "u-proposer",
      outcomeNote: "Closed after the vote period. Unity fell short of the frozen 80.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    // Frozen weights: yes 2, no 2 — unity 50 against the frozen 80: failed.
    // Live weights would have said yes 2, no 0 — unity 100: passed.
    expect(closed.tallies).toEqual({ yesW: 2, noW: 2, abstainW: 0 });
    expect(closed.unity).toBe(50);
    expect(closed.quorum).toBe(100);
    expect(closed.outcome).toBe("failed");

    // And the mid-ballot change is on the record, attributed, both rows.
    const [trail] = await pool.query<any[]>(
      "SELECT old_weight, new_weight, note FROM governance_weight_changes WHERE user_id = 'u-c' ORDER BY id",
    );
    expect(trail.length).toBe(2);
    expect(Number(trail[1].old_weight)).toBe(2);
    expect(Number(trail[1].new_weight)).toBe(0);
  });

  it("double-close is a no-op: the guarded UPDATE fires once", async () => {
    const opened = await openOne({ subjectRef: "gmp-close-twice" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    await castVote(pool, id, "u-a", "yes");
    await expire(id);

    const noNote = await closeBallot(pool, { ballotId: id, closedBy: "u-a", outcomeNote: "  ", closerMayCloseEarly: false });
    expect(noNote.ok).toBe(false);
    if (!noNote.ok) expect(noNote.error).toContain("note is required");

    const first = await closeBallot(pool, { ballotId: id, closedBy: "u-a", outcomeNote: "First close.", closerMayCloseEarly: false });
    expect(first.ok).toBe(true);
    const second = await closeBallot(pool, { ballotId: id, closedBy: "u-b", outcomeNote: "Second close.", closerMayCloseEarly: false });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.alreadyClosed?.closedBy).toBe("u-a");
      expect(second.alreadyClosed?.outcomeNote).toBe("First close.");
    }
    // The close freed the subject's open_key: a fresh ballot can open.
    const again = await openOne({ subjectRef: "gmp-close-twice" });
    expect(again.ok).toBe(true);
  });

  /*
   * REWRITTEN BY THE DISPATCHER LANE, because the rule it pinned is now wrong.
   *
   * It used to assert that a facilitator may close a passing ballot early. The
   * 2026-09-03 landing model derives every steward's veto window from the
   * ballot's frozen `closes_at`, so an early close would hand the length and
   * the calendar days of that window to whoever pressed the button: the
   * proposer could park a vote until the one seat holder posted about a trip.
   * A ballot now PASSES when its window ends and not before, on every method,
   * and the settlement path closes it on the clock.
   *
   * What a facilitator can still do early is close a ballot that is NOT going
   * to carry, which is the case this half covers. Nothing about a failing
   * ballot starts a window.
   */
  it("a ballot passes when its window ends and never before, on any method", async () => {
    const opened = await openOne({ subjectRef: "gmp-early" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    await castVote(pool, id, "u-a", "yes");

    const tooSoon = await closeBallot(pool, { ballotId: id, closedBy: "u-proposer", outcomeNote: "Trying early.", closerMayCloseEarly: false });
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toContain("still running");

    // Even the facilitator, because the instant a steward is owed derives from
    // this ballot's own frozen window.
    const facilitator = await closeBallot(pool, { ballotId: id, closedBy: "u-decider", outcomeNote: "Closed early by the facilitator.", closerMayCloseEarly: true });
    expect(facilitator.ok).toBe(false);
    if (!facilitator.ok) expect(facilitator.error).toContain("window ends");

    // The window ends and the same call goes through.
    await expire(id);
    const onTime = await closeBallot(pool, { ballotId: id, closedBy: "u-decider", outcomeNote: "The window ended.", closerMayCloseEarly: false });
    expect(onTime.ok).toBe(true);
    if (onTime.ok) expect(onTime.outcome).toBe("passed");
  });

  it("still lets a facilitator close a ballot early that is not going to carry", async () => {
    const opened = await openOne({ subjectRef: "gmp-early-fail" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    await castVote(pool, id, "u-a", "no");
    await castVote(pool, id, "u-b", "no");
    const early = await closeBallot(pool, { ballotId: id, closedBy: "u-decider", outcomeNote: "The village has answered.", closerMayCloseEarly: true });
    expect(early.ok).toBe(true);
    if (early.ok) expect(early.outcome).toBe("failed");
  });

  it("the consent flow: no auto-files, rulings need notes, concern passes, integrated fails", async () => {
    const consent = (ref: string) =>
      openOne({
        subjectRef: ref,
        method: "consent",
        unityPct: 0,
        quorumPct: 20,
      });

    // A no without a reason is refused: an objection carries its reasoning.
    const first = await consent("agr-consent-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const b1 = first.ballot.id;
    expect((await castVote(pool, b1, "u-a", "no")).ok).toBe(false);
    expect((await castVote(pool, b1, "u-a", "no", "This risks the water budget.")).ok).toBe(true);
    let objections = await objectionsFor(pool, b1);
    expect(objections.length).toBe(1);
    expect(objections[0].status).toBe("open");
    // Re-voting no UPDATES the standing objection instead of stacking a second.
    expect((await castVote(pool, b1, "u-a", "no", "This risks the water budget, and the well.")).ok).toBe(true);
    objections = await objectionsFor(pool, b1);
    expect(objections.length).toBe(1);
    expect(objections[0].text).toContain("and the well");

    // Objections come only from a consent ballot's own electorate.
    expect((await fileObjection(pool, b1, "u-nobody", "outsider")).ok).toBe(false);
    const voteless = await fileObjection(pool, b1, "u-b", "Filed without voting no.");
    expect(voteless.ok).toBe(true);

    // A ruling without a note is refused; an unknown ruling is refused.
    const objId = objections[0].id;
    expect((await ruleObjection(pool, { objectionId: objId, ruling: "concern", ruledBy: "u-lead", note: " " })).ok).toBe(false);
    expect((await ruleObjection(pool, { objectionId: objId, ruling: "overruled", ruledBy: "u-lead", note: "x" })).ok).toBe(false);

    // Concern: recorded, does not block. Withdraw the other, and the window
    // must still run out before a pass.
    expect((await ruleObjection(pool, { objectionId: objId, ruling: "concern", ruledBy: "u-lead", note: "Watch the water budget at review." })).ok).toBe(true);
    if (voteless.ok) {
      expect((await ruleObjection(pool, { objectionId: voteless.id, ruling: "withdrawn", ruledBy: "u-b", note: "Answered in the thread." })).ok).toBe(true);
      // A ruled objection takes no second ruling.
      expect((await ruleObjection(pool, { objectionId: voteless.id, ruling: "concern", ruledBy: "u-lead", note: "again" })).ok).toBe(false);
    }
    expect(await standingObjectionCount(pool, b1)).toBe(0);
    const beforeWindow = await closeBallot(pool, { ballotId: b1, closedBy: "u-lead", outcomeNote: "Trying before the window ends.", closerMayCloseEarly: true });
    expect(beforeWindow.ok).toBe(false);
    if (!beforeWindow.ok) expect(beforeWindow.error).toContain("only after its window ends");
    await expire(b1);
    const passed = await closeBallot(pool, { ballotId: b1, closedBy: "u-lead", outcomeNote: "No objection stands; the concern rides to review.", closerMayCloseEarly: false });
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.outcome).toBe("passed");

    // Integrated: the objection stands, the ballot fails, even after the window.
    const second = await consent("agr-consent-2");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const b2 = second.ballot.id;
    await castVote(pool, b2, "u-a", "yes");
    const blocking = await fileObjection(pool, b2, "u-c", "The plan double-books the hall.");
    expect(blocking.ok).toBe(true);
    if (blocking.ok) {
      expect((await ruleObjection(pool, { objectionId: blocking.id, ruling: "integrated", ruledBy: "u-lead", note: "It does. The proposal must change." })).ok).toBe(true);
    }
    await expire(b2);
    const failed = await closeBallot(pool, { ballotId: b2, closedBy: "u-lead", outcomeNote: "An integrated objection stands; back to staging.", closerMayCloseEarly: false });
    expect(failed.ok).toBe(true);
    if (failed.ok) expect(failed.outcome).toBe("failed");
  });

  it("weights: notes are required, absent rows weigh zero, the trail appends", async () => {
    expect(weightChangeProblem({ weight: 3, note: "" })).toContain("Say why");
    expect(weightChangeProblem({ weight: -1, note: "x" })).toContain("zero or a positive");
    await expect(
      setWeight(pool, { userId: "u-x", weight: 5, actorUserId: "u-admin", note: "" }),
    ).rejects.toThrow();

    const before = await weightsFor(pool, ["u-never-allocated"], { mode: "custom", token: null });
    expect(before.get("u-never-allocated")).toBe(0); // fail closed

    await setWeight(pool, { userId: "u-x", weight: 5, actorUserId: "u-admin", note: "founding allocation" });
    const all = await allWeights(pool);
    expect(all.get("u-x")).toBe(5);

    const equal = await weightsFor(pool, ["u-x", "u-never-allocated"], { mode: "equal", token: null });
    expect(equal.get("u-x")).toBe(1);
    expect(equal.get("u-never-allocated")).toBe(1);
  });

  it("the closed ballot's record is whole: note, closer, rewritten open_key", async () => {
    const opened = await openOne({ subjectRef: "gmp-record" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await castVote(pool, opened.ballot.id, "u-a", "abstain");
    await expire(opened.ballot.id);
    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-proposer",
      outcomeNote: "One abstention reached quorum and took no side.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    // 1 abstain of 3: quorum 33 >= 20, unity 0 against 80: failed.
    expect(closed.outcome).toBe("failed");
    const b = await ballotById(pool, opened.ballot.id);
    expect(b?.outcomeNote).toContain("abstention");
    expect(b?.closedBy).toBe("u-proposer");
    expect(b?.openKey).toBe(`mechanics:gmp-record:${opened.ballot.id}`);
  });

  /*
   * WITHDRAWAL. 0089 declared `status='withdrawn'` and the decision page
   * renders it; no route ever wrote it, so a member who opened a vote in
   * error had no way out while the interface implied there was one.
   *
   * The rule these cases pin is the one that is not obvious: a withdrawal
   * costs other people's cast votes, and cast votes are the one thing in this
   * engine belonging to somebody other than the opener. So an opener may call
   * off a ballot nobody has answered, and once one vote stands it takes a
   * facilitator.
   */
  it("withdrawal: the opener may call off a vote nobody has answered yet", async () => {
    const opened = await openOne({ subjectRef: "gmp-withdraw-clean" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect((await withdrawBallot(pool, {
      ballotId: opened.ballot.id, withdrawnBy: "u-proposer", reason: "", withdrawerMayDiscardVotes: false,
    })) as any).toMatchObject({ ok: false });

    const gone = await withdrawBallot(pool, {
      ballotId: opened.ballot.id,
      withdrawnBy: "u-proposer",
      reason: "Opened against the wrong draft. Reopening on the right one.",
      withdrawerMayDiscardVotes: false,
    });
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.votesDiscarded).toBe(0);

    const b = await ballotById(pool, opened.ballot.id);
    expect(b?.status).toBe("withdrawn");
    expect(b?.closedBy).toBe("u-proposer");
    expect(b?.outcomeNote).toContain("wrong draft");
    // Nothing was decided: the record carries no outcome word at all.
    expect(["passed", "failed", "no_quorum"]).not.toContain(b?.status);
    // And the subject is free again straight away, which is the same open_key
    // rewrite a close does.
    expect(b?.openKey).toBe(`mechanics:gmp-withdraw-clean:${opened.ballot.id}`);
    const again = await openOne({ subjectRef: "gmp-withdraw-clean" });
    expect(again.ok, "a withdrawn subject takes a fresh ballot immediately").toBe(true);
    // A NEW ballot with its own freeze, never the withdrawn one resumed.
    if (again.ok) expect(again.ballot.id).not.toBe(opened.ballot.id);
  });

  it("withdrawal: once a vote stands, discarding it takes a facilitator", async () => {
    const opened = await openOne({ subjectRef: "gmp-withdraw-voted" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await castVote(pool, opened.ballot.id, "u-a", "yes");

    const refused = await withdrawBallot(pool, {
      ballotId: opened.ballot.id,
      withdrawnBy: "u-proposer",
      reason: "Changed my mind about asking.",
      withdrawerMayDiscardVotes: false,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("already voted");
    expect((await ballotById(pool, opened.ballot.id))?.status).toBe("open");

    const done = await withdrawBallot(pool, {
      ballotId: opened.ballot.id,
      withdrawnBy: "u-b",
      reason: "The proposal it names was superseded this morning.",
      withdrawerMayDiscardVotes: true,
    });
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.votesDiscarded).toBe(1);
  });

  it("withdrawal is a guarded single transition, like the close", async () => {
    const opened = await openOne({ subjectRef: "gmp-withdraw-race" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const first = await withdrawBallot(pool, {
      ballotId: opened.ballot.id, withdrawnBy: "u-proposer", reason: "Asked too early.", withdrawerMayDiscardVotes: false,
    });
    expect(first.ok).toBe(true);
    const second = await withdrawBallot(pool, {
      ballotId: opened.ballot.id, withdrawnBy: "u-b", reason: "Asked too early.", withdrawerMayDiscardVotes: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already withdrawn");

    // And a CLOSED ballot is never withdrawable: an outcome the village
    // reached is not something anybody gets to take back.
    const decided = await openOne({ subjectRef: "gmp-withdraw-closed" });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    await castVote(pool, decided.ballot.id, "u-a", "yes");
    await castVote(pool, decided.ballot.id, "u-b", "yes");
    await expire(decided.ballot.id);
    expect((await closeBallot(pool, {
      ballotId: decided.ballot.id, closedBy: "u-proposer",
      outcomeNote: "Two of three in favour, and quorum was met.", closerMayCloseEarly: false,
    })).ok).toBe(true);
    const late = await withdrawBallot(pool, {
      ballotId: decided.ballot.id, withdrawnBy: "u-b", reason: "Second thoughts.", withdrawerMayDiscardVotes: true,
    });
    expect(late.ok).toBe(false);
    expect((await ballotById(pool, decided.ballot.id))?.status).toBe("passed");
  });

  /*
   * The no-quorum distinction at the engine's own level. The close route used
   * to write `failed` on the subject for BOTH of these, so this pins that the
   * two outcomes are genuinely different rows and not one word with two
   * spellings.
   */
  it("a ballot that misses quorum closes as no_quorum, never as failed", async () => {
    const opened = await openOne({ subjectRef: "gmp-quiet-week", quorumPct: 60 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // One of three votes YES: unity is a perfect 100, quorum is 33 of 60.
    await castVote(pool, opened.ballot.id, "u-a", "yes");
    await expire(opened.ballot.id);
    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-proposer",
      outcomeNote: "One member voted, and the village asks for more than that.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("no_quorum");
    // Everyone who did vote was in favour, which is exactly why calling this
    // a rejection was false.
    expect(closed.unity).toBe(100);
    expect((await ballotById(pool, opened.ballot.id))?.status).toBe("no_quorum");
  });

  /*
   * A DELEGATED ROW DOES NOT COUNT WHERE EVERYONE MUST AGREE IN PERSON
   * (thresholds lane, from the audit of 2026-09-03).
   *
   * The rule lives in `delegatedRowsCountOn` and the tally reads it, so these
   * cases go through the real SQL and never the predicate alone: a row stamped
   * with `followed_user_id` counts on an ordinary ballot and counts toward
   * nothing on one conducted at 100 unity, in weight AND in heads. The rows
   * are written directly because `applyDelegatedVotes` sweeps derived rows
   * whenever no delegation stands, and what is under test here is the tally.
   */
  const delegateRow = async (ballotId: string, follower: string, decidedBy: string, choice: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO ballot_votes (ballot_id, user_id, choice, reason, followed_user_id) VALUES (?,?,?,NULL,?)",
      [ballotId, follower, choice, decidedBy],
    );
  };

  it("counts a delegated row on an ordinary ballot, in weight and in heads", async () => {
    const opened = await openOne({ subjectRef: "gmp-delegated-ordinary", unityPct: 80 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    await delegateRow(id, "u-b", "u-a", "yes");
    expect(await talliesFor(pool, opened.ballot)).toEqual({ yesW: 2, noW: 0, abstainW: 0 });
    expect(await headsFor(pool, opened.ballot)).toMatchObject({ yesHeads: 2, electorateCount: 3 });
  });

  it("refuses a delegated row on a ballot conducted at 100 unity, in weight and in heads", async () => {
    const opened = await openOne({ subjectRef: "gmp-delegated-unanimous", unityPct: 100, quorumPct: 100 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    await delegateRow(id, "u-b", "u-a", "yes");
    await delegateRow(id, "u-c", "u-a", "yes");
    // Three rows on the table, one member who answered for themselves.
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM ballot_votes WHERE ballot_id = ?", [id]);
    expect(Number(rows[0].c)).toBe(3);
    expect(await talliesFor(pool, opened.ballot)).toEqual({ yesW: 1, noW: 0, abstainW: 0 });
    expect(await headsFor(pool, opened.ballot)).toMatchObject({ yesHeads: 1, electorateCount: 3 });
  });

  it("the Birthing does not carry on delegations: it closes short of quorum instead", async () => {
    const opened = await openOne({
      subjectType: VILLAGE_LAUNCH,
      subjectRef: "gmp-birthing-delegated",
      unityPct: 100,
      quorumPct: 100,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    await delegateRow(id, "u-b", "u-a", "yes");
    await delegateRow(id, "u-c", "u-a", "yes");
    await expire(id);
    const closed = await closeBallot(pool, {
      ballotId: id,
      closedBy: "u-proposer",
      outcomeNote: "One member answered for themselves and two followed them.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    // A missed quorum, so the village can ask again on a fresh freeze. Three
    // delegations to one person are not three people starting a Game.
    expect(closed.outcome).toBe("no_quorum");
    expect(closed.quorum).toBeCloseTo(100 / 3, 5);
  });
});

/**
 * -- VOICE FOR OTHER BEINGS, AND THE QUORUM IT SITS IN (19G) ----------------
 *
 * Red before this: a seat speaking for a river sat in every quorum
 * denominator, so a village that gave a quarter of its Voice to the land it
 * lives on made its own top tier unreachable and nothing said why.
 *
 * The flag is a column the founding step writes (`roles.represents_being`).
 * This lane writes no migration, so the fixture adds the column the way the
 * birthing lane will, and the first case proves the honest answer on a
 * database that does not have it yet.
 */
describe.skipIf(!configured)("the quorum a being's seat sits outside of (MySQL)", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const expire = async (ballotId: string) =>
    pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  const seatABeing = async (userId: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "ALTER TABLE roles ADD COLUMN `represents_being` tinyint(1) NOT NULL DEFAULT 0",
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO roles (id, name, description, capabilities, sort_order, represents_being) VALUES (?,?,?,?,?,1)",
      ["the-river", "The river", "The water that borders this land", JSON.stringify([]), 1],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO role_holders (id, role_id, user_id) VALUES (?,?,?)",
      ["rh-river", "the-river", userId],
    );
  };

  it("says it could not tell while the flag is not on this database, and excludes nothing", async () => {
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "gmp-being-unknown",
      title: "Before the flag exists",
      docMarkdown: "# Before the flag exists",
      method: "custom",
      weightMode: "custom",
      unityPct: 80,
      quorumPct: 30,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-river", weight: 8 },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const facts = await quorumFactsFor(pool, opened.ballot);
    expect(facts.known).toBe(false);
    expect(facts.reduced).toBe(false);
    expect(facts.base.baseWeight).toBe(10);
    expect(facts.base.excludedWeight).toBe(0);
  });

  it("takes the seat's weight out of the count on both sides, and keeps its vote in the agreement", async () => {
    await seatABeing("u-river");
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "gmp-being-counted",
      title: "A quarter of the Voice speaks for the water",
      docMarkdown: "# A quarter of the Voice speaks for the water",
      method: "custom",
      weightMode: "custom",
      unityPct: 80,
      quorumPct: 30,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-river", weight: 8 },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;

    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    const facts = await quorumFactsFor(pool, opened.ballot);
    expect(facts.known).toBe(true);
    expect(facts.reduced).toBe(true);
    expect(facts.base.excludedWeight).toBe(8);
    expect(facts.base.speaksForABeing).toBe(1);
    expect(facts.arithmetic).toEqual({ answeredWeight: 1, baseWeight: 2 });

    // One yes of ten is 10% and misses a 30% bar. One yes of the two seats in
    // the count is 50% and clears it, which is the whole ruling in one row.
    await expire(id);
    const closed = await closeBallot(pool, {
      ballotId: id,
      closedBy: "u-clock",
      outcomeNote: "Closed on the clock.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("passed");
    expect(closed.quorum).toBe(50);
    expect(closed.quorumBase.excludedWeight).toBe(8);
  });

  it("counts the being's own vote toward agreement, so its no still decides", async () => {
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "gmp-being-objects",
      title: "The water says no",
      docMarkdown: "# The water says no",
      method: "custom",
      weightMode: "custom",
      unityPct: 80,
      quorumPct: 30,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-river", weight: 8 },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.ballot.id;
    expect((await castVote(pool, id, "u-a", "yes")).ok).toBe(true);
    expect((await castVote(pool, id, "u-river", "no")).ok).toBe(true);
    await expire(id);
    const closed = await closeBallot(pool, {
      ballotId: id,
      closedBy: "u-clock",
      outcomeNote: "Closed on the clock.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    // Quorum is met on the two seats in the count; unity is 1 against 8.
    expect(closed.outcome).toBe("failed");
    expect(closed.quorum).toBe(50);
    expect(closed.unity).toBeCloseTo(11.11, 1);
  });
});

/**
 * -- THREE CYCLES WITHOUT QUORUM, COUNTED FROM THE RECORD (19F, 20.11) ------
 *
 * Red before this: the founder's sentence had no counter anywhere, so the
 * close said the same thing on the ninth miss as on the first.
 */
describe.skipIf(!configured)("the no-quorum counter (MySQL)", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const expire = async (ballotId: string) =>
    pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  /** Open a ballot on one subject, let it expire with nobody voting, close it. */
  const missQuorum = async (ref: string) => {
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: ref,
      title: `Nobody came, ${ref}`,
      docMarkdown: "# Nobody came",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 90,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-c", weight: 1 },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error);
    await expire(opened.ballot.id);
    return closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-clock",
      outcomeNote: "Closed on the clock, nobody voted.",
      closerMayCloseEarly: false,
    });
  };

  it("counts the misses, warns on the second and ends it on the third with one door", async () => {
    const first = await missQuorum("gmp-miss");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome).toBe("no_quorum");
    expect(first.quorumMiss?.state).toBe("clear");
    expect(await noQuorumStreak(pool, "mechanics", "gmp-miss")).toBe(1);

    const second = await missQuorum("gmp-miss");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.quorumMiss?.state).toBe("warned");
    expect(second.quorumMiss?.sentence).toContain("ends this one for good");

    const third = await missQuorum("gmp-miss");
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.quorumMiss?.state).toBe("ended");
    expect(third.quorumMiss?.terminalState).toBe(NO_QUORUM_ENDED);
    expect(third.quorumMiss?.door).toContain("Withdraw it and write it again");
    expect(await noQuorumStreak(pool, "mechanics", "gmp-miss")).toBe(3);
  });

  it("says nothing about the rule on a close that reached quorum, and starts the count again", async () => {
    await missQuorum("gmp-reached");
    expect(await noQuorumStreak(pool, "mechanics", "gmp-reached")).toBe(1);
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: "gmp-reached",
      title: "Everybody came",
      docMarkdown: "# Everybody came",
      method: "custom",
      weightMode: "equal",
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: [
        { userId: "u-a", weight: 1 },
        { userId: "u-b", weight: 1 },
        { userId: "u-c", weight: 1 },
      ],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await castVote(pool, opened.ballot.id, "u-a", "yes")).ok).toBe(true);
    await expire(opened.ballot.id);
    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-clock",
      outcomeNote: "Closed on the clock.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("passed");
    expect(closed.quorumMiss).toBeUndefined();
    expect(await noQuorumStreak(pool, "mechanics", "gmp-reached")).toBe(0);
  });
});
