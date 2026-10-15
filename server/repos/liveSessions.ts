/**
 * Live Sessions' six tables (0238): `live_session_members`, `live_sessions`,
 * `live_session_people`, `live_session_items`, `live_session_entries` and
 * `live_session_responses`. Every statement `server/lib/liveSessions.ts` runs
 * against them, one function each.
 *
 * ── WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT ─────────────────────
 *
 * Each function hands back what the driver handed back: rows, an insert id,
 * or nothing. Mapping into the shapes in shared/sessions.ts, every permission
 * and every refusal stay in the lib beside the rules they keep, the split
 * server/repos/journal.ts makes for the same reason.
 *
 * ── A PERSON IS A NUMBER ─────────────────────────────────────────────────
 *
 * Every `_no` column holds a number from `live_session_members`, never a
 * `users`.`id`. The two functions at the top are the only door between them.
 *
 * ── THE PRIVACY PROMISE IS ENUMERABLE HERE ───────────────────────────────
 *
 * `facilitationRows` names no `member_no` in its column list, so a reader of
 * feedback on the facilitation cannot get a person back without new SQL.
 * `eraseArrivals` is the one statement that empties the arrival round, and
 * the close runs it in the same transaction that stores the spread.
 *
 * ── TRANSACTIONS ARE OPENED HERE ─────────────────────────────────────────
 *
 * `inTransaction` hands the lib one connection inside one transaction, and
 * every function here takes a `Queryable`, so a pool and that connection are
 * interchangeable. Every write the room makes locks its session row first
 * (`sessionRow(conn, id, true)`) and bumps `version` before it commits, so
 * writes to one room are serial and the version is the room's whole history.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { lostConcurrencyRace } from "../db/concurrency";

/** A pool, or the one connection a transaction runs on. */
export type Queryable = Pool | PoolConnection;

/** How many times a transaction that lost a race is run again, in all. */
const RACE_ATTEMPTS = 3;

/**
 * Run `work` on one connection inside one transaction: commit when it
 * returns, roll back when it throws. A lost race (a deadlock, a lock wait
 * timeout) runs the whole transaction again, so every read decides again
 * against the world as it is now.
 */
export async function inTransaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await work(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      if (!lostConcurrencyRace(err) || attempt >= RACE_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 25)));
    } finally {
      conn.release();
    }
  }
}

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const insertIdOf = async (q: Queryable, sql: string, params: unknown[]): Promise<number> => {
  const [r] = await q.query<any>(sql, params);
  return Number(r.insertId);
};

/** `IN (?)` with an empty list is a syntax error, so an empty list reads nothing. */
const none = <T>(list: readonly T[]): boolean => list.length === 0;

// ── live_session_members: a member's number ─────────────────────────────────

/** The member's number, if they have one. */
export async function memberNoRows(q: Queryable, userId: string): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `no` FROM `live_session_members` WHERE `user_id` = ? LIMIT 1", [userId]);
}

/** Give the member a number. A second call for the same member changes nothing. */
export async function insertMemberNo(q: Queryable, userId: string, now: Date): Promise<void> {
  await q.query("INSERT IGNORE INTO `live_session_members` (`user_id`, `created_at`) VALUES (?, ?)", [userId, now]);
}

/** Which member each number is. Numbers nobody holds any more are simply absent. */
export async function memberUserIdRows(q: Queryable, nos: readonly number[]): Promise<RowDataPacket[]> {
  if (none(nos)) return [];
  return rowsOf(q, "SELECT `no`, `user_id` FROM `live_session_members` WHERE `no` IN (?)", [nos]);
}

export async function deleteMemberNo(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_members` WHERE `no` = ?", [no]);
}

// ── live_sessions ───────────────────────────────────────────────────────────

const SESSION_COLUMNS =
  "`id`, `title`, `circle_id`, `status`, `facilitator_no`, `secretary_no`, `created_by_no`, `duration_min`, " +
  "`state`, `version`, `stamp`, `summary`, `created_at`, `closed_at`";

export async function insertSessionRow(
  q: Queryable,
  row: { title: string; circleId: string | null; facilitatorNo: number; durationMin: number; state: string; stamp: string; now: Date },
): Promise<number> {
  return insertIdOf(
    q,
    "INSERT INTO `live_sessions` (`title`, `circle_id`, `status`, `facilitator_no`, `secretary_no`, `created_by_no`, " +
      "`duration_min`, `state`, `version`, `stamp`, `created_at`) VALUES (?, ?, 'open', ?, NULL, ?, ?, ?, 1, ?, ?)",
    [row.title, row.circleId, row.facilitatorNo, row.facilitatorNo, row.durationMin, row.state, row.stamp, row.now],
  );
}

/** One session. `lock` takes the row for the rest of the transaction. */
export async function sessionRow(q: Queryable, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${SESSION_COLUMNS} FROM \`live_sessions\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
}

/** The stored minutes of a closed session, in both audiences. */
export async function minutesRow(q: Queryable, id: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `status`, `minutes_people`, `minutes_shareable` FROM `live_sessions` WHERE `id` = ? LIMIT 1", [id]);
}

/** What is open now, newest first. */
export async function openSessionRows(q: Queryable, limit: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${SESSION_COLUMNS} FROM \`live_sessions\` WHERE \`status\` = 'open' ORDER BY \`created_at\` DESC, \`id\` DESC LIMIT ?`, [limit]);
}

/** Closed sessions this member was in, newest first. */
export async function closedSessionRowsFor(q: Queryable, no: number, limit: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${SESSION_COLUMNS.split(", ").map((c) => `\`s\`.${c}`).join(", ")} FROM \`live_sessions\` \`s\` ` +
      "JOIN `live_session_people` `p` ON `p`.`session_id` = `s`.`id` AND `p`.`member_no` = ? " +
      "WHERE `s`.`status` = 'closed' ORDER BY `s`.`closed_at` DESC, `s`.`id` DESC LIMIT ?",
    [no, limit],
  );
}

/** Every closed session, newest first. For an admin's list. */
export async function closedSessionRows(q: Queryable, limit: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${SESSION_COLUMNS} FROM \`live_sessions\` WHERE \`status\` = 'closed' ORDER BY \`closed_at\` DESC, \`id\` DESC LIMIT ?`, [limit]);
}

/** The most recent closed session of a circle, other than this one. */
export async function lastClosedInCircle(q: Queryable, circleId: string, exceptId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${SESSION_COLUMNS} FROM \`live_sessions\` WHERE \`circle_id\` = ? AND \`status\` = 'closed' AND \`id\` <> ? ` +
      "ORDER BY `closed_at` DESC, `id` DESC LIMIT 1",
    [circleId, exceptId],
  );
}

/**
 * Open rooms nobody has been seen in for a while: older than
 * `GREATEST(duration_min + graceMin, floorMin)` minutes, with nobody's
 * `last_seen_at` inside that window. The status index narrows the read to open
 * sessions older than the floor before any row is weighed, and each candidate
 * looks at its own people through their primary key, so a village whose rooms
 * are all fresh pays one index range that finds nothing. `onlyId` asks about
 * one room.
 */
export async function staleOpenSessionIds(
  q: Queryable,
  w: { now: Date; graceMin: number; floorMin: number; onlyId: number | null; limit: number },
): Promise<number[]> {
  const windowStart = "DATE_SUB(?, INTERVAL GREATEST(`s`.`duration_min` + ?, ?) MINUTE)";
  const rows = await rowsOf(
    q,
    "SELECT `s`.`id` FROM `live_sessions` `s` WHERE `s`.`status` = 'open' AND `s`.`created_at` < DATE_SUB(?, INTERVAL ? MINUTE) " +
      `AND \`s\`.\`created_at\` < ${windowStart} ${w.onlyId != null ? "AND `s`.`id` = ? " : ""}` +
      "AND NOT EXISTS (SELECT 1 FROM `live_session_people` `p` WHERE `p`.`session_id` = `s`.`id` " +
      `AND \`p\`.\`last_seen_at\` >= ${windowStart}) ORDER BY \`s\`.\`id\` LIMIT ?`,
    [
      w.now,
      w.floorMin,
      w.now,
      w.graceMin,
      w.floorMin,
      ...(w.onlyId != null ? [w.onlyId] : []),
      w.now,
      w.graceMin,
      w.floorMin,
      w.limit,
    ],
  );
  return rows.map((r) => Number(r.id));
}

/** Every write the room makes ends here, inside its transaction. */
export async function bumpVersion(q: Queryable, id: number): Promise<void> {
  await q.query("UPDATE `live_sessions` SET `version` = `version` + 1 WHERE `id` = ?", [id]);
}

export async function writeState(q: Queryable, id: number, state: string): Promise<void> {
  await q.query("UPDATE `live_sessions` SET `state` = ? WHERE `id` = ?", [state, id]);
}

export async function writeHosts(q: Queryable, id: number, facilitatorNo: number, secretaryNo: number | null): Promise<void> {
  await q.query(
    "UPDATE `live_sessions` SET `facilitator_no` = ?, `secretary_no` = ? WHERE `id` = ?",
    [facilitatorNo, secretaryNo, id],
  );
}

/** The close: status, the spread and the minutes, in one statement. */
export async function writeClosed(
  q: Queryable,
  id: number,
  row: { state: string; summary: string; minutesPeople: string; minutesShareable: string; closedAt: Date },
): Promise<void> {
  await q.query(
    "UPDATE `live_sessions` SET `status` = 'closed', `state` = ?, `summary` = ?, `minutes_people` = ?, " +
      "`minutes_shareable` = ?, `closed_at` = ? WHERE `id` = ? AND `status` = 'open'",
    [row.state, row.summary, row.minutesPeople, row.minutesShareable, row.closedAt, id],
  );
}

/** Rebuilt minutes, after an erasure changed what a closed record may say. */
export async function writeMinutes(q: Queryable, id: number, minutesPeople: string, minutesShareable: string): Promise<void> {
  await q.query(
    "UPDATE `live_sessions` SET `minutes_people` = ?, `minutes_shareable` = ?, `version` = `version` + 1 WHERE `id` = ?",
    [minutesPeople, minutesShareable, id],
  );
}

// ── live_session_people ─────────────────────────────────────────────────────

const PEOPLE_COLUMNS = "`member_no`, `joined_at`, `last_seen_at`, `arrival_score`, `arrival_wish`";

export async function peopleRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${PEOPLE_COLUMNS} FROM \`live_session_people\` WHERE \`session_id\` = ? ORDER BY \`joined_at\`, \`member_no\``, [sessionId]);
}

export async function personRow(q: Queryable, sessionId: number, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${PEOPLE_COLUMNS} FROM \`live_session_people\` WHERE \`session_id\` = ? AND \`member_no\` = ? LIMIT 1`, [sessionId, no]);
}

export async function insertPerson(q: Queryable, sessionId: number, no: number, now: Date): Promise<void> {
  await q.query(
    "INSERT IGNORE INTO `live_session_people` (`session_id`, `member_no`, `joined_at`, `last_seen_at`) VALUES (?, ?, ?, ?)",
    [sessionId, no, now, now],
  );
}

/** Presence. Changes nothing anybody else reads in a version, so it bumps nothing. */
export async function touchPerson(q: Queryable, sessionId: number, no: number, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_people` SET `last_seen_at` = ? WHERE `session_id` = ? AND `member_no` = ?",
    [now, sessionId, no],
  );
  return Number(r.affectedRows ?? 0);
}

export async function writeArrival(q: Queryable, sessionId: number, no: number, score: number, wish: string | null, now: Date): Promise<void> {
  await q.query(
    "UPDATE `live_session_people` SET `arrival_score` = ?, `arrival_wish` = ?, `last_seen_at` = ? WHERE `session_id` = ? AND `member_no` = ?",
    [score, wish, now, sessionId, no],
  );
}

/** At close, for everybody in the room: the words and the numbers go. */
export async function eraseArrivals(q: Queryable, sessionId: number): Promise<void> {
  await q.query("UPDATE `live_session_people` SET `arrival_score` = NULL, `arrival_wish` = NULL WHERE `session_id` = ?", [sessionId]);
}

export async function countPeople(q: Queryable, sessionId: number): Promise<number> {
  const rows = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_people` WHERE `session_id` = ?", [sessionId]);
  return Number(rows[0]?.n ?? 0);
}

/** How many people each session holds. */
export async function peopleCountRows(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(
    q,
    "SELECT `session_id`, COUNT(*) AS `n` FROM `live_session_people` WHERE `session_id` IN (?) GROUP BY `session_id`",
    [sessionIds],
  );
}

/** Which of these sessions this member is in. */
export async function joinedRows(q: Queryable, no: number, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `session_id` FROM `live_session_people` WHERE `member_no` = ? AND `session_id` IN (?)", [no, sessionIds]);
}

// ── live_session_items ──────────────────────────────────────────────────────

const ITEM_COLUMNS =
  "`id`, `session_id`, `title`, `aim`, `minutes`, `position`, `status`, `added_by_no`, `presenter_no`, " +
  "`started_at`, `ended_at`, `used_seconds`, `from_session_id`";

export async function itemRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${ITEM_COLUMNS} FROM \`live_session_items\` WHERE \`session_id\` = ? ORDER BY \`position\`, \`id\``, [sessionId]);
}

export async function insertItem(
  q: Queryable,
  row: { sessionId: number; title: string; aim: string; minutes: number; position: number; addedByNo: number; fromSessionId: number | null; now: Date },
): Promise<number> {
  return insertIdOf(
    q,
    "INSERT INTO `live_session_items` (`session_id`, `title`, `aim`, `minutes`, `position`, `status`, `added_by_no`, " +
      "`presenter_no`, `used_seconds`, `from_session_id`, `created_at`) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?, 0, ?, ?)",
    [row.sessionId, row.title, row.aim, row.minutes, row.position, row.addedByNo, row.addedByNo, row.fromSessionId, row.now],
  );
}

/** Title, aim, minutes and presenter: what the words of an item are. */
export async function writeItemWords(
  q: Queryable,
  id: number,
  row: { title: string; aim: string; minutes: number; presenterNo: number | null },
): Promise<void> {
  await q.query(
    "UPDATE `live_session_items` SET `title` = ?, `aim` = ?, `minutes` = ?, `presenter_no` = ? WHERE `id` = ?",
    [row.title, row.aim, row.minutes, row.presenterNo, id],
  );
}

export async function writeItemPosition(q: Queryable, id: number, position: number): Promise<void> {
  await q.query("UPDATE `live_session_items` SET `position` = ? WHERE `id` = ?", [position, id]);
}

/** An item stops being the active one: its clock adds up and it takes its new status. */
export async function finishItemClock(q: Queryable, id: number, status: string, usedSeconds: number, now: Date): Promise<void> {
  await q.query(
    "UPDATE `live_session_items` SET `status` = ?, `used_seconds` = ?, `ended_at` = ? WHERE `id` = ?",
    [status, usedSeconds, now, id],
  );
}

/** An item becomes the active one. */
export async function startItemClock(q: Queryable, id: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_items` SET `status` = 'active', `started_at` = ?, `ended_at` = NULL WHERE `id` = ?", [now, id]);
}

/** An item that is not the active one changes status. */
export async function writeItemStatus(q: Queryable, id: number, status: string): Promise<void> {
  await q.query("UPDATE `live_session_items` SET `status` = ? WHERE `id` = ?", [status, id]);
}

// ── live_session_entries ────────────────────────────────────────────────────

/** `due_on` as text, so no zone ever moves a date by a day. */
const ENTRY_COLUMNS =
  "`id`, `session_id`, `item_id`, `kind`, `text`, `status`, `author_no`, `owner_no`, `owner_seat_id`, " +
  "DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `claimed_at`, `created_at`";

export async function entryRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${ENTRY_COLUMNS} FROM \`live_session_entries\` WHERE \`session_id\` = ? ORDER BY \`id\``, [sessionId]);
}

export async function entryRow(q: Queryable, sessionId: number, id: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${ENTRY_COLUMNS} FROM \`live_session_entries\` WHERE \`session_id\` = ? AND \`id\` = ? LIMIT 1`, [sessionId, id]);
}

/** How many entries the session holds, and how many of them this member wrote. */
export async function entryCounts(q: Queryable, sessionId: number, authorNo: number): Promise<{ all: number; mine: number }> {
  const rows = await rowsOf(
    q,
    "SELECT COUNT(*) AS `all_n`, COALESCE(SUM(`author_no` = ?), 0) AS `mine_n` FROM `live_session_entries` WHERE `session_id` = ?",
    [authorNo, sessionId],
  );
  return { all: Number(rows[0]?.all_n ?? 0), mine: Number(rows[0]?.mine_n ?? 0) };
}

export async function insertEntry(
  q: Queryable,
  row: {
    sessionId: number;
    itemId: number | null;
    kind: string;
    text: string;
    authorNo: number;
    ownerSeatId: string | null;
    dueOn: string | null;
    now: Date;
  },
): Promise<number> {
  return insertIdOf(
    q,
    "INSERT INTO `live_session_entries` (`session_id`, `item_id`, `kind`, `text`, `status`, `author_no`, `owner_no`, " +
      "`owner_seat_id`, `due_on`, `claimed_at`, `created_at`) VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, ?, NULL, ?)",
    [row.sessionId, row.itemId, row.kind, row.text, row.authorNo, row.ownerSeatId, row.dueOn, row.now],
  );
}

/** Every field a patch can move, written whole from the row the lib already merged. */
export async function writeEntry(
  q: Queryable,
  id: number,
  row: { text: string; status: string; ownerNo: number | null; ownerSeatId: string | null; dueOn: string | null; claimedAt: Date | null },
): Promise<void> {
  await q.query(
    "UPDATE `live_session_entries` SET `text` = ?, `status` = ?, `owner_no` = ?, `owner_seat_id` = ?, `due_on` = ?, " +
      "`claimed_at` = ? WHERE `id` = ?",
    [row.text, row.status, row.ownerNo, row.ownerSeatId, row.dueOn, row.claimedAt, id],
  );
}

/** A quiet room's actions that nobody holds go to the backlog before it closes. */
export async function parkEntries(q: Queryable, sessionId: number, ids: readonly number[]): Promise<void> {
  if (none(ids)) return;
  await q.query("UPDATE `live_session_entries` SET `status` = 'parked' WHERE `session_id` = ? AND `id` IN (?)", [sessionId, ids]);
}

export async function deleteEntryRow(q: Queryable, id: number): Promise<void> {
  await q.query("DELETE FROM `live_session_entries` WHERE `id` = ?", [id]);
}

// ── live_session_responses ──────────────────────────────────────────────────

/**
 * Every answer except feedback on the facilitation. Those are read only
 * through `facilitationRows`, which names no person.
 */
export async function responseRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `target`, `member_no`, `value`, `text` FROM `live_session_responses` " +
      "WHERE `session_id` = ? AND `target` <> 'facilitation' ORDER BY `id`",
    [sessionId],
  );
}

/** Feedback on the facilitation, with no column that names a person. */
export async function facilitationRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `value`, `text` FROM `live_session_responses` WHERE `session_id` = ? AND `target` = 'facilitation' " +
      "ORDER BY `value`, `text`",
    [sessionId],
  );
}

/** One answer per person per target. Answering again replaces the answer. */
export async function upsertResponse(
  q: Queryable,
  row: { sessionId: number; target: string; memberNo: number; value: string; text: string | null; now: Date },
): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_responses` (`session_id`, `target`, `member_no`, `value`, `text`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `text` = VALUES(`text`), " +
      "`updated_at` = VALUES(`updated_at`)",
    [row.sessionId, row.target, row.memberNo, row.value, row.text, row.now, row.now],
  );
}

export async function deleteResponsesForTargets(q: Queryable, sessionId: number, targets: readonly string[]): Promise<void> {
  if (none(targets)) return;
  await q.query("DELETE FROM `live_session_responses` WHERE `session_id` = ? AND `target` IN (?)", [sessionId, targets]);
}

// ── One member, across every session: the export and the erasure ──────────

/** The sessions this member was in, with when they joined. */
export async function memberSessionRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `s`.`id`, `s`.`title`, `s`.`circle_id`, `s`.`status`, `s`.`facilitator_no`, `s`.`secretary_no`, `s`.`created_at`, " +
      "`s`.`closed_at`, `p`.`joined_at`, `p`.`arrival_score`, `p`.`arrival_wish` FROM `live_session_people` `p` " +
      "JOIN `live_sessions` `s` ON `s`.`id` = `p`.`session_id` WHERE `p`.`member_no` = ? ORDER BY `s`.`created_at`, `s`.`id`",
    [no],
  );
}

/** The entries this member wrote, and the ones they hold. */
export async function memberEntryRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${ENTRY_COLUMNS} FROM \`live_session_entries\` WHERE \`author_no\` = ? OR \`owner_no\` = ? ORDER BY \`id\``,
    [no, no],
  );
}

/** The agenda items this member added, and the ones they present. */
export async function memberItemRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT ${ITEM_COLUMNS}, \`created_at\` FROM \`live_session_items\` WHERE \`added_by_no\` = ? OR \`presenter_no\` = ? ORDER BY \`id\``,
    [no, no],
  );
}

/** This member's own answers, feedback on the facilitation included: it is theirs. */
export async function memberResponseRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `session_id`, `target`, `value`, `text`, `updated_at` FROM `live_session_responses` WHERE `member_no` = ? ORDER BY `id`",
    [no],
  );
}

/** Every session that names this member anywhere, so the erasure knows what to rebuild. */
export async function sessionIdsNaming(q: Queryable, no: number): Promise<number[]> {
  const rows = await rowsOf(
    q,
    "SELECT `session_id` AS `id` FROM `live_session_people` WHERE `member_no` = ? " +
      "UNION SELECT `session_id` FROM `live_session_entries` WHERE `author_no` = ? OR `owner_no` = ? " +
      "UNION SELECT `session_id` FROM `live_session_responses` WHERE `member_no` = ? " +
      "UNION SELECT `session_id` FROM `live_session_items` WHERE `added_by_no` = ? OR `presenter_no` = ? " +
      "UNION SELECT `id` FROM `live_sessions` WHERE `facilitator_no` = ? OR `secretary_no` = ? OR `created_by_no` = ?",
    [no, no, no, no, no, no, no, no, no],
  );
  return rows.map((r) => Number(r.id));
}

/** The ids of the entries this member wrote. */
export async function authoredEntryIds(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `id`, `session_id`, `kind` FROM `live_session_entries` WHERE `author_no` = ?", [no]);
}

/**
 * The member leaves every room. One function so the erasure's writes read as
 * one list: people rows and answers deleted, written entries deleted, held
 * actions released, and every place they were named as a host or an adder
 * set to the departed number.
 */
export async function forgetMemberRows(q: Queryable, no: number, entryIds: readonly number[]): Promise<void> {
  await q.query("DELETE FROM `live_session_people` WHERE `member_no` = ?", [no]);
  await q.query("DELETE FROM `live_session_responses` WHERE `member_no` = ?", [no]);
  if (!none(entryIds)) await q.query("DELETE FROM `live_session_entries` WHERE `id` IN (?)", [entryIds]);
  await q.query("UPDATE `live_session_entries` SET `owner_no` = NULL, `claimed_at` = NULL WHERE `owner_no` = ?", [no]);
  await q.query("UPDATE `live_session_items` SET `added_by_no` = 0 WHERE `added_by_no` = ?", [no]);
  await q.query("UPDATE `live_session_items` SET `presenter_no` = NULL WHERE `presenter_no` = ?", [no]);
  await q.query("UPDATE `live_sessions` SET `facilitator_no` = 0 WHERE `facilitator_no` = ?", [no]);
  await q.query("UPDATE `live_sessions` SET `secretary_no` = NULL WHERE `secretary_no` = ?", [no]);
  await q.query("UPDATE `live_sessions` SET `created_by_no` = 0 WHERE `created_by_no` = ?", [no]);
}
