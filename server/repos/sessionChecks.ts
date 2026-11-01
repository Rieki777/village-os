/**
 * A proposal checked in a live session (0297): every statement against
 * `live_session_checks`. The rule is `checkEntry` in server/lib/liveSessions.ts;
 * the contract is shared/sessionCheck.ts.
 *
 * The deletes are called from inside the entry and session deletes in
 * server/repos/liveSessions.ts, so no caller that removes a proposal can leave
 * its check behind.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

/** Every check in one session. */
export async function checkRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `entry_id`, `checked_at`, `checked_hash`, `read_json` FROM `live_session_checks` WHERE `session_id` = ?",
    [sessionId],
  );
  return rows;
}

/** One proposal's check, replacing the one before it. */
export async function writeCheck(q: Queryable, row: { entryId: number; sessionId: number; hash: string; read: string; now: Date }): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_checks` (`entry_id`, `session_id`, `checked_at`, `checked_hash`, `read_json`) VALUES (?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `session_id` = VALUES(`session_id`), `checked_at` = VALUES(`checked_at`), `checked_hash` = VALUES(`checked_hash`), " +
      "`read_json` = VALUES(`read_json`)",
    [row.entryId, row.sessionId, row.now, row.hash, row.read],
  );
}

/** The checks of these proposals, as they go. */
export async function deleteChecksForEntries(q: Queryable, entryIds: readonly number[]): Promise<void> {
  if (!entryIds.length) return;
  await q.query("DELETE FROM `live_session_checks` WHERE `entry_id` IN (?)", [entryIds]);
}

/**
 * Every check whose proposal is gone. A release older than 0297's code, run
 * back over a migrated database, removes proposals without their checks; the
 * erasure and a discard sweep up after it, so an erased member's words never
 * stay behind as a read.
 */
export async function deleteOrphanChecks(q: Queryable): Promise<void> {
  // A plain read first, which takes no locks, then a delete by primary key: a
  // DELETE joined to the entries would hold a shared lock on every entry it read.
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `c`.`entry_id` FROM `live_session_checks` `c` LEFT JOIN `live_session_entries` `e` ON `e`.`id` = `c`.`entry_id` WHERE `e`.`id` IS NULL",
  );
  await deleteChecksForEntries(q, rows.map((r) => Number(r.entry_id)));
}

/** A discarded session takes its checks with it. */
export async function deleteChecksForSession(q: Queryable, sessionId: number): Promise<void> {
  await q.query("DELETE FROM `live_session_checks` WHERE `session_id` = ?", [sessionId]);
}
