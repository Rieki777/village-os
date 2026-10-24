/**
 * `exits`, for the erasure's exit step, for resolve and for the cancel: a home
 * being started.
 *
 * server/lib/exit.ts still creates, reads and settles exits where it always
 * did, and the settle route in server/index.ts still writes `resolution`. What
 * lives here is the erasure's read and write of that column (lane E2), called
 * from `forgetOwnExitNotes` in exit.ts, which decides what the note becomes;
 * the terminal write of a resolve, called from `resolveExit`; and the cancel's
 * status write, called from `cancelExit`.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

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
export async function cancelOpenExit(pool: Pool, exitId: string): Promise<boolean> {
  const [result] = await pool.query(
    "UPDATE exits SET status = 'cancelled', resolved_at = NOW() WHERE id = ? AND status IN ('open','settling')",
    [exitId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * The terminal write of a resolve, for `resolveExit` (server/lib/exitResolve.ts).
 *
 * `agreementRef` is a POINTER and never content, kept when none is given.
 * `note` is appended to the resolution text when there is one; an empty note
 * leaves the column exactly as it was, which is the erasure path's case: the
 * erasure has just rewritten that column itself (`forgetOwnExitNotes`), and a
 * resolve that wrote back an empty string would turn its NULL into ''.
 */
export async function markExitResolved(pool: Pool, exitId: string, agreementRef: string | null, note: string): Promise<void> {
  if (note) {
    await pool.query(
      "UPDATE exits SET status = 'resolved', resolved_at = NOW(), agreement_ref = COALESCE(?, agreement_ref), " +
        "resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ?",
      [agreementRef, note, exitId],
    );
    return;
  }
  await pool.query(
    "UPDATE exits SET status = 'resolved', resolved_at = NOW(), agreement_ref = COALESCE(?, agreement_ref) WHERE id = ?",
    [agreementRef, exitId],
  );
}
