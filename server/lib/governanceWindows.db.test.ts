/**
 * THE WINDOW AT THE OPEN PATH, proven against a real MySQL (S5 harness).
 *
 * The pure arithmetic is `governanceWindows.test.ts`. This file proves the
 * four things only a database can show:
 *
 *  - `openBallot` refuses an opening outside the window, in the words the
 *    member reads, and writes NOTHING when it does;
 *  - a ballot that opened while its kind was open is never closed by the
 *    window shutting under it, and a vote cast afterwards still counts;
 *  - a proposal coming back from a decision that closed inside the grace opens
 *    outside the window, which is what keeps the objection loop answerable,
 *    and one that comes back long afterwards is held to the window again;
 *  - the grace is measured from the close of the original ballot.
 *
 * WHY THE SHUT SHAPE IS COMPUTED. A window is a position in the cycle, so a
 * fixed shape is open on some days and shut on others and this file would pass
 * for the wrong reason three weeks a month. The shape is derived from where
 * the run actually falls in the cycle, so "shut" means shut on the day the test
 * runs.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ballotById, castVote, closeBallot, openBallot, type OpenBallotInput } from "./ballots";
import { loadVariables, setVariable, stringVar } from "./variables";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { comingBackFrom, nextWindowFor, WINDOW_KINDS } from "./governanceWindows";

const configured = testDbConfigured();
const DAY = 86_400_000;
const SEAT_KEY = WINDOW_KINDS.role_seat.key;

let db: TestDb;
let pool: mysql.Pool;
let n = 0;

/**
 * A two-day window that does NOT contain today, whichever day of the cycle
 * this run falls on. Two days clears `governance.vote_days`, which this suite
 * pins at one so the shape is legal.
 */
function shutShapeNow(now = new Date()): string {
  const b = LUNAR_CLOCK.boundsFor(now);
  const remainingDays = (b.endsAt.getTime() - now.getTime()) / DAY;
  // More than three days left: put the window at the very end, still ahead.
  // Otherwise the run is in the last stretch, so the first two days are past.
  return remainingDays > 3 ? "last_days_of_cycle:2" : "custom:1-2";
}

const openOne = async (over: Partial<OpenBallotInput> = {}) =>
  openBallot(pool, {
    subjectType: "role_seat",
    subjectRef: `win-${++n}`,
    title: `Ballot ${n}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 20,
    durationDays: 1,
    openedBy: "u-proposer",
    electorate: [
      { userId: "u-a", weight: 1 },
      { userId: "u-b", weight: 1 },
      { userId: "u-c", weight: 1 },
    ],
    ...over,
  });

describe.skipIf(!configured)("governance windows at the open path (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadVariables(pool);
    await setVariable(pool, "governance.vote_days", "1");
  });

  afterAll(async () => {
    if (pool) {
      await setVariable(pool, SEAT_KEY, "always_open");
      await setVariable(pool, "governance.vote_days", "7");
      await pool.end();
    }
    await db?.drop();
  });

  it("opens on any day while every window ships always open", async () => {
    expect(stringVar(SEAT_KEY)).toBe("always_open");
    const r = await openOne();
    expect(r.ok).toBe(true);
  });

  it("refuses an opening outside the window and writes nothing", async () => {
    await setVariable(pool, SEAT_KEY, shutShapeNow());
    expect(nextWindowFor("role_seat", new Date()).open).toBe(false);
    const ref = `win-shut-${Date.now()}`;
    const r = await openOne({ subjectRef: ref });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Seating a role opens in");
      expect(r.error).toContain("The next window opens");
      expect(r.error).toContain("tray");
    }
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS c FROM ballots WHERE subject_ref = ?", [ref]);
    expect(Number(rows[0].c)).toBe(0);
    await setVariable(pool, SEAT_KEY, "always_open");
  });

  it("lets anything coming back open outside its window, inside the grace", async () => {
    await setVariable(pool, SEAT_KEY, shutShapeNow());
    const back = await openOne({
      subjectRef: `win-back-${Date.now()}`,
      window: { comingBackFrom: new Date(Date.now() - 2 * DAY), relation: "overrides" },
    });
    expect(back.ok).toBe(true);
    const stale = await openOne({
      subjectRef: `win-stale-${Date.now()}`,
      window: { comingBackFrom: new Date(Date.now() - 60 * DAY), relation: "renews" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toContain("days it had to come back in have passed");
    await setVariable(pool, SEAT_KEY, "always_open");
  });

  it("refuses a relation this build does not know", async () => {
    const r = await openOne({ window: { comingBackFrom: new Date(), relation: "supersedes" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("renews, overrides, replaces");
  });

  it("never closes a ballot the window shuts under, and the votes still count", async () => {
    const ref = `win-running-${Date.now()}`;
    const opened = await openOne({ subjectRef: ref });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // The window shuts under the running vote. Nothing about the ballot moves.
    await setVariable(pool, SEAT_KEY, shutShapeNow());
    const still = await ballotById(pool, opened.ballot.id);
    expect(still?.status).toBe("open");

    const cast = await castVote(pool, opened.ballot.id, "u-a", "yes");
    expect(cast.ok).toBe(true);
    // Let the ballot reach its own close the way the clock would, then close
    // it. The window is long shut by now and takes no part in either step.
    await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [opened.ballot.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const closed = await closeBallot(pool, {
      ballotId: opened.ballot.id,
      closedBy: "u-proposer",
      outcomeNote: "The window shut while this ran and the vote finished anyway.",
      closerMayCloseEarly: false,
    });
    expect(closed.ok, closed.ok ? "" : closed.error).toBe(true);
    if (closed.ok) expect(closed.tallies.yesW).toBe(1);
    await setVariable(pool, SEAT_KEY, "always_open");
  });

  it("reads the close of the decision a proposal comes back from", async () => {
    await pool.query(
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, " +
        "unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status) " +
        "VALUES ('bal-orig','mechanics','gmp-orig','closed:bal-orig','Original','#','custom','equal',80,20,3,3,'u-proposer', " +
        "'2026-01-01 00:00:00','2026-01-08 00:00:00','passed')", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    );
    await pool.query(
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status, ballot_id) " +
        "VALUES ('gmp-orig','Original','because','[]','u-proposer','vetoed','bal-orig')", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    );
    await pool.query(
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status, supersedes_proposal_id) " +
        "VALUES ('gmp-back','Again','because','[]','u-proposer','open','gmp-orig')", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    );
    const at = await comingBackFrom(pool, "gmp-back");
    expect(at?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    // A proposal pointing at nothing gets no grace, which is the ordinary case.
    expect(await comingBackFrom(pool, "gmp-orig")).toBeNull();
  });
});
