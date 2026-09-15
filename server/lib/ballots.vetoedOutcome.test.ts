/**
 * A VETOED DECISION READS AS FAILED, WHATEVER ITS ROW STILL SAYS.
 *
 * Rye's ruling, 2026-09-08: all vetoed proposals clearly show that they did not
 * pass and failed. `recordVetoOnBallot` (server/repos/ballotLandings.ts) now
 * writes `status = 'failed'` with the veto, but every row vetoed BEFORE that
 * change kept `status = 'passed'` beside `landing_status = 'vetoed'`, and the
 * decision page maps `passed` to "Carried". No migration rewrites them: the
 * rule is read-side, in `outcomeStatusOf`, and `rowToBallot` applies it, so
 * `ballotById` (the decision page), `ballotsFor` (prior attempts, the launch
 * record, the completion gate) and the list route all serve the same answer.
 *
 * The first block needs no database and runs everywhere. The second proves the
 * rule survives a real `SELECT *` round trip, and that the stored column is
 * left exactly as it was.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ballotById, ballotsFor, openBallot, outcomeStatusOf, rowToBallot } from "./ballots";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[ballots.vetoedOutcome] TEST_DATABASE_URL not set. The database block SKIPPED.");
}

/** A ballot row as `SELECT *` hands it back, with only the columns the rule reads varied. */
const row = (over: Record<string, unknown>) =>
  ({
    id: "b-veto", subject_type: "mechanics", subject_ref: "gmp-veto", open_key: "closed:b-veto",
    title: "A decision", doc_markdown: "# doc", method: "custom", weight_mode: "equal", weight_token: null,
    unity_pct: 80, quorum_pct: 20, total_weight: 3, electorate_count: 3, opened_by: "u-proposer",
    opens_at: new Date("2026-08-01T00:00:00Z"), closes_at: new Date("2026-08-08T00:00:00Z"),
    status: "passed", timing: null, outcome_note: "Carried at close.", closed_by: "governance",
    closed_at: new Date("2026-08-08T00:00:00Z"), created_at: new Date("2026-08-01T00:00:00Z"),
    landing_status: "pending", vetoed_at: null,
    ...over,
  }) as any;

describe("a vetoed decision reads as failed", () => {
  it("reads a pre-ruling veto (passed, landing vetoed) as failed", () => {
    expect(rowToBallot(row({ landing_status: "vetoed", vetoed_at: new Date("2026-08-09T00:00:00Z") })).status).toBe("failed");
  });

  it("reads failed on either half of the veto record alone", () => {
    expect(outcomeStatusOf(row({ landing_status: "vetoed", vetoed_at: null }))).toBe("failed");
    expect(outcomeStatusOf(row({ landing_status: "pending", vetoed_at: "2026-08-09 00:00:00" }))).toBe("failed");
  });

  it("leaves every decision nobody stopped exactly as stored", () => {
    expect(outcomeStatusOf(row({}))).toBe("passed");
    expect(outcomeStatusOf(row({ landing_status: "applied" }))).toBe("passed");
    expect(outcomeStatusOf(row({ status: "open", landing_status: "not_applicable" }))).toBe("open");
    expect(outcomeStatusOf(row({ status: "failed", landing_status: "vetoed", vetoed_at: new Date() }))).toBe("failed");
    expect(outcomeStatusOf(row({ status: "no_quorum" }))).toBe("no_quorum");
    expect(outcomeStatusOf(row({ status: "withdrawn" }))).toBe("withdrawn");
  });
});

describe.skipIf(!configured)("a vetoed decision reads as failed, through a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture pool against the S5 scratch schema, never a production table
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const open = async (ref: string) => {
    const r: any = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: ref,
      title: `Ballot ${ref}`,
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
      ],
    });
    const id = String(r?.ballot?.id ?? r?.id ?? "");
    expect(id, `openBallot must hand back an id: ${JSON.stringify(r).slice(0, 200)}`).not.toBe("");
    return id;
  };

  it("serves a pre-ruling vetoed row as failed on the decision read and the list read, and writes nothing", async () => {
    const vetoed = await open("gmp-veto-legacy");
    const standing = await open("gmp-veto-control");
    // The shape a veto left before this PR: the vote's status untouched.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE ballots SET status = 'passed', landing_status = 'vetoed', vetoed_at = NOW(), vetoed_by = 'u-steward', veto_reason = 'old veto' WHERE id = ?",
      [vetoed],
    );
    await pool.query("UPDATE ballots SET status = 'passed', landing_status = 'pending' WHERE id = ?", [standing]); // module-review-ok: fixture SQL against the S5 scratch schema

    expect((await ballotById(pool, vetoed))?.status).toBe("failed");
    expect((await ballotsFor(pool, "mechanics", "gmp-veto-legacy")).map((b) => b.status)).toEqual(["failed"]);
    // The control: a carried decision nobody stopped still reads as carried.
    expect((await ballotById(pool, standing))?.status).toBe("passed");

    // Read-side only. The stored column still says what it said.
    const [[stored]] = await pool.query<any[]>("SELECT status FROM ballots WHERE id = ?", [vetoed]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(String(stored.status)).toBe("passed");
  });
});
