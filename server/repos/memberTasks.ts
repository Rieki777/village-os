/**
 * Every statement against `member_tasks`, `member_task_events` and
 * `member_task_access` (drizzle/0310).
 *
 * A member reads and writes ONLY their own rows: every statement here is keyed
 * on `user_id`, so no route can reach somebody else's list by id.
 *
 * `private_detail` is selected only by `ownTasks` and `ownTask`. The steward
 * read (`stewardView`) names its columns and leaves it out, so a steward
 * surface cannot leak it by accident.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { forgetMemberTaskFeedback } from "./memberTaskFeedback";
import {
  RESTORE_DAYS, type Horizon, type RemoveReason, type TaskInput, type TaskSource, type TaskStatus, type Tier,
} from "../../shared/memberTasks";

export type Queryable = Pool | PoolConnection;

export interface MemberTaskRow {
  id: string;
  userId: string;
  title: string;
  privateDetail: string | null;
  tier: Tier;
  horizon: Horizon | null;
  dueOn: string | null;
  minutes: number | null;
  status: TaskStatus;
  removeReason: string | null;
  pinned: boolean;
  memberPinned: boolean;
  source: TaskSource;
  externalId: string | null;
  importBatch: string | null;
  memberEdited: boolean;
  confidence: number | null;
  /** Who asked for it, from the library (display only). */
  requestedBy: string | null;
  notNowCount: number;
  version: number;
  createdOn: string;
  doneAt: string | null;
  removedAt: string | null;
  updatedAt: string | null;
}

const COLUMNS =
  "`id`, `user_id`, `title`, `private_detail`, `tier`, `horizon`, DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `minutes`, `status`, `remove_reason`, `pinned`, `member_pinned`, `source`, `external_id`, `import_batch`, `member_edited`, `confidence`, `requested_by`, `not_now_count`, `version`, DATE_FORMAT(`created_on`, '%Y-%m-%d') AS `created_on`, `done_at`, `removed_at`, `updated_at`";

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function toRow(r: RowDataPacket): MemberTaskRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    title: String(r.title ?? ""),
    privateDetail: r.private_detail == null ? null : String(r.private_detail),
    tier: r.tier as Tier,
    horizon: (r.horizon ?? null) as Horizon | null,
    dueOn: r.due_on == null ? null : String(r.due_on),
    minutes: r.minutes == null ? null : Number(r.minutes),
    status: r.status as TaskStatus,
    removeReason: r.remove_reason == null ? null : String(r.remove_reason),
    pinned: Number(r.pinned) === 1,
    memberPinned: Number(r.member_pinned ?? 0) === 1,
    source: String(r.source) as TaskSource,
    externalId: r.external_id == null ? null : String(r.external_id),
    importBatch: r.import_batch == null ? null : String(r.import_batch),
    memberEdited: Number(r.member_edited) === 1,
    confidence: r.confidence == null ? null : Number(r.confidence),
    requestedBy: r.requested_by == null ? null : String(r.requested_by),
    notNowCount: Number(r.not_now_count ?? 0),
    version: Number(r.version ?? 1),
    createdOn: String(r.created_on),
    doneAt: iso(r.done_at),
    removedAt: iso(r.removed_at),
    updatedAt: iso(r.updated_at),
  };
}

// ── The switch ───────────────────────────────────────────────────────────

/**
 * Is this member's board on? A row decides, a steward's off included; with no
 * row, `listDefault` does (the game variable `memberTasks.listDefault`, which
 * the caller reads: this file imports nothing from server/lib).
 */
export async function listIsOn(db: Queryable, userId: string, listDefault: boolean): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `list_on` FROM `member_task_access` WHERE `user_id` = ?", [userId]);
  return rows.length > 0 ? Number(rows[0].list_on) === 1 : listDefault;
}

export async function setListOn(db: Queryable, userId: string, on: boolean, byUserId: string | null): Promise<void> {
  await db.query(
    "INSERT INTO `member_task_access` (`user_id`, `list_on`, `set_by_user_id`) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE `list_on` = VALUES(`list_on`), `set_by_user_id` = VALUES(`set_by_user_id`)",
    [userId, on ? 1 : 0, byUserId],
  );
}

/** Every member whose board is on by the same rule as `listIsOn`, for the steward panel. */
export async function membersWithListOn(db: Queryable, listDefault: boolean): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.`id` AS `user_id` FROM `users` u LEFT JOIN `member_task_access` a ON a.`user_id` = u.`id` " +
      "WHERE COALESCE(a.`list_on`, ?) = 1 ORDER BY u.`id`",
    [listDefault ? 1 : 0],
  );
  return rows.map((r) => String(r.user_id));
}

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * The member's own tasks: open and done ones, and removed ones still inside the
 * restore window. Tombstones past the window are never returned.
 */
export async function ownTasks(db: Queryable, userId: string): Promise<MemberTaskRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_tasks\` WHERE \`user_id\` = ? AND (\`status\` <> 'removed' OR \`removed_at\` > (NOW() - INTERVAL ${RESTORE_DAYS} DAY)) ORDER BY \`created_at\`, \`id\``,
    [userId],
  );
  return rows.map(toRow);
}

export async function ownTask(db: Queryable, userId: string, id: string): Promise<MemberTaskRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM \`member_tasks\` WHERE \`user_id\` = ? AND \`id\` = ?`, [userId, id]);
  return rows.length ? toRow(rows[0]) : null;
}

export async function byExternal(db: Queryable, userId: string, source: TaskSource, externalId: string): Promise<MemberTaskRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`member_tasks\` WHERE \`user_id\` = ? AND \`source\` = ? AND \`external_id\` = ?`,
    [userId, source, externalId],
  );
  return rows.length ? toRow(rows[0]) : null;
}

// ── Writes ───────────────────────────────────────────────────────────────

export interface NewTask extends TaskInput {
  source: TaskSource;
  externalId?: string | null;
  importBatch?: string | null;
  confidence?: number | null;
  createdOn: string;
}

export async function insertTask(db: Queryable, userId: string, t: NewTask, byUserId: string | null): Promise<string> {
  const id = `mt-${randomUUID()}`;
  await db.query(
    "INSERT INTO `member_tasks` (`id`, `user_id`, `title`, `private_detail`, `tier`, `horizon`, `due_on`, `minutes`, `source`, `external_id`, `import_batch`, `confidence`, `created_on`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, userId, t.title, t.privateDetail, t.tier, t.horizon, t.dueOn, t.minutes, t.source, t.externalId ?? null, t.importBatch ?? null, t.confidence ?? null, t.createdOn],
  );
  await recordTaskEvent(db, id, userId, "add", { source: t.source, batch: t.importBatch ?? null }, byUserId);
  return id;
}

const FIELD_COLUMN: Record<keyof TaskInput, string> = {
  title: "title", tier: "tier", dueOn: "due_on", horizon: "horizon", minutes: "minutes", privateDetail: "private_detail",
};

/**
 * Change fields on the member's own open task, only at the version they saw.
 * Returns "conflict" when the row moved on, so the route can answer 409.
 */
export async function patchTask(
  db: Queryable, userId: string, id: string, version: number, patch: Partial<TaskInput>, opts: { byMember: boolean },
): Promise<"ok" | "conflict" | "missing"> {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, col] of Object.entries(FIELD_COLUMN) as [keyof TaskInput, string][]) {
    if (k in patch) {
      sets.push(`\`${col}\` = ?`);
      args.push(patch[k] ?? null);
    }
  }
  if (opts.byMember) sets.push("`member_edited` = 1");
  if (!sets.length) return "ok";
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE \`member_tasks\` SET ${sets.join(", ")}, \`version\` = \`version\` + 1 WHERE \`user_id\` = ? AND \`id\` = ? AND \`version\` = ? AND \`status\` = 'open'`,
    [...args, userId, id, version],
  );
  if (res.affectedRows === 1) {
    await recordTaskEvent(db, id, userId, "edit", { fields: Object.keys(patch).filter((k) => k !== "privateDetail") }, opts.byMember ? userId : null);
    return "ok";
  }
  return (await ownTask(db, userId, id)) ? "conflict" : "missing";
}

/** Move a task between open, done and removed. Removed keeps the row as a tombstone. */
export async function setStatus(
  db: Queryable, userId: string, id: string, version: number, to: TaskStatus, reason: RemoveReason | string | null = null,
): Promise<"ok" | "conflict" | "missing"> {
  const extra =
    to === "done" ? ", `done_at` = NOW(), `removed_at` = NULL, `remove_reason` = NULL"
      : to === "removed" ? ", `removed_at` = NOW(), `remove_reason` = ?"
        : ", `done_at` = NULL, `removed_at` = NULL, `remove_reason` = NULL";
  const args: unknown[] = to === "removed" ? [reason] : [];
  // A removed task comes back only inside the restore window.
  const window = to === "open" ? ` AND (\`status\` <> 'removed' OR \`removed_at\` > (NOW() - INTERVAL ${RESTORE_DAYS} DAY))` : "";
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE \`member_tasks\` SET \`status\` = ?${extra}, \`version\` = \`version\` + 1 WHERE \`user_id\` = ? AND \`id\` = ? AND \`version\` = ?${window}`,
    [to, ...args, userId, id, version],
  );
  if (res.affectedRows === 1) {
    await recordTaskEvent(db, id, userId, to === "open" ? "restore" : to, reason ? { reason } : null, userId);
    return "ok";
  }
  return (await ownTask(db, userId, id)) ? "conflict" : "missing";
}

/** The member's own pin to the top of the tier. */
export async function setMemberPinned(db: Queryable, userId: string, id: string, on: boolean): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_tasks` SET `member_pinned` = ?, `version` = `version` + 1 WHERE `user_id` = ? AND `id` = ? AND `status` = 'open'",
    [on ? 1 : 0, userId, id],
  );
  if (res.affectedRows === 1) await recordTaskEvent(db, id, userId, on ? "pin" : "unpin", null, userId);
  return res.affectedRows === 1;
}

/** "Not now": one more push down the list, counted for the feedback slider. */
export async function bumpNotNow(db: Queryable, userId: string, id: string): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_tasks` SET `not_now_count` = `not_now_count` + 1, `version` = `version` + 1 WHERE `user_id` = ? AND `id` = ? AND `status` = 'open'",
    [userId, id],
  );
  if (res.affectedRows === 1) await recordTaskEvent(db, id, userId, "not_now", null, userId);
  return res.affectedRows === 1;
}

/**
 * Clear the words of tombstones past the restore window. The row, its source and
 * its external id stay, so a re-sent task is still recognised and ignored.
 */
export async function clearOldTombstones(db: Queryable): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE \`member_tasks\` SET \`title\` = '', \`private_detail\` = NULL WHERE \`status\` = 'removed' AND \`removed_at\` <= (NOW() - INTERVAL ${RESTORE_DAYS} DAY) AND (\`title\` <> '' OR \`private_detail\` IS NOT NULL)`,
  );
  return res.affectedRows;
}

export async function recordTaskEvent(
  db: Queryable, taskId: string, userId: string, kind: string, detail: Record<string, unknown> | null, byUserId: string | null,
): Promise<void> {
  await db.query("INSERT INTO `member_task_events` (`task_id`, `user_id`, `kind`, `detail`, `by_user_id`) VALUES (?,?,?,?,?)", [
    taskId, userId, kind, detail ? JSON.stringify(detail) : null, byUserId,
  ]);
}

/** A steward's read of one member: titles, tiers and dates only. Never the private detail. */
export async function stewardView(db: Queryable, userId: string): Promise<Pick<MemberTaskRow, "id" | "title" | "tier" | "status" | "dueOn" | "horizon" | "source">[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `tier`, `status`, DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `horizon`, `source` FROM `member_tasks` WHERE `user_id` = ? AND `status` = 'open' ORDER BY `created_at`",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id), title: String(r.title), tier: r.tier as Tier, status: r.status as TaskStatus,
    dueOn: r.due_on == null ? null : String(r.due_on), horizon: (r.horizon ?? null) as Horizon | null, source: String(r.source) as TaskSource,
  }));
}

/** Everything held about this member, for `GET /api/profile/export`. */
export async function exportMemberTasks(db: Queryable, userId: string): Promise<MemberTaskRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM \`member_tasks\` WHERE \`user_id\` = ? ORDER BY \`created_at\``, [userId]);
  return rows.map(toRow);
}

/**
 * The `member-tasks-after-tombstone` step of the erasure sweep
 * (server/lib/erasure.ts): the member's tasks, their events and their switch
 * are deleted. Where they acted on somebody else's list (a steward turning a
 * switch, an event they wrote), the id that named them is cleared.
 */
export async function forgetMemberTasks(db: Queryable, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const [e] = await db.query<ResultSetHeader>("DELETE FROM `member_task_events` WHERE `user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_events` SET `by_user_id` = NULL WHERE `by_user_id` = ?", [uid]);
  const [t] = await db.query<ResultSetHeader>("DELETE FROM `member_tasks` WHERE `user_id` = ?", [uid]);
  const [a] = await db.query<ResultSetHeader>("DELETE FROM `member_task_access` WHERE `user_id` = ?", [uid]);
  await db.query("UPDATE `member_task_access` SET `set_by_user_id` = NULL WHERE `set_by_user_id` = ?", [uid]);
  // The feedback bridge (drizzle/0312), then the library's links (0311), dropped last.
  const [links] = await db.query<RowDataPacket[]>("SELECT `sera_owner_id` FROM `sera_person_links` WHERE `user_id` = ?", [uid]);
  await forgetMemberTaskFeedback(db, uid, links.map((l) => String(l.sera_owner_id)));
  await db.query("DELETE FROM `sera_person_links` WHERE `user_id` = ?", [uid]);
  await db.query("UPDATE `sera_person_links` SET `linked_by_user_id` = NULL WHERE `linked_by_user_id` = ?", [uid]);
  return e.affectedRows + t.affectedRows + a.affectedRows;
}

// ── Nudges ────────────────────────────────────────────────────────────────

/** Open tasks due in [from, to] for members whose list is on. Only what a bell needs. */
export async function dueSoonTasks(db: Queryable, from: string, to: string): Promise<{ id: string; userId: string; title: string; dueOn: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT t.`id`, t.`user_id`, t.`title`, DATE_FORMAT(t.`due_on`, '%Y-%m-%d') AS `due_on` FROM `member_tasks` t JOIN `member_task_access` a ON a.`user_id` = t.`user_id` AND a.`list_on` = 1 " +
      "WHERE t.`status` = 'open' AND t.`due_on` BETWEEN ? AND ? LIMIT 2000",
    [from, to],
  );
  return rows.map((r) => ({ id: String(r.id), userId: String(r.user_id), title: String(r.title ?? ""), dueOn: String(r.due_on) }));
}

/** Open library tasks someone asked for, landed in the last week, for members whose list is on. */
export async function askedForTasks(db: Queryable): Promise<{ id: string; userId: string; title: string; requestedBy: string }[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT t.`id`, t.`user_id`, t.`title`, t.`requested_by` FROM `member_tasks` t JOIN `member_task_access` a ON a.`user_id` = t.`user_id` AND a.`list_on` = 1 " +
      "WHERE t.`status` = 'open' AND t.`requested_by` IS NOT NULL AND t.`created_at` > NOW() - INTERVAL 7 DAY LIMIT 2000",
  );
  return rows.map((r) => ({ id: String(r.id), userId: String(r.user_id), title: String(r.title ?? ""), requestedBy: String(r.requested_by) }));
}
