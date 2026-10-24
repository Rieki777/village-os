/**
 * A circle's season, read from what its closed sessions already hold: the
 * sessions themselves (`live_sessions`, their stamp and summary), what they
 * decided and named (`live_session_entries`), where their actions stand
 * (`live_session_task_state`, 0255), and who came (`live_session_people`).
 * Every statement server/lib/sessionPulse.ts runs, one function each. Reads
 * only: the pulse keeps no table of its own.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const none = <T>(list: readonly T[]): boolean => list.length === 0;

/** A circle's closed sessions since an instant, oldest first, with their stamp and summary. */
export async function closedSince(q: Queryable, circleId: string, since: Date): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `id`, `stamp`, `summary`, `closed_at` FROM `live_sessions` WHERE `circle_id` = ? AND `status` = 'closed' AND `closed_at` >= ? ORDER BY `closed_at`, `id`",
    [circleId, since],
  );
}

/** How many people were in each of some sessions. */
export async function peopleCounts(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `session_id`, COUNT(*) AS `n` FROM `live_session_people` WHERE `session_id` IN (?) GROUP BY `session_id`", [sessionIds]);
}

/** Different people across some sessions. */
export async function distinctPeople(q: Queryable, sessionIds: readonly number[]): Promise<number> {
  if (none(sessionIds)) return 0;
  const [row] = await rowsOf(q, "SELECT COUNT(DISTINCT `member_no`) AS `n` FROM `live_session_people` WHERE `session_id` IN (?)", [sessionIds]);
  return Number(row?.n ?? 0);
}

/** Proposals decided by consent and tensions named, across some sessions. */
export async function entryCounts(q: Queryable, sessionIds: readonly number[]): Promise<{ decisions: number; tensions: number }> {
  if (none(sessionIds)) return { decisions: 0, tensions: 0 };
  const [row] = await rowsOf(
    q,
    "SELECT SUM(`kind` = 'decision' AND `status` = 'done') AS `decisions`, SUM(`kind` = 'tension') AS `tensions` FROM `live_session_entries` WHERE `session_id` IN (?)",
    [sessionIds],
  );
  return { decisions: Number(row?.decisions ?? 0), tensions: Number(row?.tensions ?? 0) };
}

/** Where the actions some sessions left stand now, by status. */
export async function actionStates(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `status`, COUNT(*) AS `n` FROM `live_session_task_state` WHERE `session_id` IN (?) GROUP BY `status`", [sessionIds]);
}
