/**
 * The steward import of one member's library tasks (drizzle/0311, and the
 * member_tasks rows of drizzle/0310).
 *
 * `runImport` applies a plan from shared/memberTaskImport.ts inside one
 * transaction, under one batch id. It writes only what the plan says: new rows,
 * refreshed untouched rows, and the Needs Owner queue. Rows the member edited,
 * finished or removed are never written. The unique key on (user, source,
 * external id) is the last word: a second run racing the first cannot add a
 * duplicate.
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { HeldTask, ImportPlan } from "../../shared/memberTaskImport";
import type { TaskStatus, Tier } from "../../shared/memberTasks";
import { recordTaskEvent, type Queryable } from "./memberTasks";

export async function heldFromLibrary(db: Queryable, userId: string): Promise<HeldTask[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `external_id`, `title`, `tier`, DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `status`, `member_edited`, `requested_by` FROM `member_tasks` WHERE `user_id` = ? AND `source` = 'sera' AND `external_id` IS NOT NULL",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id), externalId: String(r.external_id), title: String(r.title), tier: r.tier as Tier,
    dueOn: r.due_on == null ? null : String(r.due_on), status: r.status as TaskStatus, memberEdited: Number(r.member_edited) === 1,
    requestedBy: r.requested_by == null ? null : String(r.requested_by),
  }));
}

export async function linkSeraPerson(db: Queryable, seraOwnerId: string, userId: string, byUserId: string | null): Promise<void> {
  await db.query(
    "INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `linked_by_user_id`, `how`) VALUES (?,?,?,'steward') " +
      "ON DUPLICATE KEY UPDATE `user_id` = VALUES(`user_id`), `linked_by_user_id` = VALUES(`linked_by_user_id`), `how` = 'steward'",
    [seraOwnerId, userId, byUserId],
  );
}

export async function linkedMember(db: Queryable, seraOwnerId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `user_id` FROM `sera_person_links` WHERE `sera_owner_id` = ?", [seraOwnerId]);
  return rows.length ? String(rows[0].user_id) : null;
}

export interface ImportResult {
  batch: string;
  created: number;
  updated: number;
  queued: number;
}

export async function runImport(
  pool: Pool, userId: string, seraOwnerId: string, plan: ImportPlan, createdOn: string, byUserId: string | null,
): Promise<ImportResult> {
  const batch = `imp-${randomUUID()}`;
  const conn = await pool.getConnection();
  let created = 0;
  let updated = 0;
  let queued = 0;
  try {
    await conn.beginTransaction();
    await linkSeraPerson(conn, seraOwnerId, userId, byUserId);
    for (const t of plan.create) {
      const id = `mt-${randomUUID()}`;
      const [res] = await conn.query<any>(
        "INSERT IGNORE INTO `member_tasks` (`id`, `user_id`, `title`, `tier`, `due_on`, `source`, `external_id`, `import_batch`, `confidence`, `requested_by`, `created_on`) VALUES (?,?,?,?,?,'sera',?,?,?,?,?)",
        [id, userId, t.title, t.tier, t.dueOn, t.externalId, batch, t.confidence, t.requestedBy ?? null, createdOn],
      );
      if (res.affectedRows === 1) {
        created += 1;
        await recordTaskEvent(conn, id, userId, "add", { source: "sera", batch }, byUserId);
      }
    }
    for (const u of plan.update) {
      const [res] = await conn.query<any>(
        "UPDATE `member_tasks` SET `title` = ?, `tier` = ?, `due_on` = ?, `requested_by` = ?, `version` = `version` + 1 WHERE `id` = ? AND `user_id` = ? AND `status` = 'open' AND `member_edited` = 0",
        [u.next.title, u.next.tier, u.next.dueOn, u.next.requestedBy ?? null, u.id, userId],
      );
      if (res.affectedRows === 1) {
        updated += 1;
        await recordTaskEvent(conn, u.id, userId, "refresh", { batch }, byUserId);
      }
    }
    // Marked, never removed: the member still sees it, with a line saying it waits for a role.
    for (const w of plan.roleWaiting) {
      await conn.query("UPDATE `member_tasks` SET `sera_role_id` = ? WHERE `id` = ? AND `user_id` = ? AND `status` = 'open'", [w.roleId ?? "", w.id, userId]);
    }
    // Back with a person: the mark goes.
    for (const u of plan.ownedAgain ?? []) {
      await conn.query("UPDATE `member_tasks` SET `sera_role_id` = NULL WHERE `id` = ? AND `user_id` = ? AND `sera_role_id` IS NOT NULL", [u, userId]);
    }
    for (const q of plan.needsOwner) {
      const [res] = await conn.query<any>(
        "INSERT IGNORE INTO `member_task_import_queue` (`external_id`, `title`, `import_batch`, `sera_role_id`) VALUES (?,?,?,?)",
        [q.externalId, q.title, batch, q.roleId ?? null],
      );
      queued += res.affectedRows === 1 ? 1 : 0;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return { batch, created, updated, queued };
}

/** Undo a whole batch: every row it made that is still open becomes removed (restorable for 30 days). */
export async function removeBatch(db: Queryable, batch: string, byUserId: string | null): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id`, `user_id` FROM `member_tasks` WHERE `import_batch` = ? AND `status` = 'open'", [batch]);
  if (!rows.length) return 0;
  await db.query(
    "UPDATE `member_tasks` SET `status` = 'removed', `removed_at` = NOW(), `remove_reason` = 'other', `version` = `version` + 1 WHERE `import_batch` = ? AND `status` = 'open'",
    [batch],
  );
  for (const r of rows) await recordTaskEvent(db, String(r.id), String(r.user_id), "removed", { batch, by: "steward" }, byUserId);
  return rows.length;
}

export async function memberExists(db: Queryable, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  return rows.length > 0;
}
