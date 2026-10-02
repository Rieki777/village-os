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
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const ENTRY_COLUMNS =
  "`id`, `client_id`, `practice`, `depth`, `answers`, `scores`, `written_at`, `local_hour`, " +
  "`privacy`, `meta`, `reflection`, `confirmed`, `created_at`, `updated_at`";

const SENT_COLUMNS =
  "`id`, `recipient_id`, `observation`, `feeling`, `need`, `request`, `message`, `status`, " +
  "`deliver_after`, `created_at`";

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
  pool: Pool,
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
export async function entryRowByClientId(pool: Pool, userId: string, clientId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ENTRY_COLUMNS} FROM \`journal_entries\` WHERE \`user_id\` = ? AND \`client_id\` = ? LIMIT 1`,
    [userId, clientId],
  );
  return rows;
}

/** One of this member's entries by id. Another member's id finds nothing. */
export async function entryRowById(pool: Pool, userId: string, id: string): Promise<RowDataPacket[]> {
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

/** Forget one entry. The result header. */
export async function deleteEntryRow(pool: Pool, userId: string, id: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `journal_entries` WHERE `user_id` = ? AND `id` = ?", [userId, id]);
  return r;
}

// ── journal_pulse ───────────────────────────────────────────────────────────

/** One number. A second answer in the same week replaces the first. */
export async function upsertPulseRow(
  pool: Pool,
  row: { id: string; userId: string; entryId: string; weekId: string; metric: string; value: number },
): Promise<void> {
  await pool.query(
    "INSERT INTO `journal_pulse` (`id`, `user_id`, `entry_id`, `week_id`, `metric`, `value`) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `entry_id` = VALUES(`entry_id`)",
    [row.id, row.userId, row.entryId, row.weekId, row.metric, row.value],
  );
}

/** The numbers one entry carried, gone with it. */
export async function deletePulseRowsForEntry(pool: Pool, userId: string, entryId: string): Promise<any> {
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

export async function upsertPrefsRow(
  pool: Pool,
  row: { userId: string; open: 0 | 1; style: string; note: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO `journal_feedback_prefs` (`user_id`, `open`, `style`, `note`) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `open` = VALUES(`open`), `style` = VALUES(`style`), `note` = VALUES(`note`)",
    [row.userId, row.open, row.style, row.note],
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
 * Queue one message, ONLY while this author has queued fewer than `cap` to
 * this recipient since `weekStart`.
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
      "AND `status` = 'queued' AND `created_at` >= ?) < ?",
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
      cap,
    ],
  );
  return r;
}

/** One message as its author sees it. Another member's id finds nothing. */
export async function sentFeedbackRowById(pool: Pool, authorId: string, id: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SENT_COLUMNS} FROM \`journal_feedback\` WHERE \`author_id\` = ? AND \`id\` = ? LIMIT 1`,
    [authorId, id],
  );
  return rows;
}

/** Everything this author wrote, newest first. */
export async function sentFeedbackRows(pool: Pool, authorId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${SENT_COLUMNS} FROM \`journal_feedback\` WHERE \`author_id\` = ? ORDER BY \`created_at\` DESC, \`id\``,
    [authorId],
  );
  return rows;
}

/**
 * Take a message back, but only while it is still held. The delivery time is
 * in the WHERE, so a withdraw that races the batch either lands before it or
 * changes nothing.
 */
export async function withdrawFeedbackRow(pool: Pool, authorId: string, id: string, now: Date): Promise<any> {
  const [r] = await pool.query<any>(
    "UPDATE `journal_feedback` SET `status` = 'withdrawn' " +
      "WHERE `author_id` = ? AND `id` = ? AND `status` = 'queued' AND `deliver_after` > ?",
    [authorId, id, now],
  );
  return r;
}

/**
 * What a recipient may read: queued, and past its delivery time. The column
 * list names no `author_id`, on purpose. See the header.
 */
export async function receivedFeedbackRows(pool: Pool, recipientId: string, now: Date): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `message`, `deliver_after`, `response` FROM `journal_feedback` " +
      "WHERE `recipient_id` = ? AND `status` = 'queued' AND `deliver_after` <= ? " +
      "ORDER BY `deliver_after` DESC, `id`",
    [recipientId, now],
  );
  return rows;
}

/** The recipient's answer, on a message they have actually received. */
export async function respondFeedbackRow(
  pool: Pool,
  recipientId: string,
  id: string,
  response: string,
  now: Date,
): Promise<any> {
  const [r] = await pool.query<any>(
    "UPDATE `journal_feedback` SET `response` = ? " +
      "WHERE `recipient_id` = ? AND `id` = ? AND `status` = 'queued' AND `deliver_after` <= ?",
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
 * Every row in all four tables that names this member, in one transaction.
 * Feedback goes in both directions: what they wrote and what they received.
 * Returns how many rows went, per table.
 */
export async function deleteJournalForUser(
  pool: Pool,
  userId: string,
): Promise<{ entries: number; pulse: number; prefs: number; feedback: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [e] = await conn.query<any>("DELETE FROM `journal_entries` WHERE `user_id` = ?", [userId]);
    const [p] = await conn.query<any>("DELETE FROM `journal_pulse` WHERE `user_id` = ?", [userId]);
    const [f] = await conn.query<any>("DELETE FROM `journal_feedback_prefs` WHERE `user_id` = ?", [userId]);
    const [b] = await conn.query<any>(
      "DELETE FROM `journal_feedback` WHERE `author_id` = ? OR `recipient_id` = ?",
      [userId, userId],
    );
    await conn.commit();
    return {
      entries: Number(e?.affectedRows ?? 0),
      pulse: Number(p?.affectedRows ?? 0),
      prefs: Number(f?.affectedRows ?? 0),
      feedback: Number(b?.affectedRows ?? 0),
    };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
