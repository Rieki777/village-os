/**
 * A CARRIED CHANGE THAT CANNOT LAND: AT THE CLOSE, AND AT ITS INSTANT.
 *
 * G1. The worry was that a closer throwing on a refusal would answer a human
 * closing the ballot with a 500 after the ballot had closed. Measured on the
 * landing table: a Game change never executes inside the close. `landingFor`
 * executes at close only for a no-window subject (`village_launch`) or a set of
 * token sends chosen at acceptance, and a mechanics, minting or weight-mode
 * ballot is a Game change. So the close stamps an instant and returns, and the
 * refusal meets the landing job instead. The first case pins that.
 *
 * G2. At its instant the weight-mode landing used to RETURN on a refusal, so
 * `applyDue` marked it applied. The second case drives the real library the
 * closer calls through the real landing job and reads the landing row and the
 * executor-pending attempt afterwards.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and it skips loudly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { castVote, closeBallot, openBallot, type BallotRow } from "./ballots";
import { applyDueGovernance, landingRow, routeOutcome, type LandingDeps, type SubjectCloser } from "./applyDue";
import { loadVariables } from "./variables";
import type { ChangesetDeps } from "./changeset";
import { landWeightMode, notLandedSentence } from "./landingRefusal";
import { GOVERNANCE_MODE } from "../../shared/ballotSubjects";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[landingRefusal] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");
}

const HOUR = 60 * 60 * 1000;
let db: TestDb;
let pool: mysql.Pool;
let executes = 0;
let n = 0;

const changesetDeps = (): ChangesetDeps => ({
  pool,
  recordMechanicsChange: async () => {},
  reloadCaches: async () => {
    await loadVariables(pool);
  },
  sharedPasswordPosture: () => false,
});

/** The weight-mode closer's execute, as `server/index.ts` wires it, minus the admin bell. */
const modeCloser: SubjectCloser = {
  settle: async () => ({ applied: [], held: null, proposerTold: null }),
  execute: async (b, actorId) => {
    executes += 1;
    const result = await landWeightMode(changesetDeps(), b, actorId);
    return { applied: result.applied, held: null, proposerTold: null };
  },
};

const landing = (): LandingDeps => ({
  pool,
  vetoHours: () => 72,
  autoApplyEnabled: () => true,
  stewardCouncil: () => false,
  stewardVetoTiers: () => "all",
  nextBoundaryAfter: (after: Date) => new Date(after.getTime() + 20 * 24 * HOUR),
  cycleNumberAt: () => 1,
  landingExpiryCycles: () => 3,
  closerFor: (subjectType: string) => (subjectType === GOVERNANCE_MODE ? modeCloser : undefined),
  notify: async () => {},
  endedUnclosedCycle: async () => false,
  waitsForCycleClose: () => false,
  snapsToBoundary: () => false,
});

/** A carried vote to weigh by a token this village never made. */
const carriedModeBallot = async (): Promise<BallotRow> => {
  n += 1;
  const opened = await openBallot(pool, {
    subjectType: GOVERNANCE_MODE,
    subjectRef: `token@a-token-this-village-never-made-${n}`,
    title: `Weigh votes by a token ${n}`,
    docMarkdown: "# How votes are weighed",
    method: "custom",
    weightMode: "equal",
    unityPct: 60,
    quorumPct: 20,
    durationDays: 7,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  for (const voter of ["u-a", "u-b"]) {
    const v = await castVote(pool, opened.ballot.id, voter, "yes");
    if (!v.ok) throw new Error(`vote refused: ${v.error}`);
  }
  await pool.query("UPDATE ballots SET closes_at = ? WHERE id = ?", [new Date(Date.now() - 60_000), opened.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const closed = await closeBallot(pool, {
    ballotId: opened.ballot.id,
    closedBy: "u-a",
    outcomeNote: "The window ended and the village carried it.",
    closerMayCloseEarly: false,
  });
  if (!closed.ok || !closed.ballot) throw new Error(`close refused: ${JSON.stringify(closed)}`);
  expect(closed.outcome).toBe("passed");
  return closed.ballot;
};

const storedMode = async (): Promise<string | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `value` FROM `game_variables` WHERE `config_key` = 'governance.weight_mode'",
  );
  return rows[0] ? String(rows[0].value) : null;
};

describe("the sentence a set that did not wholly land is recorded with", () => {
  it("names a refusal, names every failed element of a partial set, and is null for a whole one", () => {
    expect(
      notLandedSentence({
        refusal: { index: 0, itemKind: "mode_switch", problem: "no", sentence: "Item 1 of 1 (mode_switch) could not be applied: no" },
        failed: [],
      }),
    ).toBe("Item 1 of 1 (mode_switch) could not be applied: no");
    // A PARTIAL set: the mode was written and the token was not.
    expect(
      notLandedSentence({ refusal: null, failed: [{ key: "governance.weight_token", problem: "the registry refused it" }] }),
    ).toBe("governance.weight_token: the registry refused it");
    expect(notLandedSentence({ refusal: null, failed: [] })).toBeNull();
  });
});

describe.skipIf(!configured)("a weight-mode landing that refuses", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
    await loadVariables(pool);
  }, 300000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(() => {
    executes = 0;
  });

  it("closes without landing, so the close cannot answer with the refusal (G1)", async () => {
    const ballot = await carriedModeBallot();
    // The close route's own call. It must resolve: a throw here is the 500.
    const routing = await routeOutcome(landing(), ballot, "passed", "carried", "u-a");
    expect(executes, "a Game change must not execute inside the close").toBe(0);
    expect(routing.held).toContain("It lands at");
    const row = await landingRow(pool, ballot.id);
    expect(row?.landingStatus).toBe("pending");
    expect(row?.landsAt).not.toBeNull();
    expect(await storedMode()).toBeNull();
  });

  it("fails at its instant through the landing job: recorded, retried, never marked applied (G2)", async () => {
    const ballot = await carriedModeBallot();
    await routeOutcome(landing(), ballot, "passed", "carried", "u-a");
    await pool.query("UPDATE ballots SET lands_at = ? WHERE id = ?", [new Date(Date.now() - HOUR), ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    const report = await applyDueGovernance(landing());
    expect(executes).toBe(1);
    expect(report.ran === true && report.failed).toBe(1);
    expect(report.ran === true && report.notes.join(" ")).toContain("no token called");
    // Not applied: back to pending, so the next tick tries again.
    expect((await landingRow(pool, ballot.id))?.landingStatus).toBe("pending");
    // The sentence is on the attempt, which stays open for a person to read.
    const [attempts] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT cleared_at, last_error FROM governance_executor_pending WHERE ballot_id = ?",
      [ballot.id],
    );
    expect(attempts.length).toBe(1);
    expect(attempts[0].cleared_at).toBeNull();
    expect(String(attempts[0].last_error)).toContain("no token called");
    // And nothing was written.
    expect(await storedMode()).toBeNull();
  });
});
