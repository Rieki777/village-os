/**
 * Writes to `stays` that belong in a repo. The stay lifecycle itself (request,
 * activate, post nights, end) still lives in server/lib/stays.ts; this file
 * starts with the one write the erasure needs, so the query sits where a
 * table's statements stay enumerable.
 */
import type { Pool } from "mysql2/promise";

/**
 * Clear the notes on every stay one member made, for the erasure's
 * `stay-notes-after-tombstone` step (server/lib/erasure.ts).
 *
 * THE STAY STAYS, ITS NOTES GO. A stay is a value row: its nights were posted
 * to the ledger against it, and the conservation proof reads those legs, so
 * the row is kept and the tombstone de-attributes it. The notes are up to two
 * thousand characters the member wrote about themselves (dates, needs, who
 * they travel with), and nothing the village owes or is owed depends on them.
 *
 * Idempotent: an UPDATE writing NULL, keyed on the member.
 */
export async function forgetStayNotesOf(pool: Pool, userId: string): Promise<number> {
  const [r]: any = await pool.query(
    "UPDATE stays SET notes = NULL WHERE user_id = ? AND notes IS NOT NULL",
    [userId],
  );
  return Number(r?.affectedRows ?? 0);
}
