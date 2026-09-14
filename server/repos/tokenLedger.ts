/**
 * `token_ledger`, read for one question: has the village ever paid this account.
 *
 * ── A HOME BEING STARTED, THE SAME WAY `tokenBalances.ts` IS ────────────────
 *
 * The burn-down register's reason for a repo module is that a table's readers
 * stay ENUMERABLE. For `token_ledger` that is not yet true and this file does
 * not pretend otherwise: server/lib/ledger.ts still reads and writes it in many
 * places, and most of those have to stay. Every write runs inside the
 * transaction `postTransfer` opens, on the connection that holds the account
 * locks, and a statement whose correctness depends on the CALLER's connection
 * cannot become a function that takes a pool. `tokenBalances.ts` says the same
 * about `balanceOf` and `recomputeBalance`.
 *
 * What lives here are two READS that run outside any transaction and decide a
 * standing, the Contributor rung, rather than whether a movement may proceed.
 * They were added to ledger.ts first and moved here before landing, so the
 * register did not grow for them.
 *
 * ── THE ACCOUNT SCHEME IS THE CALLER'S TO SAY ───────────────────────────────
 *
 * Both queries tell a member's account from the village's by its prefix. The
 * prefix arrives as an argument instead of being typed here, because
 * `memberAccount` in server/lib/ledger.ts is where accounts are named, and a
 * second spelling of it in this file would be a second home for one fact with
 * nothing forcing the two to agree.
 *
 * ── WHY THE FROM SIDE, AND WHY NOT RECOGNITION ──────────────────────────────
 *
 * Written once, on `hasBeenPaidByVillage` in server/lib/ledger.ts, which is the
 * function everything calls. In short: a peer gift does not count, or one
 * member could buy in and manufacture Contributors; and the caller passes the
 * token slugs, from which recognition is already excluded.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** `prefix%` for LIKE, with LIKE's own wildcards in the prefix taken literally. */
const startsWith = (prefix: string): string => `${prefix.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Whether `accountId` has ever received a positive amount of one of
 * `tokenSlugs` from an account whose id does not start with `memberPrefix`.
 *
 * An empty slug list answers false without asking, because `IN ()` is a syntax
 * error and a village paying in no tokens has paid nobody.
 */
export async function receivedFromVillage(
  pool: Pool,
  accountId: string,
  tokenSlugs: readonly string[],
  memberPrefix: string,
): Promise<boolean> {
  if (tokenSlugs.length === 0) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM token_ledger WHERE to_account = ? AND amount > 0 " +
      `AND token_type IN (${tokenSlugs.map(() => "?").join(",")}) ` +
      "AND from_account NOT LIKE ? LIMIT 1",
    [accountId, ...tokenSlugs, startsWith(memberPrefix)],
  );
  return rows.length > 0;
}

/**
 * The same question for many accounts in one query. Returns the ACCOUNT ids
 * that have been paid; mapping back to members is the caller's, for the same
 * reason the prefix is.
 */
export async function accountsReceivedFromVillage(
  pool: Pool,
  accountIds: readonly string[],
  tokenSlugs: readonly string[],
  memberPrefix: string,
): Promise<Set<string>> {
  const paid = new Set<string>();
  if (accountIds.length === 0 || tokenSlugs.length === 0) return paid;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT to_account FROM token_ledger " +
      `WHERE to_account IN (${accountIds.map(() => "?").join(",")}) AND amount > 0 ` +
      `AND token_type IN (${tokenSlugs.map(() => "?").join(",")}) ` +
      "AND from_account NOT LIKE ?",
    [...accountIds, ...tokenSlugs, startsWith(memberPrefix)],
  );
  for (const r of rows) paid.add(String(r.to_account));
  return paid;
}
