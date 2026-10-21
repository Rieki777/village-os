/**
 * `member_code_names` (0261): every statement that touches the map from a
 * code-name to a person.
 *
 * ── WHY ENUMERABLE MATTERS HERE ──────────────────────────────────────────
 *
 * This is the one table that can turn a code-name an outside service holds
 * back into a member of this village. "Who can read the map" has to be a
 * question somebody answers by opening one file, so every reader and writer
 * is below and none is anywhere else. The decisions (when one is minted,
 * what shape it has, when an entry may be dropped) stay in
 * server/lib/codeNames.ts beside the rulings they keep.
 *
 * ── A DROPPED ROW STAYS ──────────────────────────────────────────────────
 *
 * Dropping blanks `user_id` and stamps `dropped_at`; it never deletes. The
 * code-name stays reserved, so it is never minted again for somebody else
 * while the service may still hold records under it. Every read that answers
 * "who is this" filters on `dropped_at IS NULL`.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ───────────────────────────────────────
 *
 * Every read goes to the database when asked. A dropped entry has to stop
 * resolving at once, and a cached answer is the one an erasure cannot afford.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Queryable = Pool | PoolConnection;

/** The live code-name this member holds for one purpose, or null. */
export async function codeNameForUser(db: Queryable, userId: string, purpose: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `code_name` FROM `member_code_names` WHERE `user_id` = ? AND `purpose` = ? AND `dropped_at` IS NULL LIMIT 1",
    [userId, purpose],
  );
  const c = rows[0]?.code_name;
  return typeof c === "string" ? c : null;
}

/** The live code-names several members hold for one purpose, in one round trip. */
export async function codeNamesForUsers(
  db: Queryable,
  userIds: readonly string[],
  purpose: string,
): Promise<Array<{ userId: string; codeName: string }>> {
  if (userIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `user_id`, `code_name` FROM `member_code_names` " +
      `WHERE \`purpose\` = ? AND \`dropped_at\` IS NULL AND \`user_id\` IN (${userIds.map(() => "?").join(",")})`,
    [purpose, ...userIds],
  );
  return rows.map((r) => ({ userId: String(r.user_id), codeName: String(r.code_name) }));
}

/**
 * Issue a code-name, losing quietly to either unique key. The primary key on
 * `code_name` makes a collision with somebody else's a no-op, and the unique
 * key on (`user_id`, `purpose`) makes a race for the same member one. The
 * caller re-reads to learn which happened, so this reports nothing.
 */
export async function insertCodeNameIfAbsent(db: Queryable, codeName: string, userId: string, purpose: string): Promise<void> {
  await db.query("INSERT IGNORE INTO `member_code_names` (`code_name`, `user_id`, `purpose`) VALUES (?, ?, ?)", [
    codeName,
    userId,
    purpose,
  ]);
}

/** Who a live code-name names, or null. A dropped one names nobody. */
export async function userIdForCodeName(db: Queryable, codeName: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `user_id` FROM `member_code_names` WHERE `code_name` = ? AND `dropped_at` IS NULL LIMIT 1",
    [codeName],
  );
  const id = rows[0]?.user_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Every live code-name this member holds, whatever its purpose. The erasure's read. */
export async function liveCodeNamesOfUser(db: Queryable, userId: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `code_name` FROM `member_code_names` WHERE `user_id` = ? AND `dropped_at` IS NULL",
    [userId],
  );
  return rows.map((r) => String(r.code_name));
}

/**
 * Mark this member's live code-names as waiting on a vendor delete.
 * COALESCE, so a second erasure does not move the date: the age is the age of
 * the obligation. An UPDATE matching nothing is a member who never crossed.
 */
export async function markPendingVendorDelete(db: Queryable, userId: string): Promise<void> {
  await db.query(
    "UPDATE `member_code_names` SET `pending_vendor_delete_at` = COALESCE(`pending_vendor_delete_at`, NOW()) " +
      "WHERE `user_id` = ? AND `dropped_at` IS NULL",
    [userId],
  );
}

/**
 * Drop one map entry: forget who it named, keep the code-name reserved.
 * Only an entry already marked pending can be dropped, which is the order the
 * founder promised the vendor: scrub, ask, then drop on their confirm.
 */
export async function dropPendingCodeName(db: Queryable, codeName: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE `member_code_names` SET `user_id` = NULL, `dropped_at` = NOW() " +
      "WHERE `code_name` = ? AND `pending_vendor_delete_at` IS NOT NULL AND `dropped_at` IS NULL",
    [codeName],
  );
  return Number(r?.affectedRows ?? 0);
}

/** How many map entries are kept, marked, waiting on a vendor's confirm. */
export async function pendingVendorDeleteCount(db: Queryable): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `member_code_names` WHERE `pending_vendor_delete_at` IS NOT NULL AND `dropped_at` IS NULL",
  );
  return Number(rows[0]?.n ?? 0);
}
