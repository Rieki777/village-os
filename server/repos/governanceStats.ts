/**
 * Village-wide ballots as counts, for the governance page's spread band
 * (server/routes/voiceSpread.ts). Reads `ballots` and `ballot_votes`, whose one
 * enumerable home is server/lib/ballots.ts; this is a read and never writes.
 *
 * One row per ballot, with how many distinct members voted on it. No title,
 * no subject, no voter: the band reports counts and nothing that names a vote.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface BallotCountRow extends RowDataPacket {
  status: string;
  landing_status: string | null;
  vetoed_at: Date | string | null;
  electorate_count: number;
  voters: number;
}

/**
 * Each account's balance of one token, from the `token_balances` cache; an
 * account with no row is absent from the map. For the spread band only: a
 * ballot's weights come from `weightsFor` (server/lib/governanceWeights.ts),
 * which also refuses a token money can buy. A picture of who holds what has no
 * such refusal to make, and must not fail where a village has no Voice yet.
 */
export async function balancesOf(pool: Pool, tokenType: string, accounts: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (accounts.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT account_id, balance FROM token_balances WHERE token_type = ? AND account_id IN (${accounts.map(() => "?").join(",")})`,
    [tokenType, ...accounts],
  );
  for (const r of rows) out.set(String(r.account_id), Number(r.balance));
  return out;
}

/**
 * Ballots opened at or after `since` (a UTC datetime string), or all of them
 * when `since` is null. Every ballot is village-wide (0095 dropped the circle
 * scope). Withdrawn ones are left out: a vote called off before it ran is not
 * a vote the village held.
 */
export async function villageBallotsSince(pool: Pool, since: string | null): Promise<BallotCountRow[]> {
  const [rows] = await pool.query<BallotCountRow[]>(
    "SELECT b.status, b.landing_status, b.vetoed_at, b.electorate_count, " +
      "(SELECT COUNT(DISTINCT v.user_id) FROM ballot_votes v WHERE v.ballot_id = b.id) AS voters " +
      "FROM ballots b WHERE b.status <> 'withdrawn'" +
      (since ? " AND b.opens_at >= ?" : ""),
    since ? [since] : [],
  );
  return rows;
}
