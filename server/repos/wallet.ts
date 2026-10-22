/**
 * The two reads the member wallet makes that no other module already makes.
 *
 * Everything else the wallet shows comes through a function that already
 * exists and is already tested: balances and locks through `holdingsFor`
 * (server/lib/holdings.ts), claim readiness through `claimReadinessFor`
 * (server/lib/voiceClaim.ts), posted prices through `latestPrice`
 * (server/lib/exchange.ts), the giving allowance through `allowanceFor`. These
 * two are new, so they live here, where a table's readers stay enumerable.
 *
 * BOTH ARE SCOPED TO ONE MEMBER BY THE CALLER'S OWN ID. Neither takes a handle,
 * a slug from the request or anything a stranger could steer, because a wallet
 * is the one surface whose whole content is somebody's private holdings.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One cached on-chain balance, exactly as `readOnchainBalance` last wrote it. */
export interface CachedChainBalance {
  tokenSlug: string;
  /** Raw uint256 as a decimal string. Formatted at the edge, never parsed to a float. */
  raw: string;
  decimals: number;
  fetchedAt: string;
}

/**
 * What Base last said this member holds of each mirror, from the cache only.
 *
 * NO CHAIN READ HAPPENS HERE, on purpose. `readOnchainBalance` is the one
 * guarded dialer and it already runs when the on-chain card loads; a second
 * reader that dialled too would double the paid RPC traffic of every profile
 * view. A row here is a true thing Base said at `fetchedAt`, and a missing row
 * is "never read", which the wallet says in words and never as a zero.
 */
export async function cachedChainBalances(pool: Pool, userId: string): Promise<CachedChainBalance[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `token_slug`, `raw_balance`, `decimals`, `fetched_at` FROM `onchain_balances` WHERE `user_id` = ?",
    [userId],
  );
  return rows.map((r) => ({
    tokenSlug: String(r.token_slug),
    // decimal(65,0) arrives from mysql2 as a string, which is the point.
    raw: String(r.raw_balance),
    decimals: Number(r.decimals ?? 0),
    fetchedAt: new Date(r.fetched_at).toISOString(),
  }));
}

/**
 * How much of each token this member has carried across to Hypha, by confirmed
 * claim, in the HUMAN number `voice_claims.amount` stores.
 *
 * Confirmed only. A claim still waiting on a vote is the member's balance held
 * at a bridge, and a refunded one never left at all.
 */
export async function confirmedClaimTotals(
  pool: Pool,
  villageId: string,
  userId: string,
): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `token_slug`, COALESCE(SUM(`amount`), 0) AS total FROM `voice_claims` " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'confirmed' GROUP BY `token_slug`",
    [villageId, userId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.token_slug)] = Number(r.total ?? 0);
  return out;
}
