/**
 * `redemptions`: every statement against the table, moved verbatim out of
 * `server/lib/redemptionStore.ts`, plus the one read `server/lib/holdings.ts`
 * makes of it.
 *
 * ── WHAT MOVED, AND WHAT DELIBERATELY DID NOT ────────────────────────────
 *
 * One function per statement, and each hands back what the driver handed
 * back: rows, or the result header for an UPDATE whose `affectedRows` is the
 * compare-and-set. The row mapping, the clamps on a limit, the id, both
 * ledger keys and every decision stay in the lib. `villageId()` is read there
 * and passed in, so this file imports nothing from server/lib.
 *
 * ── ONE STATEMENT HERE RUNS INSIDE SOMEBODY ELSE'S TRANSACTION ───────────
 *
 * `insertRedemptionRow` takes a `PoolConnection` and never a pool, because
 * `requestRedemption` runs it on the connection that holds the member's
 * `users` row and their `token_balances` row locked FOR UPDATE under
 * SERIALIZABLE, and commits it with them. Given a pool it would write outside
 * that transaction, which is the race the locks exist to close. Everything
 * else here is a single statement the lib ran on the pool, outside any
 * transaction, and still runs that way.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ───────────────────────────────────────
 *
 * `holdReconciliation` compares these rows against the hold account's
 * balance, and that comparison is only worth anything when both halves are
 * read at the moment it is asked.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** One redemption by id, scoped to the village. At most one row. */
export async function redemptionRowsById(pool: Pool, id: string, villageId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `redemptions` WHERE `id` = ? AND `village_id` = ?",
    [id, villageId],
  );
  return rows;
}

/** One member's open redemptions, oldest first. */
export async function openRedemptionRows(pool: Pool, villageId: string, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'requested' " +
      "ORDER BY `created_at`",
    [villageId, userId],
  );
  return rows;
}

/** MINOR units held against one member's open redemptions, one row per token. */
export async function heldRowsByToken(pool: Pool, villageId: string, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `token_slug`, COALESCE(SUM(`amount`),0) AS held FROM `redemptions` " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'requested' AND `held_account` IS NOT NULL " +
      "GROUP BY `token_slug`",
    [villageId, userId],
  );
  return rows;
}

/**
 * A count of what one member has opened since a moment. One row.
 *
 * Takes a connection as well as a pool: `requestRedemption` runs it a second
 * time on the connection holding the member's `users` row FOR UPDATE, so the
 * per-cycle cap is decided inside the lock that serialises that member's opens.
 */
export async function openedSinceRows(
  pool: Pool | PoolConnection,
  villageId: string,
  userId: string,
  since: Date,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? AND `created_at` >= ?",
    [villageId, userId, since],
  );
  return rows;
}

/** One member's redemptions, newest first. The caller clamps `limit`. */
export async function historyRows(
  pool: Pool,
  villageId: string,
  userId: string,
  limit: number,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? ORDER BY `created_at` DESC LIMIT ?",
    [villageId, userId, limit],
  );
  return rows;
}

/** Every open redemption in the village, oldest first. The caller clamps `limit`. */
export async function queueRows(pool: Pool, villageId: string, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `redemptions` WHERE `village_id` = ? AND `state` = 'requested' ORDER BY `created_at` LIMIT ?",
    [villageId, limit],
  );
  return rows;
}

/**
 * Write a new `requested` row ON THE CALLER'S CONNECTION, inside the
 * transaction that holds the member's row and balance locked. See the header.
 */
export async function insertRedemptionRow(
  conn: PoolConnection,
  row: {
    id: string;
    villageId: string;
    userId: string;
    tokenSlug: string;
    amountUnits: number;
    askedFor: string;
    confirmedByMode: string;
    heldAccount: string | null;
    holdKey: string | null;
    burnKey: string;
    expiresAt: Date | null;
    /** 0213, ruling 23: what this was worth when it was asked for. NULL where
     *  the village values nothing (no rate, or no currency arithmetic). */
    currency: string | null;
    rateMinor: number | null;
    rateSource: string | null;
    feePct: number | null;
    feeFixedMinor: number | null;
    grossMinor: number | null;
    feeMinor: number | null;
    netMinor: number | null;
    processText: string | null;
  },
): Promise<void> {
  await conn.query(
    "INSERT INTO `redemptions` (`id`, `village_id`, `user_id`, `token_slug`, `amount`, `asked_for`, " +
      "`state`, `confirmed_by_mode`, `held_account`, `hold_key`, `burn_key`, `expires_at`, " +
      "`currency`, `rate_minor`, `rate_source`, `fee_pct`, `fee_fixed_minor`, " +
      "`gross_minor`, `fee_minor`, `net_minor`, `process_text`) " +
      "VALUES (?,?,?,?,?,?,'requested',?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      row.id,
      row.villageId,
      row.userId,
      row.tokenSlug,
      row.amountUnits,
      row.askedFor,
      row.confirmedByMode,
      row.heldAccount,
      row.holdKey,
      row.burnKey,
      row.expiresAt,
      row.currency,
      row.rateMinor,
      row.rateSource,
      row.feePct,
      row.feeFixedMinor,
      row.grossMinor,
      row.feeMinor,
      row.netMinor,
      row.processText,
    ],
  );
}

/**
 * What ONE member has already asked for in money since a moment, in the minor
 * units of each request's own currency. One row per currency.
 *
 * `requested` and `confirmed` only. A refusal, a withdrawal and an expiry each
 * gave the tokens back and cost the village nothing, so counting them would
 * spend a member's allowance on requests the village never paid.
 */
export async function moneyAskedSinceRows(
  conn: Pool | PoolConnection,
  villageId: string,
  userId: string,
  since: Date,
): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `currency`, COALESCE(SUM(`gross_minor`), 0) AS total FROM `redemptions` " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `state` IN ('requested','confirmed') " +
      "AND `created_at` >= ? AND `gross_minor` IS NOT NULL GROUP BY `currency`",
    [villageId, userId, since],
  );
  return rows;
}

/**
 * What the WHOLE VILLAGE has asked for in money since a moment, LOCKED.
 *
 * ── WHY THIS ONE TAKES A CONNECTION AND LOCKS ────────────────────────────
 *
 * The per-member caps are serialised by the `users` row `requestRedemption`
 * already locks: every ask by one member queues behind the one before it. The
 * village-wide cap has no such row. Two members asking in the same instant
 * would each read a total that did not include the other, each pass a cap with
 * room for one, and the village would owe more than it said it would pay.
 *
 * `FOR UPDATE` over the cycle's range is the serialisation point, and it is the
 * shape `createExchangeOrder` already uses to claim a receipt number: the range
 * lock makes the second ask wait for the first to commit, so it reads a total
 * that includes it. It MUST run on the caller's connection, inside the
 * transaction that writes the row, or it locks nothing that outlives the read.
 */
export async function villageMoneyAskedSinceRowsForUpdate(
  conn: PoolConnection,
  villageId: string,
  since: Date,
): Promise<RowDataPacket[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT `currency`, `gross_minor` FROM `redemptions` " +
      "WHERE `village_id` = ? AND `state` IN ('requested','confirmed') " +
      "AND `created_at` >= ? AND `gross_minor` IS NOT NULL FOR UPDATE",
    [villageId, since],
  );
  return rows;
}

/** Mark a still-requested row refused because its hold never posted. */
export async function markHoldRefused(pool: Pool, note: string, id: string): Promise<void> {
  await pool.query(
    "UPDATE `redemptions` SET `state` = 'refused', `decided_at` = CURRENT_TIMESTAMP, " +
      "`decision_note` = ? WHERE `id` = ? AND `state` = 'requested'",
    [note, id],
  );
}

/**
 * THE COMPARE-AND-SET. Moves a row from `fromState` to `to` and hands back the
 * header, so the caller posts only when `affectedRows` is exactly one.
 */
export async function claimRedemptionState(
  pool: Pool,
  claim: { to: string; decidedBy: string | null; note: string; id: string; villageId: string; fromState: string },
): Promise<ResultSetHeader> {
  const [upd] = await pool.query<ResultSetHeader>(
    "UPDATE `redemptions` SET `state` = ?, `decided_by` = ?, `decided_at` = CURRENT_TIMESTAMP, " +
      "`decision_note` = ? WHERE `id` = ? AND `village_id` = ? AND `state` = ?",
    [claim.to, claim.decidedBy, claim.note, claim.id, claim.villageId, claim.fromState],
  );
  return upd;
}

/** Put a confirmed row back to requested, clearing the decision. */
export async function unclaimConfirmation(pool: Pool, id: string, villageId: string): Promise<void> {
  await pool.query(
    "UPDATE `redemptions` SET `state` = 'requested', `decided_by` = NULL, `decided_at` = NULL, " +
      "`decision_note` = NULL WHERE `id` = ? AND `village_id` = ? AND `state` = 'confirmed'",
    [id, villageId],
  );
}

/** Ids of requested rows whose `expires_at` has passed, oldest first, at most 200. */
export async function expiredIdRows(pool: Pool, villageId: string, now: Date): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `redemptions` WHERE `village_id` = ? AND `state` = 'requested' " +
      "AND `expires_at` IS NOT NULL AND `expires_at` <= ? ORDER BY `created_at` LIMIT 200",
    [villageId, now],
  );
  return rows;
}

/** What the open, held rows say the hold account owes, per token. */
export async function owedRowsByToken(pool: Pool, villageId: string): Promise<RowDataPacket[]> {
  const [owed] = await pool.query<RowDataPacket[]>(
    "SELECT `token_slug`, COUNT(*) AS n, COALESCE(SUM(`amount`),0) AS total FROM `redemptions` " +
      "WHERE `village_id` = ? AND `state` = 'requested' AND `held_account` IS NOT NULL GROUP BY `token_slug`",
    [villageId],
  );
  return owed;
}

/** A count of one member's open redemptions. One row. */
export async function openCountRows(pool: Pool, villageId: string, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? AND `state` = 'requested'",
    [villageId, userId],
  );
  return rows;
}

/**
 * A count of every open redemption in the village, held or not. One row. The
 * module's `openStateCheck` reads it: `requested` is the one state that has
 * not ended (`canSettleRedemption` in server/lib/redemption.ts).
 */
export async function openCountAllRows(pool: Pool, villageId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `redemptions` WHERE `village_id` = ? AND `state` = 'requested'",
    [villageId],
  );
  return rows;
}

/**
 * One member's open, held redemptions as locks, oldest first. The read
 * `redemptionLocksFor` in server/lib/holdings.ts makes; `held_account IS NOT
 * NULL` is the same test `heldRowsByToken` applies.
 */
export async function heldLockRows(pool: Pool, villageId: string, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `token_slug`, `amount` FROM `redemptions` WHERE `village_id` = ? AND `user_id` = ? " +
      "AND `state` = 'requested' AND `held_account` IS NOT NULL ORDER BY `created_at`",
    [villageId, userId],
  );
  return rows;
}
