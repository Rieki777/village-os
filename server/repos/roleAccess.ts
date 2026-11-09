/**
 * Access tasks and moon renewals (migration 0366). Names the item and its
 * state, never a credential: see shared/accessBundle.ts.
 */
import crypto from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { AccessState } from "../../shared/accessBundle";

export interface AccessTaskRow {
  id: string;
  assignmentId: string;
  orgRoleId: string;
  holderUserId: string | null;
  itemKey: string;
  itemLabel: string;
  kind: "grant" | "revoke";
  grantingRoleId: string | null;
  state: AccessState;
  createdAt: Date;
  doneAt: Date | null;
}

const COLS = "id, assignment_id, org_role_id, holder_user_id, item_key, item_label, kind, granting_role_id, state, created_at, done_at";
const toTask = (r: any): AccessTaskRow => ({
  id: String(r.id),
  assignmentId: String(r.assignment_id),
  orgRoleId: String(r.org_role_id),
  holderUserId: r.holder_user_id ? String(r.holder_user_id) : null,
  itemKey: String(r.item_key),
  itemLabel: String(r.item_label),
  kind: r.kind,
  grantingRoleId: r.granting_role_id ? String(r.granting_role_id) : null,
  state: r.state,
  createdAt: new Date(r.created_at),
  doneAt: r.done_at ? new Date(r.done_at) : null,
});

/** The stored access list of a role, raw. Null when the column is not there yet. */
export async function accessBundleOf(pool: Pool, orgRoleId: string): Promise<unknown> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT access_bundle FROM org_roles WHERE id = ?", [orgRoleId]);
    return rows[0]?.access_bundle ?? null;
  } catch {
    return null;
  }
}

/** One row per (seating, item, kind). Returns true when it was new. */
export async function insertTaskIfAbsent(
  pool: Pool,
  t: {
    assignmentId: string;
    orgRoleId: string;
    holderUserId: string | null;
    itemKey: string;
    itemLabel: string;
    kind: "grant" | "revoke";
    grantingRoleId: string | null;
  },
): Promise<boolean> {
  const [r]: any = await pool.query(
    "INSERT IGNORE INTO role_access_tasks (id, assignment_id, org_role_id, holder_user_id, item_key, item_label, kind, granting_role_id) VALUES (?,?,?,?,?,?,?,?)",
    [crypto.randomUUID(), t.assignmentId, t.orgRoleId, t.holderUserId, t.itemKey, t.itemLabel.slice(0, 160), t.kind, t.grantingRoleId],
  );
  return !!r?.affectedRows;
}

export async function tasksForAssignment(pool: Pool, assignmentId: string): Promise<AccessTaskRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM role_access_tasks WHERE assignment_id = ? ORDER BY created_at, item_label`,
    [assignmentId],
  );
  return rows.map(toTask);
}

export async function tasksForHolder(pool: Pool, userId: string): Promise<AccessTaskRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM role_access_tasks WHERE holder_user_id = ? AND kind = 'grant' ORDER BY created_at, item_label LIMIT 200`,
    [userId],
  );
  return rows.map(toTask);
}

export async function taskById(pool: Pool, id: string): Promise<AccessTaskRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLS} FROM role_access_tasks WHERE id = ?`, [id]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function openTasksForRoles(pool: Pool, roleIds: string[]): Promise<AccessTaskRow[]> {
  if (!roleIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM role_access_tasks WHERE state = 'open' AND granting_role_id IN (?) ORDER BY created_at LIMIT 500`,
    [roleIds],
  );
  return rows.map(toTask);
}

export async function setTaskState(pool: Pool, id: string, state: AccessState, by: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE role_access_tasks SET state = ?, done_at = IF(? = 'open', NULL, NOW()), done_by = ? WHERE id = ?",
    [state, state, by, id],
  );
  return !!r?.affectedRows;
}

/** User ids that hold a role right now (org chart plane). */
export async function liveHolderIds(pool: Pool, orgRoleId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM org_role_assignments WHERE org_role_id = ? AND ended_at IS NULL AND holder_kind = 'member' AND user_id IS NOT NULL",
    [orgRoleId],
  );
  return rows.map((r) => String(r.user_id));
}

export async function seatingFacts(pool: Pool, assignmentId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.id, a.org_role_id, a.user_id, a.holder_kind, a.started_at, a.term_ends_at, a.ended_at, r.name AS role_name FROM org_role_assignments a LEFT JOIN org_roles r ON r.id = a.org_role_id WHERE a.id = ?",
    [assignmentId],
  );
  const r: any = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    orgRoleId: String(r.org_role_id),
    userId: r.user_id ? String(r.user_id) : null,
    holderKind: String(r.holder_kind),
    startedAt: new Date(r.started_at),
    termEndsAt: r.term_ends_at ? new Date(r.term_ends_at) : null,
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    roleName: String(r.role_name ?? r.org_role_id),
  };
}

/** A member's live seatings, for the carry-on card. */
export async function liveSeatingsOfUser(pool: Pool, userId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.id, a.org_role_id, a.started_at, a.term_ends_at, r.name AS role_name FROM org_role_assignments a LEFT JOIN org_roles r ON r.id = a.org_role_id WHERE a.user_id = ? AND a.holder_kind = 'member' AND a.ended_at IS NULL AND a.term_ends_at IS NOT NULL",
    [userId],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    orgRoleId: String(r.org_role_id),
    startedAt: new Date(r.started_at),
    termEndsAt: new Date(r.term_ends_at),
    roleName: String(r.role_name ?? r.org_role_id),
  }));
}

// ── Moon renewals ───────────────────────────────────────────────────────────

export interface RenewalRow {
  id: string;
  assignmentId: string;
  orgRoleId: string;
  userId: string;
  forTermEndsAt: Date;
  contribution: string | null;
  status: "filed" | "renewed" | "withdrawn";
  nextTermEndsAt: Date | null;
}
const RCOLS = "id, assignment_id, org_role_id, user_id, for_term_ends_at, contribution, status, next_term_ends_at";
const toRenewal = (r: any): RenewalRow => ({
  id: String(r.id),
  assignmentId: String(r.assignment_id),
  orgRoleId: String(r.org_role_id),
  userId: String(r.user_id),
  forTermEndsAt: new Date(r.for_term_ends_at),
  contribution: r.contribution ?? null,
  status: r.status,
  nextTermEndsAt: r.next_term_ends_at ? new Date(r.next_term_ends_at) : null,
});

/** File, or re-word, a carry-on for this term. A renewed one stays renewed. */
export async function fileRenewal(
  pool: Pool,
  a: { assignmentId: string; orgRoleId: string; userId: string; forTermEndsAt: Date; contribution: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO role_moon_renewals (id, assignment_id, org_role_id, user_id, for_term_ends_at, contribution) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE contribution = IF(status <> 'renewed', VALUES(contribution), contribution), status = IF(status = 'withdrawn', 'filed', status)",
    [crypto.randomUUID(), a.assignmentId, a.orgRoleId, a.userId, a.forTermEndsAt, a.contribution],
  );
}

export async function withdrawRenewal(pool: Pool, assignmentId: string, forTermEndsAt: Date, userId: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE role_moon_renewals SET status = 'withdrawn' WHERE assignment_id = ? AND for_term_ends_at = ? AND user_id = ? AND status = 'filed'",
    [assignmentId, forTermEndsAt, userId],
  );
  return !!r?.affectedRows;
}

export async function renewalFor(pool: Pool, assignmentId: string, forTermEndsAt: Date): Promise<RenewalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RCOLS} FROM role_moon_renewals WHERE assignment_id = ? AND for_term_ends_at = ?`,
    [assignmentId, forTermEndsAt],
  );
  return rows[0] ? toRenewal(rows[0]) : null;
}

export async function filedRenewals(pool: Pool): Promise<RenewalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RCOLS} FROM role_moon_renewals WHERE status = 'filed' ORDER BY filed_at LIMIT 500`,
  );
  return rows.map(toRenewal);
}

/**
 * Write the next moon's term on a live seating, once. The term it was filed
 * for must still be the seating's term, so a second press, or a term changed
 * in between, writes nothing.
 */
export async function renewSeating(pool: Pool, r: RenewalRow, nextEnds: Date, by: string): Promise<boolean> {
  const [u]: any = await pool.query(
    "UPDATE org_role_assignments SET term_ends_at = ?, season_id = NULL WHERE id = ? AND ended_at IS NULL AND term_ends_at = ?",
    [nextEnds, r.assignmentId, r.forTermEndsAt],
  );
  if (!u?.affectedRows) return false;
  // A term that had lapsed and is now renewed no longer ends: its revoke reminders are withdrawn.
  await pool.query("UPDATE role_access_tasks SET state = 'not_needed' WHERE assignment_id = ? AND kind = 'revoke' AND state = 'open'", [r.assignmentId]);
  await pool.query(
    "UPDATE role_moon_renewals SET status = 'renewed', next_term_ends_at = ?, renewed_at = NOW(), renewed_by = ? WHERE id = ? AND status = 'filed'",
    [nextEnds, by, r.id],
  );
  return true;
}
