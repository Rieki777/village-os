/**
 * `token_balances`: the cached balance of one account in one token.
 *
 * ── THIS IS A HOME BEING STARTED, NOT A COMPLETE ONE, AND SAYING SO IS THE
 *    POINT ──────────────────────────────────────────────────────────────────
 *
 * The burn-down register's own note gives the reason a repo module exists:
 * "move the query into a repo under server/repos, so the caches above it stay
 * correct and a table's readers stay ENUMERABLE". For this table that is not
 * yet true and this file does not pretend otherwise. On 2026-09-10
 * `token_balances` was read from two other repo modules
 * (`governanceWeightRows.ts`, `investorPath.ts`) and from ten files under
 * server/lib/, including economy, exchange, health, messaging, profile and
 * stays. Consolidating all of that is a real change with real risk and it is
 * not this one.
 *
 * What this file is: the first statement to move, and a named place for the
 * next one. A reader who lands here should know the list above is where the
 * others are, rather than believing they have found the table's only door.
 *
 * ── WHAT DOES NOT BELONG HERE ────────────────────────────────────────────────
 *
 * `balanceOf` in server/lib/ledger.ts takes `Pool | PoolConnection` on purpose:
 * it is read INSIDE the transaction that `postTransfer` opens, after the
 * account rows are locked, and moving it to a pool-taking function would run it
 * on a different connection and read a world the transaction cannot see. It
 * stays where it is, and it stays polymorphic.
 *
 * `recomputeBalance` writes this table from inside that same lock. Also stays.
 *
 * The rule those two share: a statement whose correctness depends on running on
 * the CALLER's connection cannot become a function that takes a pool, however
 * much tidier the count would look.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Every token balance held by one account, as slug to cached balance.
 *
 * Read on a pool rather than a connection because its one caller
 * (`balancesFor` in server/lib/ledger.ts) is a display read outside any
 * transaction: it answers "what does this account hold" for a page, not for a
 * decision about whether a movement may proceed. A decision reads through
 * `balanceOf` inside the lock instead.
 */
export async function balanceRowsFor(pool: Pool, accountId: string): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT token_type, balance FROM token_balances WHERE account_id = ?",
    [accountId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.token_type)] = Number(r.balance);
  return out;
}

/**
 * One account's balance row in one token, locked FOR UPDATE ON THE CALLER'S
 * CONNECTION.
 *
 * This is the rule in the header kept, not bent: the statement depends on the
 * caller's connection, so the function takes that connection and nothing
 * else. Its caller is `requestRedemption` (server/lib/redemptionStore.ts),
 * which re-reads the balance inside the SERIALIZABLE transaction it opened
 * and commits the redemption row under this lock.
 */
export async function lockedBalanceRows(
  conn: PoolConnection,
  accountId: string,
  tokenType: string,
): Promise<RowDataPacket[]> {
  const [bal] = await conn.query<RowDataPacket[]>(
    "SELECT `balance` FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ? FOR UPDATE",
    [accountId, tokenType],
  );
  return bal;
}

/**
 * Every token balance one SYSTEM account holds, as the driver returned the
 * rows. A display and reconciliation read on the pool, outside any
 * transaction. Callers: `holdReconciliation` and `retiredSupply` in
 * server/lib/redemptionStore.ts, for `sys:redemption-hold` and `sys:redeemed`.
 */
export async function accountBalanceRows(pool: Pool, accountId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `token_type`, `balance` FROM `token_balances` WHERE `account_id` = ?",
    [accountId],
  );
  return rows;
}

/**
 * The same read with the token column named `slug`, which is the shape
 * `publicSupply` in server/lib/economy.ts reads the waning sink in.
 */
export async function accountBalanceRowsBySlug(pool: Pool, accountId: string): Promise<RowDataPacket[]> {
  const [waned] = await pool.query<RowDataPacket[]>(
    "SELECT `token_type` AS slug, `balance` FROM `token_balances` WHERE `account_id` = ?",
    [accountId],
  );
  return waned;
}
