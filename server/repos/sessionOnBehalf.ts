/**
 * A facilitator fills in for a member (0288): every statement against
 * `live_session_on_behalf`, and the two writes an undo makes on the room's
 * own tables that the room never made before (an agenda item removed, an
 * arrival taken back). The rules are server/lib/sessionOnBehalf.ts; the
 * contract is shared/sessionOnBehalf.ts.
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

const COLUMNS =
  "`id`, `session_id`, `actor_no`, `person_no`, `target`, `target_id`, `act`, `before_json`, `created_at`, `noticed_at`, `undone_at`, `kept_at`";

export async function insertFill(
  q: Queryable,
  row: { sessionId: number; actorNo: number; personNo: number; target: string; targetId: number; act: string; before: string | null; now: Date },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_on_behalf` (`session_id`, `actor_no`, `person_no`, `target`, `target_id`, `act`, `before_json`, `created_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [row.sessionId, row.actorNo, row.personNo, row.target, row.targetId, row.act, row.before, row.now],
  );
  return Number(r.insertId);
}

/** Every fill-in in one session, oldest first. */
export async function fillRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${COLUMNS} FROM \`live_session_on_behalf\` WHERE \`session_id\` = ? ORDER BY \`id\``, [sessionId]);
}

export async function fillRow(q: Queryable, sessionId: number, id: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${COLUMNS} FROM \`live_session_on_behalf\` WHERE \`session_id\` = ? AND \`id\` = ? LIMIT 1`, [sessionId, id]);
}

export async function markUndone(q: Queryable, id: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_on_behalf` SET `undone_at` = ? WHERE `id` = ?", [now, id]);
}

/**
 * The person changed it themselves: every fill-in still standing on it is
 * theirs now. Hands back how many rows moved.
 */
export async function keepFills(q: Queryable, sessionId: number, target: string, targetId: number, personNo: number, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_on_behalf` SET `kept_at` = ? WHERE `session_id` = ? AND `target` = ? AND `target_id` = ? AND `person_no` = ? " +
      "AND `undone_at` IS NULL AND `kept_at` IS NULL",
    [now, sessionId, target, targetId, personNo],
  );
  return Number(r.affectedRows ?? 0);
}

/** Fill-ins in one session whose person has not been told yet. */
export async function unnoticedRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${COLUMNS} FROM \`live_session_on_behalf\` WHERE \`session_id\` = ? AND \`noticed_at\` IS NULL AND \`undone_at\` IS NULL ORDER BY \`id\` LIMIT 50`,
    [sessionId],
  );
}

export async function markNoticed(q: Queryable, id: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_on_behalf` SET `noticed_at` = ? WHERE `id` = ? AND `noticed_at` IS NULL", [now, id]);
}

/**
 * The close: nothing is undone after it, so what an undo would put back goes,
 * and with it the arrival words a fill-in replaced. Who filled in what stays.
 */
export async function forgetBefores(q: Queryable, sessionId: number): Promise<void> {
  await q.query("UPDATE `live_session_on_behalf` SET `before_json` = NULL WHERE `session_id` = ?", [sessionId]);
}

export async function deleteFillsForSession(q: Queryable, sessionId: number): Promise<void> {
  await q.query("DELETE FROM `live_session_on_behalf` WHERE `session_id` = ?", [sessionId]);
}

/** The fill-ins that name this member, as the person or the one who filled in. */
export async function memberFillRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `session_id`, `target`, `act`, `actor_no` = ? AS `by_me`, `person_no` = ? AS `for_me`, `created_at`, `undone_at` " +
      "FROM `live_session_on_behalf` WHERE `person_no` = ? OR `actor_no` = ? ORDER BY `id`",
    [no, no, no, no],
  );
}

/**
 * The member leaves: what was filled in for them goes with the rest of what
 * was theirs, and a fill-in they made for somebody else says it was made by
 * nobody, so the person it was for keeps their mark.
 */
export async function forgetFillsFor(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_on_behalf` WHERE `person_no` = ?", [no]);
  await q.query("UPDATE `live_session_on_behalf` SET `actor_no` = 0 WHERE `actor_no` = ?", [no]);
}

// ── The undo's writes on the room's own tables ──────────────────────────────

/** An agenda item filled in for somebody, undone before it was talked about. */
export async function deleteItemRow(q: Queryable, sessionId: number, itemId: number): Promise<void> {
  await q.query("DELETE FROM `live_session_items` WHERE `session_id` = ? AND `id` = ?", [sessionId, itemId]);
}

/** An arrival given for somebody, without marking them here: the facilitator is, they may not be. */
export async function writeArrivalFor(q: Queryable, sessionId: number, no: number, score: number, wish: string | null): Promise<void> {
  await q.query("UPDATE `live_session_people` SET `arrival_score` = ?, `arrival_wish` = ? WHERE `session_id` = ? AND `member_no` = ?", [
    score,
    wish,
    sessionId,
    no,
  ]);
}

/** An arrival given for somebody who had given none, undone. */
export async function clearArrival(q: Queryable, sessionId: number, no: number): Promise<void> {
  await q.query("UPDATE `live_session_people` SET `arrival_score` = NULL, `arrival_wish` = NULL WHERE `session_id` = ? AND `member_no` = ?", [sessionId, no]);
}
