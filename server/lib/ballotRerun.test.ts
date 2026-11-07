/**
 * THE QUORUM FALLBACK, proven against a real MySQL (S5 harness).
 *
 * Rye, 2026-11-06: build the linked re-run ballot from the quorum fallback
 * note. A ballot that misses quorum is asked again once, on a new ballot on the
 * same subject, at half the quorum and for as long as the first ran. A re-run
 * that misses too is decided by a simple majority of the votes cast, and a tie
 * fails.
 *
 * THE CONTROL COMES FIRST and it is the one that matters most: a village with
 * the dial OFF closes a missed quorum exactly as it did before this file
 * existed. Same outcome, same status, the same keys on the close and on the
 * ballot it serves, no second ballot, and nobody told anything new.
 *
 * Cases run in order inside one schema; run the whole file.
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  ballotById,
  ballotsFor,
  castVote,
  closeBallot,
  electorateOf,
  noQuorumStreak,
  openBallot,
  openBallotFor,
  setQuorumFallbackListener,
  type BallotRow,
  type OpenBallotInput,
  type QuorumFallbackEvent,
} from "./ballots";
import { autoSettleExpired, type CloseRouting, type LandingDeps, type SubjectCloser } from "./applyDue";
import { setVariable, loadVariables } from "./variables";
import { QUORUM_FALLBACK_KEY, NO_QUORUM_RERUN } from "../../shared/quorumFallback";
import { SUBJECT_THRESHOLDS, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";
import { announceQuorumFallbackSwitch } from "../routes/quorumFallback";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let n = 0;
let heard: QuorumFallbackEvent[] = [];

const TEN = Array.from({ length: 10 }, (_, i) => ({ userId: `u-${i}`, weight: 1 }));

const openOne = async (over: Partial<OpenBallotInput> = {}) => {
  const r = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `qf-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 50,
    durationDays: 5,
    openedBy: "u-proposer",
    electorate: TEN,
    ...over,
  });
  if (!r.ok) throw new Error(r.error);
  return r.ballot;
};

/**
 * Run the clock out by moving the WHOLE window back, so the window the ballot
 * froze keeps its length. The re-run's duration is read off that length, and
 * the usual fixture (closes_at alone) would shrink it.
 */
const expire = async (ballotId: string) => {
  const b = await ballotById(pool, ballotId);
  const shift = Math.ceil((Date.parse(b!.closesAt) - Date.now()) / 1000) + 3600;
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE ballots SET opens_at = DATE_SUB(opens_at, INTERVAL ? SECOND), closes_at = DATE_SUB(closes_at, INTERVAL ? SECOND) WHERE id = ?",
    [shift, shift, ballotId],
  );
};

const close = (ballotId: string) =>
  closeBallot(pool, { ballotId, closedBy: "u-clock", outcomeNote: "Closed on the clock.", closerMayCloseEarly: false });

const rawRow = async (id: string): Promise<any> => {
  const [rows] = await pool.query<any[]>("SELECT * FROM ballots WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
};

const fallback = async (value: "on" | "off") => {
  const r = await setVariable(pool, QUORUM_FALLBACK_KEY, value);
  expect(r.ok, r.error).toBe(true);
};

describe.skipIf(!configured)("the quorum fallback (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
    await loadVariables(pool);
    setQuorumFallbackListener(async (e) => { heard.push(e); });
  });

  afterEach(() => { heard = []; });

  afterAll(async () => {
    setQuorumFallbackListener(null);
    await fallback("off").catch(() => {});
    await pool?.end();
    await db?.drop();
  });

  it("CONTROL: with the dial off, a missed quorum closes exactly as it always did", async () => {
    const b = await openOne({ subjectRef: "qf-control" });
    expect(Number((await rawRow(b.id)).quorum_fallback)).toBe(0);
    expect((await rawRow(b.id)).rerun_of).toBeNull();
    // The served ballot carries no new key, so every payload is unchanged.
    expect(Object.keys(b)).not.toContain("quorumFallback");
    expect(Object.keys(b)).not.toContain("rerunOf");
    await castVote(pool, b.id, "u-0", "yes");
    await expire(b.id);
    const closed = await close(b.id);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("no_quorum");
    expect(Object.keys(closed).sort()).toEqual(["ballot", "ok", "outcome", "quorum", "quorumBase", "quorumMiss", "tallies", "unity"]);
    expect(closed.ballot.status).toBe("no_quorum");
    expect(closed.ballot.outcomeNote).toBe("Closed on the clock.");
    expect(Object.keys(closed.ballot)).not.toContain("rerunOf");
    expect(closed.quorumMiss?.misses).toBe(1);
    expect(await ballotsFor(pool, "mechanics", "qf-control")).toHaveLength(1);
    expect(await openBallotFor(pool, "mechanics", "qf-control")).toBeNull();
    expect(heard).toEqual([]);
  });

  it("CONTROL: with the dial off, a re-run never exists however often it misses", async () => {
    for (let i = 0; i < 3; i += 1) {
      const b = await openOne({ subjectRef: "qf-control-3" });
      await expire(b.id);
      const closed = await close(b.id);
      expect(closed.ok && closed.outcome).toBe("no_quorum");
    }
    const all = await ballotsFor(pool, "mechanics", "qf-control-3");
    expect(all.map((b) => b.status)).toEqual(["no_quorum", "no_quorum", "no_quorum"]);
    expect(await noQuorumStreak(pool, "mechanics", "qf-control-3")).toBe(3);
  });

  it("never re-runs a ballot opened before the village switched the dial on", async () => {
    const before = await openOne({ subjectRef: "qf-before" });
    await fallback("on");
    await expire(before.id);
    const closed = await close(before.id);
    expect(closed.ok && closed.outcome).toBe("no_quorum");
    expect(await openBallotFor(pool, "mechanics", "qf-before")).toBeNull();
    expect(heard).toEqual([]);
  });

  let first: BallotRow;
  let rerun: BallotRow;

  it("freezes the dial onto a ballot opened while it is on", async () => {
    first = await openOne({ subjectRef: "qf-on", quorumPct: 25, durationDays: 4 });
    expect(Number((await rawRow(first.id)).quorum_fallback)).toBe(1);
    expect(first.quorumFallback).toBe(true);
  });

  it("first miss: closes as asked again and opens a linked re-run at half the quorum, for as long", async () => {
    await castVote(pool, first.id, "u-0", "yes");
    await expire(first.id);
    const closed = await close(first.id);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe(NO_QUORUM_RERUN);
    expect(closed.quorumMiss).toBeUndefined();
    expect(closed.ballot.status).toBe(NO_QUORUM_RERUN);
    expect(closed.ballot.outcomeNote).toContain("Closed on the clock.");
    expect(closed.ballot.outcomeNote).toContain("open again for 4 days at half the quorum (13%)");
    expect(closed.quorumRerun).toBeDefined();
    rerun = closed.quorumRerun!;
    expect(rerun.status).toBe("open");
    expect(rerun.rerunOf).toBe(first.id);
    expect(rerun.quorumPct).toBe(13);
    expect(rerun.method).toBe(first.method);
    expect(rerun.unityPct).toBe(first.unityPct);
    expect(rerun.subjectType).toBe(first.subjectType);
    expect(rerun.subjectRef).toBe(first.subjectRef);
    expect(rerun.title).toBe(first.title);
    expect(rerun.totalWeight).toBe(first.totalWeight);
    const days = (Date.parse(rerun.closesAt) - Date.parse(rerun.opensAt)) / 86_400_000;
    expect(days).toBe(4);
    expect((await openBallotFor(pool, "mechanics", "qf-on"))?.id).toBe(rerun.id);
    expect(await electorateOf(pool, rerun.id)).toEqual(await electorateOf(pool, first.id));
    // A fresh ask: the vote on the first ballot stays on the first ballot.
    expect((await ballotById(pool, rerun.id))?.id).toBe(rerun.id);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: "rerun_opened" });
    if (heard[0].kind === "rerun_opened") {
      expect(heard[0].first.id).toBe(first.id);
      expect(heard[0].rerun.id).toBe(rerun.id);
      expect(heard[0].days).toBe(4);
    }
  });

  it("counts the pair as no miss while the re-run is open", async () => {
    expect(await noQuorumStreak(pool, "mechanics", "qf-on")).toBe(0);
  });

  it("second miss: more yes than no carries it, and the note says the votes cast decided", async () => {
    await castVote(pool, rerun.id, "u-1", "yes");
    await expire(rerun.id);
    const closed = await close(rerun.id);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.outcome).toBe("passed");
    expect(closed.decidedByMajorityOfCast).toBe(true);
    expect(closed.ballot.status).toBe("passed");
    expect(closed.ballot.outcomeNote).toContain("the votes cast decided it: more said yes than no (1 for, 0 against)");
    expect(closed.quorumRerun).toBeUndefined();
    expect(await openBallotFor(pool, "mechanics", "qf-on")).toBeNull();
    expect(heard).toEqual([expect.objectContaining({ kind: "decided_by_majority", outcome: "passed" })]);
    // A re-run is never re-run again, and the subject's run of misses is over.
    expect(await ballotsFor(pool, "mechanics", "qf-on")).toHaveLength(2);
    expect(await noQuorumStreak(pool, "mechanics", "qf-on")).toBe(0);
  });

  it("second miss: a tie fails", async () => {
    const b = await openOne({ subjectRef: "qf-tie" });
    await expire(b.id);
    const asked = await close(b.id);
    if (!asked.ok || !asked.quorumRerun) throw new Error("no re-run");
    const again = asked.quorumRerun;
    await castVote(pool, again.id, "u-0", "yes");
    await castVote(pool, again.id, "u-1", "no");
    await expire(again.id);
    const closed = await close(again.id);
    expect(closed.ok && closed.outcome).toBe("failed");
    if (closed.ok) expect(closed.ballot.outcomeNote).toContain("did not get them (1 for, 1 against)");
  });

  it("second miss with nobody voting fails, because nobody said yes", async () => {
    const b = await openOne({ subjectRef: "qf-silent" });
    await expire(b.id);
    const asked = await close(b.id);
    if (!asked.ok || !asked.quorumRerun) throw new Error("no re-run");
    await expire(asked.quorumRerun.id);
    const closed = await close(asked.quorumRerun.id);
    expect(closed.ok && closed.outcome).toBe("failed");
  });

  it("a re-run that reaches its half quorum is decided by the ballot's own rules", async () => {
    const b = await openOne({ subjectRef: "qf-reached", quorumPct: 50 });
    await expire(b.id);
    const asked = await close(b.id);
    if (!asked.ok || !asked.quorumRerun) throw new Error("no re-run");
    const again = asked.quorumRerun;
    // 3 of 10 answer: quorum 30 against the re-run's 25. Unity 67, under the
    // 80 the ballot froze, so it fails on the ballot's own rules, and a
    // majority of the votes cast never enters into it.
    await castVote(pool, again.id, "u-0", "yes");
    await castVote(pool, again.id, "u-1", "yes");
    await castVote(pool, again.id, "u-2", "no");
    await expire(again.id);
    const closed = await close(again.id);
    expect(closed.ok && closed.outcome).toBe("failed");
    if (closed.ok) expect(closed.decidedByMajorityOfCast).toBeUndefined();
  });

  it("counts a ballot and its re-run as one miss in the three-misses rule", async () => {
    await fallback("off");
    const plain = await openOne({ subjectRef: "qf-streak" });
    await expire(plain.id);
    await close(plain.id);
    expect(await noQuorumStreak(pool, "mechanics", "qf-streak")).toBe(1);
    await fallback("on");
    const b = await openOne({ subjectRef: "qf-streak" });
    await expire(b.id);
    const asked = await close(b.id);
    expect(asked.ok && asked.outcome).toBe(NO_QUORUM_RERUN);
    // The pair adds nothing while the re-run runs, so the fallback never makes
    // a subject end sooner.
    expect(await noQuorumStreak(pool, "mechanics", "qf-streak")).toBe(1);
  });

  it("refuses a second close of the first ballot, and opens no second re-run", async () => {
    const b = await openOne({ subjectRef: "qf-twice" });
    await expire(b.id);
    expect((await close(b.id)).ok).toBe(true);
    const again = await close(b.id);
    expect(again.ok).toBe(false);
    expect(await ballotsFor(pool, "mechanics", "qf-twice")).toHaveLength(2);
  });

  it("carries the payloads a closer reads by ballot id onto the re-run", async () => {
    const gps = await openOne({ subjectType: "gps_change", subjectRef: "qf-gps" });
    await pool.query("INSERT INTO gps_change_proposals (ballot_id, statement, proposed_by) VALUES (?,?,?)", [gps.id, "We grow food together.", "u-proposer"]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const role = await openOne({ subjectType: "role_declare", subjectRef: "qf-role" });
    await pool.query("INSERT INTO role_declarations (ballot_id, role_id, name, purpose) VALUES (?,?,?,?)", [role.id, "keepers", "Keepers", "Keep the beds."]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const mech = await openOne({ subjectRef: "qf-mech" });
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, proposer_user_id, change_set, status, ballot_id) VALUES (?,?,?,?,?,?,?)",
      ["qf-mech", "A change", "Because.", "u-proposer", "[]", "onsite_vote", mech.id],
    );
    for (const b of [gps, role, mech]) await expire(b.id);
    const [g, r, m] = await Promise.all([close(gps.id), close(role.id), close(mech.id)]);
    const rerunOf = (x: typeof g) => (x.ok && x.quorumRerun ? x.quorumRerun.id : "");
    const [gpsRows] = await pool.query<any[]>("SELECT statement FROM gps_change_proposals WHERE ballot_id = ?", [rerunOf(g)]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(gpsRows[0]?.statement).toBe("We grow food together.");
    const [roleRows] = await pool.query<any[]>("SELECT role_id FROM role_declarations WHERE ballot_id = ?", [rerunOf(r)]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(roleRows[0]?.role_id).toBe("keepers");
    const [mechRows] = await pool.query<any[]>("SELECT ballot_id, status FROM mechanics_proposals WHERE id = 'qf-mech'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(mechRows[0]?.ballot_id).toBe(rerunOf(m));
    expect(mechRows[0]?.status).toBe("onsite_vote");
  });

  it("records and announces a switch made by the village's own vote, and says nothing about a non-switch", async () => {
    const said = async () => {
      const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "SELECT kind, text, audience FROM health_events WHERE entity_type = 'variable' AND entity_ref = ? AND actor_user_id = 'u-voter' ORDER BY at, id",
        [QUORUM_FALLBACK_KEY],
      );
      return rows.map((r) => `${r.kind}|${r.audience}|${r.text}`);
    };
    await announceQuorumFallbackSwitch(pool, { previous: "on", value: "on", by: "village", actorUserId: "u-voter" });
    expect(await said()).toEqual([]);
    await announceQuorumFallbackSwitch(pool, { previous: "on", value: "off", by: "village", actorUserId: "u-voter" });
    expect(await said()).toEqual([
      "audit|admin|quorum-fallback:off:village:vote",
      expect.stringMatching(/^governance\|public\|The village switched the quorum fallback off\./),
    ]);
  });

  it("never re-runs the Birthing, which asks again on a fresh roll", async () => {
    const b = await openOne({ subjectType: VILLAGE_LAUNCH, subjectRef: "qf-launch" });
    expect(Number((await rawRow(b.id)).quorum_fallback)).toBe(0);
    await expire(b.id);
    const closed = await close(b.id);
    expect(closed.ok && closed.outcome).toBe("no_quorum");
  });

  /*
   * EVERY SUBJECT TYPE, through the settlement path a running village takes.
   *
   * The subject closers are only ever reached through `routeOutcome`, so the
   * one property every subject needs is that the first ballot's close routes
   * NOWHERE (the subject waits, untouched, in whatever state its vote put it)
   * and the re-run's close routes exactly once with the re-run's own outcome.
   * The list is the subject registry itself plus the mechanics subject, never
   * a hand-kept copy.
   */
  const settled: Array<{ subjectType: string; ballotId: string; outcome: string }> = [];
  const recordingCloser: SubjectCloser = {
    settle: async (b, outcome) => {
      settled.push({ subjectType: b.subjectType, ballotId: b.id, outcome });
      return { applied: [], held: null, proposerTold: null } as CloseRouting;
    },
  };
  const deps = (): LandingDeps => ({
    pool,
    vetoHours: () => 72,
    autoApplyEnabled: () => true,
    stewardCouncil: () => false,
    stewardVetoTiers: () => "all",
    nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * 86_400_000),
    cycleNumberAt: () => 1,
    closerFor: () => recordingCloser,
    notify: async () => {},
    endedUnclosedCycle: async () => false,
    waitsForCycleClose: () => false,
    snapsToBoundary: () => false,
    landingExpiryCycles: () => 3,
  });

  const subjects = Array.from(new Set(["mechanics", ...Object.keys(SUBJECT_THRESHOLDS)])).filter((s) => s !== VILLAGE_LAUNCH);

  it.each(subjects)("%s: the re-run opens, the subject waits, and the re-run's outcome lands", async (subjectType) => {
    await pool.query("UPDATE ballots SET status = 'withdrawn', open_key = CONCAT(open_key, ':', id) WHERE status = 'open'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    settled.length = 0;
    const ref = `qf-every-${subjectType}`;
    const b = await openOne({ subjectType, subjectRef: ref, method: "majority" });
    await expire(b.id);
    await autoSettleExpired(deps(), closeBallot);
    expect(settled, "the first close routes nowhere").toEqual([]);
    const again = await openBallotFor(pool, subjectType, ref);
    expect(again?.rerunOf).toBe(b.id);
    await castVote(pool, again!.id, "u-0", "yes");
    await expire(again!.id);
    await autoSettleExpired(deps(), closeBallot);
    expect(settled).toEqual([{ subjectType, ballotId: again!.id, outcome: "passed" }]);
  });
});
