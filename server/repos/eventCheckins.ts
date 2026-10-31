/**
 * `event_checkins`: a home being started, with the erasure's two statements in it.
 *
 * `checkIn` and `checkinCount` in server/lib/economy.ts still write and read
 * this table where they always did. What lives here is what the erasure added
 * (lane E2): the read that refuses a check-in for a departed member, and the
 * write that clears a steward's note about one. Both are called from
 * economy.ts, so a reader who lands here knows where the rest are.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** The address on the attendee's account, or null when there is no such account. */
export async function attendeeEmail(pool: Pool, userId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `email` FROM `users` WHERE `id` = ?", [userId]);
  return rows[0] ? String(rows[0].email ?? "") : null;
}

/** Clear the note on every check-in of one member. NULL is a constant, so a second run matches nothing. */
export async function clearCheckinNotes(pool: Pool, villageId: string, userId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE `event_checkins` SET `note` = NULL WHERE `village_id` = ? AND `user_id` = ? AND `note` IS NOT NULL",
    [villageId, userId],
  );
  return Number(res.affectedRows ?? 0);
}
