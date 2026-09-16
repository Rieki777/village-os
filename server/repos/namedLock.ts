/**
 * A named database lock around one piece of background work, so a second copy
 * of it returns at once instead of running beside the first.
 *
 * ── WHY A LOCK WHEN THE SCHEDULER ALREADY CLAIMS ────────────────────────────
 *
 * `server/lib/scheduler.ts` claims a job by stamping when its run STARTED, and
 * ticks every five minutes without waiting for a run to end. A job slower than
 * its own cadence, or run by hand while the scheduler runs it too, can
 * therefore be claimed twice. `GET_LOCK(name, 0)` answers immediately, so the
 * second caller learns it lost and does nothing.
 *
 * ── WHY THE NAME CARRIES THE DATABASE ───────────────────────────────────────
 *
 * MySQL's lock namespace is the whole server, never one database, the trap
 * `server/db/migrate.ts` records. Two villages sharing a server, or two test
 * suites each on their own scratch schema, would otherwise take each other's
 * lock and skip work that was theirs to do. MySQL refuses a name over 64
 * characters, so the name is clipped to fit.
 *
 * ── WHY ONE DEDICATED CONNECTION ────────────────────────────────────────────
 *
 * The lock belongs to the session that took it. It is released on that same
 * connection, and if the connection dies mid-run the server releases it, so a
 * crashed run never leaves the work locked for good.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const LOCK_NAME_SQL = "LEFT(CONCAT(?, ':', COALESCE(DATABASE(), '')), 64)";

export type LockedRun<T> = { ran: true; value: T } | { ran: false };

/** Run `fn` while holding the lock, or return `{ ran: false }` at once when another caller holds it. */
export async function withNamedLock<T>(pool: Pool, name: string, fn: () => Promise<T>): Promise<LockedRun<T>> {
  const conn = await pool.getConnection();
  let held = false;
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK(${LOCK_NAME_SQL}, 0) AS got`, [name]);
    held = Number(rows[0]?.got) === 1;
    if (!held) return { ran: false };
    return { ran: true, value: await fn() };
  } finally {
    if (held) await conn.query(`SELECT RELEASE_LOCK(${LOCK_NAME_SQL})`, [name]).catch(() => undefined);
    conn.release();
  }
}
