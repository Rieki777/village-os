/**
 * `token_ledger`: a home being started, not a complete one.
 *
 * ── THIS IS NOT THE TABLE'S ONLY DOOR, AND SAYING SO IS THE POINT ────────
 *
 * The ledger's own write path stays in `server/lib/ledger.ts`: the INSERTs,
 * the balance recompute and every read the posting transaction makes after it
 * has locked the account rows, including `clawbackRefusal`'s and
 * `pairSiblingKey`'s. So does `checkLedgerInvariants`, whose seven reads are
 * read AS SOURCE by `scripts/generate-economics-doc.mjs` (it pairs each
 * `.query(` with the finding pushed after it) and cannot leave that function
 * without the generator refusing to render. `server/lib/economy.ts`,
 * `server/lib/circleTreasury.ts`, `server/lib/exchange.ts`,
 * `server/lib/eventSeats.ts` and a dozen more read the table too. None of
 * those moved here.
 *
 * What is here: single statements that were already standalone, moved
 * verbatim, one function each, handing back what the driver handed back.
 *
 * ── TWO FUNCTIONS TAKE A CONNECTION, AND WHY THAT MATTERS ────────────────
 *
 * `cycleIssuanceRows` and `circleSpendRows` take `Pool | PoolConnection`
 * because their callers did. `mintCapGuard` (server/lib/mintCap.ts) runs the
 * issuance read on the posting transaction's own connection, after `sys:mint`
 * is locked FOR UPDATE, so the figure is read under that lock; the caller
 * passes that same connection straight through and the read stays inside the
 * transaction. Neither statement takes a lock of its own. Every other function
 * here takes a pool, as the statement it replaced did.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Issued, returned, other-door issuance and the other doors' sources for one
 * token since a moment, in one row. The floor at zero and the sort of the
 * sources stay in `readCycleIssuance`, where a reader meets them.
 */
export async function cycleIssuanceRows(
  conn: Pool | PoolConnection,
  faucet: string,
  handSources: readonly string[],
  slug: string,
  since: Date,
): Promise<any[]> {
  const hand = handSources.map(() => "?").join(",");
  const [rows] = await conn.query<any[]>(
    "SELECT " +
      "COALESCE(SUM(CASE WHEN from_account = ? THEN amount ELSE 0 END), 0) AS issued, " +
      "COALESCE(SUM(CASE WHEN to_account = ? THEN amount ELSE 0 END), 0) AS came_back, " +
      `COALESCE(SUM(CASE WHEN from_account = ? AND source NOT IN (${hand}) THEN amount ELSE 0 END), 0) AS other_doors, ` +
      `GROUP_CONCAT(DISTINCT CASE WHEN from_account = ? AND source NOT IN (${hand}) THEN source END SEPARATOR ',') AS other_sources ` +
      "FROM token_ledger WHERE token_type = ? AND at >= ? AND (from_account = ? OR to_account = ?)",
    [
      faucet,
      faucet,
      faucet,
      ...handSources,
      faucet,
      ...handSources,
      slug,
      since,
      faucet,
      faucet,
    ],
  );
  return rows;
}

/**
 * What rows attributed to one circle issued out of a faucet and returned into
 * one, in a half-open window, in one row. The floor stays in `circleSpendIn`.
 */
export async function circleSpendRows(
  conn: Pool | PoolConnection,
  ref: string,
  tokenType: string,
  from: Date,
  to: Date,
): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN fa.faucet = 1 THEN t.amount ELSE 0 END), 0) AS issued,
       COALESCE(SUM(CASE WHEN ta.faucet = 1 THEN t.amount ELSE 0 END), 0) AS returned,
       COUNT(*) AS n
     FROM token_ledger t
     LEFT JOIN ledger_accounts fa ON fa.id = t.from_account
     LEFT JOIN ledger_accounts ta ON ta.id = t.to_account
     WHERE t.source_ref = ?
       AND t.token_type = ?
       AND t.at >= ?
       AND t.at < ?`,
    [ref, tokenType, from, to],
  );
  return rows;
}

/** The distinct tokens posted TO an account under one `source_ref`. */
export async function tokenTypesPostedTo(pool: Pool, sourceRef: string, toAccount: string): Promise<RowDataPacket[]> {
  const [back] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT token_type FROM token_ledger WHERE source_ref = ? AND to_account = ?",
    [sourceRef, toAccount],
  );
  return back;
}

/** At most one row when a posting with this idempotency key exists. */
export async function idempotencyKeyRows(pool: Pool, idempotencyKey: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM token_ledger WHERE idempotency_key = ? LIMIT 1",
    [idempotencyKey],
  );
  return rows;
}

/**
 * The stored keys that collate equal to either of two keys. The caller
 * compares byte for byte, because the index folds case and pads spaces.
 */
export async function keysCollatingWith(pool: Pool, first: string, second: string): Promise<RowDataPacket[]> {
  const [found] = await pool.query<RowDataPacket[]>(
    "SELECT idempotency_key FROM token_ledger WHERE idempotency_key IN (?, ?)",
    [first, second],
  );
  return found;
}

/** Every posting to or from one account, newest first. */
export async function accountEntryRows(pool: Pool, accountId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, from_account, to_account, token_type, amount, source, source_ref, description, at " +
      "FROM token_ledger WHERE to_account = ? OR from_account = ? ORDER BY at DESC, id DESC",
    [accountId, accountId],
  );
  return rows;
}

/** One account's quest-consent credits in one token, per `source_ref`. */
export async function questConsentCreditRows(pool: Pool, accountId: string, tokenType: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT source_ref, amount FROM token_ledger " +
      "WHERE to_account = ? AND source = 'quest_consent' AND token_type = ? AND source_ref IS NOT NULL",
    [accountId, tokenType],
  );
  return rows;
}

/*
 * Moved from server/lib/circleTreasury.ts, where each read was waived on the
 * grounds that no repo read these tables and that a repo would add a second
 * cache. Neither held once this file existed: it reads them with no cache,
 * so the waivers became moves. Statements are verbatim, and each runs on the
 * connection its caller passes.
 */
/** What moved between one account and a faucet in one token: funded, spent and returned. */
export async function treasuryFlowRows(conn: Pool | PoolConnection, account: string, faucet: string, tokenType: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN to_account = ? AND from_account = ? THEN amount ELSE 0 END), 0) AS funded,
       COALESCE(SUM(CASE WHEN from_account = ? AND to_account <> ? THEN amount ELSE 0 END), 0) AS spent,
       COALESCE(SUM(CASE WHEN from_account = ? AND to_account = ? THEN amount ELSE 0 END), 0) AS returned,
       COUNT(*) AS n
     FROM token_ledger
     WHERE token_type = ? AND (from_account = ? OR to_account = ?)`,
    [
      account, faucet,
      account, faucet,
      account, faucet,
      tokenType, account, account,
    ],
  );
  return rows;
}

/** Whether a ledger account row exists. */
export async function ledgerAccountRows(conn: Pool | PoolConnection, id: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM ledger_accounts WHERE id = ? LIMIT 1",
    [id],
  );
  return rows;
}

/** Funded and returned per source_ref since an instant, for refs matching `refPattern`. */
export async function circleFundingRows(conn: Pool | PoolConnection, faucet: string, tokenSlug: string, since: Date, refPattern: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT source_ref,
       COALESCE(SUM(CASE WHEN from_account = ? THEN amount ELSE 0 END), 0) AS funded,
       COALESCE(SUM(CASE WHEN to_account = ? THEN amount ELSE 0 END), 0) AS returned
     FROM token_ledger
     WHERE token_type = ? AND at >= ? AND source_ref LIKE ?
       AND (from_account = ? OR to_account = ?)
     GROUP BY source_ref`,
    [faucet, faucet, tokenSlug, since, refPattern, faucet, faucet],
  );
  return rows;
}
