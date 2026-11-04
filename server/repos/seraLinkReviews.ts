/**
 * The steward review queue for keyed-hash matches, and the reads the match needs.
 * No email or hash is stored or returned by anything in this file except
 * `verifiedEmailOf`, which hands the address to the hasher in memory only.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Queryable = Pool | PoolConnection;
const TOMBSTONE = "%@anonymized.invalid";

/** A standing member's verified email, or null (unverified, departed, example, unknown). */
export async function verifiedEmailOf(db: Queryable, userId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `email` FROM `users` WHERE `id` = ? AND `email_verified_at` IS NOT NULL AND `is_example` = 0 AND `email` NOT LIKE ? LIMIT 1",
    [userId, TOMBSTONE],
  );
  return rows.length && rows[0].email ? String(rows[0].email) : null;
}

export async function hasSeraLink(db: Queryable, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM `sera_person_links` WHERE `user_id` = ? LIMIT 1", [userId]);
  return rows.length > 0;
}

/** Verified, standing members with no link yet: the backfill's candidates. */
export async function unlinkedVerifiedMembers(db: Queryable): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.`id` FROM `users` u LEFT JOIN `sera_person_links` l ON l.`user_id` = u.`id` " +
      "WHERE l.`user_id` IS NULL AND u.`email_verified_at` IS NOT NULL AND u.`is_example` = 0 AND u.`email` NOT LIKE ? ORDER BY u.`id` LIMIT 2000",
    [TOMBSTONE],
  );
  return rows.map((r) => String(r.id));
}

/** A link made by the keyed match: the same table, `how` = 'email'. */
export async function linkByMatch(db: Queryable, seraOwnerId: string, userId: string): Promise<void> {
  await db.query(
    "INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `linked_by_user_id`, `how`) VALUES (?,?,NULL,'email') " +
      "ON DUPLICATE KEY UPDATE `sera_owner_id` = `sera_owner_id`",
    [seraOwnerId, userId],
  );
}

export async function linkedMemberOf(db: Queryable, seraOwnerId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `user_id` FROM `sera_person_links` WHERE `sera_owner_id` = ?", [seraOwnerId]);
  return rows.length ? String(rows[0].user_id) : null;
}

export async function queueReview(db: Queryable, userId: string, outcome: "none" | "several", matches: number, secretVersion: number): Promise<void> {
  await db.query(
    "INSERT INTO `sera_link_reviews` (`user_id`, `outcome`, `matches`, `secret_version`) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `outcome` = VALUES(`outcome`), `matches` = VALUES(`matches`), `secret_version` = VALUES(`secret_version`)",
    [userId, outcome, matches, secretVersion],
  );
}

export async function clearReview(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM `sera_link_reviews` WHERE `user_id` = ?", [userId]);
}

/** The waiting reviews, by member: what the panel marks. */
export async function reviewsByMember(db: Queryable): Promise<Map<string, { outcome: "none" | "several"; matches: number }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `user_id`, `outcome`, `matches` FROM `sera_link_reviews` LIMIT 2000");
  return new Map(rows.map((r) => [String(r.user_id), { outcome: r.outcome === "several" ? "several" : "none", matches: Number(r.matches) || 0 }]));
}
