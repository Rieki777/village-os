/**
 * The `role_tensions` table (0269), and the few reads of the org chart and the
 * circles a tension needs. Every statement for the feature lives here; the
 * rules are server/lib/roleTensions.ts and the contract is
 * shared/roleTensions.ts.
 *
 * Instants are written from Node's clock and read back as epoch seconds with
 * UNIX_TIMESTAMP(col), so the database session's zone never shifts one.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { isTensionStatus, type TensionStatus } from "../../shared/roleTensions";

export type Queryable = Pool | PoolConnection;

export interface TensionRow {
  id: string;
  roleId: string;
  raisedBy: string | null;
  text: string;
  status: TensionStatus;
  answerNote: string | null;
  answeredBy: string | null;
  circleEntryId: number | null;
  createdAt: Date;
  answeredAt: Date | null;
}

const COLUMNS =
  "`id`, `org_role_id`, `raised_by`, `text`, `status`, `answer_note`, `answered_by`, `circle_entry_id`, " +
  "UNIX_TIMESTAMP(`created_at`) AS `created_s`, UNIX_TIMESTAMP(`answered_at`) AS `answered_s`";

const none = <T>(list: readonly T[]): boolean => list.length === 0;

const at = (s: unknown): Date | null => (s == null ? null : new Date(Number(s) * 1000));

function mapRow(r: RowDataPacket): TensionRow {
  const status = String(r.status);
  return {
    id: String(r.id),
    roleId: String(r.org_role_id),
    raisedBy: r.raised_by == null ? null : String(r.raised_by),
    text: String(r.text ?? ""),
    // An unknown status is read as answered: the safe side, since it hides the words.
    status: isTensionStatus(status) ? status : "answered",
    answerNote: r.answer_note == null ? null : String(r.answer_note),
    answeredBy: r.answered_by == null ? null : String(r.answered_by),
    circleEntryId: r.circle_entry_id == null ? null : Number(r.circle_entry_id),
    createdAt: at(r.created_s) ?? new Date(0),
    answeredAt: at(r.answered_s),
  };
}

export async function insertTension(
  q: Queryable,
  row: { id: string; roleId: string; raisedBy: string; text: string; now: Date },
): Promise<void> {
  await q.query(
    "INSERT INTO `role_tensions` (`id`, `org_role_id`, `raised_by`, `text`, `status`, `created_at`) VALUES (?, ?, ?, ?, 'open', ?)",
    [row.id, row.roleId, row.raisedBy, row.text, row.now],
  );
}

export async function tensionById(q: Queryable, id: string, lock = false): Promise<TensionRow | null> {
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`role_tensions\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/** Every tension raised with these roles, newest first. */
export async function tensionsForRoleIds(q: Queryable, roleIds: readonly string[]): Promise<TensionRow[]> {
  if (none(roleIds)) return [];
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`role_tensions\` WHERE \`org_role_id\` IN (?) ORDER BY \`created_at\` DESC, \`id\` DESC`,
    [roleIds],
  );
  return rows.map(mapRow);
}

/** Open and taken tensions with these roles, oldest first. */
export async function openTensionsForRoleIds(q: Queryable, roleIds: readonly string[]): Promise<TensionRow[]> {
  if (none(roleIds)) return [];
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`role_tensions\` WHERE \`org_role_id\` IN (?) AND \`status\` IN ('open', 'taken') ORDER BY \`created_at\`, \`id\``,
    [roleIds],
  );
  return rows.map(mapRow);
}

/** Tensions nobody has picked up, raised at or before `before`: the reminder job's candidates. */
export async function untakenOlderThan(q: Queryable, before: Date): Promise<TensionRow[]> {
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`role_tensions\` WHERE \`status\` = 'open' AND \`created_at\` <= ? ORDER BY \`created_at\`, \`id\` LIMIT 500`,
    [before],
  );
  return rows.map(mapRow);
}

/** Move one tension. The caller has decided the move is allowed and holds the row's lock. */
export async function writeResponse(
  q: Queryable,
  id: string,
  row: { status: TensionStatus; answeredBy: string; answerNote: string | null; answeredAt: Date | null; circleEntryId: number | null },
): Promise<void> {
  await q.query(
    "UPDATE `role_tensions` SET `status` = ?, `answered_by` = ?, `answer_note` = COALESCE(?, `answer_note`), " +
      "`answered_at` = COALESCE(?, `answered_at`), `circle_entry_id` = COALESCE(?, `circle_entry_id`) WHERE `id` = ?",
    [row.status, row.answeredBy, row.answerNote, row.answeredAt, row.circleEntryId, id],
  );
}

// ── The org chart, as a tension reads it ────────────────────────────────────

/** One role's title and circle, or null. Standing examples are left out. */
export async function roleForTension(q: Queryable, roleId: string): Promise<{ id: string; name: string; circleId: string | null } | null> {
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `circle_id` FROM `org_roles` WHERE `id` = ? AND `is_example` = 0 LIMIT 1",
    [roleId],
  );
  if (!rows.length) return null;
  return { id: String(rows[0].id), name: String(rows[0].name ?? ""), circleId: rows[0].circle_id == null ? null : String(rows[0].circle_id) };
}

/** Titles and circle names for these roles. */
export async function rolesWithCircles(q: Queryable, roleIds: readonly string[]): Promise<Map<string, { name: string; circle: string | null }>> {
  const out = new Map<string, { name: string; circle: string | null }>();
  if (none(roleIds)) return out;
  const [rows] = await q.query<RowDataPacket[]>(
    "SELECT `r`.`id`, `r`.`name`, `c`.`name` AS `circle_name` FROM `org_roles` `r` LEFT JOIN `circles` `c` ON `c`.`id` = `r`.`circle_id` WHERE `r`.`id` IN (?)",
    [roleIds],
  );
  for (const r of rows) out.set(String(r.id), { name: String(r.name ?? ""), circle: r.circle_name == null ? null : String(r.circle_name) });
  return out;
}

/**
 * Who holds each role now, as `shared/roleTensions.ts` reads a live holder: a
 * seating not ended, held as a member, no standing example. `roleIds` limits
 * it to those roles; `userId` to the roles one member holds.
 */
export async function liveHoldings(q: Queryable, opts: { roleIds?: readonly string[]; userId?: string }): Promise<Array<{ roleId: string; userId: string }>> {
  if (opts.roleIds && none(opts.roleIds)) return [];
  const where = ["`ended_at` IS NULL", "`holder_kind` = 'member'", "`user_id` IS NOT NULL", "`is_example` = 0"];
  const params: unknown[] = [];
  if (opts.roleIds) {
    where.push("`org_role_id` IN (?)");
    params.push(opts.roleIds);
  }
  if (opts.userId) {
    where.push("`user_id` = ?");
    params.push(opts.userId);
  }
  const [rows] = await q.query<RowDataPacket[]>(
    `SELECT DISTINCT \`org_role_id\`, \`user_id\` FROM \`org_role_assignments\` WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows.map((r) => ({ roleId: String(r.org_role_id), userId: String(r.user_id) }));
}

// ── Erasure ─────────────────────────────────────────────────────────────────

/**
 * A member leaves: their unanswered words are cleared, their answer notes go,
 * and they are taken off every row as raiser and as answerer. Answered words
 * stay, de-attributed: once answered they are the role's record.
 */
export async function forgetTensionsOf(q: Queryable, userId: string): Promise<number> {
  let n = 0;
  const run = async (sql: string) => {
    const [r]: any = await q.query(sql, [userId]);
    n += Number(r?.affectedRows ?? 0);
  };
  await run("UPDATE `role_tensions` SET `text` = '' WHERE `raised_by` = ? AND `status` IN ('open', 'taken')");
  await run("UPDATE `role_tensions` SET `answer_note` = NULL, `answered_by` = NULL WHERE `answered_by` = ?");
  await run("UPDATE `role_tensions` SET `raised_by` = NULL WHERE `raised_by` = ?");
  return n;
}
