/**
 * The two reads that say whether somebody left the village and what they are
 * still owed in cash, for `server/lib/formerMember.ts`.
 *
 * Under `server/repos` because that is where a table's readers live. Neither
 * read writes anything.
 *
 * WHO LEFT is a STRUCTURAL fact, read off `exits.status`, and never parsed out
 * of the resolution note. The note's wording is display copy, and a reader
 * keyed on display copy breaks on the next copy edit. A resolved exit on its
 * own is not the answer, because a member can be admitted again afterwards:
 * the lib combines this read with the member record (`isFormerMember`).
 *
 * WHAT CASH IS UNPAID reads `cash_owed` (0285) in the two states that are
 * still owed: `owed` and `claimed`. Grouped by currency, because a village that
 * changed currency holds rows in both and adding them would be a number in no
 * currency at all. The `cash_owed` table's own readers and writers live in
 * `server/repos/cashOwed.ts`; this is the one read a departure needs, kept
 * here so the exit path owns its question.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Every account that has a resolved exit on record, for building a roll in one read. */
export async function resolvedExitUserIds(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT DISTINCT user_id FROM exits WHERE status = 'resolved'");
  return new Set(rows.map((r) => String(r.user_id)));
}

/** Whether this account has a resolved exit on record. */
export async function hasResolvedExit(pool: Pool, userId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 AS found FROM exits WHERE user_id = ? AND status = 'resolved' LIMIT 1",
    [userId],
  );
  return rows.length > 0;
}

/** The cash still owed to one member, totalled per currency, in minor units. */
export async function unpaidCashTotalsOf(
  pool: Pool,
  userId: string,
): Promise<Array<{ currency: string; amountMinor: number; rows: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT currency, SUM(amount_minor) AS amount_minor, COUNT(*) AS n FROM cash_owed " +
      "WHERE user_id = ? AND state IN ('owed','claimed') GROUP BY currency ORDER BY currency",
    [userId],
  );
  return rows.map((r) => ({ currency: String(r.currency), amountMinor: Number(r.amount_minor), rows: Number(r.n) }));
}
