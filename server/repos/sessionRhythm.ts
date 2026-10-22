/**
 * A circle's rhythm (0271): `live_session_rhythms`, one row per circle with
 * when it meets. Every statement server/lib/sessionRhythm.ts runs against it,
 * one function each, and the two small reads it makes beside it: when the
 * circle's last meeting closed, and who was in it.
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

/** `IN (?)` with an empty list is a syntax error, so an empty list reads nothing. */
const none = <T>(list: readonly T[]): boolean => list.length === 0;

const COLUMNS = "`circle_id`, `kind`, `recurrence`, `starts_at`, `duration_min`, `set_by_no`, `updated_at`";

/** Every rhythm, by circle. */
export async function rhythmRows(q: Queryable): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${COLUMNS} FROM \`live_session_rhythms\` ORDER BY \`circle_id\``);
}

/** One circle's rhythm. `lock` takes the row for the rest of the transaction. */
export async function rhythmRow(q: Queryable, circleId: string, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${COLUMNS} FROM \`live_session_rhythms\` WHERE \`circle_id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [circleId]);
}

/** Set a circle's rhythm, whole: a new one, or one written over the last. */
export async function putRhythm(
  q: Queryable,
  row: { circleId: string; kind: string; recurrence: string | null; startsAt: Date; durationMin: number; setByNo: number; now: Date },
): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_rhythms` (`circle_id`, `kind`, `recurrence`, `starts_at`, `duration_min`, `set_by_no`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `kind` = VALUES(`kind`), `recurrence` = VALUES(`recurrence`), " +
      "`starts_at` = VALUES(`starts_at`), `duration_min` = VALUES(`duration_min`), `set_by_no` = VALUES(`set_by_no`), `updated_at` = VALUES(`updated_at`)",
    [row.circleId, row.kind, row.recurrence, row.startsAt, row.durationMin, row.setByNo, row.now, row.now],
  );
}

/** The recurrence alone, for a skipped meeting. Hands back 1 or 0. */
export async function writeRecurrence(q: Queryable, circleId: string, recurrence: string, setByNo: number, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_rhythms` SET `recurrence` = ?, `set_by_no` = ?, `updated_at` = ? WHERE `circle_id` = ?",
    [recurrence, setByNo, now, circleId],
  );
  return Number(r.affectedRows ?? 0);
}

export async function deleteRhythm(q: Queryable, circleId: string): Promise<void> {
  await q.query("DELETE FROM `live_session_rhythms` WHERE `circle_id` = ?", [circleId]);
}

/** When some sessions closed, for "last met". */
export async function closedAtRows(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `id`, `closed_at` FROM `live_sessions` WHERE `id` IN (?)", [sessionIds]);
}

/** Who was in some sessions, as member numbers, for the circle's members. */
export async function peopleOfRows(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `session_id`, `member_no` FROM `live_session_people` WHERE `session_id` IN (?)", [sessionIds]);
}

// ── One member: the export and the erasure ──────────────────────────────────

/** The rhythms this member set last. */
export async function memberRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `circle_id`, `updated_at` FROM `live_session_rhythms` WHERE `set_by_no` = ? ORDER BY `circle_id`", [no]);
}

/** The member leaves: a rhythm they set last says it was set by nobody. */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  await q.query("UPDATE `live_session_rhythms` SET `set_by_no` = 0 WHERE `set_by_no` = ?", [no]);
}
