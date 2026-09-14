/**
 * `token_ledger`, read for one question: has the village ever paid this account
 * for something the person brought it.
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
 * ── AND WHY THE MOVEMENT HAPPENED IS PART OF THE QUESTION ───────────────────
 *
 * Who paid and in which token is not enough. A guest who buys stay credits with
 * a card receives a village token from a village account, and has not brought
 * the village anything. The caller passes the `source` values that count, from
 * server/lib/contributionPay.ts, which is where that decision is made and where
 * a new source has to be decided on. The from side still matters beside it: a
 * gift from a neighbour is not the village paying, whatever it is labelled.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** `prefix%` for LIKE, with LIKE's own wildcards in the prefix taken literally. */
const startsWith = (prefix: string): string => `${prefix.replace(/[\\%_]/g, "\\$&")}%`;

const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(",");

/**
 * Whether `accountId` has ever received a positive amount of one of
 * `tokenSlugs`, for one of `sources`, from an account whose id does not start
 * with `memberPrefix`.
 *
 * An empty slug or source list answers false without asking, because `IN ()` is
 * a syntax error, and a village that counts nothing has paid nobody.
 */
export async function receivedFromVillage(
  pool: Pool,
  accountId: string,
  tokenSlugs: readonly string[],
  sources: readonly string[],
  memberPrefix: string,
): Promise<boolean> {
  if (tokenSlugs.length === 0 || sources.length === 0) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM token_ledger WHERE to_account = ? AND amount > 0 " +
      `AND token_type IN (${placeholders(tokenSlugs)}) ` +
      `AND source IN (${placeholders(sources)}) ` +
      "AND from_account NOT LIKE ? LIMIT 1",
    [accountId, ...tokenSlugs, ...sources, startsWith(memberPrefix)],
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
  sources: readonly string[],
  memberPrefix: string,
): Promise<Set<string>> {
  const paid = new Set<string>();
  if (accountIds.length === 0 || tokenSlugs.length === 0 || sources.length === 0) return paid;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT to_account FROM token_ledger " +
      `WHERE to_account IN (${placeholders(accountIds)}) AND amount > 0 ` +
      `AND token_type IN (${placeholders(tokenSlugs)}) ` +
      `AND source IN (${placeholders(sources)}) ` +
      "AND from_account NOT LIKE ?",
    [...accountIds, ...tokenSlugs, ...sources, startsWith(memberPrefix)],
  );
  for (const r of rows) paid.add(String(r.to_account));
  return paid;
}
