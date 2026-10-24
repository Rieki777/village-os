/**
 * Meet-me windows (the `events` rows of kind `meet-me`), for the erasure: a
 * home being started, with one read in it.
 *
 * server/lib/calendarCommunity.ts still opens, lists and closes windows where
 * it always did. What lives here is the read the erasure's meet-me step makes
 * (lane E2), called from `forgetMeetMeWindowsOf` in server/lib/gatherings.ts,
 * which frees each window the way any gathering is freed.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Every window a member ever opened, past or ahead, by id. */
export async function meetMeWindowIdsOf(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM events WHERE kind = 'meet-me' AND (created_by = ? OR owner_user_id = ?)",
    [userId, userId],
  );
  return rows.map((r) => String(r.id));
}
