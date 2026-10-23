/**
 * Following circles on a calendar (0275): `live_session_follows`, which
 * circles a member follows, and `live_session_feed_keys`, the sha256 of each
 * member's private address key. A circle's own calendar (0277):
 * `live_session_circle_calendars`, which external calendar is whose, and the
 * one read of the village calendar it needs, the events imported from those
 * calendars. Every statement server/lib/sessionCalendar.ts and
 * server/lib/circleOwnCalendar.ts run against them, one function each.
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

// ── A circle's own calendar ─────────────────────────────────────────────────

const OWN_COLUMNS = "`circle_id`, `external_calendar_id`, `set_by_no`, `created_at`";

/** Every circle's own calendar. */
export async function ownCalendarRows(q: Queryable): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${OWN_COLUMNS} FROM \`live_session_circle_calendars\` ORDER BY \`circle_id\``);
}

/** One circle's own calendar. */
export async function ownCalendarRow(q: Queryable, circleId: string): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${OWN_COLUMNS} FROM \`live_session_circle_calendars\` WHERE \`circle_id\` = ? LIMIT 1`, [circleId]);
}

/** A circle's own calendar, taking the place of the one before. */
export async function putOwnCalendar(q: Queryable, row: { circleId: string; externalId: string; setByNo: number; now: Date }): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_circle_calendars` (`circle_id`, `external_calendar_id`, `set_by_no`, `created_at`) VALUES (?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `external_calendar_id` = VALUES(`external_calendar_id`), `set_by_no` = VALUES(`set_by_no`), `created_at` = VALUES(`created_at`)",
    [row.circleId, row.externalId, row.setByNo, row.now],
  );
}

export async function deleteOwnCalendar(q: Queryable, circleId: string): Promise<void> {
  await q.query("DELETE FROM `live_session_circle_calendars` WHERE `circle_id` = ?", [circleId]);
}

/**
 * The events imported from some external calendars that touch a window,
 * soonest first, as the village calendar holds them (0085). Read only: the
 * import itself is server/lib/externalCalendars.ts.
 */
export async function importedRows(q: Queryable, externalIds: readonly string[], from: Date, to: Date): Promise<RowDataPacket[]> {
  if (!externalIds.length) return [];
  return rowsOf(
    q,
    "SELECT e.* FROM `events` e WHERE e.`external_source_id` IN (?) AND e.`removed_at` IS NULL " +
      "AND e.`status` IN ('scheduled', 'cancelled', 'postponed') AND e.`starts_at` < ? AND COALESCE(e.`ends_at`, e.`starts_at`) > ? " +
      "ORDER BY e.`starts_at`, e.`id` LIMIT 2000",
    [externalIds, to, from],
  );
}

// ── One member: the export and the erasure ──────────────────────────────────

/** The circles whose own calendar this member attached. */
export async function memberOwnCalendarRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `circle_id`, `created_at` FROM `live_session_circle_calendars` WHERE `set_by_no` = ? ORDER BY `circle_id`", [no]);
}

/**
 * The member leaves: what they followed and their key go with them, and a
 * circle's own calendar they attached says it was attached by nobody. The
 * calendar is the circle's, and stays.
 */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_follows` WHERE `member_no` = ?", [no]);
  await q.query("DELETE FROM `live_session_feed_keys` WHERE `member_no` = ?", [no]);
  await q.query("UPDATE `live_session_circle_calendars` SET `set_by_no` = 0 WHERE `set_by_no` = ?", [no]);
}
