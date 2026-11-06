/**
 * The reads and writes behind shared work chats (server/lib/sharedWork.ts).
 *
 * The rules (who is on a quest or a task, when a chat is created, who stays in
 * it) live in the lib; these are the statements, kept here so every reader of
 * quest_claims, the live-session task tables and conversation_members stays
 * enumerable.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export async function questRow(pool: Pool, questId: string): Promise<{ id: string; title: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id, title FROM quests WHERE id = ?", [questId]);
  return rows[0] ? { id: String(rows[0].id), title: String(rows[0].title ?? "") } : null;
}

/** Everyone with a claim on the quest that was not declined, first claimant first. */
export async function questClaimants(pool: Pool, questId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, MIN(claimed_at) AS first_at FROM quest_claims WHERE quest_id = ? AND status <> 'declined' " +
      "GROUP BY user_id ORDER BY first_at, user_id",
    [questId],
  );
  return rows.map((r) => String(r.user_id));
}

export interface TaskRow {
  id: string;
  kind: string;
  text: string;
  ownerNo: number | null;
  ownerSeatId: string | null;
}

/** A live-session entry and who holds it now: the state row, or the entry while its session is still open. */
export async function taskRow(pool: Pool, entryId: number): Promise<TaskRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT e.id, e.kind, e.text, COALESCE(t.owner_no, e.owner_no) AS owner_no, " +
      "IF(t.entry_id IS NULL, e.owner_seat_id, t.owner_seat_id) AS owner_seat_id " +
      "FROM live_session_entries e LEFT JOIN live_session_task_state t ON t.entry_id = e.id WHERE e.id = ?",
    [entryId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    kind: String(r.kind),
    text: String(r.text ?? ""),
    ownerNo: r.owner_no == null ? null : Number(r.owner_no),
    ownerSeatId: r.owner_seat_id == null || r.owner_seat_id === "" ? null : String(r.owner_seat_id),
  };
}

export async function liveSessionUserFor(pool: Pool, no: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT user_id FROM live_session_members WHERE no = ?", [no]);
  return rows[0] ? String(rows[0].user_id) : null;
}

export async function liveSessionNoFor(pool: Pool, userId: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT no FROM live_session_members WHERE user_id = ?", [userId]);
  return rows[0] ? Number(rows[0].no) : null;
}

/** Quests this member holds a live claim on. */
export async function liveClaimedQuestIds(pool: Pool, userId: string, cap: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT quest_id FROM quest_claims WHERE user_id = ? AND status IN ('claimed','submitted') LIMIT ?",
    [userId, cap],
  );
  return rows.map((r) => String(r.quest_id));
}

/** Tasks held by this person number or by any of these seats, not let go, newest change first. */
export async function heldTaskIds(pool: Pool, no: number | null, seats: string[], cap: number): Promise<string[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (no != null) {
    clauses.push("owner_no = ?");
    params.push(no);
  }
  if (seats.length) {
    clauses.push(`owner_seat_id IN (${seats.map(() => "?").join(",")})`);
    params.push(...seats);
  }
  if (!clauses.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT entry_id FROM live_session_task_state WHERE status <> 'let_go' AND (${clauses.join(" OR ")}) ` +
      `ORDER BY changed_at DESC LIMIT ${Math.max(1, Math.trunc(cap))}`,
    params,
  );
  return rows.map((r) => String(r.entry_id));
}

export async function conversationIdByKey(pool: Pool, directKey: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM conversations WHERE direct_key = ?", [directKey]);
  return rows[0] ? String(rows[0].id) : null;
}

export async function insertWorkConversation(
  pool: Pool,
  row: { id: string; name: string; contextType: string; contextId: string; createdBy: string; directKey: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO conversations (id, kind, name, context_type, context_id, created_by, direct_key) VALUES (?,?,?,?,?,?,?)",
    [row.id, "group", row.name, row.contextType, row.contextId, row.createdBy, row.directKey],
  );
}

export async function renameConversation(pool: Pool, conversationId: string, name: string): Promise<void> {
  await pool.query("UPDATE conversations SET name = ? WHERE id = ?", [name, conversationId]);
}

export async function liveMemberIds(pool: Pool, conversationId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL",
    [conversationId],
  );
  return rows.map((r) => String(r.user_id));
}

/** A returning member gets their old row back, history and read mark with it. */
export async function joinAsMember(pool: Pool, conversationId: string, userId: string): Promise<void> {
  await pool.query(
    "INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,'member') " +
      "ON DUPLICATE KEY UPDATE left_at = NULL, role = 'member'",
    [conversationId, userId],
  );
}

export async function markLeft(pool: Pool, conversationId: string, userId: string): Promise<void> {
  await pool.query(
    "UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
    [conversationId, userId],
  );
}
