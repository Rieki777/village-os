/**
 * The task layer's three tables (0255): `live_session_task_state`,
 * `live_session_task_events` and `live_session_task_sends`. Every statement
 * the task board, the answers, the task emails and the due-date notes run
 * against them, one function each, and the joins they make to the session
 * tables 0238 made, for a task's words and its session's title.
 *
 * ── WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT ─────────────────────
 *
 * Each function hands back what the driver handed back: rows, an insert id,
 * a count, or nothing. Mapping into the shapes in shared/sessionTasks.ts,
 * every right and every refusal stay in the lib (server/lib/sessionTasks.ts),
 * the split server/repos/liveSessions.ts makes for the same reason.
 *
 * ── THE RECORD STAYS AS SAID ─────────────────────────────────────────────
 *
 * Nothing here writes `live_session_entries`. An entry's words, its holders
 * and its date as the session closed stay in the record; an answer given
 * afterwards moves the state row and appends an event, and that is all.
 *
 * ── A PERSON IS A NUMBER ─────────────────────────────────────────────────
 *
 * Every `_no` column holds a number from `live_session_members`, never a
 * `users`.`id`. No statement here names a user id, and none reads an email.
 *
 * ── TRANSACTIONS ─────────────────────────────────────────────────────────
 *
 * Every function takes a `Queryable`, so the lib runs an answer on the one
 * connection `inTransaction` (server/repos/liveSessions.ts) hands it:
 * `stateForUpdate` takes the row, `writeState` and `appendEvent` write the
 * answer, `bumpOpenRooms` moves the version of the circle's open room so its
 * next poll reads the answer, and the commit makes all four one step.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { TaskEventRow, TaskState } from "../../shared/sessionTasks";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

/** `IN (?)` with an empty list is a syntax error, and `IN (NULL)` matches nothing. */
const listOrNone = (list: readonly string[]): (string | null)[] => (list.length ? [...list] : [null]);

/** A time the driver can write: a Date from an ISO instant, or NULL. */
const instant = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * The state row's own columns. `due_on` as text, so no zone ever moves a date
 * by a day. `hand_asked_at` is reserved for a later wave and read by nobody.
 */
const STATE_COLUMNS =
  "`t`.`entry_id`, `t`.`session_id`, `t`.`circle_id`, `t`.`status`, `t`.`owner_no`, `t`.`owner_seat_id`, " +
  "DATE_FORMAT(`t`.`due_on`, '%Y-%m-%d') AS `due_on`, `t`.`latest_kind`, `t`.`latest_note`, `t`.`changed_by_no`, " +
  "`t`.`changed_at`, `t`.`done_at`, `t`.`version`";

/**
 * A task as a card needs it: the state, the words said (`text`), and the
 * session it came from (title, close, the stored summary with the circle's
 * name at the time, and its hosts, so the lib can tell a facilitator's note).
 */
const TASK_COLUMNS =
  `${STATE_COLUMNS}, \`e\`.\`text\`, \`s\`.\`title\`, \`s\`.\`closed_at\`, \`s\`.\`summary\`, ` +
  "`s`.`facilitator_no`, `s`.`secretary_no`";

const TASK_FROM =
  "FROM `live_session_task_state` `t` " +
  "JOIN `live_session_entries` `e` ON `e`.`id` = `t`.`entry_id` " +
  "JOIN `live_sessions` `s` ON `s`.`id` = `t`.`session_id`";

// ── The close ───────────────────────────────────────────────────────────────

/**
 * One closed session's actions get their state rows: every action that is
 * open or done, as the close left it. An open one nobody holds (its holder
 * left the village, say) is back with the circle, and its next call's action
 * check still shows it. The
 * same statement as 0255's backfill, scoped to one session, and run inside
 * the close's own transaction on its connection, after `writeClosed`, so the
 * row and the close commit together. INSERT IGNORE: a second run changes
 * nothing, and a row that has been answered keeps its answers.
 */
export async function seedStateForSession(q: Queryable, sessionId: number): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT IGNORE INTO `live_session_task_state` (`entry_id`, `session_id`, `circle_id`, `status`, `owner_no`, " +
      "`owner_seat_id`, `due_on`, `latest_kind`, `changed_by_no`, `changed_at`, `done_at`) " +
      "SELECT `e`.`id`, `e`.`session_id`, `s`.`circle_id`, `e`.`status`, NULLIF(`e`.`owner_no`, 0), `e`.`owner_seat_id`, " +
      "`e`.`due_on`, 'closed', 0, COALESCE(`s`.`closed_at`, CURRENT_TIMESTAMP), " +
      "CASE WHEN `e`.`status` = 'done' THEN COALESCE(`s`.`closed_at`, CURRENT_TIMESTAMP) ELSE NULL END " +
      "FROM `live_session_entries` `e` JOIN `live_sessions` `s` ON `s`.`id` = `e`.`session_id` " +
      "WHERE `e`.`session_id` = ? AND `e`.`kind` = 'action' AND `e`.`status` IN ('open', 'done')",
    [sessionId],
  );
  return Number(r.affectedRows ?? 0);
}

// ── The board ───────────────────────────────────────────────────────────────

/**
 * Every task one member holds, in person or through a seat they sit in now,
 * across every session. `ownerNo` may be null (a seat holder who never joined
 * a session): then only the seats match. Without `earlier`, a finished task
 * is read only when it changed at or after `finishedSince`; with it, every
 * finished task is read too.
 */
export async function boardRows(
  q: Queryable,
  ownerNo: number | null,
  seatIds: readonly string[],
  opts: { finishedSince: Date; earlier: boolean },
): Promise<RowDataPacket[]> {
  const window = opts.earlier ? "" : "AND (`t`.`status` = 'open' OR `t`.`changed_at` >= ?) ";
  return rowsOf(
    q,
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE (\`t\`.\`owner_no\` = ? OR \`t\`.\`owner_seat_id\` IN (?)) ${window}` +
      "ORDER BY `t`.`entry_id`",
    [ownerNo, listOrNone(seatIds), ...(opts.earlier ? [] : [opts.finishedSince])],
  );
}

/** How many of the member's finished tasks changed before `before`: the board's Earlier, unread until opened. */
export async function boardEarlierCount(q: Queryable, ownerNo: number | null, seatIds: readonly string[], before: Date): Promise<number> {
  const rows = await rowsOf(
    q,
    "SELECT COUNT(*) AS `n` FROM `live_session_task_state` `t` WHERE (`t`.`owner_no` = ? OR `t`.`owner_seat_id` IN (?)) " +
      "AND `t`.`status` <> 'open' AND `t`.`changed_at` < ?",
    [ownerNo, listOrNone(seatIds), before],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * What waits on one member, in one statement: how many open tasks they hold in
 * person or through a seat they sit in now (`n`), and the nearest date among
 * them (`next_due`, YYYY-MM-DD, NULL when none has one). The same two sets the
 * board reads: the state rows still open, and the actions of a session that is
 * still open, which have no state row yet. A close seeds the state rows, so no
 * task is in both. One row, always.
 */
export async function waitingRows(q: Queryable, ownerNo: number | null, seatIds: readonly string[]): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT COUNT(*) AS `n`, DATE_FORMAT(MIN(`w`.`due_on`), '%Y-%m-%d') AS `next_due` FROM (" +
      "SELECT `t`.`due_on` FROM `live_session_task_state` `t` " +
      "WHERE `t`.`status` = 'open' AND (`t`.`owner_no` = ? OR `t`.`owner_seat_id` IN (?)) " +
      "UNION ALL SELECT `e`.`due_on` FROM `live_session_entries` `e` JOIN `live_sessions` `s` ON `s`.`id` = `e`.`session_id` " +
      "WHERE `s`.`status` = 'open' AND `e`.`kind` = 'action' AND `e`.`status` = 'open' " +
      "AND (`e`.`owner_no` = ? OR `e`.`owner_seat_id` IN (?))) `w`",
    [ownerNo, listOrNone(seatIds), ownerNo, listOrNone(seatIds)],
  );
}

/**
 * The actions one member holds in a session that is still open: they have no
 * state row yet, and the board shows them read-only, answered in the room.
 */
export async function openSessionActionRows(q: Queryable, ownerNo: number | null, seatIds: readonly string[]): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `e`.`id` AS `entry_id`, `e`.`session_id`, `s`.`circle_id`, `e`.`text`, `e`.`owner_no`, `e`.`owner_seat_id`, " +
      "DATE_FORMAT(`e`.`due_on`, '%Y-%m-%d') AS `due_on`, `s`.`title`, `s`.`created_at`, `s`.`facilitator_no`, `s`.`secretary_no` " +
      "FROM `live_session_entries` `e` JOIN `live_sessions` `s` ON `s`.`id` = `e`.`session_id` " +
      "WHERE `s`.`status` = 'open' AND `e`.`kind` = 'action' AND `e`.`status` = 'open' " +
      "AND (`e`.`owner_no` = ? OR `e`.`owner_seat_id` IN (?)) ORDER BY `e`.`id`",
    [ownerNo, listOrNone(seatIds)],
  );
}

/** These tasks, as cards need them. For the fresh card an answer or a 409 hands back. */
export async function taskRowsFor(q: Queryable, entryIds: readonly number[]): Promise<RowDataPacket[]> {
  if (entryIds.length === 0) return [];
  return rowsOf(q, `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`entry_id\` IN (?) ORDER BY \`t\`.\`entry_id\``, [entryIds]);
}

// ── An answer ───────────────────────────────────────────────────────────────

/** One task's state, taken for the rest of the transaction. */
export async function stateForUpdate(q: Queryable, entryId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${STATE_COLUMNS} FROM \`live_session_task_state\` \`t\` WHERE \`t\`.\`entry_id\` = ? LIMIT 1 FOR UPDATE`, [entryId]);
}

/**
 * The state after an answer, written whole from what `applyAnswer` returned.
 * `version` is the new one. `hand_asked_at` is left as it is.
 */
export async function writeState(q: Queryable, next: TaskState): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_task_state` SET `status` = ?, `owner_no` = ?, `owner_seat_id` = ?, `due_on` = ?, " +
      "`latest_kind` = ?, `latest_note` = ?, `changed_by_no` = ?, `changed_at` = ?, `done_at` = ?, `version` = ? " +
      "WHERE `entry_id` = ?",
    [
      next.status,
      next.ownerNo,
      next.ownerSeatId,
      next.dueOn,
      next.latestKind,
      next.latestNote,
      next.changedByNo,
      instant(next.changedAt) ?? new Date(),
      instant(next.doneAt),
      next.version,
      next.entryId,
    ],
  );
  return Number(r.affectedRows ?? 0);
}

/** One answer, appended. Returns its id, for a notice's dedupe key. */
export async function appendEvent(q: Queryable, ev: TaskEventRow, now: Date = new Date()): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_task_events` (`entry_id`, `session_id`, `kind`, `by_no`, `status`, `owner_no`, " +
      "`owner_seat_id`, `due_on`, `note`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [ev.entryId, ev.sessionId, ev.kind, ev.byNo, ev.status, ev.ownerNo, ev.ownerSeatId, ev.dueOn, ev.note, now],
  );
  return Number(r.insertId);
}

/** The circle's open rooms read an answer on their next poll: their version moves. */
export async function bumpOpenRooms(q: Queryable, circleId: string): Promise<void> {
  await q.query("UPDATE `live_sessions` SET `version` = `version` + 1 WHERE `circle_id` = ? AND `status` = 'open'", [circleId]);
}

/** One task's answers, oldest first. */
export async function eventRows(q: Queryable, entryId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `id`, `entry_id`, `session_id`, `kind`, `by_no`, `status`, `owner_no`, `owner_seat_id`, " +
      "DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `note`, `created_at` FROM `live_session_task_events` " +
      "WHERE `entry_id` = ? ORDER BY `id`",
    [entryId],
  );
}

// ── A circle, and one session ───────────────────────────────────────────────

/**
 * A circle's tasks for its next call's action check: every one still open,
 * and every one that changed after the circle last met, through the circle
 * index. `lastMetAt` null reads every change.
 */
export async function circleTaskRows(q: Queryable, circleId: string, lastMetAt: Date | null): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`circle_id\` = ? AND (\`t\`.\`status\` = 'open' OR \`t\`.\`changed_at\` > ?) ` +
      "ORDER BY `t`.`entry_id`",
    [circleId, lastMetAt ?? new Date(0)],
  );
}

/** An open task held by no person and no seat, from a session that had a circle. */
const BACK_WITH_CIRCLE =
  "`t`.`status` = 'open' AND (`t`.`owner_no` IS NULL OR `t`.`owner_no` = 0) " +
  "AND (`t`.`owner_seat_id` IS NULL OR `t`.`owner_seat_id` = '') AND `t`.`circle_id` IS NOT NULL AND `t`.`circle_id` <> ''";

/** The circles that have a task back with them now, so the board measures standing only where it matters. */
export async function backWithCircleIds(q: Queryable): Promise<string[]> {
  const rows = await rowsOf(q, `SELECT DISTINCT \`t\`.\`circle_id\` FROM \`live_session_task_state\` \`t\` WHERE ${BACK_WITH_CIRCLE}`);
  return rows.map((r) => String(r.circle_id));
}

/** Every task back with one of these circles, through the circle index. By date, undated last. */
export async function backWithCircleRows(q: Queryable, circleIds: readonly string[]): Promise<RowDataPacket[]> {
  if (!circleIds.length) return [];
  return rowsOf(
    q,
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`circle_id\` IN (?) AND ${BACK_WITH_CIRCLE} ` +
      "ORDER BY `t`.`due_on` IS NULL, `t`.`due_on`, `t`.`entry_id`",
    [[...circleIds]],
  );
}

/** One session's tasks, for its record and its task emails. `openOnly` reads the open ones. */
export async function sessionTaskRows(q: Queryable, sessionId: number, opts: { openOnly?: boolean } = {}): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`session_id\` = ? ${opts.openOnly ? "AND `t`.`status` = 'open' " : ""}` +
      "ORDER BY `t`.`entry_id`",
    [sessionId],
  );
}

// ── The task emails ─────────────────────────────────────────────────────────

/**
 * The next send number for a session. It takes the session row first, so two
 * presses at once wait for each other and each gets its own number; the
 * caller then reserves it with `insertSend` in the same transaction.
 */
export async function nextSendNo(q: Queryable, sessionId: number): Promise<number> {
  await q.query("SELECT `id` FROM `live_sessions` WHERE `id` = ? FOR UPDATE", [sessionId]);
  const rows = await rowsOf(q, "SELECT COALESCE(MAX(`send_no`), 0) + 1 AS `n` FROM `live_session_task_sends` WHERE `session_id` = ?", [sessionId]);
  return Number(rows[0]?.n ?? 1);
}

/**
 * A send, recorded. INSERT IGNORE: true when this call took the number, false
 * when the number was already taken (the close's own send, queued twice).
 */
export async function insertSend(
  q: Queryable,
  row: { sessionId: number; sendNo: number; sentByNo: number; sentAt: Date; counts: string },
): Promise<boolean> {
  const [r] = await q.query<any>(
    "INSERT IGNORE INTO `live_session_task_sends` (`session_id`, `send_no`, `sent_by_no`, `sent_at`, `counts`) VALUES (?, ?, ?, ?, ?)",
    [row.sessionId, row.sendNo, row.sentByNo, row.sentAt, row.counts],
  );
  return Number(r.affectedRows ?? 0) === 1;
}

/** A send's counts, once every email in it is posted. JSON numbers, never addresses. */
export async function writeSendCounts(q: Queryable, sessionId: number, sendNo: number, counts: string): Promise<void> {
  await q.query("UPDATE `live_session_task_sends` SET `counts` = ? WHERE `session_id` = ? AND `send_no` = ?", [counts, sessionId, sendNo]);
}

/** The latest send of a session, for the record's last-send line. */
export async function lastSend(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `send_no`, `sent_by_no`, `sent_at`, `counts` FROM `live_session_task_sends` WHERE `session_id` = ? " +
      "ORDER BY `send_no` DESC LIMIT 1",
    [sessionId],
  );
}

// ── The due-date notes ──────────────────────────────────────────────────────

/** Open tasks due from one YYYY-MM-DD to another, both included, through the due index. */
export async function dueRows(q: Queryable, fromDate: string, toDate: string): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`status\` = 'open' AND \`t\`.\`due_on\` BETWEEN ? AND ? ORDER BY \`t\`.\`entry_id\``,
    [fromDate, toDate],
  );
}

// ── One session, gone ───────────────────────────────────────────────────────

/**
 * Every task row a discarded session or a deleted record left: the state and
 * the answers of its entries, and every send of its task emails. Run inside
 * the discard's own transaction, before the entries themselves are deleted
 * (server/repos/liveSessions.ts `deleteSessionRows`), with the entry ids read
 * in that transaction.
 *
 * Both by the entries and by the session, so a row whose copied `session_id`
 * and entry disagree still goes. `live_session_task_events` has no index on
 * `session_id`, so its ids are read first with a plain read, which takes no
 * locks, and deleted by primary key; a DELETE that scanned the table would
 * lock every task answer in the village until the commit.
 */
export async function deleteTaskRowsForSession(q: Queryable, sessionId: number, entryIds: readonly number[]): Promise<void> {
  if (entryIds.length > 0) {
    await q.query("DELETE FROM `live_session_task_state` WHERE `entry_id` IN (?)", [entryIds]);
    await q.query("DELETE FROM `live_session_task_events` WHERE `entry_id` IN (?)", [entryIds]);
  }
  await q.query("DELETE FROM `live_session_task_state` WHERE `session_id` = ?", [sessionId]);
  const events = (await rowsOf(q, "SELECT `id` FROM `live_session_task_events` WHERE `session_id` = ?", [sessionId])).map((r) => Number(r.id));
  if (events.length > 0) await q.query("DELETE FROM `live_session_task_events` WHERE `id` IN (?)", [events]);
  await q.query("DELETE FROM `live_session_task_sends` WHERE `session_id` = ?", [sessionId]);
}

// ── One member: the export and the erasure ─────────────────────────────────

/** The tasks a member holds in person now, and every answer they gave, notes included: both are theirs. */
export async function exportTaskRowsFor(q: Queryable, memberNo: number): Promise<{ held: RowDataPacket[]; answers: RowDataPacket[] }> {
  const held = await rowsOf(q, `SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE \`t\`.\`owner_no\` = ? ORDER BY \`t\`.\`entry_id\``, [memberNo]);
  const answers = await rowsOf(
    q,
    "SELECT `entry_id`, `session_id`, `kind`, DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `note`, `created_at` " +
      "FROM `live_session_task_events` WHERE `by_no` = ? ORDER BY `id`",
    [memberNo],
  );
  return { held, answers };
}

/**
 * The member leaves the task layer, inside the erasure's own transaction. The
 * entries they wrote are being deleted, so those tasks' state and answers go
 * with them. Everywhere else they appear, they become nobody: a task they
 * held is back with the circle (its version moves, so a board that read it
 * before has to read it again), the answers they gave keep their kind and
 * lose their name and their words, and a send they pressed reads as the
 * close's own.
 */
export async function forgetTaskRowsFor(q: Queryable, memberNo: number, deletedEntryIds: readonly number[]): Promise<void> {
  if (deletedEntryIds.length > 0) {
    await q.query("DELETE FROM `live_session_task_state` WHERE `entry_id` IN (?)", [deletedEntryIds]);
    await q.query("DELETE FROM `live_session_task_events` WHERE `entry_id` IN (?)", [deletedEntryIds]);
  }
  await q.query("UPDATE `live_session_task_state` SET `owner_no` = NULL, `version` = `version` + 1 WHERE `owner_no` = ?", [memberNo]);
  await q.query("UPDATE `live_session_task_state` SET `changed_by_no` = 0, `latest_note` = NULL WHERE `changed_by_no` = ?", [memberNo]);
  await q.query("UPDATE `live_session_task_events` SET `by_no` = 0, `note` = NULL WHERE `by_no` = ?", [memberNo]);
  await q.query("UPDATE `live_session_task_events` SET `owner_no` = NULL WHERE `owner_no` = ?", [memberNo]);
  await q.query("UPDATE `live_session_task_sends` SET `sent_by_no` = 0 WHERE `sent_by_no` = ?", [memberNo]);
}
