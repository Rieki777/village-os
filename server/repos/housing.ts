/**
 * Housing reads, in a repo because that is where reads live.
 *
 * `reservationsForMember` was written in `server/lib/housing.ts` on the
 * reasoning that a table's readers should stay in one file. The rule wants the
 * same thing and puts the file somewhere else: queries live under
 * `server/repos` so the caches above them stay correct and a table's readers
 * stay ENUMERABLE, which means findable by looking in one known directory
 * rather than by knowing which lib happens to own the subject.
 *
 * The gate could not say so at the time. Its raw-SQL rule was anchored on
 * `query\s*\(` and a TypeScript generic broke the match, so
 * `pool.query<RowDataPacket[]>(...)` passed while the identical untyped call
 * failed. That hole hid 436 call sites, this one among them. Widening the
 * pattern made it visible on the first run, which is the whole argument for
 * fixing a gate rather than working around it.
 *
 * It sits beside `investorPath.ts` and `ventures.ts`, the two repos written
 * for the same feature, so all three per-path readers are in one place.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { ReservationRow } from "../lib/housing";

const VILLAGE = "local";

/**
 * Every reservation a member has made, newest first.
 *
 * Served by migration 0159's `housing_res_member_idx (village_id, user_id,
 * status)`. Without it this is a full scan: 0077 indexed the table for the
 * hamlet view and for the email lookup, and neither is reachable from a user
 * id.
 *
 * `user_id` is nullable because the reservation form is deliberately open to
 * people with no account, so a lead is never lost for want of a login. This
 * read is the signed-in half of that.
 */
export async function reservationsForMember(
  pool: Pool,
  userId: string,
): Promise<ReservationRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, structure_key, home_type, name, email, phone, notes, arrived_from, status, user_id, created_at " +
      "FROM housing_reservations WHERE village_id = ? AND user_id = ? ORDER BY created_at DESC",
    [VILLAGE, userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    structureKey: r.structure_key == null ? null : String(r.structure_key),
    homeType: String(r.home_type),
    name: String(r.name),
    email: String(r.email),
    phone: r.phone == null ? null : String(r.phone),
    notes: r.notes == null ? null : String(r.notes),
    arrivedFrom: r.arrived_from == null ? null : String(r.arrived_from),
    status: String(r.status),
    userId: r.user_id == null ? null : String(r.user_id),
    createdAt: String(r.created_at),
  }));
}
