/**
 * `library_loans`: a home being started, with one read in it.
 *
 * ── THIS IS NOT THE TABLE'S ONLY DOOR, AND SAYING SO IS THE POINT ────────
 *
 * The lending machinery in `server/lib/library.ts` reads and writes this
 * table inside its own transactions, and `server/lib/exit.ts`,
 * `server/lib/health.ts`, `server/lib/calendarProviders.ts` and
 * `server/index.ts` each read it too (counted 2026-09-14). None of those moved
 * here. What moved is the one read `server/lib/holdings.ts` made, verbatim, so
 * a reader who lands here knows the list above is where the rest are.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * One member's unsettled loans that still hold a deposit, with the item's
 * name, oldest first.
 *
 * `statuses` is the caller's live-loan list, passed in so the list and the
 * reason for it stay beside `escrowReconciliation`'s own in the lib. Each
 * status travels as a parameter; the placeholders are generated from the
 * list's own length.
 */
export async function liveLoanLockRows(
  pool: Pool,
  userId: string,
  statuses: readonly string[],
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`escrow_credits`, i.`name` FROM `library_loans` l " +
      "JOIN `library_items` i ON i.`id` = l.`item_id` " +
      `WHERE l.\`user_id\` = ? AND l.\`settled_at\` IS NULL AND l.\`escrow_credits\` > 0 ` +
      `AND l.\`status\` IN (${statuses.map(() => "?").join(",")}) ORDER BY l.\`created_at\``,
    [userId, ...statuses],
  );
  return rows;
}
