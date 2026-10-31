/**
 * `exits`, for the erasure's exit step, for resolve and for the cancel: a home
 * being started.
 *
 * server/lib/exit.ts still creates, reads and settles exits where it always
 * did, and the settle route in server/index.ts still writes `resolution`. What
 * lives here is the erasure's read and write of that column (lane E2), called
 * from `forgetOwnExitNotes` in exit.ts, which decides what the note becomes;
 * the hold resolve and cancel take turns under (`whileExitHeld`), with the
 * writes each makes inside it; and the terminal write of a resolve.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

/** Every departure a member opened themselves that carries any text. */
export async function ownExitResolutions(pool: Pool, userId: string): Promise<Array<{ id: string; resolution: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, resolution FROM exits WHERE user_id = ? AND opened_by = ? AND resolution IS NOT NULL",
    [userId, userId],
  );
  return rows.map((r) => ({ id: String(r.id), resolution: String(r.resolution) }));
}

/** Write one exit's resolution text, or NULL when nothing is left of it. */
export async function setExitResolution(pool: Pool, exitId: string, resolution: string | null): Promise<void> {
  await pool.query("UPDATE exits SET resolution = ? WHERE id = ?", [resolution, exitId]);
}

/**
 * Close one exit as cancelled while it is still open or settling. True when
 * this call closed it; false when there is no such exit or it already ended.
 */
export async function cancelOpenExit(db: Db, exitId: string): Promise<boolean> {
  const [result] = await db.query(
    "UPDATE exits SET status = 'cancelled', resolved_at = NOW() WHERE id = ? AND status IN ('open','settling')",
    [exitId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * The terminal write of a resolve, for `resolveExit` (server/lib/exitResolve.ts).
 *
 * ONLY WHILE THE EXIT IS STILL OPEN OR SETTLING (round 4). It used to write
 * 'resolved' with no status condition, so a cancel that landed after the
 * resolve route read the status was overwritten, and the admin who had just
 * pressed "They're staying" was contradicted by the record. True when this
 * call resolved it; false when the exit had already ended, which the caller
 * reads.
 *
 * `agreementRef` is a POINTER and never content, kept when none is given.
 * `note` is appended to the resolution text when there is one; an empty note
 * leaves the column exactly as it was, which is the erasure path's case: the
 * erasure has just rewritten that column itself (`forgetOwnExitNotes`), and a
 * resolve that wrote back an empty string would turn its NULL into ''.
 */
export async function markExitResolved(db: Db, exitId: string, agreementRef: string | null, note: string): Promise<boolean> {
  const [result] = note
    ? await db.query(
        "UPDATE exits SET status = 'resolved', resolved_at = NOW(), agreement_ref = COALESCE(?, agreement_ref), " +
          "resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ? AND status IN ('open','settling')",
        [agreementRef, note, exitId],
      )
    : await db.query(
        "UPDATE exits SET status = 'resolved', resolved_at = NOW(), agreement_ref = COALESCE(?, agreement_ref) " +
          "WHERE id = ? AND status IN ('open','settling')",
        [agreementRef, exitId],
      );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** One exit as a hold read it, with the row locked. */
export interface HeldExit {
  /** Null when there is no such exit. */
  status: string | null;
  userId: string | null;
  resolution: string | null;
  /** Open or settling: the only states resolve and cancel act on. */
  open: boolean;
}

/** What a hold may write, on the locked connection, so each write lands with the lock. */
export interface ExitHold {
  exit: HeldExit;
  /** Append one line to the exit's resolution text. */
  appendNote(line: string): Promise<void>;
  /** `markExitResolved`, inside the hold. */
  markResolved(agreementRef: string | null, note: string): Promise<boolean>;
  /** `cancelOpenExit`, inside the hold. */
  cancel(): Promise<boolean>;
}

/**
 * Hold one exit's row FOR UPDATE for as long as `fn` runs, so resolve and the
 * cancel take turns on it (round 4).
 *
 * Both take the hold before they read the status, and neither lets go until
 * its own write has landed. A cancel that arrives while a resolve holds the
 * row waits, then reads what the resolve left; a resolve that arrives after a
 * cancel reads 'cancelled' and stops. No migration: `exits.status` is an enum
 * with no "resolving" in it, and a row lock needs none.
 *
 * What `fn` does on the pool runs on other connections, OUTSIDE this
 * transaction, which is the point: an account write or an erasure record the
 * caller makes while holding the row has landed by the time anybody else can
 * read the exit. So `fn` must never write `exits` through the pool, which
 * would wait on this very lock: it writes through the hold.
 *
 * Commits when `fn` returns and rolls back when it throws.
 */
export async function whileExitHeld<T>(pool: Pool, exitId: string, fn: (hold: ExitHold) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT user_id, status, resolution FROM exits WHERE id = ? FOR UPDATE",
      [exitId],
    );
    const r = rows[0];
    const status = r ? String(r.status) : null;
    const hold: ExitHold = {
      exit: {
        status,
        userId: r ? String(r.user_id) : null,
        resolution: r?.resolution == null ? null : String(r.resolution),
        open: status === "open" || status === "settling",
      },
      appendNote: async (line) => {
        await conn.query("UPDATE exits SET resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ?", [line, exitId]);
      },
      markResolved: (agreementRef, note) => markExitResolved(conn, exitId, agreementRef, note),
      cancel: () => cancelOpenExit(conn, exitId),
    };
    const out = await fn(hold);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
