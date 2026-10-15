/**
 * `exits`: the three status writes the admin exit routes make.
 *
 * Moved here from `server/index.ts` with the routes that call them
 * (`server/routes/exits.ts`, 2026-09-27). Each statement is the one that route
 * ran inline, word for word, so a departure moves through the same states it
 * always did. The rest of the table's readers and writers (open, enumerate,
 * sweep) live in `server/lib/exit.ts`.
 *
 * No cache sits above this table: every write goes straight to the database.
 */
import type { Pool } from "mysql2/promise";

/** After a balance sweep: the exit is settling, and the sweep's note joins its resolution text. */
export async function markExitSettling(pool: Pool, exitId: string, note: string): Promise<void> {
  await pool.query(
    "UPDATE exits SET status = 'settling', resolution = CONCAT(COALESCE(resolution,''), ?) WHERE id = ?",
    [note, exitId],
  );
}

/** After the tombstone: the exit is resolved, keeping any agreement pointer it already holds when none is given. */
export async function markExitResolved(pool: Pool, exitId: string, agreementRef: string | null): Promise<void> {
  await pool.query(
    "UPDATE exits SET status = 'resolved', resolved_at = NOW(), agreement_ref = COALESCE(?, agreement_ref) WHERE id = ?",
    [agreementRef, exitId],
  );
}

/**
 * A person who stays. Only an exit still open or settling can be cancelled,
 * and the answer says whether one was.
 */
export async function cancelOpenExit(pool: Pool, exitId: string): Promise<boolean> {
  const [r] = await pool.query<any>(
    "UPDATE exits SET status = 'cancelled', resolved_at = NOW() WHERE id = ? AND status IN ('open','settling')",
    [exitId],
  );
  return Boolean((r as any).affectedRows);
}
