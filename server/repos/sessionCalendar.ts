/**
 * Following circles on a calendar (0275): `live_session_follows`, which
 * circles a member follows, and `live_session_feed_keys`, the sha256 of each
 * member's private address key. Every statement server/lib/sessionCalendar.ts
 * runs against them, one function each.
 *
 * Each function hands back what the driver handed back. Mapping, rights and
 * refusals stay in the lib, the split server/repos/liveSessions.ts makes.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

// ── Follows ─────────────────────────────────────────────────────────────────

/** The circles one member follows, `*` among them for every circle. */
export async function followRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `circle_id`, `created_at` FROM `live_session_follows` WHERE `member_no` = ? ORDER BY `circle_id`", [no]);
}

/** Replace what one member follows, whole. Inside a transaction, so a reader never sees half. */
export async function replaceFollows(q: Queryable, no: number, circleIds: readonly string[], now: Date): Promise<void> {
  await q.query("DELETE FROM `live_session_follows` WHERE `member_no` = ?", [no]);
  if (!circleIds.length) return;
  await q.query(
    "INSERT INTO `live_session_follows` (`member_no`, `circle_id`, `created_at`) VALUES ?",
    [circleIds.map((c) => [no, c, now])],
  );
}

// ── Keys ────────────────────────────────────────────────────────────────────

/** One member's key row: when it was made and last read. Never the hash. */
export async function keyRow(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `created_at`, `last_used_at` FROM `live_session_feed_keys` WHERE `member_no` = ? LIMIT 1", [no]);
}

/** A new key for a member, taking the place of the old. */
export async function putKey(q: Queryable, no: number, keyHash: string, now: Date): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_feed_keys` (`member_no`, `key_hash`, `created_at`, `last_used_at`) VALUES (?, ?, ?, NULL) " +
      "ON DUPLICATE KEY UPDATE `key_hash` = VALUES(`key_hash`), `created_at` = VALUES(`created_at`), `last_used_at` = NULL",
    [no, keyHash, now],
  );
}

/** Stop a member's key. Hands back 1 or 0. */
export async function deleteKey(q: Queryable, no: number): Promise<number> {
  const [r] = await q.query<any>("DELETE FROM `live_session_feed_keys` WHERE `member_no` = ?", [no]);
  return Number(r.affectedRows ?? 0);
}

/** Whose key this is, by its hash. */
export async function memberForKey(q: Queryable, keyHash: string): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `member_no` FROM `live_session_feed_keys` WHERE `key_hash` = ? LIMIT 1", [keyHash]);
}

/** A calendar app read the address. */
export async function touchKey(q: Queryable, no: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_feed_keys` SET `last_used_at` = ? WHERE `member_no` = ?", [now, no]);
}

// ── One member: the erasure ─────────────────────────────────────────────────

/** The member leaves: what they followed and their key go with them. */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_follows` WHERE `member_no` = ?", [no]);
  await q.query("DELETE FROM `live_session_feed_keys` WHERE `member_no` = ?", [no]);
}
