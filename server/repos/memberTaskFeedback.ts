/**
 * Every statement against the feedback bridge's tables (drizzle/0312).
 *
 * Reads for stewards name their columns and never select `note`: a steward
 * sees that a task was removed and why, never the member's own words.
 */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DEFAULT_IMPORT_PHRASE, RETENTION_DAYS, type FeedbackAction, type FeedbackContext, type LibraryCode, type ScreenReason } from "../../shared/memberTaskFeedback";
import type { Queryable } from "./memberTasks";

// ── Switches ──────────────────────────────────────────────────────────────

export type NotesRelease = "held" | "released";

export async function notesRelease(db: Queryable): Promise<NotesRelease> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `value` FROM `member_task_bridge` WHERE `setting` = 'notes_release'");
  return rows.length && String(rows[0].value) === "released" ? "released" : "held";
}

export async function setNotesRelease(db: Queryable, value: NotesRelease, byUserId: string | null): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_bridge` (`setting`, `value`, `set_by_user_id`) VALUES ('notes_release', ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `set_by_user_id` = VALUES(`set_by_user_id`)",
    [value, byUserId],
  );
  if (value === "released") {
    await db.query("UPDATE `member_task_outbox` SET `status` = 'queued', `next_at` = NOW() WHERE `kind` = 'note' AND `status` = 'held'");
  }
}

export async function feedbackOn(db: Queryable, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `feedback_on` FROM `member_task_prefs` WHERE `user_id` = ?", [userId]);
  return rows.length === 0 || Number(rows[0].feedback_on) === 1;
}

/** The member's off switch. Turning it off drops everything not yet sent. */
export async function setFeedbackOn(db: Queryable, userId: string, on: boolean): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_prefs` (`user_id`, `feedback_on`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `feedback_on` = VALUES(`feedback_on`)",
    [userId, on ? 1 : 0],
  );
  if (!on) {
    await db.query("UPDATE `member_task_outbox` SET `status` = 'dropped', `payload` = '{}' WHERE `user_id` = ? AND `status` IN ('queued','held','failed')", [userId]);
  }
}

// ── Feedback rows ─────────────────────────────────────────────────────────

export interface NewFeedback {
  feedbackId: string;
  userId: string;
  taskId: string;
  action: FeedbackAction;
  reason: ScreenReason | null;
  code: LibraryCode | null;
  note: string | null;
  context: FeedbackContext;
  redirectToUserId: string | null;
  redirectToRoleId: string | null;
  review: "auto" | "steward";
}

/** True when this press is new. A retried press with the same id writes nothing. */
export async function insertFeedback(db: Queryable, f: NewFeedback): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO `member_task_feedback` (`feedback_id`, `user_id`, `task_id`, `action`, `screen_reason`, `library_code`, `note`, `context`, `redirect_to_user_id`, `redirect_to_role_id`, `review`) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [f.feedbackId, f.userId, f.taskId, f.action, f.reason, f.code, f.note, JSON.stringify(f.context), f.redirectToUserId, f.redirectToRoleId, f.review],
  );
  return res.affectedRows === 1;
}

/** The latest feedback on a task still standing, for undo. */
export async function latestFeedback(db: Queryable, userId: string, taskId: string): Promise<{ feedbackId: string; action: string; redirectToRoleId: string | null } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `feedback_id`, `action`, `redirect_to_role_id` FROM `member_task_feedback` WHERE `user_id` = ? AND `task_id` = ? AND `undone_at` IS NULL ORDER BY `created_at` DESC, `feedback_id` DESC LIMIT 1",
    [userId, taskId],
  );
  return rows.length ? { feedbackId: String(rows[0].feedback_id), action: String(rows[0].action), redirectToRoleId: rows[0].redirect_to_role_id ?? null } : null;
}

/**
 * Undo: the feedback is marked undone, anything about it not yet sent is
 * dropped, and when something was already sent an `undo` is queued so the
 * library can take it back.
 */
export async function undoFeedback(db: Queryable, userId: string, feedbackId: string): Promise<{ wasSent: boolean }> {
  await db.query("UPDATE `member_task_feedback` SET `undone_at` = NOW() WHERE `feedback_id` = ? AND `user_id` = ? AND `undone_at` IS NULL", [feedbackId, userId]);
  const [sent] = await db.query<RowDataPacket[]>("SELECT `id` FROM `member_task_outbox` WHERE `feedback_id` = ? AND `status` = 'sent' LIMIT 1", [feedbackId]);
  await db.query("UPDATE `member_task_outbox` SET `status` = 'dropped', `payload` = '{}' WHERE `feedback_id` = ? AND `status` IN ('queued','held','failed')", [feedbackId]);
  await db.query("UPDATE `member_task_role_queue` SET `status` = 'dismissed' WHERE `feedback_id` = ? AND `status` = 'waiting'", [feedbackId]);
  // A task handed to a person comes back: their copy goes, if they have not touched it yet.
  const [fb] = await db.query<RowDataPacket[]>(
    "SELECT f.`redirect_to_user_id` AS to_uid, t.`title`, f.`created_at` AS at FROM `member_task_feedback` f JOIN `member_tasks` t ON t.`id` = f.`task_id` WHERE f.`feedback_id` = ? AND f.`user_id` = ? AND f.`action` = 'redirect'",
    [feedbackId, userId],
  );
  if (fb.length && fb[0].to_uid) {
    await db.query(
      "DELETE FROM `member_tasks` WHERE `user_id` = ? AND `source` IN ('redirect','sera') AND `import_batch` IS NULL AND `title` = ? AND `status` = 'open' AND `member_edited` = 0 AND `created_at` >= ? ORDER BY `created_at` DESC LIMIT 1",
      [String(fb[0].to_uid), String(fb[0].title), fb[0].at],
    );
  }
  return { wasSent: sent.length > 0 };
}

// ── The outbox ────────────────────────────────────────────────────────────

export type OutboxKind = "feedback" | "suppress" | "note" | "undo" | "forget_person";

export async function enqueue(
  db: Queryable, userId: string | null, feedbackId: string | null, kind: OutboxKind, payload: Record<string, unknown>, held = false,
): Promise<void> {
  await db.query(
    "INSERT IGNORE INTO `member_task_outbox` (`user_id`, `feedback_id`, `kind`, `payload`, `status`) VALUES (?,?,?,?,?)",
    [userId, feedbackId, kind, JSON.stringify(payload), held ? "held" : "queued"],
  );
}

export interface OutboxRow {
  id: number;
  userId: string | null;
  feedbackId: string | null;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function dueOutbox(db: Queryable, limit = 50): Promise<OutboxRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `user_id`, `feedback_id`, `kind`, `payload`, `attempts` FROM `member_task_outbox` WHERE `status` IN ('queued','failed') AND `next_at` <= NOW() ORDER BY `id` LIMIT ?",
    [limit],
  );
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(r.payload)); } catch { payload = {}; }
    return { id: Number(r.id), userId: r.user_id ?? null, feedbackId: r.feedback_id ?? null, kind: String(r.kind) as OutboxKind, payload, attempts: Number(r.attempts) };
  });
}

export async function markOutboxSent(db: Queryable, id: number): Promise<void> {
  await db.query("UPDATE `member_task_outbox` SET `status` = 'sent', `sent_at` = NOW(), `attempts` = `attempts` + 1, `last_error` = NULL WHERE `id` = ?", [id]);
}

/** Backs off 5, 10, 20... minutes up to a day. After 20 tries it stays failed for a steward to see. */
export async function markOutboxFailed(db: Queryable, id: number, attempts: number, error: string): Promise<void> {
  const minutes = Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 9));
  const giveUp = attempts + 1 >= 20;
  await db.query(
    `UPDATE \`member_task_outbox\` SET \`status\` = 'failed', \`attempts\` = \`attempts\` + 1, \`last_error\` = ?, \`next_at\` = ${giveUp ? "'2099-01-01 00:00:00'" : "(NOW() + INTERVAL ? MINUTE)"} WHERE \`id\` = ?`,
    giveUp ? [error.slice(0, 300), id] : [error.slice(0, 300), minutes, id],
  );
}

export async function outboxCounts(db: Queryable): Promise<Record<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `kind`, `status`, COUNT(*) AS n FROM `member_task_outbox` GROUP BY `kind`, `status`");
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.kind}:${r.status}`] = Number(r.n);
  return out;
}

export async function lastOutboxErrors(db: Queryable): Promise<{ kind: string; error: string; attempts: number }[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `kind`, `last_error`, `attempts` FROM `member_task_outbox` WHERE `status` = 'failed' ORDER BY `id` DESC LIMIT 5");
  return rows.map((r) => ({ kind: String(r.kind), error: String(r.last_error ?? ""), attempts: Number(r.attempts) }));
}

// ── Steward review and role queues ────────────────────────────────────────

export async function reviewQueue(db: Queryable): Promise<{ feedbackId: string; title: string; action: string; reason: string | null; createdAt: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT f.`feedback_id`, f.`action`, f.`screen_reason`, f.`created_at`, t.`title` FROM `member_task_feedback` f LEFT JOIN `member_tasks` t ON t.`id` = f.`task_id` " +
      "WHERE f.`review` = 'steward' AND f.`reviewed_at` IS NULL AND f.`undone_at` IS NULL ORDER BY f.`created_at` LIMIT 100",
  );
  return rows.map((r) => ({
    feedbackId: String(r.feedback_id), title: String(r.title ?? ""), action: String(r.action), reason: r.screen_reason ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function markReviewed(db: Queryable, feedbackId: string): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>("UPDATE `member_task_feedback` SET `reviewed_at` = NOW() WHERE `feedback_id` = ? AND `review` = 'steward' AND `reviewed_at` IS NULL", [feedbackId]);
  return res.affectedRows === 1;
}

export async function queueForRole(db: Queryable, roleId: string, title: string, fromUserId: string, feedbackId: string): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_role_queue` (`id`, `role_id`, `title`, `from_user_id`, `feedback_id`) VALUES (?,?,?,?,?)",
    [`rq-${randomUUID()}`, roleId, title, fromUserId, feedbackId],
  );
}

export async function roleQueue(db: Queryable): Promise<{ id: string; roleId: string; roleName: string | null; title: string; createdAt: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT q.`id`, q.`role_id`, q.`title`, q.`created_at`, r.`name` FROM `member_task_role_queue` q LEFT JOIN `org_roles` r ON r.`id` = q.`role_id` WHERE q.`status` = 'waiting' ORDER BY q.`created_at` LIMIT 200",
  );
  return rows.map((r) => ({
    id: String(r.id), roleId: String(r.role_id), roleName: r.name ?? null, title: String(r.title),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function closeRoleItem(db: Queryable, id: string, status: "taken" | "dismissed", byUserId: string | null): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_task_role_queue` SET `status` = ?, `taken_by_user_id` = ? WHERE `id` = ? AND `status` = 'waiting'",
    [status, byUserId, id],
  );
  return res.affectedRows === 1;
}

export async function activeRoles(db: Queryable): Promise<{ id: string; name: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id`, `name` FROM `org_roles` WHERE `active` = 1 ORDER BY `name` LIMIT 300");
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

/** Members a task can be handed to by name: those whose list is on. Names only. */
export async function redirectPeople(db: Queryable, exceptUserId: string, listDefault: boolean): Promise<{ id: string; name: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.`id`, u.`name` FROM `users` u LEFT JOIN `member_task_access` a ON a.`user_id` = u.`id` " +
      "WHERE COALESCE(a.`list_on`, ?) = 1 AND u.`id` <> ? ORDER BY u.`name` LIMIT 300",
    [listDefault ? 1 : 0, exceptUserId],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
}

// ── Retention and erasure ─────────────────────────────────────────────────

export async function sweepOldFeedback(db: Queryable): Promise<number> {
  const [a] = await db.query<ResultSetHeader>(`DELETE FROM \`member_task_feedback\` WHERE \`created_at\` < (NOW() - INTERVAL ${RETENTION_DAYS} DAY)`);
  await db.query(`DELETE FROM \`member_task_outbox\` WHERE \`status\` IN ('sent','dropped') AND \`created_at\` < (NOW() - INTERVAL ${RETENTION_DAYS} DAY)`);
  return a.affectedRows;
}

/**
 * Part of the `member-tasks-after-tombstone` erasure step: the member's
 * feedback, their outbox rows and their switch are deleted, and their name
 * comes off any role-queue item they handed on. When the library knew them, a
 * `forget_person` is queued (under their library id, never ours) so it deletes
 * the feedback it holds about them.
 */
export async function forgetMemberTaskFeedback(db: Queryable, userId: string, libraryOwnerIds: string[]): Promise<void> {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  await db.query("DELETE FROM `member_task_feedback` WHERE `user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_feedback` SET `redirect_to_user_id` = NULL WHERE `redirect_to_user_id` = ?", [uid]);
  await db.query("DELETE FROM `member_task_outbox` WHERE `user_id` = ?", [uid]);
  await db.query("DELETE FROM `member_task_prefs` WHERE `user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_role_queue` SET `from_user_id` = NULL WHERE `from_user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_role_queue` SET `taken_by_user_id` = NULL WHERE `taken_by_user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_bridge` SET `set_by_user_id` = NULL WHERE `set_by_user_id` = ?", [uid]);
  for (const owner of libraryOwnerIds) await enqueue(db, null, `forget-${owner}`.slice(0, 64), "forget_person", { owner_id: owner });
}

// ── Bridge sync helpers ───────────────────────────────────────────────────

/** The library's id for a member, when a steward linked them. */
export async function libraryOwnerOf(db: Queryable, userId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `sera_owner_id` FROM `sera_person_links` WHERE `user_id` = ? ORDER BY `updated_at` DESC LIMIT 1", [userId]);
  return rows.length ? String(rows[0].sera_owner_id) : null;
}

export async function markOutboxDropped(db: Queryable, id: number, why: string): Promise<void> {
  await db.query("UPDATE `member_task_outbox` SET `status` = 'dropped', `last_error` = ? WHERE `id` = ?", [why.slice(0, 300), id]);
}

/** Close an open, unedited library task the library says is gone. */
export async function closeLibraryTask(db: Queryable, userId: string, externalId: string): Promise<number> {
  const [u] = await db.query<ResultSetHeader>(
    "UPDATE `member_tasks` SET `status` = 'done', `done_at` = NOW(), `version` = `version` + 1 WHERE `user_id` = ? AND `source` = 'sera' AND `external_id` = ? AND `status` = 'open' AND `member_edited` = 0",
    [userId, externalId],
  );
  return u.affectedRows;
}

export async function markLinkSynced(db: Queryable, owner: string, at: Date | string): Promise<void> {
  await db.query("UPDATE `sera_person_links` SET `last_synced_at` = ? WHERE `sera_owner_id` = ?", [at, owner]);
}

/** Every linked member whose board is on by the `listIsOn` rule: a row decides, no row means `listDefault` (A6). */
export async function syncableLinks(db: Queryable, listDefault: boolean): Promise<{ owner: string; userId: string; since: string | null }[]> {
  const [links] = await db.query<RowDataPacket[]>(
    "SELECT l.`sera_owner_id`, l.`user_id`, l.`last_synced_at` FROM `sera_person_links` l " +
      "LEFT JOIN `member_task_access` a ON a.`user_id` = l.`user_id` WHERE COALESCE(a.`list_on`, ?) = 1",
    [listDefault ? 1 : 0],
  );
  return links.map((l) => ({
    owner: String(l.sera_owner_id),
    userId: String(l.user_id),
    since: l.last_synced_at instanceof Date ? l.last_synced_at.toISOString() : l.last_synced_at ? String(l.last_synced_at) : null,
  }));
}

/** The evidence phrase the import and the sync read with. Steward-editable. */
export async function importPhrase(db: Queryable): Promise<string> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `value` FROM `member_task_bridge` WHERE `setting` = 'import_phrase'");
  return rows.length && String(rows[0].value).trim() ? String(rows[0].value) : DEFAULT_IMPORT_PHRASE;
}

export async function setImportPhrase(db: Queryable, phrase: string): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_bridge` (`setting`, `value`) VALUES ('import_phrase', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [phrase.slice(0, 200)],
  );
}

/** Did a removal for this member reach the library in the last few minutes? Then an empty removed_since may just be lag. */
export async function recentRemovalSent(db: Queryable, userId: string, seconds = 180): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM `member_task_outbox` WHERE `user_id` = ? AND `kind` = 'feedback' AND `status` = 'sent' AND `sent_at` > NOW() - INTERVAL ? SECOND LIMIT 1",
    [userId, seconds],
  );
  return rows.length > 0;
}

/** The last linked-members sync, as a short JSON record (member_task_bridge setting). */
export async function setSyncRecord(db: Queryable, json: string): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_bridge` (`setting`, `value`) VALUES ('member_sync_last', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [json.slice(0, 200)],
  );
}

export async function syncRecord(db: Queryable): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `value` FROM `member_task_bridge` WHERE `setting` = 'member_sync_last'");
  return rows.length ? String(rows[0].value) : null;
}
