/**
 * Meeting templates (0291): every statement server/lib/sessionTemplates.ts
 * runs against `live_session_templates`, `live_session_template_uses`,
 * `live_session_priorities` and `live_session_shares`, one function each.
 *
 * Each function hands back what the driver handed back. Mapping, rights and
 * refusals stay in the lib, the split server/repos/liveSessions.ts makes.
 * Every UPDATE sets `updated_at` where the table has one: no column has ON UPDATE.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const TEMPLATE_COLUMNS =
  "`id`, `name`, `category`, `summary`, `circle_id`, `duration_min`, `flow`, `position`, `status`, `feeds_from_id`, `seed_key`, `updated_at`";

// ── Templates ───────────────────────────────────────────────────────────────

export async function templateRows(q: Queryable): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${TEMPLATE_COLUMNS} FROM \`live_session_templates\` ORDER BY \`category\`, \`position\`, \`id\``);
}

export async function templateRow(q: Queryable, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${TEMPLATE_COLUMNS} FROM \`live_session_templates\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
}

export async function templateCount(q: Queryable): Promise<number> {
  const rows = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_templates`");
  return Number(rows[0]?.n ?? 0);
}

export async function seededCount(q: Queryable): Promise<number> {
  const rows = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_templates` WHERE `seed_key` IS NOT NULL");
  return Number(rows[0]?.n ?? 0);
}

/** A seed, written once: a second write of the same key is ignored. */
export async function insertSeed(
  q: Queryable,
  row: { seedKey: string; name: string; category: string; summary: string; durationMin: number | null; flow: string; position: number; now: Date },
): Promise<void> {
  await q.query(
    "INSERT IGNORE INTO `live_session_templates` (`name`, `category`, `summary`, `circle_id`, `duration_min`, `flow`, `position`, `status`, `feeds_from_id`, `seed_key`, `created_by_no`, `updated_by_no`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, NULL, ?, ?, ?, 'active', NULL, ?, 0, 0, ?, ?)",
    [row.name, row.category, row.summary, row.durationMin, row.flow, row.position, row.seedKey, row.now, row.now],
  );
}

/** A seed's id by its key. */
export async function seedIdRows(q: Queryable): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `id`, `seed_key`, `feeds_from_id` FROM `live_session_templates` WHERE `seed_key` IS NOT NULL");
}

/** Link a freshly seeded template to the one it feeds from, only while nobody has set it. */
export async function linkSeed(q: Queryable, id: number, feedsFromId: number): Promise<void> {
  await q.query("UPDATE `live_session_templates` SET `feeds_from_id` = ? WHERE `id` = ? AND `feeds_from_id` IS NULL AND `updated_by_no` = 0", [feedsFromId, id]);
}

export async function insertTemplate(
  q: Queryable,
  row: {
    name: string;
    category: string;
    summary: string;
    circleId: string | null;
    durationMin: number | null;
    flow: string;
    position: number;
    feedsFromId: number | null;
    byNo: number;
    now: Date;
  },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_templates` (`name`, `category`, `summary`, `circle_id`, `duration_min`, `flow`, `position`, `status`, `feeds_from_id`, `seed_key`, `created_by_no`, `updated_by_no`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?)",
    [row.name, row.category, row.summary, row.circleId, row.durationMin, row.flow, row.position, row.feedsFromId, row.byNo, row.byNo, row.now, row.now],
  );
  return Number(r.insertId);
}

/** Write a template's fields whole: the lib has merged the change into the row first. */
export async function writeTemplate(
  q: Queryable,
  id: number,
  row: {
    name: string;
    category: string;
    summary: string;
    circleId: string | null;
    durationMin: number | null;
    flow: string;
    position: number;
    feedsFromId: number | null;
    byNo: number;
    now: Date;
  },
): Promise<void> {
  await q.query(
    "UPDATE `live_session_templates` SET `name` = ?, `category` = ?, `summary` = ?, `circle_id` = ?, `duration_min` = ?, `flow` = ?, `position` = ?, " +
      "`feeds_from_id` = ?, `updated_by_no` = ?, `updated_at` = ? WHERE `id` = ?",
    [row.name, row.category, row.summary, row.circleId, row.durationMin, row.flow, row.position, row.feedsFromId, row.byNo, row.now, id],
  );
}

export async function writeStatus(q: Queryable, id: number, status: string, byNo: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_templates` SET `status` = ?, `updated_by_no` = ?, `updated_at` = ? WHERE `id` = ?", [status, byNo, now, id]);
}

export async function writePosition(q: Queryable, id: number, position: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_templates` SET `position` = ?, `updated_at` = ? WHERE `id` = ?", [position, now, id]);
}

// ── Uses: the series ────────────────────────────────────────────────────────

export async function insertUse(q: Queryable, sessionId: number, templateId: number, now: Date): Promise<void> {
  await q.query(
    "INSERT IGNORE INTO `live_session_template_uses` (`session_id`, `template_id`, `stick`, `created_at`, `updated_at`) VALUES (?, ?, NULL, ?, ?)",
    [sessionId, templateId, now, now],
  );
}

export async function useRow(q: Queryable, sessionId: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT \`session_id\`, \`template_id\`, \`stick\` FROM \`live_session_template_uses\` WHERE \`session_id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [
    sessionId,
  ]);
}

export async function writeStick(q: Queryable, sessionId: number, stick: string | null, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_template_uses` SET `stick` = ?, `updated_at` = ? WHERE `session_id` = ?", [stick, now, sessionId]);
}

/**
 * The latest session of a template opened before a given one, that still
 * exists. A discarded session's use row is left behind, so the join keeps
 * only sessions that are still here.
 */
export async function latestOfTemplateBefore(q: Queryable, templateId: number, beforeSessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT s.`id`, s.`title`, s.`created_at` FROM `live_session_template_uses` u JOIN `live_sessions` s ON s.`id` = u.`session_id` " +
      "WHERE u.`template_id` = ? AND u.`session_id` < ? ORDER BY u.`session_id` DESC LIMIT 1",
    [templateId, beforeSessionId],
  );
}

/** Which template each of some sessions came from. */
export async function usesFor(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (!sessionIds.length) return [];
  return rowsOf(q, "SELECT `session_id`, `template_id` FROM `live_session_template_uses` WHERE `session_id` IN (?)", [sessionIds]);
}

// ── Priorities ──────────────────────────────────────────────────────────────

const PRIORITY_COLUMNS = "`id`, `session_id`, `position`, `text`, `outcome`, `outcome_session_id`, `carried_from_id`, `serves_goal`, `serves_goal_id`";

export async function priorityRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${PRIORITY_COLUMNS} FROM \`live_session_priorities\` WHERE \`session_id\` = ? ORDER BY \`position\`, \`id\``, [sessionId]);
}

export async function priorityRow(q: Queryable, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${PRIORITY_COLUMNS} FROM \`live_session_priorities\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
}

/** The priorities a session marked, wherever they were chosen. */
export async function markedBy(q: Queryable, outcomeSessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${PRIORITY_COLUMNS} FROM \`live_session_priorities\` WHERE \`outcome_session_id\` = ? ORDER BY \`session_id\`, \`position\`, \`id\``, [
    outcomeSessionId,
  ]);
}

export async function insertPriority(
  q: Queryable,
  row: {
    sessionId: number;
    position: number;
    text: string;
    authorNo: number;
    carriedFromId: number | null;
    servesGoal: string | null;
    servesGoalId: string | null;
    now: Date;
  },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_priorities` (`session_id`, `position`, `text`, `author_no`, `outcome`, `outcome_session_id`, `outcome_by_no`, `carried_from_id`, `serves_goal`, `serves_goal_id`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?)",
    [row.sessionId, row.position, row.text, row.authorNo, row.carriedFromId, row.servesGoal, row.servesGoalId, row.now, row.now],
  );
  return Number(r.insertId);
}

export async function writePriorityServes(q: Queryable, id: number, goal: { id: string; text: string } | null, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_priorities` SET `serves_goal` = ?, `serves_goal_id` = ?, `updated_at` = ? WHERE `id` = ?", [goal?.text ?? null, goal?.id ?? null, now, id]);
}

export async function writePriorityText(q: Queryable, id: number, text: string, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_priorities` SET `text` = ?, `updated_at` = ? WHERE `id` = ?", [text, now, id]);
}

export async function writeOutcome(q: Queryable, id: number, outcome: string | null, sessionId: number | null, byNo: number, now: Date): Promise<void> {
  await q.query("UPDATE `live_session_priorities` SET `outcome` = ?, `outcome_session_id` = ?, `outcome_by_no` = ?, `updated_at` = ? WHERE `id` = ?", [
    outcome,
    sessionId,
    byNo,
    now,
    id,
  ]);
}

export async function deletePriority(q: Queryable, id: number): Promise<void> {
  await q.query("DELETE FROM `live_session_priorities` WHERE `id` = ?", [id]);
}

/** Which of some priorities were taken up again in a session. */
export async function carriedInto(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `carried_from_id` FROM `live_session_priorities` WHERE `session_id` = ? AND `carried_from_id` IS NOT NULL", [sessionId]);
}

// ── Shares ──────────────────────────────────────────────────────────────────

export async function shareRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `id`, `kind`, `text`, `speaker_no`, `author_no`, `library_id`, `serves_goal`, `serves_goal_id`, `created_at` FROM `live_session_shares` WHERE `session_id` = ? ORDER BY `id`",
    [sessionId],
  );
}

export async function shareRow(q: Queryable, sessionId: number, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT \`id\`, \`kind\`, \`text\`, \`speaker_no\`, \`library_id\` FROM \`live_session_shares\` WHERE \`session_id\` = ? AND \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [sessionId, id],
  );
}

/** One share wherever it was said, with its session, for regrouping a tension (0298). */
export async function shareById(q: Queryable, id: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `id`, `session_id`, `kind` FROM `live_session_shares` WHERE `id` = ? LIMIT 1", [id]);
}

export async function writeSameAs(q: Queryable, id: number, sameAsId: number | null): Promise<void> {
  await q.query("UPDATE `live_session_shares` SET `same_as_id` = ?, `stands_alone` = 0 WHERE `id` = ?", [sameAsId, id]);
}

export async function writeStandsAlone(q: Queryable, id: number, alone: boolean): Promise<void> {
  // Standing alone also lets go of any "same as" it was given.
  await q.query(`UPDATE \`live_session_shares\` SET \`stands_alone\` = ?${alone ? ", `same_as_id` = NULL" : ""} WHERE \`id\` = ?`, [alone ? 1 : 0, id]);
}

/** Every other share that names this one as the same tension: they are let go with it. */
export async function releaseSameAs(q: Queryable, id: number): Promise<void> {
  await q.query("UPDATE `live_session_shares` SET `same_as_id` = NULL WHERE `same_as_id` = ?", [id]);
}

export async function shareCount(q: Queryable, sessionId: number): Promise<number> {
  const rows = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_shares` WHERE `session_id` = ?", [sessionId]);
  return Number(rows[0]?.n ?? 0);
}

export async function insertShare(
  q: Queryable,
  row: { sessionId: number; kind: string; text: string; speakerNo: number; authorNo: number; servesGoal: string | null; servesGoalId: string | null; now: Date },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_shares` (`session_id`, `kind`, `text`, `speaker_no`, `author_no`, `library_id`, `serves_goal`, `serves_goal_id`, `created_at`) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
    [row.sessionId, row.kind, row.text, row.speakerNo, row.authorNo, row.servesGoal, row.servesGoalId, row.now],
  );
  return Number(r.insertId);
}

export async function writeShareServes(q: Queryable, id: number, goal: { id: string; text: string } | null): Promise<void> {
  await q.query("UPDATE `live_session_shares` SET `serves_goal` = ?, `serves_goal_id` = ? WHERE `id` = ?", [goal?.text ?? null, goal?.id ?? null, id]);
}

/**
 * THE TABLES 0298's BACKFILL NAMES, and the only two it ever named. A season
 * goal on `live_session_entries` is new in 0298, so no row there can carry
 * words without an id; these two could, from every release before it.
 */
export const GOAL_LINK_TABLES = ["live_session_priorities", "live_session_shares"] as const;

/**
 * THE LINKS THAT NAME A GOAL BY ITS WORDS AND HAVE NO ID YET (0298).
 *
 * The WHERE is the one statements 7 and 8 of the migration carried, so this
 * reads exactly the rows that backfill would have written. Distinct words,
 * not rows: the id is a function of the words alone, so one UPDATE settles
 * every row that shares them.
 */
export async function goalWordsWithoutIds(q: Queryable, table: string): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    `SELECT DISTINCT \`serves_goal\` FROM \`${table}\` ` +
      "WHERE `serves_goal_id` IS NULL AND `serves_goal` IS NOT NULL AND `serves_goal` <> ''",
  );
}

/**
 * Give every link with these exact words the id they derive. The WHERE keeps
 * the same conditions, so a row that gained an id since the SELECT (a member
 * saving the season, a second boot) is left alone: that is what makes the
 * backfill safe to run again.
 */
export async function writeGoalIdForWords(q: Queryable, table: string, words: string, goalId: string): Promise<number> {
  const [r] = await q.query(
    `UPDATE \`${table}\` SET \`serves_goal_id\` = ? ` +
      "WHERE `serves_goal_id` IS NULL AND `serves_goal` = ? AND `serves_goal` <> ''",
    [goalId, words],
  );
  return Number((r as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * A goal reworded on the season: every link to it keeps its words in step, so
 * a link to a goal later removed says what the goal was last called (0298).
 * Bounded by the goal's id; a link already saying the words moves nothing.
 */
export async function refreshGoalWords(q: Queryable, goalId: string, text: string): Promise<void> {
  for (const table of ["live_session_priorities", "live_session_shares", "live_session_entries"]) {
    await q.query(`UPDATE \`${table}\` SET \`serves_goal\` = ? WHERE \`serves_goal_id\` = ? AND (\`serves_goal\` IS NULL OR \`serves_goal\` <> ?)`, [text, goalId, text]);
  }
}

// ── A win on an agenda item (0298) ──────────────────────────────────────────

/** One entry of a session, with its kind, for naming the season priority a win serves. */
export async function entryKindRow(q: Queryable, sessionId: number, entryId: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT \`id\`, \`kind\` FROM \`live_session_entries\` WHERE \`session_id\` = ? AND \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [sessionId, entryId]);
}

export async function writeEntryServes(q: Queryable, entryId: number, goal: { id: string; text: string } | null): Promise<void> {
  await q.query("UPDATE `live_session_entries` SET `serves_goal` = ?, `serves_goal_id` = ? WHERE `id` = ?", [goal?.text ?? null, goal?.id ?? null, entryId]);
}

/** The season priority each win of a session serves, for the room. */
export async function entryLinkRows(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `id`, `serves_goal_id` FROM `live_session_entries` WHERE `session_id` = ? AND `kind` = 'win' AND `serves_goal_id` IS NOT NULL", [sessionId]);
}

export async function writeShareLibrary(q: Queryable, id: number, libraryId: number): Promise<void> {
  await q.query("UPDATE `live_session_shares` SET `library_id` = ? WHERE `id` = ?", [libraryId, id]);
}

// ── A season's window (0292) ────────────────────────────────────────────────

/** Every priority set in a templated session opened inside a window, with its session. */
export async function prioritiesInWindow(q: Queryable, from: Date, to: Date): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT p.`id`, p.`text`, p.`outcome`, p.`serves_goal`, p.`serves_goal_id`, p.`session_id`, s.`title` AS `session_title`, s.`created_at` AS `session_at` " +
      "FROM `live_session_priorities` p JOIN `live_sessions` s ON s.`id` = p.`session_id` " +
      "WHERE s.`created_at` >= ? AND s.`created_at` < ? ORDER BY s.`created_at`, s.`id`, p.`position`, p.`id`",
    [from, to],
  );
}

/** Wins and tensions captured in sessions opened inside a window. */
export async function sharesInWindow(q: Queryable, kinds: readonly string[], from: Date, to: Date): Promise<RowDataPacket[]> {
  if (!kinds.length) return [];
  return rowsOf(
    q,
    "SELECT sh.`id`, sh.`kind`, sh.`text`, sh.`serves_goal`, sh.`serves_goal_id`, sh.`same_as_id`, sh.`stands_alone`, sh.`session_id`, sh.`created_at`, s.`created_at` AS `session_at`, s.`title` AS `session_title` " +
      "FROM `live_session_shares` sh JOIN `live_sessions` s ON s.`id` = sh.`session_id` " +
      "WHERE sh.`kind` IN (?) AND s.`created_at` >= ? AND s.`created_at` < ? ORDER BY s.`created_at`, s.`id`, sh.`id`",
    [kinds, from, to],
  );
}

/** Wins written on the room's item pages (entry kind `win`) inside a window, with the season priority each serves. */
export async function itemWinsInWindow(q: Queryable, from: Date, to: Date): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT e.`text`, e.`serves_goal`, e.`serves_goal_id`, s.`title` AS `session_title`, s.`created_at` AS `session_at` " +
      "FROM `live_session_entries` e JOIN `live_sessions` s ON s.`id` = e.`session_id` " +
      "WHERE e.`kind` = 'win' AND s.`created_at` >= ? AND s.`created_at` < ? ORDER BY s.`created_at`, s.`id`, e.`id`",
    [from, to],
  );
}

/** Which of some sessions a member was in. */
export async function sessionsWith(q: Queryable, no: number, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (!sessionIds.length) return [];
  return rowsOf(q, "SELECT `session_id` FROM `live_session_people` WHERE `member_no` = ? AND `session_id` IN (?)", [no, sessionIds]);
}

// ── One member: the export and the erasure ──────────────────────────────────

export async function memberShareRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `session_id`, `kind`, `text`, `created_at` FROM `live_session_shares` WHERE `speaker_no` = ? OR `author_no` = ? ORDER BY `id`", [no, no]);
}

export async function memberPriorityRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `session_id`, `text`, `created_at` FROM `live_session_priorities` WHERE `author_no` = ? ORDER BY `id`", [no]);
}

/**
 * The member leaves. What they said around the stick goes with them: a share
 * they spoke or wrote is removed, since its words are theirs. A priority they
 * wrote is the circle's plan, so it stays and says it was written by nobody.
 */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  await q.query("DELETE FROM `live_session_shares` WHERE `speaker_no` = ? OR `author_no` = ?", [no, no]);
  await q.query("UPDATE `live_session_priorities` SET `author_no` = 0 WHERE `author_no` = ?", [no]);
  await q.query("UPDATE `live_session_priorities` SET `outcome_by_no` = 0 WHERE `outcome_by_no` = ?", [no]);
  await q.query("UPDATE `live_session_templates` SET `created_by_no` = 0 WHERE `created_by_no` = ?", [no]);
  await q.query("UPDATE `live_session_templates` SET `updated_by_no` = 0 WHERE `updated_by_no` = ?", [no]);
}
