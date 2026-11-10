/**
 * THE ONBOARDING TABLES' ONE ENUMERABLE HOME (0365).
 *
 * Every statement against `onboarding_paths`, `onboarding_items` and
 * `onboarding_checkins` is here, with the two reads of the org chart the path
 * needs (a buddy from the same circle, the holders of a named role). The policy
 * (what a path holds, who may see a check-in) is shared/onboardingPath.ts and
 * server/lib/onboarding.ts; nothing here decides who may see what.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { ItemKind, ItemSource, OwnerKey } from "../../shared/onboardingPath";

type Q = Pool | PoolConnection;

export interface PathRow {
  id: string;
  userId: string;
  assignmentId: string;
  orgRoleId: string;
  circleId: string | null;
  buddyUserId: string | null;
  openedOn: string;
  dueOn: string;
  title: string;
  checkinDays: number[];
  status: "open" | "done" | "ended";
}

export interface ItemRow {
  id: string;
  pathId: string;
  key: string;
  kind: ItemKind;
  title: string;
  owner: OwnerKey;
  dueDay: number;
  doneWhen: string;
  source: ItemSource;
  phase: string;
  phaseFrom: number;
  phaseTo: number;
  sortOrder: number;
  doneAt: string | null;
  doneBy: string | null;
}

export interface CheckinRow {
  id: string;
  pathId: string;
  day: number;
  authorUserId: string;
  answers: string;
  filedAt: string;
}

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const stamp = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

const PATH_COLS = "id, user_id, assignment_id, org_role_id, circle_id, buddy_user_id, opened_on, due_on, title, checkin_days, status";
const ITEM_COLS = "id, path_id, item_key, kind, title, owner_key, due_day, done_when, source, phase, phase_from, phase_to, sort_order, done_at, done_by";

const pathOf = (r: RowDataPacket): PathRow => ({
  id: r.id,
  userId: r.user_id,
  assignmentId: r.assignment_id,
  orgRoleId: r.org_role_id,
  circleId: r.circle_id ?? null,
  buddyUserId: r.buddy_user_id ?? null,
  openedOn: day(r.opened_on),
  dueOn: day(r.due_on),
  title: r.title ?? "",
  checkinDays: String(r.checkin_days ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0),
  status: r.status,
});

const itemOf = (r: RowDataPacket): ItemRow => ({
  id: r.id,
  pathId: r.path_id,
  key: r.item_key,
  kind: r.kind,
  title: r.title,
  owner: r.owner_key,
  dueDay: Number(r.due_day),
  doneWhen: r.done_when,
  source: r.source,
  phase: r.phase ?? "",
  phaseFrom: Number(r.phase_from),
  phaseTo: Number(r.phase_to),
  sortOrder: Number(r.sort_order),
  doneAt: stamp(r.done_at),
  doneBy: r.done_by ?? null,
});

/** Insert a path. False when the seating already has one. */
export async function insertPath(db: Q, p: Omit<PathRow, "status">): Promise<boolean> {
  const [r]: any = await db.query(
    "INSERT IGNORE INTO onboarding_paths (id, user_id, assignment_id, org_role_id, circle_id, buddy_user_id, opened_on, due_on, title, checkin_days) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [p.id, p.userId, p.assignmentId, p.orgRoleId, p.circleId, p.buddyUserId, p.openedOn, p.dueOn, p.title, p.checkinDays.join(",")],
  );
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function insertItems(db: Q, pathId: string, items: ReadonlyArray<Omit<ItemRow, "pathId" | "doneAt" | "doneBy"> & { id: string }>): Promise<void> {
  for (const it of items) {
    await db.query(
      "INSERT IGNORE INTO onboarding_items (id, path_id, item_key, kind, title, owner_key, due_day, done_when, source, phase, phase_from, phase_to, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [it.id, pathId, it.key, it.kind, it.title, it.owner, it.dueDay, it.doneWhen, it.source, it.phase, it.phaseFrom, it.phaseTo, it.sortOrder],
    );
  }
}

export async function pathsOfUser(db: Q, userId: string, statuses: readonly string[] = ["open", "done"]): Promise<PathRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${PATH_COLS} FROM onboarding_paths WHERE user_id = ? AND status IN (${statuses.map(() => "?").join(",")}) ORDER BY opened_on DESC, id`,
    [userId, ...statuses],
  );
  return rows.map(pathOf);
}

export async function pathById(db: Q, id: string): Promise<PathRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${PATH_COLS} FROM onboarding_paths WHERE id = ?`, [id]);
  return rows[0] ? pathOf(rows[0]) : null;
}

/** Open paths where this member is the named buddy. */
export async function pathsOfBuddy(db: Q, userId: string): Promise<PathRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${PATH_COLS} FROM onboarding_paths WHERE buddy_user_id = ? AND status IN ('open','done') ORDER BY opened_on DESC, id`,
    [userId],
  );
  return rows.map(pathOf);
}

/** Every open or finished path, for a holder of the onboarding role. */
export async function allPaths(db: Q, limit = 200): Promise<PathRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${PATH_COLS} FROM onboarding_paths WHERE status IN ('open','done') ORDER BY opened_on DESC, id LIMIT ?`,
    [limit],
  );
  return rows.map(pathOf);
}

export async function itemsOfPath(db: Q, pathId: string): Promise<ItemRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${ITEM_COLS} FROM onboarding_items WHERE path_id = ? ORDER BY sort_order, item_key`, [pathId]);
  return rows.map(itemOf);
}

export async function itemById(db: Q, pathId: string, key: string): Promise<ItemRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${ITEM_COLS} FROM onboarding_items WHERE path_id = ? AND item_key = ?`, [pathId, key]);
  return rows[0] ? itemOf(rows[0]) : null;
}

/** Tick an item once. False when it was already done. */
export async function tickItem(db: Q, pathId: string, key: string, by: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE onboarding_items SET done_at = CURRENT_TIMESTAMP, done_by = ? WHERE path_id = ? AND item_key = ? AND done_at IS NULL",
    [by, pathId, key],
  );
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function setPathStatus(db: Q, id: string, status: "open" | "done" | "ended"): Promise<void> {
  await db.query("UPDATE onboarding_paths SET status = ? WHERE id = ?", [status, id]);
}

/** Keys of the items on a member's open paths that are not done yet, for the Trail. */
export async function openItemKeysOf(db: Q, userId: string): Promise<Array<{ pathId: string; key: string; kind: ItemKind }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT i.path_id, i.item_key, i.kind FROM onboarding_items i JOIN onboarding_paths p ON p.id = i.path_id " +
      "WHERE p.user_id = ? AND p.status = 'open' AND i.done_at IS NULL AND i.owner_key = 'holder'",
    [userId],
  );
  return rows.map((r) => ({ pathId: r.path_id, key: r.item_key, kind: r.kind }));
}

export async function insertCheckin(db: Q, c: { id: string; pathId: string; day: number; authorUserId: string; answers: string }): Promise<boolean> {
  const [r]: any = await db.query(
    "INSERT IGNORE INTO onboarding_checkins (id, path_id, day, author_user_id, answers) VALUES (?,?,?,?,?)",
    [c.id, c.pathId, c.day, c.authorUserId, c.answers],
  );
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function checkinsOfPath(db: Q, pathId: string): Promise<CheckinRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, path_id, day, author_user_id, answers, filed_at FROM onboarding_checkins WHERE path_id = ? ORDER BY day",
    [pathId],
  );
  return rows.map((r) => ({ id: r.id, pathId: r.path_id, day: Number(r.day), authorUserId: r.author_user_id, answers: r.answers, filedAt: stamp(r.filed_at) ?? "" }));
}

/** The member's own rows, whole: their paths, those paths' items and check-ins, and the buddy link on others'. */
export async function forgetOnboardingForMember(db: Q, userId: string): Promise<void> {
  const [mine] = await db.query<RowDataPacket[]>("SELECT id FROM onboarding_paths WHERE user_id = ?", [userId]);
  const ids = mine.map((r) => String(r.id));
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    await db.query(`DELETE FROM onboarding_checkins WHERE path_id IN (${marks})`, ids);
    await db.query(`DELETE FROM onboarding_items WHERE path_id IN (${marks})`, ids);
    await db.query(`DELETE FROM onboarding_paths WHERE id IN (${marks})`, ids);
  }
  await db.query("UPDATE onboarding_paths SET buddy_user_id = NULL WHERE buddy_user_id = ?", [userId]);
  await db.query("DELETE FROM onboarding_checkins WHERE author_user_id = ?", [userId]);
  await db.query("UPDATE onboarding_items SET done_by = NULL WHERE done_by = ?", [userId]);
}

// ── Two reads of the org chart ──────────────────────────────────────────────

/** A role's circle and its card's "First 90 days" text. */
export async function roleFacts(db: Q, orgRoleId: string): Promise<{ name: string; circleId: string | null; first90: string | null } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT name, circle_id, first_90_day_outcomes FROM org_roles WHERE id = ?", [orgRoleId]);
  const r = rows[0];
  return r ? { name: r.name, circleId: r.circle_id ?? null, first90: r.first_90_day_outcomes ?? null } : null;
}

/** The longest-serving live holder, in the same circle, of any role but the new holder's own seating. */
export async function buddyCandidate(db: Q, circleId: string, exceptUserId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT a.user_id FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_agent = 0 AND a.is_example = 0 AND a.user_id IS NOT NULL AND a.user_id <> ? AND r.circle_id = ? " +
      "ORDER BY a.started_at, a.user_id LIMIT 1",
    [exceptUserId, circleId],
  );
  return rows[0] ? String(rows[0].user_id) : null;
}

/** A member's stored name, for a first name on the path. Null when there is none. */
export async function nameOf(db: Q, userId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT name FROM users WHERE id = ?", [userId]);
  return rows[0]?.name ? String(rows[0].name) : null;
}

/** Whether the member holds, live, a role with this name. */
export async function holdsRoleNamed(db: Q, userId: string, roleName: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 AS ok FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.ended_at IS NULL AND a.holder_kind = 'member' AND a.user_id = ? AND r.active = 1 AND LOWER(r.name) = LOWER(?) LIMIT 1",
    [userId, roleName],
  );
  return rows.length > 0;
}
