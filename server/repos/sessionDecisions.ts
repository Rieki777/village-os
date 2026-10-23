/**
 * A circle's decisions and their review dates (0280): `live_session_decision_reviews`,
 * one row per decision that has a review date, and the reads of the room's
 * own tables the log needs (a circle's decided `decision` entries in its
 * closed sessions). Every statement server/lib/sessionDecisions.ts runs, one
 * function each.
 *
 * Each function hands back what the driver handed back. Mapping, rights and
 * refusals stay in the lib, the split server/repos/liveSessions.ts makes.
 * Every UPDATE sets `updated_at`: the column has no ON UPDATE.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const none = <T>(list: readonly T[]): boolean => list.length === 0;

/** A circle's decided decisions in its closed sessions, newest first. */
export async function decisionRows(q: Queryable, circleId: string, limit: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT e.`id`, e.`text`, e.`session_id`, s.`title`, s.`closed_at` FROM `live_session_entries` e " +
      "JOIN `live_sessions` s ON s.`id` = e.`session_id` " +
      "WHERE s.`circle_id` = ? AND s.`status` = 'closed' AND e.`kind` = 'decision' AND e.`status` = 'done' " +
      "ORDER BY s.`closed_at` DESC, e.`id` DESC LIMIT ?",
    [circleId, limit],
  );
}

/** One decision, with its session's circle, when it is a decided decision of a closed session. */
export async function decisionRow(q: Queryable, entryId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT e.`id`, e.`text`, e.`session_id`, s.`circle_id` FROM `live_session_entries` e JOIN `live_sessions` s ON s.`id` = e.`session_id` " +
      "WHERE e.`id` = ? AND s.`status` = 'closed' AND e.`kind` = 'decision' AND e.`status` = 'done' LIMIT 1",
    [entryId],
  );
}

/** The review rows of some decisions. */
export async function reviewRows(q: Queryable, entryIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(entryIds)) return [];
  return rowsOf(q, "SELECT `entry_id`, `review_on`, `set_by_no`, `library_id` FROM `live_session_decision_reviews` WHERE `entry_id` IN (?)", [entryIds]);
}

/** Set a decision's review date. A new date starts a new cycle: what the last one became is let go. */
export async function putReview(q: Queryable, row: { entryId: number; reviewOn: string; setByNo: number; now: Date }): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_decision_reviews` (`entry_id`, `review_on`, `set_by_no`, `library_id`, `created_at`, `updated_at`) VALUES (?, ?, ?, NULL, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `review_on` = VALUES(`review_on`), `set_by_no` = VALUES(`set_by_no`), `library_id` = NULL, `updated_at` = VALUES(`updated_at`)",
    [row.entryId, row.reviewOn, row.setByNo, row.now, row.now],
  );
}

export async function deleteReview(q: Queryable, entryId: number): Promise<void> {
  await q.query("DELETE FROM `live_session_decision_reviews` WHERE `entry_id` = ?", [entryId]);
}

/** The reviews that have come and are not yet agenda items, with each decision's words and circle. */
export async function dueRows(q: Queryable, today: string): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT r.`entry_id`, r.`review_on`, r.`set_by_no`, e.`text`, s.`circle_id` FROM `live_session_decision_reviews` r " +
      "JOIN `live_session_entries` e ON e.`id` = r.`entry_id` JOIN `live_sessions` s ON s.`id` = e.`session_id` " +
      "WHERE r.`review_on` <= ? AND r.`library_id` IS NULL ORDER BY r.`review_on`, r.`entry_id` LIMIT 200",
    [today],
  );
}

/** A due review became an agenda item. Only the cycle it was due in: a date changed meanwhile is a new one. */
export async function markBrought(q: Queryable, entryId: number, reviewOn: string, libraryId: number, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_decision_reviews` SET `library_id` = ?, `updated_at` = ? WHERE `entry_id` = ? AND `review_on` = ? AND `library_id` IS NULL",
    [libraryId, now, entryId, reviewOn],
  );
  return Number(r.affectedRows ?? 0);
}

// ── One member: the export and the erasure ──────────────────────────────────

/** The review dates this member set last. */
export async function memberRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `entry_id`, `review_on`, `updated_at` FROM `live_session_decision_reviews` WHERE `set_by_no` = ? ORDER BY `entry_id`", [no]);
}

/** The member leaves: a review date they set says it was set by nobody. The date is the circle's, and stays. */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  await q.query("UPDATE `live_session_decision_reviews` SET `set_by_no` = 0 WHERE `set_by_no` = ?", [no]);
}
