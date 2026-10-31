/**
 * `cash_owed` (0285): every statement against the table, plus the one read of
 * the roles that pay cash.
 *
 * One function per statement, and each hands back what the driver handed
 * back: rows, or the result header whose `affectedRows` is the
 * compare-and-set. Every decision, the ids and the keys stay in
 * server/lib/cashOwed.ts, so this file imports nothing from server/lib.
 *
 * `insertCashOwedRow` takes a pool OR a connection, because the quest consent
 * records what it owes on the consent's own connection, inside the commit that
 * flips the claim (server/routes/questClaims.ts). Handed that connection, the
 * row exists exactly when the consent does.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface CashOwedInsert {
  id: string;
  occurrenceKey: string;
  userId: string;
  workKind: "quest" | "role" | "proposal";
  workRef: string;
  workTitle: string;
  amountMinor: number;
  currency: string;
}

/**
 * Write one owed row, or nothing when its occurrence is already recorded.
 * ON DUPLICATE KEY names only the duplicate, where INSERT IGNORE would also
 * swallow a truncation or a bad value and hide a real failure.
 */
export async function insertCashOwedRow(db: Pool | PoolConnection, r: CashOwedInsert): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `cash_owed` (`id`, `occurrence_key`, `user_id`, `work_kind`, `work_ref`, `work_title`, `amount_minor`, `currency`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`",
    [r.id, r.occurrenceKey, r.userId, r.workKind, r.workRef, r.workTitle, r.amountMinor, r.currency],
  );
  return res;
}

/**
 * The id that holds an occurrence, read on the same pool or connection the
 * insert ran on. `affectedRows` cannot say whether the insert above wrote:
 * mysql2 connects with FOUND_ROWS, so a duplicate under ON DUPLICATE KEY
 * reports 1, the same as a fresh row. The id that won is the answer.
 */
export async function cashOwedIdForOccurrence(db: Pool | PoolConnection, occurrenceKey: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id` FROM `cash_owed` WHERE `occurrence_key` = ?", [occurrenceKey]);
  return rows[0] ? String(rows[0].id) : null;
}

/** Everything one member is or was owed, newest first. */
export async function cashOwedRowsFor(pool: Pool, userId: string, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `cash_owed` WHERE `user_id` = ? ORDER BY `owed_at` DESC, `id` DESC LIMIT ?",
    [userId, limit],
  );
  return rows;
}

/** One row by id. At most one. */
export async function cashOwedRowById(pool: Pool, id: string): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `cash_owed` WHERE `id` = ?", [id]);
  return rows[0] ?? null;
}

/** The treasurer's list: everything not yet paid, oldest first. */
export async function unpaidCashRows(pool: Pool, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `cash_owed` WHERE `state` IN ('owed', 'claimed') ORDER BY `owed_at` ASC, `id` ASC LIMIT ?",
    [limit],
  );
  return rows;
}

/** The most recent payments, newest first, so the record is checkable after the fact. */
export async function recentlyPaidCashRows(pool: Pool, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `cash_owed` WHERE `state` = 'paid' ORDER BY `paid_at` DESC, `id` DESC LIMIT ?",
    [limit],
  );
  return rows;
}

/** A member claims their own owed row. Compare-and-set on the owner and the state. */
export async function claimCashOwedRow(pool: Pool, id: string, userId: string): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE `cash_owed` SET `state` = 'claimed', `claimed_at` = CURRENT_TIMESTAMP WHERE `id` = ? AND `user_id` = ? AND `state` = 'owed'",
    [id, userId],
  );
  return res;
}

/** A holder of `cash.pay` marks a row paid. Compare-and-set on the state, so a row is paid once. */
export async function markCashOwedPaidRow(pool: Pool, id: string, paidBy: string, note: string): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE `cash_owed` SET `state` = 'paid', `paid_at` = CURRENT_TIMESTAMP, `paid_by` = ?, `paid_note` = ? " +
      "WHERE `id` = ? AND `state` IN ('owed', 'claimed')",
    [paidBy, note, id],
  );
  return res;
}

/** Rows by id, in no particular order. Absent ids are simply absent. */
export async function cashOwedRowsByIds(pool: Pool, ids: readonly string[]): Promise<RowDataPacket[]> {
  if (ids.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `cash_owed` WHERE `id` IN (?)", [ids]);
  return rows;
}

/** Every row, unpaid first then paid, for the accounts' export. */
export async function allCashRows(pool: Pool, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `cash_owed` ORDER BY (`state` = 'paid') ASC, `owed_at` ASC, `id` ASC LIMIT ?",
    [limit],
  );
  return rows;
}

/**
 * Pay several of ONE member's rows in one transaction, all or none.
 *
 * The compare-and-set is the same as `markCashOwedPaidRow`: only a row still
 * owed or claimed, and only that member's, is touched. When fewer rows match
 * than were asked for (one was paid by somebody else a moment ago, or belongs
 * to another member), the whole transaction rolls back and the answer is 0, so
 * a transfer never records half of itself and no line is ever paid twice.
 * mysql2 connects with FOUND_ROWS, so `affectedRows` counts the rows the WHERE
 * matched, which is exactly the count this needs.
 */
export async function payCashRowsTogether(
  pool: Pool,
  ids: readonly string[],
  userId: string,
  paidBy: string,
  note: string,
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      "UPDATE `cash_owed` SET `state` = 'paid', `paid_at` = CURRENT_TIMESTAMP, `paid_by` = ?, `paid_note` = ? " +
        "WHERE `id` IN (?) AND `user_id` = ? AND `state` IN ('owed', 'claimed')",
      [paidBy, note, ids, userId],
    );
    if (res.affectedRows !== ids.length) {
      await conn.rollback();
      return 0;
    }
    await conn.commit();
    return res.affectedRows;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Every live seat on a role that pays cash, with the role's cash and name.
 *
 * The same four conditions the token seat query in `runSettlement`
 * (server/lib/economy.ts) asks, so the seats owed cash are exactly the seats
 * paid tokens: a live seating, held by a member account, not an example. An
 * agent seat is `holder_kind = 'documented'` with no `user_id`, so it is never
 * owed cash, for the reason that query gives.
 */
export async function seatsOnCashRoles(pool: Pool): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.`id` AS `seat_id`, a.`user_id`, r.`id` AS `role_id`, r.`name` AS `role_name`, r.`cash_minor`, r.`cash_currency` " +
      "FROM `org_role_assignments` a JOIN `org_roles` r ON r.`id` = a.`org_role_id` " +
      "WHERE a.`active_holder_key` IS NOT NULL AND a.`holder_kind` = 'member' " +
      "AND a.`user_id` IS NOT NULL AND a.`is_example` = 0 " +
      "AND r.`cash_minor` > 0 AND r.`cash_currency` IS NOT NULL",
  );
  return rows;
}

/** How many of one member's rows are still unpaid: owed, or claimed and waiting. */
export async function unpaidCashCountFor(pool: Pool, userId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS `n` FROM `cash_owed` WHERE `user_id` = ? AND `state` IN ('owed', 'claimed')",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}
