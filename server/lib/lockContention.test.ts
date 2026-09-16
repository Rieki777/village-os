/**
 * WHAT A LOST LOCK ANSWERS, PROVED AGAINST A LOCK THE ENGINE REALLY REFUSED.
 *
 * Three retry loops give up after three attempts and rethrow: `withDeadlockRetry`
 * (server/repos/quests.ts) and the two around `postTransfer` and
 * `postTransferPair` (server/lib/ledger.ts). Whatever they rethrow reaches the
 * terminal handler, which answered "Internal server error" to a steward whose
 * consent had simply lost to contention on the faucet row and whose next press
 * would very likely have worked.
 *
 * WHY THE ERROR IS NOT HAND-MADE. `terminalAnswerFor` duck-types the driver's
 * error, so a literal `{ code: "ER_LOCK_WAIT_TIMEOUT" }` would prove only that
 * the matcher matches itself while the real mysql2 object could carry something
 * else entirely. One connection holds a row, a second one waits one second for
 * it, and the error the driver raises is the one asserted on. The same reason
 * `server/lib/errors.test.ts` builds a real `StaleSnapshotError`.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { respondToTerminalError, terminalAnswerFor } from "./errors";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[lockContention.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;

/**
 * A row somebody else is holding, waited on for one second.
 *
 * The holder LOCKS without writing, deliberately: MariaDB's
 * `innodb_snapshot_isolation` refuses a lock on a row modified since the
 * waiter's snapshot with `ER_CHECKREAD` (1020), which is a different answer,
 * and the waiter's locking read is its transaction's first statement, so no
 * read view is open. Both engines therefore reach the same lock wait.
 */
async function lockWaitTimeout(): Promise<unknown> {
  const holder = await pool.getConnection();
  const waiter = await pool.getConnection();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT n FROM lock_probe WHERE id = 1 FOR UPDATE"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, holding a row so the next connection has to wait
    await waiter.query("SET SESSION innodb_lock_wait_timeout = 1");
    await waiter.query("BEGIN");
    try {
      await waiter.query("SELECT n FROM lock_probe WHERE id = 1 FOR UPDATE"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, the statement whose refusal this suite exists to assert
      return null;
    } catch (e) {
      return e;
    }
  } finally {
    await waiter.query("ROLLBACK").catch(() => {});
    await holder.query("ROLLBACK").catch(() => {});
    waiter.release();
    holder.release();
  }
}

describe.skipIf(!configured)("what the terminal handler answers for a lost lock (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await pool.query("CREATE TABLE lock_probe (id int NOT NULL PRIMARY KEY, n int NOT NULL)"); // module-review-ok: fixture table on the S5 scratch schema this suite provisioned, so no product table is locked
    await pool.query("INSERT INTO lock_probe (id, n) VALUES (1, 0)"); // module-review-ok: fixture row on the S5 scratch schema this suite provisioned
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("answers 503 and a sentence to act on, for an error the driver really raised", async () => {
    const err: any = await lockWaitTimeout();
    // The test is worthless if the engine did not actually refuse.
    expect(err?.code, "the waiter was supposed to time out on a held row").toBe("ER_LOCK_WAIT_TIMEOUT");
    expect(err?.errno).toBe(1205);

    const answer = terminalAnswerFor(err);
    expect(answer.status).toBe(503);
    expect(answer.body.code).toBe("lock_contention");
    expect(answer.level, "a busy moment is not a fault, and the log should not shout").toBe("warn");
    expect(answer.body.error).toContain("Try it again");
    // The engine's own words stay in the log, and our schema never reaches a screen.
    expect(answer.detail.toLowerCase()).toContain("lock wait timeout");
    expect(answer.body.error).not.toContain("lock_probe");
  });

  it("carries that answer through the handler the server installs", async () => {
    const err = await lockWaitTimeout();
    const sent: Array<{ status: number; body: any }> = [];
    const res = { status: (code: number) => ({ json: (body: unknown) => sent.push({ status: code, body }) }) };
    respondToTerminalError(err, res);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.status).toBe(503);
    expect(sent[0]!.body.code).toBe("lock_contention");
  });

  it("answers the deadlock code the same way, and the bare number too", () => {
    // CONSTRUCTED, and honest about why. The case above anchors the shape
    // against the real driver; this one covers the other constant the three
    // retry loops name. A real deadlock is not reproduced here because the
    // local engine is MariaDB with `innodb_snapshot_isolation` on, which
    // refuses the crossing update with `ER_CHECKREAD` before a cycle can form:
    // the test would be red on this machine and green in CI, which is the
    // worst shape a test can have.
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
      sqlState: "40001",
    });
    expect(terminalAnswerFor(deadlock).status).toBe(503);
    // A driver that hands back the number and no name means the same thing.
    expect(terminalAnswerFor(Object.assign(new Error("Lock wait timeout exceeded"), { errno: 1205 })).status).toBe(503);
  });
});
