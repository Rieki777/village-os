/**
 * The abuse guard's table, and the one decision that has to be atomic.
 *
 * ── WHY THE CHECK AND THE RECORD ARE ONE TRANSACTION ────────────────────────
 *
 * The guard counted the recent hits in one statement and inserted its own in
 * the next. Between those two statements nothing held the window, so a burst
 * fired in parallel ALL read a count below the bound, ALL inserted, and ALL
 * passed. The bound held only against callers polite enough to arrive one at a
 * time, which is the opposite of the traffic it exists to stop. Found while
 * reviewing the quest-ideas pull request; `rateHitsConcurrency.test.ts` fires
 * twenty at once and counts how many got through.
 *
 * The serialising is a NAMED LOCK, one per bucket, and the first shape this
 * took was wrong in a way worth writing down. `SELECT ... FOR UPDATE` over
 * `bucket = ? AND at > ...` reads like a lock on that bucket's rows, and it is
 * not: InnoDB locks the GAPS around the index entries it scans, and on a
 * sparse `rate_hits` one bucket's gap spans its neighbours. Ten callers on ten
 * DIFFERENT buckets then waited on each other, which is the opposite of what a
 * per-abuser bound needs, and the test that fires ten at once said so.
 *
 * `GET_LOCK` takes a lock on a name rather than on a range, so two buckets
 * never meet, and the count and the insert between acquiring and releasing it
 * are one decision. The name is hashed because a bucket may be 120 characters
 * and MySQL's lock names stop at 64. A lock the database will not give inside
 * two seconds answers `unavailable`, because a guard that cannot serialise
 * cannot honestly say the caller is within budget.
 *
 * ── WHY THERE ARE THREE ANSWERS AND NOT TWO ─────────────────────────────────
 *
 * `under`, `over`, and `unavailable`, because "the guard could not check" is
 * not the same fact as "the caller is within their budget", and flattening the
 * two is what made a database problem silently remove the protection. Callers
 * that were written to fail open still fail open, by mapping `unavailable` to
 * "not over limit" in one visible place. The one caller that must not, the
 * share-card raster, reads the third answer and refuses (Rye, 2026-09-23:
 * refuse on the raster only).
 *
 * ── WHY THE WINDOW IS MEASURED IN THE DATABASE ─────────────────────────────
 *
 * The guard used to compute `since` in Node and send it as a parameter, then
 * compare it against `at`, which the INSERT writes with the database's own
 * `CURRENT_TIMESTAMP(3)`. Those are two different clocks whenever the
 * database session is not on UTC, because every pool here connects with
 * `timezone: "Z"`. Measured on this machine, whose MariaDB session runs
 * SYSTEM (Pacific): a row written at that very moment did NOT fall inside a
 * one-hour window, so the count came back 0 every time and the guard passed
 * everyone, forever, without a word in any log.
 *
 * A village whose database happens to run UTC never sees it, which is why it
 * survived: the platform's own deployment is UTC. A fork on a database in
 * local time has no rate limiting at all and cannot tell.
 *
 * So the window is arithmetic the database does on its own clock:
 * `at > CURRENT_TIMESTAMP(3) - INTERVAL ? MICROSECOND`. Both sides of the
 * comparison are then written and read in one frame, whatever that frame is,
 * and nothing depends on the driver's timezone setting. See
 * [[timestamp-read-shifts-by-db-host-offset]] for the same trap elsewhere.
 *
 * The opportunistic sweep stays OUTSIDE the transaction: it deletes a day's
 * tail across every bucket, and holding those locks inside a guard that every
 * login waits on would trade a small table for a wide stall.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/** What the window says about this caller, including not knowing. */
export type LimitState = "under" | "over" | "unavailable";

/**
 * A lock name for a bucket, inside MySQL's 64-character limit.
 *
 * Hashed rather than truncated: two buckets that share their first 64
 * characters, which is easy for `og-quest:<a long forwarded address>`, would
 * otherwise share a lock and wait on each other for no reason.
 */
function lockName(bucket: string): string {
  return `ratehit:${createHash("sha1").update(bucket).digest("hex")}`;
}

/** One in a hundred calls trims the table. Never awaited, never fatal. */
function sweep(pool: Pool): void {
  if (Math.random() >= 0.01) return;
  void pool
    .query("DELETE FROM rate_hits WHERE at < (NOW() - INTERVAL 1 DAY) LIMIT 5000")
    .catch(() => {});
}

/**
 * Count this bucket's window and record this hit, as ONE decision.
 *
 * Answers `over` without recording anything, so a refused caller does not
 * spend the budget it was refused for, which is the behaviour the guard had
 * before and the reason the count comes first inside the lock.
 */
export async function limitState(
  pool: Pool,
  bucket: string,
  max: number,
  windowMs: number,
  attempt = 1,
): Promise<LimitState> {
  let conn: PoolConnection | undefined;
  let held = false;
  const name = lockName(bucket);
  try {
    conn = await pool.getConnection();
    const [got] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 2) AS ok", [name]);
    // 1 is the lock, 0 is the timeout, NULL is an error. Only 1 may proceed.
    if (Number(got[0]?.ok ?? 0) !== 1) return "unavailable";
    held = true;
    const window = Math.max(0, Math.round(windowMs * 1000));
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND at > (CURRENT_TIMESTAMP(3) - INTERVAL ? MICROSECOND)",
      [bucket, window],
    );
    if (Number(rows[0]?.n ?? 0) >= max) return "over";
    await conn.query("INSERT INTO rate_hits (bucket, at) VALUES (?, CURRENT_TIMESTAMP(3))", [bucket]);
    sweep(pool);
    return "under";
  } catch (e) {
    /*
     * A CONTENDED WRITE IS NOT AN OUTAGE, so it is retried rather than
     * answered `unavailable`. The only write here is the INSERT, and a
     * failed INSERT recorded nothing, so a retry cannot double-count.
     * Three codes reach this branch: InnoDB picking a deadlock victim, a
     * lock wait that timed out, and MariaDB's ER_CHECKREAD (1020) under
     * `innodb_snapshot_isolation`, which the local engine raises where
     * MySQL 8 waits. Without the last one this guard would be red on every
     * developer's machine and green in CI, the worst shape a test can have.
     *
     * THE NAMED LOCK IS GIVEN BACK BEFORE RETRYING, and the connection with
     * it. A named lock belongs to the CONNECTION, so handing the connection
     * back to the pool while still holding the lock would leave the retry
     * waiting two seconds for a name only its own parent could release.
     */
    const code = (e as { code?: string; errno?: number } | null)?.code;
    const errno = (e as { errno?: number } | null)?.errno;
    const contended = code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT" || code === "ER_CHECKREAD" || errno === 1213 || errno === 1205 || errno === 1020;
    if (contended && attempt < 4) {
      if (conn && held) await conn.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => {});
      held = false;
      conn?.release();
      conn = undefined;
      await new Promise((r) => setTimeout(r, 15 * attempt + Math.floor(Math.random() * 15)));
      return limitState(pool, bucket, max, windowMs, attempt + 1);
    }
    console.error("[abuse-guard] check failed", e);
    return "unavailable";
  } finally {
    if (conn && held) await conn.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => {});
    conn?.release();
  }
}

/**
 * Count only, recording nothing. The login guard records a hit on a failed
 * credential alone, so a correct sign-in spends nobody's budget, and it cannot
 * share the transaction above. It has the same race in principle and a
 * different shape in practice: the hit it counts is written by `recordHit`
 * after the attempt fails, so two parallel wrong passwords can both be let
 * through to fail. That is a bound on GUESSES, and letting two land where one
 * was budgeted is not the flood this guard exists to stop.
 */
export async function countInWindow(pool: Pool, bucket: string, windowMs: number): Promise<number | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND at > (CURRENT_TIMESTAMP(3) - INTERVAL ? MICROSECOND)",
      [bucket, Math.max(0, Math.round(windowMs * 1000))],
    );
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    console.error("[abuse-guard] count failed", e);
    return null;
  }
}

/** Record a hit for a guard that counts and records separately. */
export async function recordHit(pool: Pool, bucket: string): Promise<void> {
  try {
    await pool.query("INSERT INTO rate_hits (bucket, at) VALUES (?, CURRENT_TIMESTAMP(3))", [bucket]);
    sweep(pool);
  } catch (e) {
    console.error("[abuse-guard] record failed", e);
  }
}
