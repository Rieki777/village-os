/**
 * `reward_moment_seen` (0294), and the reads a reward moment makes of what
 * landed for a member: their work credits on the ledger, their cash marked
 * paid, and the titles of the work behind each.
 *
 * One function per statement, rows back as the driver hands them, and every
 * decision stays in server/lib/rewardMoment.ts. The ledger and `cash_owed`
 * are only READ here. Nothing in this file writes either.
 *
 * THE BASELINE IS COMPARED IN SQL. `at` and `paid_at` are TIMESTAMPs, and a
 * TIMESTAMP read into JavaScript shifts by the database host's offset, so a
 * baseline carried through a Date and back could skip or replay an hour of
 * arrivals. The subquery keeps both sides of the comparison in the database.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export const BASELINE_KEY = "baseline";

const BASELINE = "(SELECT b.`seen_at` FROM `reward_moment_seen` b WHERE b.`user_id` = ? AND b.`arrival_key` = 'baseline')";

/** Start counting arrivals for a member from now. A second call changes nothing. */
export async function insertBaselineRow(pool: Pool, userId: string): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO `reward_moment_seen` (`user_id`, `arrival_key`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `user_id` = `user_id`",
    [userId, BASELINE_KEY],
  );
  return res;
}

/** Whether a member has a baseline yet. */
export async function hasBaselineRow(pool: Pool, userId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM `reward_moment_seen` WHERE `user_id` = ? AND `arrival_key` = ?",
    [userId, BASELINE_KEY],
  );
  return rows.length > 0;
}

/** Credits to a member's account from the given sources, at or after their baseline, oldest first. */
export async function workCreditRowsSince(
  pool: Pool,
  accountId: string,
  userId: string,
  sources: readonly string[],
  limit: number,
): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `token_type`, `amount`, `source`, `source_ref` FROM `token_ledger` " +
      `WHERE \`to_account\` = ? AND \`source\` IN (?) AND \`at\` >= ${BASELINE} ORDER BY \`at\`, \`id\` LIMIT ?`,
    [accountId, sources, userId, limit],
  );
  return rows;
}

/** Every claim whose consent paid this account something at or after the member's baseline, with the token. */
export async function questConsentRefsSince(pool: Pool, accountId: string, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT `source_ref`, `token_type` FROM `token_ledger` " +
      `WHERE \`to_account\` = ? AND \`source\` = 'quest_consent' AND \`amount\` > 0 AND \`at\` >= ${BASELINE}`,
    [accountId, userId],
  );
  return rows;
}

/** A member's cash rows marked paid at or after their baseline, oldest first. */
export async function cashPaidRowsSince(pool: Pool, userId: string, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `work_title`, `amount_minor`, `currency` FROM `cash_owed` " +
      `WHERE \`user_id\` = ? AND \`state\` = 'paid' AND \`paid_at\` >= ${BASELINE} ORDER BY \`paid_at\`, \`id\` LIMIT ?`,
    [userId, userId, limit],
  );
  return rows;
}

/** Which of these keys a member has already been shown. */
export async function seenKeyRows(pool: Pool, userId: string, keys: string[]): Promise<RowDataPacket[]> {
  if (!keys.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `arrival_key` FROM `reward_moment_seen` WHERE `user_id` = ? AND `arrival_key` IN (?)",
    [userId, keys],
  );
  return rows;
}

/** Record keys as shown. A key already recorded is left as it was. */
export async function insertSeenRows(pool: Pool, userId: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await pool.query(
    "INSERT INTO `reward_moment_seen` (`user_id`, `arrival_key`) VALUES ? ON DUPLICATE KEY UPDATE `user_id` = `user_id`",
    [keys.map((k) => [userId, k])],
  );
}

/** The quest behind each consented claim: the title on the claim, else the quest's own. */
export async function questTitleRows(pool: Pool, claimIds: string[]): Promise<RowDataPacket[]> {
  if (!claimIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.`id`, COALESCE(NULLIF(c.`quest_title`, ''), q.`title`) AS `title` FROM `quest_claims` c " +
      "LEFT JOIN `quests` q ON q.`id` = c.`quest_id` WHERE c.`id` IN (?)",
    [claimIds],
  );
  return rows;
}

/** The role behind each seat a cycle paid. */
export async function roleNameRows(pool: Pool, seatIds: string[]): Promise<RowDataPacket[]> {
  if (!seatIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.`id`, r.`name` FROM `org_role_assignments` a JOIN `org_roles` r ON r.`id` = a.`org_role_id` WHERE a.`id` IN (?)",
    [seatIds],
  );
  return rows;
}

/** Every marker a member left: their baseline and each arrival they were shown. For erasure. */
export async function forgetRewardMomentsOf(pool: Pool, userId: string): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM `reward_moment_seen` WHERE `user_id` = ?", [userId]);
  return res;
}

/** The proposal behind each accepted submission, as the proposer wrote it. */
export async function proposalDataRows(pool: Pool, submissionIds: string[]): Promise<RowDataPacket[]> {
  if (!submissionIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `data` FROM `submissions` WHERE `id` IN (?)",
    [submissionIds],
  );
  return rows;
}
