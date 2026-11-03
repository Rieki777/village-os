/**
 * THE READS THE END-OF-MOON REVIEW GATHERS FROM (module moon-review, lane B).
 *
 * server/repos/moonRecaps.ts holds every statement against the five moon
 * tables. This file holds the statements the review READS from other domains
 * and that no existing repo answers in the shape it needs:
 *
 *   boardTasksCreatedIn   the member's task board rows set within the moon
 *   pressesFor            which of them the member pressed Done on, and the
 *                         reason on the ones they removed or redirected
 *   seatingsOfMember      every seating the member ever held, ended or not
 *   roleCardsFor          the words of a role card coverage reads
 *   roomEntryIdsOfRecap   the room entry behind each room item, for the
 *                         `canSeeTask` filter on another member's view
 *
 * WHAT THIS FILE NEVER READS: `member_tasks.private_detail`, `member_tasks.minutes`
 * and a role's CCOS `time_commitment`. Every SELECT names its columns, so none
 * of them can arrive by a `SELECT *` later. No row here carries hours.
 *
 * One function per statement, and nothing here decides anything: the rules
 * live in server/lib/moonRecap.ts.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Queryable = Pool | PoolConnection;

const ts = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

/** MySQL hands JSON back parsed on some drivers and as text on others. */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim() !== "");
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String).filter((s) => s.trim() !== "") : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── The task board ───────────────────────────────────────────────────────────

export interface BoardTask {
  id: string;
  title: string;
  source: string;
  externalId: string | null;
  status: "open" | "done" | "removed";
  removeReason: string | null;
  /** YYYY-MM-DD, the civil day the task was set. */
  createdOn: string;
  doneAt: string | null;
  roleId: string | null;
  servesGoalId: string | null;
}

/**
 * The member's board tasks SET within the moon's civil days, inclusive. A task
 * set before the moon never enters its recap. Titles only.
 */
export async function boardTasksCreatedIn(db: Queryable, userId: string, firstDay: string, lastDay: string): Promise<BoardTask[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `source`, `external_id`, `status`, `remove_reason`, DATE_FORMAT(`created_on`, '%Y-%m-%d') AS `created_on`, " +
      "`done_at`, `role_id`, `serves_goal_id` FROM `member_tasks` " +
      "WHERE `user_id` = ? AND `created_on` >= ? AND `created_on` <= ? ORDER BY `created_on` ASC, `created_at` ASC, `id` ASC",
    [userId, firstDay, lastDay],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    source: String(r.source ?? "self"),
    externalId: str(r.external_id),
    status: (["open", "done", "removed"].includes(String(r.status)) ? String(r.status) : "open") as BoardTask["status"],
    removeReason: str(r.remove_reason),
    createdOn: String(r.created_on),
    doneAt: ts(r.done_at),
    roleId: str(r.role_id),
    servesGoalId: str(r.serves_goal_id),
  }));
}

export interface BoardPress {
  taskId: string;
  action: string;
  screenReason: string | null;
  redirectToUserId: string | null;
  redirectToRoleId: string | null;
}

/**
 * The member's own presses on these tasks that still stand (an undo marks a
 * press undone), newest first per task. A Done press always writes one of
 * these rows; a close by the Sera sync never does. That row, and never a
 * timestamp, is how a press is told from a sync close.
 */
export async function pressesFor(db: Queryable, userId: string, taskIds: readonly string[]): Promise<BoardPress[]> {
  if (taskIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `task_id`, `action`, `screen_reason`, `redirect_to_user_id`, `redirect_to_role_id` FROM `member_task_feedback` " +
      "WHERE `user_id` = ? AND `task_id` IN (?) AND `undone_at` IS NULL AND `action` IN ('done', 'remove', 'redirect') " +
      "ORDER BY `created_at` DESC, `feedback_id` DESC",
    [userId, taskIds],
  );
  return rows.map((r) => ({
    taskId: String(r.task_id),
    action: String(r.action),
    screenReason: str(r.screen_reason),
    redirectToUserId: str(r.redirect_to_user_id),
    redirectToRoleId: str(r.redirect_to_role_id),
  }));
}

// ── Seats held ───────────────────────────────────────────────────────────────

export interface SeatingRow {
  id: string;
  roleId: string;
  userId: string;
  holderKind: string;
  isExample: boolean;
  applicationId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * Every seating the member has held, ended ones included, from
 * `org_role_assignments`. Never `role_holder_terms`, which is the permission
 * plane's term history and not who sat in a seat.
 */
export async function seatingsOfMember(db: Queryable, userId: string): Promise<SeatingRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `org_role_id`, `user_id`, `holder_kind`, `is_example`, `application_id`, `started_at`, `ended_at` " +
      "FROM `org_role_assignments` WHERE `user_id` = ? ORDER BY `started_at` ASC, `id` ASC",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleId: String(r.org_role_id),
    userId: String(r.user_id),
    holderKind: String(r.holder_kind ?? ""),
    isExample: Number(r.is_example) === 1,
    applicationId: str(r.application_id),
    startedAt: ts(r.started_at),
    endedAt: ts(r.ended_at),
  }));
}

export interface RoleCardWords {
  id: string;
  name: string;
  circleId: string | null;
  accountabilities: string[];
  /** The CCOS "What I do regularly" list (0274). Never its time commitment. */
  responsibilities: string[];
}

/** The words coverage reads off each role card. */
export async function roleCardsFor(db: Queryable, roleIds: readonly string[]): Promise<RoleCardWords[]> {
  if (roleIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `circle_id`, `accountabilities`, `responsibilities` FROM `org_roles` WHERE `id` IN (?)",
    [roleIds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    circleId: str(r.circle_id),
    accountabilities: list(r.accountabilities),
    responsibilities: list(r.responsibilities),
  }));
}

// ── Room items ───────────────────────────────────────────────────────────────

/** Item id to the room entry it came from (`room:<entry id>`), for this recap's room items. */
export async function roomEntryIdsOfRecap(db: Queryable, recapId: string): Promise<Map<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `dedupe_key` FROM `moon_recap_items` WHERE `recap_id` = ? AND `origin` = 'room'",
    [recapId],
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const m = /^room:(\d+)$/.exec(String(r.dedupe_key ?? ""));
    if (m) out.set(String(r.id), Number(m[1]));
  }
  return out;
}
