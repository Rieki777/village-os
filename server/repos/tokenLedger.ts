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

/*
 * Moved from server/lib/economy.ts and server/lib/ledger.ts because the module
 * intake check flagged them as raw SQL on lines this branch changed. Each is a
 * plain read with no lock of its own and runs on the connection its caller
 * passes, so a read inside the ledger's transaction stays inside it.
 * Statements are verbatim.
 */
/** Both legs of an atomic pair, by their two keys. The caller matches byte-exactly. */
export async function legRowsForKeys(conn: Pool | PoolConnection, first: string, second: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` IN (?, ?)",
    [first, second],
  );
  return rows;
}

/** The faucet accounts, as the ledger_accounts rows mark them. */
export async function faucetAccountRows(conn: Pool | PoolConnection): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `id` FROM `ledger_accounts` WHERE `faucet` = 1 ORDER BY `id`",
  );
  return rows;
}

/** Issued per token and source, from the given faucet accounts. `faucets` must be non-empty. */
export async function issuedBySourceRows(conn: Pool | PoolConnection, faucets: string[]): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `token_type` AS token, `source`, SUM(`amount`) AS issued FROM `token_ledger` " +
      `WHERE \`from_account\` IN (${faucets.map(() => "?").join(",")}) ` +
      "GROUP BY `token_type`, `source` ORDER BY `token_type`, `source`",
    faucets,
  );
  return rows;
}

/** A key under one source, for a pair's sibling leg. The caller matches byte-exactly. */
export async function keyRowsWithSource(conn: Pool | PoolConnection, key: string, source: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key` FROM `token_ledger` WHERE `idempotency_key` = ? AND `source` = ? LIMIT 1",
    [key, source],
  );
  return rows;
}

/** The posting a key names. The caller matches byte-exactly. */
export async function postingRowForKey(conn: Pool | PoolConnection, key: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` = ? LIMIT 1",
    [key],
  );
  return rows;
}

/** Reversal mirrors that move exactly this amount between these accounts in this token. */
export async function reversalMirrorRows(
  conn: Pool | PoolConnection,
  toAccount: string,
  tokenType: string,
  fromAccount: string,
  amount: number,
): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `idempotency_key` FROM `token_ledger` " +
      "WHERE `to_account` = ? AND `token_type` = ? AND `from_account` = ? AND `amount` = ? " +
      "AND CAST(`source` AS BINARY) = 'reversal'",
    [toAccount, tokenType, fromAccount, amount],
  );
  return rows;
}

/**
 * What one account held of one token going into an instant, read off the rows
 * posted BEFORE it: credits minus debits, as one row with a `held` column.
 *
 * `decayVoice` (server/lib/economy.ts) reads this at the moon's opening, so a
 * waning acts on what a member carried into the moon and never on whatever a
 * payout during the moon made of their balance. Its caller holds the reasons.
 *
 * `UNIX_TIMESTAMP(at) < ?` and never `at < ?` with a Date: a `timestamp`
 * column is compared in the SESSION zone, and a pool without `SET time_zone`
 * shifts that comparison by the database host's offset. Epoch seconds are the
 * same number in every zone. The two account indexes (`token_ledger_to_idx`,
 * `token_ledger_from_idx`) narrow each sum to one account's rows first.
 */
export async function heldBeforeRows(
  conn: Pool | PoolConnection,
  accountId: string,
  tokenType: string,
  beforeEpochSeconds: number,
): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT " +
      "COALESCE((SELECT SUM(`amount`) FROM `token_ledger` " +
      "WHERE `to_account` = ? AND `token_type` = ? AND UNIX_TIMESTAMP(`at`) < ?), 0) - " +
      "COALESCE((SELECT SUM(`amount`) FROM `token_ledger` " +
      "WHERE `from_account` = ? AND `token_type` = ? AND UNIX_TIMESTAMP(`at`) < ?), 0) AS held",
    [accountId, tokenType, beforeEpochSeconds, accountId, tokenType, beforeEpochSeconds],
  );
  return rows;
}

/** Whether a key already exists, for the collation clash check. */
export async function keyClashRows(conn: Pool | PoolConnection, key: string): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT idempotency_key FROM token_ledger WHERE idempotency_key = ? LIMIT 1",
    [key],
  );
  return rows;
}
