/**
 * The new-moon digest, proven against a real MySQL (the S5 harness).
 *
 * What is pinned here is every rule 21.4 and section 20.11 give it:
 *
 *  - one digest per cycle id, whatever runs at the boundary and how often;
 *  - a village with zero enabled minting rules still gets exactly one, because
 *    the digest is the landing job's and inherits no economic precondition;
 *  - "no digest composed" and "the digest was empty" are different answers, in
 *    words, so a fault and a quiet moon never read alike;
 *  - a section with nothing to say says so rather than disappearing;
 *  - the job holds the digest while a row due inside the closed cycle is
 *    neither applied, vetoed nor stalled.
 *
 * No TEST_DATABASE_URL: the database cases skip, the run fails on the way out
 * (house rule). Nothing here passes hollowly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { composeMoonDigest, digestFacts, digestFor, digestText, type DigestFacts } from "./moonDigest";
import { applyDueGovernance, routeOutcome, type LandingDeps, type SubjectCloser, type CloseRouting } from "./applyDue";
import { castVote, closeBallot, openBallot, type BallotRow } from "./ballots";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;
let n = 0;
const HOUR = 60 * 60 * 1000;

/** The cycle the digest is about: a closed window with a start and an end. */
const CYCLE_STARTED = new Date("2026-08-01T00:00:00.000Z");
const CYCLE_ENDED = new Date("2026-08-29T00:00:00.000Z");

const CLOSERS: Record<string, SubjectCloser> = {
  mechanics: {
    settle: async () => ({ applied: [], held: null, proposerTold: null }) as CloseRouting,
    execute: async () => ({ applied: ["a.dial"], held: null, proposerTold: null }),
  },
};

const deps = (over: Partial<LandingDeps> = {}): LandingDeps => ({
  pool,
  vetoHours: () => 72,
  autoApplyEnabled: () => true,
  stewardCouncil: () => false,
  // This file is about the digest, never about the seat’s reach; "all" keeps
  // every case here asserting exactly what it asserted before that reach existed.
  stewardVetoTiers: () => "all",
  // A boundary exactly at CYCLE_ENDED, so a tick just after it crosses one.
  nextBoundaryAfter: (after: Date) => (after.getTime() < CYCLE_ENDED.getTime() ? CYCLE_ENDED : new Date(CYCLE_ENDED.getTime() + 28 * 24 * HOUR)),
  cycleNumberAt: () => 1,
  landingExpiryCycles: () => 3,
  closerFor: (t: string) => CLOSERS[t],
  notify: async () => {},
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
  ...over,
});

/** The composer the job is handed, with the ended cycle's own bounds. */
const composer = (calls: string[]) => async (input: { pool: mysql.Pool; endedAt: Date; at: Date }) => {
  calls.push(input.endedAt.toISOString());
  return composeMoonDigest({ ...input, cycleId: "lunar-1200", startedAt: CYCLE_STARTED });
};

const openOne = async (over: Record<string, unknown> = {}): Promise<BallotRow> => {
  const result = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `digest-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
    ],
    ...(over as any),
  });
  if (!result.ok) throw new Error(`ballot refused to open: ${result.error}`);
  return result.ballot;
};

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

beforeEach(async () => {
  if (!configured) return;
  await pool.query("DELETE FROM governance_moon_digests"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await pool.query("DELETE FROM health_events WHERE entity_type = 'governance_digest'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
});

describe("the digest's words", () => {
  const empty: DigestFacts = { landed: [], paid: [], vetoed: [], opened: 0, closed: 0, stalled: 0, expired: 0 };

  it("says a section has nothing rather than dropping the heading", () => {
    const text = digestText("lunar-1200", empty);
    expect(text).toContain("What landed");
    expect(text).toContain("Nothing landed this moon.");
    expect(text).toContain("No decision sent tokens this moon.");
    expect(text).toContain("A steward stopped nothing this moon.");
  });

  it("carries every element's own sentence, not a count of them", () => {
    const text = digestText("lunar-1200", {
      ...empty,
      landed: ["governance.sensing_days moves from 7 to 14"],
      vetoed: [{ title: "The lending circle", reason: "The village had not been shown the numbers." }],
    });
    expect(text).toContain("governance.sensing_days moves from 7 to 14");
    expect(text).toContain("The village had not been shown the numbers.");
  });
});

describe.skipIf(!configured)("one digest per cycle, whatever runs", () => {
  it("composes once and reports the second call as already composed", async () => {
    const first = await composeMoonDigest({ pool, endedAt: CYCLE_ENDED, at: new Date(), cycleId: "lunar-1200", startedAt: CYCLE_STARTED });
    expect(first.composed).toBe(true);
    const second = await composeMoonDigest({ pool, endedAt: CYCLE_ENDED, at: new Date(), cycleId: "lunar-1200", startedAt: CYCLE_STARTED });
    expect(second.composed).toBe(false);
    expect(second.why).toContain("already composed");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM governance_moon_digests WHERE cycle_id = ?", ["lunar-1200"]);
    expect(Number(rows[0].n), "one row, one feed item").toBe(1);
    expect((await digestFor(pool, "lunar-1200"))?.body).toContain("What changed this moon");
  });

  it("says an empty digest is empty, which is not the same answer as none", async () => {
    const result = await composeMoonDigest({ pool, endedAt: CYCLE_ENDED, at: new Date(), cycleId: "lunar-1200", startedAt: CYCLE_STARTED });
    expect(result.composed).toBe(true);
    expect(result.why).toContain("it is empty");
  });

  it("posts exactly one feed item for a village with no minting rules at all", async () => {
    /*
     * THE FAILURE 21.4 CARRIED: the digest was the settlement path's, and that
     * path returns early on `economyReady`. A young village that turned its
     * seeded rules off would have got no digest, forever, and been told
     * nothing. Nothing in this file's fixture enables a single mint rule.
     */
    await composeMoonDigest({ pool, endedAt: CYCLE_ENDED, at: new Date(), cycleId: "lunar-1200", startedAt: CYCLE_STARTED });
    const [feed] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM health_events WHERE entity_type = 'governance_digest' AND entity_ref = ?",
      ["lunar-1200"],
    );
    expect(Number(feed[0].n)).toBe(1);
  });
});

describe.skipIf(!configured)("the landing job composes it, and only when it can be honest", () => {
  it("logs 'no digest composed' apart from 'digest empty' when a row is still resting", async () => {
    const b = await openOne();
    await castVote(pool, b.id, "u-a", "yes");
    await castVote(pool, b.id, "u-b", "yes");
    // Its window ended inside the closed cycle and it is still pending.
    await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [new Date(CYCLE_ENDED.getTime() - 10 * 24 * HOUR), b.id]);
    const closed = await closeBallot(pool, {
      ballotId: b.id, closedBy: "governance", outcomeNote: "carried", closerMayCloseEarly: false,
    });
    if (!closed.ok || !closed.ballot) throw new Error(`close refused: ${closed.ok ? "no ballot" : closed.error}`);
    await routeOutcome(deps(), closed.ballot, "passed", "carried", "u-a");
    await pool.query("UPDATE ballots SET lands_at = ?, veto_closes_at = ?, landing_status = 'pending' WHERE id = ?", [
      new Date(CYCLE_ENDED.getTime() - 2 * 24 * HOUR),
      new Date(CYCLE_ENDED.getTime() - 2 * 24 * HOUR),
      b.id,
    ]);

    const calls: string[] = [];
    // A tick one minute after the boundary, with the brake ON so nothing lands.
    const report = await applyDueGovernance(
      deps({ autoApplyEnabled: () => false, composeDigest: composer(calls) as any }),
      new Date(CYCLE_ENDED.getTime() + 60_000),
    );
    expect(report.ran).toBe(true);
    if (!report.ran) return;
    expect(report.digest).toBe("held");
    expect(calls, "the composer was never called").toEqual([]);
    expect(report.notes.join(" ")).toContain("No digest was composed");
    expect(await digestFor(pool, "lunar-1200")).toBeNull();
  });

  it("composes once the cycle's rows are all applied, vetoed or stalled", async () => {
    const calls: string[] = [];
    const report = await applyDueGovernance(
      deps({ composeDigest: composer(calls) as any }),
      new Date(CYCLE_ENDED.getTime() + 60_000),
    );
    expect(report.ran && report.digest).toBe("composed");
    expect(calls.length).toBe(1);
  });

  it("composes nothing on a tick that crossed no boundary, and says which it was", async () => {
    const calls: string[] = [];
    const report = await applyDueGovernance(
      deps({ composeDigest: composer(calls) as any }),
      new Date(CYCLE_ENDED.getTime() - 10 * 24 * HOUR),
    );
    expect(report.ran && report.digest).toBe("no_boundary_crossed");
    expect(calls).toEqual([]);
  });
});

describe.skipIf(!configured)("what the closed cycle did, read from the rows", () => {
  it("counts only what happened inside the cycle's own window", async () => {
    const facts = await digestFacts(pool, CYCLE_STARTED, CYCLE_ENDED);
    expect(facts.opened).toBeGreaterThanOrEqual(0);
    // Nothing in this file opens a ballot inside August 2026, so the window
    // holds the one row the previous case moved into it and nothing else.
    const wide = await digestFacts(pool, new Date("2000-01-01T00:00:00.000Z"), new Date("2100-01-01T00:00:00.000Z"));
    expect(wide.opened).toBeGreaterThan(facts.opened);
  });
});
