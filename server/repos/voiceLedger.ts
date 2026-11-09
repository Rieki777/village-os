/**
 * THE LEDGER READS BEHIND A WORK-ONLY VOICE COUNT (`workEarnedVoice`,
 * server/lib/voiceProvenance.ts). Reads only; nothing here writes.
 *
 * The token and its faucet are passed in, so these four reads say nothing
 * about which token is Voice: the caller owns that.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Each account's cached balance of `token`. An account with no row is absent. */
export async function balancesOf(pool: Pool, token: string, accounts: readonly string[]): Promise<Map<string, number>> {
  if (accounts.length === 0) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT account_id, balance FROM token_balances WHERE token_type = ? AND account_id IN (${marks(accounts.length)})`,
    [token, ...accounts],
  );
  return new Map(rows.map((r) => [String(r.account_id), Number(r.balance)]));
}

/** Everything `faucet` ever posted of `token` to each account, summed by source. */
export async function mintedBySource(
  pool: Pool,
  token: string,
  faucet: string,
  accounts: readonly string[],
): Promise<Array<{ account: string; source: string; total: number }>> {
  if (accounts.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT to_account, source, SUM(amount) AS total FROM token_ledger ` +
      `WHERE token_type = ? AND from_account = ? AND to_account IN (${marks(accounts.length)}) GROUP BY to_account, source`,
    [token, faucet, ...accounts],
  );
  return rows.map((r) => ({ account: String(r.to_account), source: String(r.source), total: Number(r.total) }));
}

/** Every clawback mirror of `token` from each account back to `faucet`, with its key. */
export async function clawbacksToFaucet(
  pool: Pool,
  token: string,
  faucet: string,
  accounts: readonly string[],
): Promise<Array<{ account: string; amount: number; key: string }>> {
  if (accounts.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT from_account, amount, idempotency_key FROM token_ledger ` +
      `WHERE token_type = ? AND to_account = ? AND source = 'reversal' AND from_account IN (${marks(accounts.length)})`,
    [token, faucet, ...accounts],
  );
  return rows.map((r) => ({ account: String(r.from_account), amount: Number(r.amount), key: String(r.idempotency_key) }));
}

/**
 * The source of each posting of `token` named by its key. BYTE-EXACT, as
 * `postingRowForKey` in ledger.ts is: the unique index answers
 * case-insensitively, so a near-miss key is dropped here.
 */
export async function sourcesOfKeys(pool: Pool, token: string, keys: readonly string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT idempotency_key, source FROM token_ledger WHERE token_type = ? AND idempotency_key IN (${marks(keys.length)})`,
    [token, ...keys],
  );
  const wanted = new Set(keys);
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = String(r.idempotency_key);
    if (wanted.has(key)) out.set(key, String(r.source));
  }
  return out;
}
