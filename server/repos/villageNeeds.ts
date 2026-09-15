/**
 * The needs scope's three tables: `village_needs`, `need_links` (0204) and
 * `member_needs` (0205). Every statement `server/lib/needs.ts` runs against
 * them, moved verbatim.
 *
 * ── WHAT MOVED, AND WHAT DELIBERATELY DID NOT ────────────────────────────
 *
 * One function per statement, and each hands back exactly what the driver
 * handed back: the rows, or the result header for a DELETE. The mapping into
 * `NeedScopeRow`, `NeedLinkRow` and `MemberNeedRow`, the id minting, the
 * clipping, the floor and every refusal stayed in the lib, beside the rules
 * they keep. A repo that mapped would be a second opinion about a row's
 * shape, and the lib's mappers are what its tests pin.
 *
 * No function here runs inside a transaction and none takes a lock: the
 * scope's writes are single upserts held by unique indexes, which is what the
 * lib's own comments say, and that is why these can take a pool.
 *
 * ── THE ONE LITERAL THAT CARRIES A RULE ──────────────────────────────────
 *
 * `upsertMemberNeedRow` writes `visibility` as the literal 'private' and takes
 * no visibility argument at all. That literal is the structural half of the
 * rule `saveMemberNeed` describes: no code path can write another value, and
 * the ON DUPLICATE clause does not name the column either.
 *
 * ── NO CACHE SITS ABOVE THESE TABLES ─────────────────────────────────────
 *
 * Every read goes to the database when asked. This file exists so the tables'
 * readers and writers stay enumerable, which for `member_needs` is the
 * privacy promise: `memberNeedRowsAllCycles` and `memberNeedRowsForCycle` are
 * the only reads that return a member's row, and both take the user id they
 * filter on.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const MEMBER_NEED_COLUMNS =
  "`id`, `need_key`, `depth`, `feeling`, `note`, `visibility`, `cycle_id`, `recorded_at`, `updated_at`";

// ── village_needs ───────────────────────────────────────────────────────────

/** The scope, retired rows excluded unless asked for by name. */
export async function scopeRows(pool: Pool, includeRetired: boolean): Promise<RowDataPacket[]> {
  const where = includeRetired ? "" : "WHERE `retired_at` IS NULL ";
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, " +
      "`sort_order`, `adopted_at`, `retired_at` FROM `village_needs` " +
      `${where}ORDER BY \`sort_order\`, \`adopted_at\`, \`id\``,
  );
  return rows;
}

/** One scope row by its key, retired or not. At most one row. */
export async function needRowByKey(pool: Pool, needKey: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, " +
      "`sort_order`, `adopted_at`, `retired_at` FROM `village_needs` WHERE `need_key` = ? LIMIT 1",
    [needKey],
  );
  return rows;
}

/** One scope write. An upsert onto a retired row un-retires it. */
export async function upsertNeedRow(
  pool: Pool,
  row: {
    id: string;
    needKey: string;
    label: string;
    isCustom: 0 | 1;
    depthTarget: string;
    breadthTargetPct: number;
    note: string | null;
    sortOrder: number;
  },
): Promise<void> {
  await pool.query(
    "INSERT INTO `village_needs` " +
      "(`id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, `sort_order`) " +
      "VALUES (?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `depth_target` = VALUES(`depth_target`), " +
      "`breadth_target_pct` = VALUES(`breadth_target_pct`), `note` = VALUES(`note`), " +
      "`sort_order` = VALUES(`sort_order`), `retired_at` = NULL",
    [row.id, row.needKey, row.label, row.isCustom, row.depthTarget, row.breadthTargetPct, row.note, row.sortOrder],
  );
}

/** Stamp a live need retired. A row already retired keeps its timestamp. */
export async function retireNeedRow(pool: Pool, needKey: string): Promise<void> {
  await pool.query("UPDATE `village_needs` SET `retired_at` = NOW() WHERE `need_key` = ? AND `retired_at` IS NULL", [
    needKey,
  ]);
}

/** Put a retired need back in scope. */
export async function reviveNeedRow(pool: Pool, needKey: string): Promise<void> {
  await pool.query("UPDATE `village_needs` SET `retired_at` = NULL WHERE `need_key` = ?", [needKey]);
}

// ── need_links ──────────────────────────────────────────────────────────────

/** One tag. Tagging the same subject twice updates the weight. */
export async function upsertLinkRow(
  pool: Pool,
  row: {
    id: string;
    needId: string;
    subjectType: string;
    subjectRef: string;
    weight: string;
    createdBy: string | null;
  },
): Promise<void> {
  await pool.query(
    "INSERT INTO `need_links` (`id`, `need_id`, `subject_type`, `subject_ref`, `weight`, `created_by`) " +
      "VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `weight` = VALUES(`weight`)",
    [row.id, row.needId, row.subjectType, row.subjectRef, row.weight, row.createdBy],
  );
}

/** The tag on one (need, subject type, subject ref). At most one row. */
export async function linkRowFor(
  pool: Pool,
  needId: string,
  subjectType: string,
  subjectRef: string,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_id`, `subject_type`, `subject_ref`, `weight`, `created_by`, `created_at` " +
      "FROM `need_links` WHERE `need_id` = ? AND `subject_type` = ? AND `subject_ref` = ? LIMIT 1",
    [needId, subjectType, subjectRef],
  );
  return rows;
}

/** Delete one tag by id. The result header, so the caller reads `affectedRows`. */
export async function deleteLinkRow(pool: Pool, linkId: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `need_links` WHERE `id` = ?", [linkId]);
  return r;
}

/** Delete every tag onto one subject. The result header. */
export async function deleteLinksForSubject(pool: Pool, subjectType: string, subjectRef: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `need_links` WHERE `subject_type` = ? AND `subject_ref` = ?", [
    subjectType,
    subjectRef,
  ]);
  return r;
}

/** Every tag on one need, retired or not. */
export async function linkRowsForNeed(pool: Pool, needKey: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`need_id`, l.`subject_type`, l.`subject_ref`, l.`weight`, l.`created_by`, l.`created_at` " +
      "FROM `need_links` l JOIN `village_needs` n ON n.`id` = l.`need_id` " +
      "WHERE n.`need_key` = ? ORDER BY l.`subject_type`, l.`subject_ref`",
    [needKey],
  );
  return rows;
}

/** Every need one subject meets, with the need's key, label and retirement. */
export async function linkRowsForSubject(pool: Pool, subjectType: string, subjectRef: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`need_id`, l.`subject_type`, l.`subject_ref`, l.`weight`, l.`created_by`, l.`created_at`, " +
      "n.`need_key`, n.`label`, n.`retired_at` " +
      "FROM `need_links` l JOIN `village_needs` n ON n.`id` = l.`need_id` " +
      "WHERE l.`subject_type` = ? AND l.`subject_ref` = ? ORDER BY n.`sort_order`, n.`need_key`",
    [subjectType, subjectRef],
  );
  return rows;
}

/** Tag counts per live need, subject type and weight. One round trip. */
export async function coverageCountRows(pool: Pool): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT n.`need_key` AS need_key, l.`subject_type` AS subject_type, l.`weight` AS weight, " +
      "COUNT(*) AS n FROM `village_needs` n JOIN `need_links` l ON l.`need_id` = n.`id` " +
      "WHERE n.`retired_at` IS NULL GROUP BY n.`need_key`, l.`subject_type`, l.`weight`",
  );
  return rows;
}

/**
 * The active roles each live need is tagged to, with their seats and live
 * seatings. Reads `org_roles` and `org_role_assignments` too, by the same
 * `ended_at IS NULL` clause the settlement and `loadOrgChart` use.
 */
export async function seatingRows(pool: Pool): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT n.`need_key` AS need_key, r.`id` AS role_id, r.`name` AS role_name, r.`seats` AS seats, " +
      "(SELECT COUNT(*) FROM `org_role_assignments` a WHERE a.`org_role_id` = r.`id` AND a.`ended_at` IS NULL) AS held " +
      "FROM `village_needs` n " +
      "JOIN `need_links` l ON l.`need_id` = n.`id` AND l.`subject_type` = 'role' " +
      "JOIN `org_roles` r ON r.`id` = l.`subject_ref` AND r.`active` = 1 " +
      "WHERE n.`retired_at` IS NULL ORDER BY n.`sort_order`, r.`sort_order`, r.`id`",
  );
  return rows;
}

// ── member_needs ────────────────────────────────────────────────────────────

/** One member's answer for one need in one cycle. `visibility` is the literal. */
export async function upsertMemberNeedRow(
  pool: Pool,
  row: {
    id: string;
    userId: string;
    needKey: string;
    depth: string;
    feeling: string | null;
    note: string | null;
    cycleId: string;
  },
): Promise<void> {
  await pool.query(
    "INSERT INTO `member_needs` " +
      "(`id`, `user_id`, `need_key`, `depth`, `feeling`, `note`, `visibility`, `cycle_id`) " +
      "VALUES (?,?,?,?,?,?,'private',?) " +
      "ON DUPLICATE KEY UPDATE `depth` = VALUES(`depth`), `feeling` = VALUES(`feeling`), " +
      "`note` = VALUES(`note`)",
    [row.id, row.userId, row.needKey, row.depth, row.feeling, row.note, row.cycleId],
  );
}

/** The one row a save just wrote or updated. At most one row. */
export async function memberNeedRow(
  pool: Pool,
  userId: string,
  needKey: string,
  cycleId: string,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` ` +
      "WHERE `user_id` = ? AND `need_key` = ? AND `cycle_id` = ? LIMIT 1",
    [userId, needKey, cycleId],
  );
  return rows;
}

/** Every answer one member ever gave, newest cycle first. */
export async function memberNeedRowsAllCycles(pool: Pool, userId: string): Promise<RowDataPacket[]> {
  const [all] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` WHERE \`user_id\` = ? ` +
      "ORDER BY `cycle_id` DESC, `need_key`",
    [userId],
  );
  return all;
}

/** One member's answers in one cycle. */
export async function memberNeedRowsForCycle(pool: Pool, userId: string, cycleId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` WHERE \`user_id\` = ? AND \`cycle_id\` = ? ` +
      "ORDER BY `need_key`",
    [userId, cycleId],
  );
  return rows;
}

/** Take one answer back. The result header. */
export async function deleteMemberNeedRow(pool: Pool, userId: string, needKey: string, cycleId: string): Promise<any> {
  const [r] = await pool.query<any>(
    "DELETE FROM `member_needs` WHERE `user_id` = ? AND `need_key` = ? AND `cycle_id` = ?",
    [userId, needKey, cycleId],
  );
  return r;
}

/** Every answer one member gave, deleted. The result header. */
export async function deleteMemberNeedsForUser(pool: Pool, userId: string): Promise<any> {
  const [r] = await pool.query<any>("DELETE FROM `member_needs` WHERE `user_id` = ?", [userId]);
  return r;
}

/**
 * Answers per need and depth in one cycle. COUNTS ONLY: the column list names
 * no `user_id`, which is what keeps the aggregate an aggregate.
 */
export async function aggregateTallyRows(pool: Pool, cycleId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `need_key` AS need_key, `depth` AS depth, COUNT(*) AS n FROM `member_needs` " +
      "WHERE `cycle_id` = ? GROUP BY `need_key`, `depth`",
    [cycleId],
  );
  return rows;
}
