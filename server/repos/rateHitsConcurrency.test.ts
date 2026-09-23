/**
 * DOES THE BOUND HOLD WHEN THE CALLERS ARRIVE TOGETHER?
 *
 * The guard counted a bucket's recent hits in one statement and inserted its
 * own in the next. Nothing held the window between them, so a burst fired in
 * parallel all read a count below the bound, all inserted, and all passed: the
 * limit held only against callers arriving one at a time, which is the
 * opposite of the traffic it exists to stop. Found while reviewing the
 * quest-ideas pull request.
 *
 * A sequential test cannot see that defect. It passes against the old code and
 * against the new one, which is exactly why the case below fires twenty at
 * once with `Promise.all` and counts how many got through.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { countInWindow, limitState, recordHit } from "./rateHits";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[rateHitsConcurrency.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

const HOUR = 60 * 60 * 1000;

let db: TestDb;
let pool: mysql.Pool;

/** Every hit recorded for one bucket, however it got there. */
const hits = async (bucket: string) => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the guard wrote, on the S5 scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ?",
    [bucket],
  );
  return Number(rows[0]?.n ?? 0);
};

describe.skipIf(!configured)("the abuse guard under a parallel burst (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    // Enough connections that twenty callers really do overlap. With a smaller
    // pool they would queue on connections instead of on the row lock, and the
    // case would pass without proving anything.
    pool = testPool(db, { connectionLimit: 24 });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  afterEach(async () => {
    await pool.query("DELETE FROM rate_hits"); // module-review-ok: fixture cleanup on the S5 scratch schema this suite provisioned
  });

  it("lets exactly the budget through when twenty arrive at once", async () => {
    const bucket = "burst:1.2.3.4";
    const MAX = 5;

    const answers = await Promise.all(
      Array.from({ length: 20 }, () => limitState(pool, bucket, MAX, HOUR)),
    );

    const under = answers.filter((a) => a === "under").length;
    const over = answers.filter((a) => a === "over").length;
    const unavailable = answers.filter((a) => a === "unavailable").length;

    expect(unavailable, "a lock wait is not an outage; nothing here should be unavailable").toBe(0);
    expect(under, "the bound is the bound, however the callers arrive").toBe(MAX);
    expect(over).toBe(20 - MAX);
    // And the table holds one row per caller that got through, which is what
    // makes the NEXT call in the window answer correctly.
    expect(await hits(bucket)).toBe(MAX);
  });

  it("does not spend the budget of a caller it refused", async () => {
    const bucket = "burst:refused";
    await Promise.all(Array.from({ length: 12 }, () => limitState(pool, bucket, 3, HOUR)));
    // Nine were refused. If a refusal recorded a hit, this would read 12, and
    // the window would stay full long after the burst ended.
    expect(await hits(bucket)).toBe(3);
  });

  it("separate buckets do not wait on each other", async () => {
    // The lock is per bucket, which is per IP or per member. If it were
    // coarser, one abuser would throttle the whole village.
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => limitState(pool, `burst:member-${i}`, 1, HOUR)),
    );
    expect(answers.every((a) => a === "under")).toBe(true);
  });

  it("counts the same window the caller was refused for, one at a time", async () => {
    // The sequential control: the old code passed this too, and that is the
    // point of keeping it beside the burst above.
    const bucket = "sequential:1.2.3.4";
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push(await limitState(pool, bucket, 3, HOUR));
    expect(seen).toEqual(["under", "under", "under", "over"]);
    expect(await countInWindow(pool, bucket, HOUR)).toBe(3);
  });

  it("answers unavailable when it cannot reach the table, and never under", async () => {
    // The third answer exists so a caller can tell "within budget" from "could
    // not check". `overLimit` in server/index.ts folds this back to not-over
    // for the callers written to fail open; the share-card raster reads it.
    const dead = testPool(db, { connectionLimit: 1 }); // closed on purpose, to make the guard's read fail
    await dead.end();

    await expect(limitState(dead, "unreachable", 5, HOUR)).resolves.toBe("unavailable");
    await expect(countInWindow(dead, "unreachable", HOUR)).resolves.toBeNull();
    // And recording never throws into a caller, whatever the table says.
    await expect(recordHit(dead, "unreachable")).resolves.toBeUndefined();
  });
});
