/**
 * The room votes its agenda (0290): every statement against
 * `live_session_item_votes`. The rules are server/lib/sessionVotes.ts; the
 * contract is shared/sessionVotes.ts.
 *
 * A person here is a number from `live_session_members`, as in every Live
 * Sessions table.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

/** Every vote in one session. */
export async function voteRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `item_id`, `member_no`, `vote` FROM `live_session_item_votes` WHERE `session_id` = ?", [sessionId]);
}

/** One person's vote on one item, replacing whatever they gave before. */
export async function writeVote(q: Queryable, row: { sessionId: number; itemId: number; no: number; vote: 1 | -1; now: Date }): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_item_votes` (`session_id`, `item_id`, `member_no`, `vote`, `updated_at`) VALUES (?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `vote` = VALUES(`vote`), `updated_at` = VALUES(`updated_at`)",
    [row.sessionId, row.itemId, row.no, row.vote, row.now],
  );
}

/** A vote taken back. */
export async function deleteVote(q: Queryable, itemId: number, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_item_votes` WHERE `item_id` = ? AND `member_no` = ?", [itemId, no]);
}

/** A discarded session takes its votes with it. */
export async function deleteVotesForSession(q: Queryable, sessionId: number): Promise<void> {
  await q.query("DELETE FROM `live_session_item_votes` WHERE `session_id` = ?", [sessionId]);
}

/** One member's votes across every session, for their export. */
export async function memberVoteRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `session_id`, `item_id`, `vote`, `updated_at` FROM `live_session_item_votes` WHERE `member_no` = ? ORDER BY `session_id`, `item_id`", [no]);
}

/** The erasure: a member's votes go. */
export async function forgetVotesFor(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_item_votes` WHERE `member_no` = ?", [no]);
}
