/**
 * A member's saved time zone (role journey L6, table `member_time_zones`).
 * No row reads as null: the member has not chosen, and screens fall back to
 * the browser's zone.
 */
import type { RowDataPacket } from "mysql2";
import type { Queryable } from "./memberTasks";
import { normalizeTimeZone } from "../../shared/memberTimeZone";

export async function timeZoneOf(db: Queryable, userId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `time_zone` FROM `member_time_zones` WHERE `user_id` = ?", [userId]);
  return rows.length ? normalizeTimeZone(rows[0].time_zone) : null;
}

/** Save a zone, or clear it with null. Returns false when the zone is not an IANA name. */
export async function setTimeZone(db: Queryable, userId: string, zone: unknown): Promise<boolean> {
  if (zone === null || zone === "") {
    await db.query("DELETE FROM `member_time_zones` WHERE `user_id` = ?", [userId]);
    return true;
  }
  const clean = normalizeTimeZone(zone);
  if (!clean) return false;
  await db.query(
    "INSERT INTO `member_time_zones` (`user_id`, `time_zone`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `time_zone` = VALUES(`time_zone`)",
    [userId, clean],
  );
  return true;
}

/** Erasure: the zone goes with the person. */
export async function forgetTimeZone(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM `member_time_zones` WHERE `user_id` = ?", [userId]);
}
