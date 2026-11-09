/**
 * When a budget source was last read (budgets spec R19): the newest
 * `budget_syncs` row for it, whatever the read came to. The schedule and the
 * on-open read both measure their gap from here, so a press, a scheduled read
 * and an on-open read all count as the last read, a failed or not-offered one
 * included. "Last synced" is a different question, the newest row that LANDED
 * (`latestBudgetSyncs`, server/repos/budgets.ts).
 *
 * `at` is a TIMESTAMP read back through UNIX_TIMESTAMP on the column, so the
 * session's zone can never shift it (the house's TIMESTAMP trap).
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/** The newest read of `source` as epoch milliseconds, or null when it was never read. */
export async function lastBudgetRead(db: Pool | PoolConnection, source: string): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT UNIX_TIMESTAMP(MAX(`at`)) AS `t` FROM `budget_syncs` WHERE `source` = ?", [source]);
  const t = rows[0]?.t;
  return t === null || t === undefined ? null : Math.round(Number(t) * 1000);
}
