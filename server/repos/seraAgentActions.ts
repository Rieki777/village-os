/**
 * The rows Sera's agent may write, and only the writes that can be put back
 * (End of Moon addendum v6, B7). server/lib/seraAgent.ts decides; this file
 * holds the SQL.
 *
 *   sera_person_links  a link Sera writes carries `how = 'sera'`. It never
 *                      replaces a steward's or an email link, and it never
 *                      links one owner to two members or one member to two
 *                      owners. Undone by deleting exactly that row.
 *   member_tasks       a suggestion is an open task with source `assistant`
 *                      and the action's id as its `import_batch`, at version
 *                      1. Undone only while it is still at version 1, open
 *                      and unedited: once the member touched it, it is theirs.
 *   member_task_access the board switch. Undone only while the row is still
 *                      exactly what the action wrote.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;
const affected = (res: unknown): number => Number((res as { affectedRows?: number })?.affectedRows ?? 0);

/** The member an owner is linked to, and how, or null. */
export async function seraLinkOfOwner(db: Db, seraOwnerId: string): Promise<{ userId: string; how: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `user_id`, `how` FROM `sera_person_links` WHERE `sera_owner_id` = ? LIMIT 1", [seraOwnerId]);
  return rows[0] ? { userId: String(rows[0].user_id), how: String(rows[0].how) } : null;
}

/** Whether a member already has any link. */
export async function memberHasSeraLink(db: Db, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM `sera_person_links` WHERE `user_id` = ? LIMIT 1", [userId]);
  return rows.length > 0;
}

/**
 * Who Sera's agent may act on: a member row that stands (no erasure
 * tombstone) and is a person, never another agent account. Null when there
 * is no such member.
 */
export async function seraTarget(db: Db, userId: string): Promise<{ stands: boolean; isAgent: boolean } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `email`, `is_agent` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  if (!rows[0]) return null;
  return { stands: !String(rows[0].email ?? "").endsWith("@anonymized.invalid"), isAgent: Number(rows[0].is_agent ?? 0) === 1 };
}

/** How many links a member holds. Two means a race landed both. */
export async function seraLinkCount(db: Db, userId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS `n` FROM `sera_person_links` WHERE `user_id` = ?", [userId]);
  return Number(rows[0]?.n ?? 0);
}

/** Write a Sera link. INSERT IGNORE: a row that appeared in between is left alone and this answers false. */
export async function insertSeraLink(db: Db, seraOwnerId: string, userId: string): Promise<boolean> {
  const [res] = await db.query(
    "INSERT IGNORE INTO `sera_person_links` (`sera_owner_id`, `user_id`, `linked_by_user_id`, `how`) VALUES (?,?,NULL,'sera')",
    [seraOwnerId, userId],
  );
  return affected(res) === 1;
}

/** Remove a Sera link, only while it is still that link. */
export async function deleteSeraLink(db: Db, seraOwnerId: string, userId: string): Promise<boolean> {
  const [res] = await db.query("DELETE FROM `sera_person_links` WHERE `sera_owner_id` = ? AND `user_id` = ? AND `how` = 'sera'", [seraOwnerId, userId]);
  return affected(res) === 1;
}

/** Remove a suggestion, only while the member has not touched it. */
export async function deleteUntouchedSuggestion(db: Db, userId: string, taskId: string, batch: string): Promise<boolean> {
  const [res] = await db.query(
    "DELETE FROM `member_tasks` WHERE `id` = ? AND `user_id` = ? AND `import_batch` = ? AND `source` = 'assistant' AND `status` = 'open' AND `version` = 1 AND `member_edited` = 0",
    [taskId, userId, batch],
  );
  return affected(res) === 1;
}

/** A member's board switch row, or null when there is none. */
export async function boardAccessRow(db: Db, userId: string): Promise<{ on: boolean; setBy: string | null } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `list_on`, `set_by_user_id` FROM `member_task_access` WHERE `user_id` = ? LIMIT 1", [userId]);
  return rows[0] ? { on: Number(rows[0].list_on) === 1, setBy: rows[0].set_by_user_id == null ? null : String(rows[0].set_by_user_id) } : null;
}

/** Put a board switch back: to an earlier row, or to no row. Only while the row is still what `expect` says. */
export async function restoreBoardAccess(
  db: Db,
  userId: string,
  expect: { on: boolean; setBy: string },
  before: { on: boolean; setBy: string | null } | null,
): Promise<boolean> {
  if (before === null) {
    const [res] = await db.query("DELETE FROM `member_task_access` WHERE `user_id` = ? AND `list_on` = ? AND `set_by_user_id` = ?", [userId, expect.on ? 1 : 0, expect.setBy]);
    return affected(res) === 1;
  }
  const [res] = await db.query(
    "UPDATE `member_task_access` SET `list_on` = ?, `set_by_user_id` = ? WHERE `user_id` = ? AND `list_on` = ? AND `set_by_user_id` = ?",
    [before.on ? 1 : 0, before.setBy, userId, expect.on ? 1 : 0, expect.setBy],
  );
  return affected(res) === 1;
}

// ── B7 part 2: agenda drafts and moon suggestions ───────────────────────────

/** Whether a circle exists, for a draft that names one. */
export async function circleExists(db: Db, circleId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM `circles` WHERE `id` = ? LIMIT 1", [circleId]);
  return rows.length > 0;
}

/**
 * Remove a draft Sera put in the agenda library, only while nobody has
 * touched it: still waiting, never on an agenda, never edited, no note added.
 * Its source row goes with it.
 */
export async function deleteUntouchedLibraryDraft(db: Db, libraryId: number): Promise<boolean> {
  const [res] = await db.query(
    "DELETE FROM `live_session_library` WHERE `id` = ? AND `status` = 'waiting' AND `session_id` IS NULL AND `edited_by_no` IS NULL AND `note_by_no` IS NULL " +
      "AND `id` IN (SELECT `library_id` FROM `live_session_library_sources` WHERE `kind` = 'sera_agent') " +
      // A draft some session has taken, even one later put back, has been in a room.
      "AND NOT EXISTS (SELECT 1 FROM `live_session_library_takes` t WHERE t.`library_id` = `live_session_library`.`id`)",
    [libraryId],
  );
  if (affected(res) !== 1) return false;
  await db.query("DELETE FROM `live_session_library_sources` WHERE `library_id` = ? AND `kind` = 'sera_agent'", [libraryId]);
  return true;
}

/** Remove a moon item Sera suggested, only while it is still a suggestion on a Draft recap. */
export async function deleteSuggestedMoonItem(db: Db, itemId: string, recapId: string, text: string | null): Promise<boolean> {
  // `text` is what the agent wrote. An item the member reworded is theirs, even while it is still a suggestion.
  const [res] = await db.query(
    "DELETE FROM `moon_recap_items` WHERE `id` = ? AND `recap_id` = ? AND `state` = 'suggested' AND `origin` = 'sera' " +
      (text === null ? "" : "AND `text` = ? ") +
      "AND `recap_id` IN (SELECT `id` FROM (SELECT `id` FROM `moon_recaps` WHERE `id` = ? AND `status` = 'draft') AS `d`)",
    text === null ? [itemId, recapId, recapId] : [itemId, recapId, text, recapId],
  );
  return affected(res) === 1;
}

/**
 * Whether a later action by the agent, on the same tool and the same member,
 * still stands. Undoing the earlier one under it would put back a state the
 * later one already moved past, so the later one is undone first.
 */
export async function laterStandingAction(db: Db, a: { id: string; tool: string; subjectUserId: string | null; createdAt: string; scope: string }): Promise<boolean> {
  if (a.subjectUserId === null) return false;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM `agent_actions` WHERE `scope` = ? AND `tool` = ? AND `subject_user_id` = ? AND `id` <> ? AND `state` = 'done' AND `undone_at` IS NULL " +
      "AND `created_at` > ? LIMIT 1",
    [a.scope, a.tool, a.subjectUserId, a.id, new Date(a.createdAt)],
  );
  return rows.length > 0;
}
