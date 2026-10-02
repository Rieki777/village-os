/**
 * The journal's four tables (0227): `journal_entries`, `journal_pulse`,
 * `journal_feedback_prefs` and `journal_feedback`. Every statement
 * `server/lib/journal.ts` runs against them, one function each.
 *
 * ── WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT ─────────────────────
 *
 * Each function hands back exactly what the driver handed back: the rows, or
 * the result header for a write. The mapping into the shapes in
 * shared/journal.ts, the clipping, the floor, the week arithmetic and every
 * refusal stay in the lib beside the rules they keep. Same split as
 * server/repos/villageNeeds.ts, for the same reason: a repo that mapped would
 * be a second opinion about a row's shape.
 *
 * ── THE PRIVACY PROMISE IS ENUMERABLE HERE ───────────────────────────────
 *
 * Every read that returns an entry takes the user id it filters on, and the
 * only caller passes the id off the signed-in member's own token. There is no
 * read of `journal_entries` without a `user_id = ?` in it.
 *
 * `pulseAggregateRows` names no `user_id` in its column list, so a caller who
 * wanted a person would have to write new SQL to get one.
 *
 * `receivedFeedbackRows` does not name `author_id` in its column list, and
 * the export reads received feedback through it too. That is the structural
 * half of "received feedback
 * carries no author at any depth": the column never leaves the database on
 * that road, so no mapper downstream can forget to strip it.
 *
 * ── NO CACHE SITS ABOVE THESE TABLES ─────────────────────────────────────
 *
 * Every read goes to the database when asked, so a raw write in a test is
 * seen by the next read without a reload.
 *
 * ── TRANSACTIONS ARE OPENED HERE ─────────────────────────────────────────
 *
 * `inTransaction` hands the lib one connection inside one transaction, and
 * every function the lib composes inside it takes a `Queryable`, so a pool
 * and that connection are interchangeable. The lib still owns no connection.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { lostConcurrencyRace } from "../db/concurrency";

/** A pool, or the one connection a transaction runs on. */
export type Queryable = Pool | PoolConnection;

/** How many times a transaction that lost a race is run again, in all. */
const RACE_ATTEMPTS = 3;

/**
 * Run `work` on one connection inside one transaction: commit when it
 * returns, roll back when it throws.
 *
 * A LOST RACE RUNS THE WHOLE TRANSACTION AGAIN (`lostConcurrencyRace`: a
 * deadlock, a lock wait timeout, MariaDB's snapshot conflict), so every read
 * decides again against the world as it is now. Two devices saving a pulse
 * for the same week meet here, and the loser retries instead of answering
 * 500. Anything else is rethrown after the rollback.
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

const ENTRY_COLUMNS =
  "`id`, `client_id`, `practice`, `depth`, `answers`, `scores`, `written_at`, `local_hour`, " +
  "`privacy`, `meta`, `reflection`, `confirmed`, `created_at`, `updated_at`";

/**
 * The author's view, from `journal_feedback` AS `f` joined to the recipient's
 * prefs AS `p` (`PREFS_JOIN`). The recipient's current yes or no, and when it
 * last changed, are what tell the author a message is being held.
 */
const SENT_COLUMNS =
  "`f`.`id`, `f`.`recipient_id`, `f`.`observation`, `f`.`feeling`, `f`.`need`, `f`.`request`, `f`.`message`, " +
  "`f`.`status`, `f`.`deliver_after`, `f`.`created_at`, " +
  "`p`.`open` AS `recipient_open`, `p`.`updated_at` AS `recipient_answered_at`";

/** The recipient's prefs beside each message. LEFT: no row means they never said yes. */
const PREFS_JOIN = "LEFT JOIN `journal_feedback_prefs` `p` ON `p`.`user_id` = `f`.`recipient_id`";

/**
 * A message its recipient can read now. ONE PLACEHOLDER: now, from Node's
 * clock. Queued, its Monday has come, and the recipient's answer covers it:
 * they are open, or its Monday came before they last said no.
 *
 * A NO HOLDS, IT NEVER DESTROYS. Saying no stops anything not yet arrived
 * from arriving; saying yes again lets it through. What arrived while they
 * were open stays theirs. The same predicate decides what the recipient
 * reads, what they may answer, what the author may still take back, and what
 * an author's erasure deletes instead of keeping, so those four can never
 * disagree about whether a message was seen.
 */
const VISIBLE_TO_RECIPIENT =
  "(`f`.`status` = 'queued' AND `f`.`deliver_after` <= ? AND `p`.`user_id` IS NOT NULL " +
  "AND (`p`.`open` = 1 OR `f`.`deliver_after` <= `p`.`updated_at`))";

/** Not readable by its recipient now, NULLs included (one placeholder: now). */
const NOT_VISIBLE_TO_RECIPIENT = `COALESCE(${VISIBLE_TO_RECIPIENT}, 0) = 0`;

/**
 * The author id a delivered message keeps once its author has left. No member
 * id is empty, so no author's sent list and no weekly cap count can match it.
 */
export const DEPARTED_AUTHOR_ID = "";

// ── journal_entries ─────────────────────────────────────────────────────────

/**
 * One save. A retry with the same (user, client id) matches the unique key and
 * changes nothing, which is what makes an offline retry a no-op.
 *
 * DO NOT READ `affectedRows` TO TELL A FRESH ROW FROM A RETRY. The driver
 * connects with CLIENT_FOUND_ROWS, under which a duplicate set to its own
 * values reports 1, the same as an insert (measured: the lib's late-retry
 * test goes red on exactly that reading). The caller compares the id it
 * minted with the id the row carries.
 */
export async function insertEntryRow(
  pool: Queryable,
  row: {
    id: string;
    userId: string;
    clientId: string;
    practice: string;
    depth: string;
    answers: string;
    scores: string | null;
    writtenAt: Date;
    localHour: number | null;
    privacy: string;
    meta: string | null;
    reflection: string | null;
    confirmed: 0 | 1;
  },
): Promise<any> {
  const [r] = await pool.query<any>(
    "INSERT INTO `journal_entries` " +
      "(`id`, `user_id`, `client_id`, `practice`, `depth`, `answers`, `scores`, `written_at`, `local_hour`, " +
      "`privacy`, `meta`, `reflection`, `confirmed`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `id` = `id`",
    [
      row.id,
      row.userId,
      row.clientId,
      row.practice,
      row.depth,
      row.answers,
      row.scores,
      row.writtenAt,
      row.localHour,
      row.privacy,
      row.meta,
      row.reflection,
      row.confirmed,
    ],
  );
  return r;
}

/** The row one (user, client id) names. At most one row. */
export async function entryRowByClientId(pool: Queryable, userId: string, clientId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ENTRY_COLUMNS} FROM \`journal_entries\` WHERE \`user_id\` = ? AND \`client_id\` = ? LIMIT 1`,
    [userId, clientId],
  );
  return rows;
}

/** One of this member's entries by id. Another member's id finds nothing. */
export async function entryRowById(pool: Queryable, userId: string, id: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ENTRY_COLUMNS} FROM \`journal_entries\` WHERE \`user_id\` = ? AND \`id\` = ? LIMIT 1`,
    [userId, id],
  );
  return rows;
}

/**
 * This member's entries, newest first, in (written_at, id) order. `before` is
 * a cursor: with an id it pages strictly after that exact row in this order,
 * so two entries written in the same second on a page boundary are both seen;
 * without one it pages strictly before the instant. A practice narrows to one
 * kind. `limit` is already clamped by the caller.
 */
export async function entryRowsForUser(
  pool: Pool,
  userId: string,
  opts: { limit: number; before: { at: Date; id: string | null } | null; practice: string | null },
): Promise<RowDataPacket[]> {
  const where = ["`user_id` = ?"];
  const params: unknown[] = [userId];
  if (opts.before && opts.before.id) {
    where.push("(`written_at` < ? OR (`written_at` = ? AND `id` < ?))");
    params.push(opts.before.at, opts.before.at, opts.before.id);
  } else if (opts.before) {
    where.push("`written_at` < ?");
    params.push(opts.before.at);
  }
  if (opts.practice) {
    where.push("`practice` = ?");
    params.push(opts.practice);
  }
  params.push(opts.limit);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ENTRY_COLUMNS} FROM \`journal_entries\` WHERE ${where.join(" AND ")} ` +
      "ORDER BY `written_at` DESC, `id` DESC LIMIT ?",
    params,
  );
  return rows;
}

/** Every entry this member wrote, oldest first, for an export. */
export async function allEntryRowsForUser(pool: Pool, userId: string, practice: string | null): Promise<RowDataPacket[]> {
  const params: unknown[] = [userId];
  let extra = "";
  if (practice) {
    extra = " AND `practice` = ?";
    params.push(practice);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ENTRY_COLUMNS} FROM \`journal_entries\` WHERE \`user_id\` = ?${extra} ORDER BY \`written_at\`, \`id\``,
    params,
  );
  return rows;
}

/**
 * Edit one of this member's entries. Only the fields the caller names are
 * written; `user_id` is in the WHERE, so another member's id changes nothing.
 */
export async function updateEntryRow(
  pool: Pool,
  userId: string,
  id: string,
  set: { answers?: string; reflection?: string | null; confirmed?: 0 | 1; privacy?: string },
): Promise<any> {
  const cols: string[] = [];
  const params: unknown[] = [];
  if (set.answers !== undefined) {
    cols.push("`answers` = ?");
    params.push(set.answers);
  }
  if (set.reflection !== undefined) {
    cols.push("`reflection` = ?");
    params.push(set.reflection);
  }
  if (set.confirmed !== undefined) {
    cols.push("`confirmed` = ?");
    params.push(set.confirmed);
  }
  if (set.privacy !== undefined) {
    cols.push("`privacy` = ?");
    params.push(set.privacy);
  }
  if (cols.length === 0) return { affectedRows: 0 };
  params.push(userId, id);
  const [r] = await pool.query<any>(
    `UPDATE \`journal_entries\` SET ${cols.join(", ")} WHERE \`user_id\` = ? AND \`id\` = ?`,
    params,
  );
  return r;
}

/**
 * A newer version of the same sitting, sent again under the client id the row
 * already carries: every column the save writes, replaced. `privacy` is left
 * alone, because only an edit sets it. `user_id` is in the WHERE.
 */
export async function rewriteEntryRow(
  db: Queryable,
  userId: string,
  id: string,
  row: {
    practice: string;
    depth: string;
    answers: string;
    scores: string | null;
    writtenAt: Date;
    localHour: number | null;
    meta: string | null;
    reflection: string | null;
    confirmed: 0 | 1;
  },
): Promise<any> {
  const [r] = await db.query<any>(
    "UPDATE `journal_entries` SET `practice` = ?, `depth` = ?, `answers` = ?, `scores` = ?, `written_at` = ?, " +
      "`local_hour` = ?, `meta` = ?, `reflection` = ?, `confirmed` = ? WHERE `user_id` = ? AND `id` = ?",
    [
      row.practice,
      row.depth,
      row.answers,
      row.scores,
      row.writtenAt,
      row.localHour,
      row.meta,
      row.reflection,
      row.confirmed,
      userId,
      id,
    ],
  );
  return r;
}

/** Forget one entry. The result header. */
export async function deleteEntryRow(pool: Queryable, userId: string, id: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `journal_entries` WHERE `user_id` = ? AND `id` = ?", [userId, id]);
  return r;
}

/**
 * Every pulse entry this member still has, with the scores it carried, for
 * giving a week back the answer an entry that is going away had replaced. A
 * member writes about one a week, so this is a short read.
 */
export async function pulseEntryRowsForUser(db: Queryable, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `scores`, `written_at`, `created_at` FROM `journal_entries` " +
      "WHERE `user_id` = ? AND `practice` = 'pulse' AND `scores` IS NOT NULL",
    [userId],
  );
  return rows;
}

// ── journal_pulse ───────────────────────────────────────────────────────────

/**
 * One number, written. WHETHER it should be written is the caller's question,
 * answered under `pulseHoldersForWeek`'s lock: the newest-WRITTEN answer in a
 * week is the one that stands, never the one that arrived last.
 */
export async function upsertPulseRow(
  pool: Queryable,
  row: { id: string; userId: string; entryId: string; weekId: string; metric: string; value: number },
): Promise<void> {
  await pool.query(
    "INSERT INTO `journal_pulse` (`id`, `user_id`, `entry_id`, `week_id`, `metric`, `value`) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `entry_id` = VALUES(`entry_id`)",
    [row.id, row.userId, row.entryId, row.weekId, row.metric, row.value],
  );
}

/**
 * This member's numbers for one week, each with the instant its entry was
 * written, LOCKED until the transaction ends. `holder_written_at` is null for
 * a number whose entry is gone, which any answer may replace.
 *
 * The lock is what makes "is my entry newer than the one holding this
 * number?" a fact at the moment of the write. Two saves for the same week
 * either queue on the rows or deadlock on the gap, and `inTransaction` runs
 * the loser again.
 */
export async function pulseHoldersForWeek(db: Queryable, userId: string, weekId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `p`.`metric` AS `metric`, `p`.`entry_id` AS `entry_id`, `e`.`written_at` AS `holder_written_at` " +
      "FROM `journal_pulse` `p` LEFT JOIN `journal_entries` `e` ON `e`.`user_id` = `p`.`user_id` AND `e`.`id` = `p`.`entry_id` " +
      "WHERE `p`.`user_id` = ? AND `p`.`week_id` = ? FOR UPDATE",
    [userId, weekId],
  );
  return rows;
}

/** The (week, metric) pairs one entry's numbers hold, locked, before they go. */
export async function pulseRowsForEntry(db: Queryable, userId: string, entryId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `week_id`, `metric` FROM `journal_pulse` WHERE `user_id` = ? AND `entry_id` = ? FOR UPDATE",
    [userId, entryId],
  );
  return rows;
}

/** The numbers one entry carried, gone with it. */
export async function deletePulseRowsForEntry(pool: Queryable, userId: string, entryId: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `journal_pulse` WHERE `user_id` = ? AND `entry_id` = ?", [
    userId,
    entryId,
  ]);
  return r;
}

/** This member's own numbers, newest week first. */
export async function pulseRowsForUser(pool: Pool, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `week_id`, `metric`, `value`, `recorded_at` FROM `journal_pulse` WHERE `user_id` = ? " +
      "ORDER BY `week_id` DESC, `metric`",
    [userId],
  );
  return rows;
}

/**
 * Per week and metric: how many members answered, and their mean. COUNTS AND
 * MEANS ONLY: the column list names no `user_id`. The unique key makes
 * COUNT(*) a count of distinct members.
 */
export async function pulseAggregateRows(pool: Pool, sinceWeekId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `week_id` AS week_id, `metric` AS metric, COUNT(*) AS n, AVG(`value`) AS mean " +
      "FROM `journal_pulse` WHERE `week_id` >= ? GROUP BY `week_id`, `metric` ORDER BY `week_id` DESC",
    [sinceWeekId],
  );
  return rows;
}

// ── journal_feedback_prefs ──────────────────────────────────────────────────

export async function prefsRow(pool: Pool, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `open`, `style`, `note` FROM `journal_feedback_prefs` WHERE `user_id` = ? LIMIT 1",
    [userId],
  );
  return rows;
}

/**
 * A member's yes or no, their style and their note.
 *
 * `updated_at` IS WHEN THE YES OR NO LAST CHANGED, on Node's clock, and moves
 * on nothing else. Delivery reads it: while the answer is no, a message whose
 * Monday came after it is held (see `VISIBLE_TO_RECIPIENT`). Were it to move
 * on a new note, rewriting a note while closed would let through everything
 * queued before the no. It is assigned FIRST, because MySQL and MariaDB apply
 * these assignments left to right and the comparison needs the old `open`;
 * and it is assigned at all, even to itself, so the column's own ON UPDATE
 * never fires.
 */
export async function upsertPrefsRow(
  pool: Pool,
  row: { userId: string; open: 0 | 1; style: string; note: string; answeredAt: Date },
): Promise<void> {
  await pool.query(
    "INSERT INTO `journal_feedback_prefs` (`user_id`, `open`, `style`, `note`, `updated_at`) VALUES (?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `updated_at` = IF(`open` <> VALUES(`open`), VALUES(`updated_at`), `updated_at`), " +
      "`open` = VALUES(`open`), `style` = VALUES(`style`), `note` = VALUES(`note`)",
    [row.userId, row.open, row.style, row.note, row.answeredAt],
  );
}

/** Everyone who said yes, except the asker. */
export async function openPrefsRows(pool: Pool, exceptUserId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `user_id`, `style`, `note` FROM `journal_feedback_prefs` WHERE `open` = 1 AND `user_id` <> ?",
    [exceptUserId],
  );
  return rows;
}

// ── journal_feedback ────────────────────────────────────────────────────────

/**
 * Queue one message, ONLY while this author has fewer than `cap` queued to
 * this recipient that were queued since `weekStart` OR land in this message's
 * own Monday batch or later.
 *
 * WHY BOTH. The week a message is queued in and the Monday it lands on are
 * different weeks near a boundary: late Sunday and just after midnight are two
 * ISO weeks and one batch, so a count on the queue week alone let a recipient
 * open two messages from one author in the same Monday. A batch never goes
 * backwards (`feedbackDeliverAfter` gives a later queue the same Monday or a
 * later one), so `deliver_after >= this batch` means "already in this batch",
 * with no millisecond match between two timestamps.
 *
 * The count and the insert are one statement, so the cap is the database's
 * answer at the moment of the write and never a read taken a few awaits
 * earlier. The header's `affectedRows` is 0 when the cap refused it.
 */
export async function insertQueuedFeedbackUnderCap(
  pool: Pool,
  row: {
    id: string;
    authorId: string;
    recipientId: string;
    observation: string;
    feeling: string;
    need: string;
    request: string;
    message: string;
    deliverAfter: Date;
    /** Node's clock, never the database's: the cap compares it with `weekStart`, which is Node's too. */
    createdAt: Date;
  },
  weekStart: Date,
  cap: number,
): Promise<any> {
  const [r] = await pool.query<any>(
    "INSERT INTO `journal_feedback` " +
      "(`id`, `author_id`, `recipient_id`, `observation`, `feeling`, `need`, `request`, `message`, `status`, " +
      "`deliver_after`, `created_at`) " +
      "SELECT ?,?,?,?,?,?,?,?,'queued',?,? FROM DUAL WHERE (" +
      "SELECT COUNT(*) FROM `journal_feedback` WHERE `author_id` = ? AND `recipient_id` = ? " +
      "AND `status` = 'queued' AND (`created_at` >= ? OR `deliver_after` >= ?)) < ?",
    [
      row.id,
      row.authorId,
      row.recipientId,
      row.observation,
      row.feeling,
      row.need,
      row.request,
      row.message,
      row.deliverAfter,
      row.createdAt,
      row.authorId,
      row.recipientId,
      weekStart,
      row.deliverAfter,
      cap,
    ],
  );
  return r;
}

/** One message as its author sees it. Another member's id finds nothing. */
export async function sentFeedbackRowById(pool: Pool, authorId: string, id: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SENT_COLUMNS} FROM \`journal_feedback\` \`f\` ${PREFS_JOIN} ` +
      "WHERE `f`.`author_id` = ? AND `f`.`id` = ? LIMIT 1",
    [authorId, id],
  );
  return rows;
}

/** Everything this author wrote, newest first. */
export async function sentFeedbackRows(pool: Pool, authorId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SENT_COLUMNS} FROM \`journal_feedback\` \`f\` ${PREFS_JOIN} ` +
      "WHERE `f`.`author_id` = ? ORDER BY `f`.`created_at` DESC, `f`.`id`",
    [authorId],
  );
  return rows;
}

/**
 * Take a message back, but only while its recipient cannot read it: before
 * its Monday, or held by their no. The visibility test is in the WHERE, so a
 * withdraw that races the batch either lands before it or changes nothing.
 */
export async function withdrawFeedbackRow(pool: Pool, authorId: string, id: string, now: Date): Promise<any> {
  const [r] = await pool.query<any>(
    `UPDATE \`journal_feedback\` \`f\` ${PREFS_JOIN} SET \`f\`.\`status\` = 'withdrawn' ` +
      `WHERE \`f\`.\`author_id\` = ? AND \`f\`.\`id\` = ? AND \`f\`.\`status\` = 'queued' AND ${NOT_VISIBLE_TO_RECIPIENT}`,
    [authorId, id, now],
  );
  return r;
}

/**
 * What a recipient may read: `VISIBLE_TO_RECIPIENT`. The column list names no
 * `author_id`, on purpose. See the header.
 */
export async function receivedFeedbackRows(pool: Pool, recipientId: string, now: Date): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `f`.`id`, `f`.`message`, `f`.`deliver_after`, `f`.`response` " +
      `FROM \`journal_feedback\` \`f\` ${PREFS_JOIN} ` +
      `WHERE \`f\`.\`recipient_id\` = ? AND ${VISIBLE_TO_RECIPIENT} ` +
      "ORDER BY `f`.`deliver_after` DESC, `f`.`id`",
    [recipientId, now],
  );
  return rows;
}

/** The recipient's answer, on a message they can actually read. */
export async function respondFeedbackRow(
  pool: Pool,
  recipientId: string,
  id: string,
  response: string,
  now: Date,
): Promise<any> {
  const [r] = await pool.query<any>(
    `UPDATE \`journal_feedback\` \`f\` ${PREFS_JOIN} SET \`f\`.\`response\` = ? ` +
      `WHERE \`f\`.\`recipient_id\` = ? AND \`f\`.\`id\` = ? AND ${VISIBLE_TO_RECIPIENT}`,
    [response, recipientId, id, now],
  );
  return r;
}

// ── Grounding for the guide: the member's own data only ─────────────────────

/** Gratitude this member received since `since`: a count and a few messages. */
export async function gratitudeReceivedRows(pool: Pool, userId: string, since: Date): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `message`, `at` FROM `gratitude_log` WHERE `to_id` = ? AND `at` >= ? ORDER BY `at` DESC LIMIT 50",
    [userId, since],
  );
  return rows;
}

// ── Erasure ─────────────────────────────────────────────────────────────────

/**
 * No row in any of the four tables names this member afterwards, in one
 * transaction. Returns how many rows went or were unsigned, per table.
 *
 * FEEDBACK, BY DIRECTION AND BY WHETHER IT WAS SEEN:
 *   - what they RECEIVED is deleted: it is about them.
 *   - what they wrote that its recipient cannot read (withdrawn, still before
 *     its Monday, or held by the recipient's no) is deleted: nobody saw it,
 *     so its going reveals nothing.
 *   - what they wrote that its recipient CAN read stays with the recipient,
 *     with `author_id` set to `DEPARTED_AUTHOR_ID` and the four parts blanked.
 *     The approved message and the recipient's answer are the recipient's
 *     now. Deleting it would make it vanish at the moment its author became
 *     "a departed member", which names the author of an unsigned message.
 *
 * `now` is Node's clock, as in every other delivery comparison here.
 */
export async function deleteJournalForUser(
  pool: Pool,
  userId: string,
  now: Date,
): Promise<{ entries: number; pulse: number; prefs: number; feedback: number }> {
  return inTransaction(pool, async (conn) => {
    const [e] = await conn.query<any>("DELETE FROM `journal_entries` WHERE `user_id` = ?", [userId]);
    const [p] = await conn.query<any>("DELETE FROM `journal_pulse` WHERE `user_id` = ?", [userId]);
    const [f] = await conn.query<any>("DELETE FROM `journal_feedback_prefs` WHERE `user_id` = ?", [userId]);
    const [received] = await conn.query<any>("DELETE FROM `journal_feedback` WHERE `recipient_id` = ?", [userId]);
    const [unseen] = await conn.query<any>(
      `DELETE \`f\` FROM \`journal_feedback\` \`f\` ${PREFS_JOIN} WHERE \`f\`.\`author_id\` = ? AND ${NOT_VISIBLE_TO_RECIPIENT}`,
      [userId, now],
    );
    // Everything of theirs still here is a message its recipient can read.
    const [unsigned] = await conn.query<any>(
      "UPDATE `journal_feedback` SET `author_id` = ?, `observation` = '', `feeling` = '', `need` = '', `request` = '' " +
        "WHERE `author_id` = ?",
      [DEPARTED_AUTHOR_ID, userId],
    );
    return {
      entries: Number(e?.affectedRows ?? 0),
      pulse: Number(p?.affectedRows ?? 0),
      prefs: Number(f?.affectedRows ?? 0),
      feedback:
        Number(received?.affectedRows ?? 0) + Number(unseen?.affectedRows ?? 0) + Number(unsigned?.affectedRows ?? 0),
    };
  });
}
