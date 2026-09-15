/**
 * `event_seat_charges`: a home being started, with one read in it.
 *
 * ── THIS IS NOT THE TABLE'S ONLY DOOR, AND SAYING SO IS THE POINT ────────
 *
 * `server/lib/eventSeats.ts` charges, settles and refunds seats against this
 * table, and `server/lib/gatherings.ts` reads it (counted 2026-09-14). None of
 * that moved here. What moved is the one read `server/lib/holdings.ts` made,
 * verbatim, so a reader who lands here knows where the rest are.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * One member's seat fees still held in escrow, with the gathering's title,
 * oldest first. `status = 'held'` is `seatEscrowDrift`'s own test. A LEFT
 * JOIN, so a charge whose event row is gone still comes back.
 */
export async function heldSeatChargeRows(pool: Pool, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.`id`, c.`token_type`, c.`amount`, e.`title` FROM `event_seat_charges` c " +
      "LEFT JOIN `events` e ON e.`id` = c.`event_id` " +
      "WHERE c.`user_id` = ? AND c.`status` = 'held' ORDER BY c.`created_at`",
    [userId],
  );
  return rows;
}
