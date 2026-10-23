/**
 * Housing reads, in a repo because that is where reads live, and the one
 * write the erasure makes (`scrubReservationsOf`, at the end of the file).
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

/**
 * Scrub every housing request that is this member's, for the erasure's
 * `housing-reservations-after-tombstone` step (server/lib/erasure.ts).
 *
 * SCRUBBED, NEVER DELETED. A `reserved` row is a home held, and while a
 * hamlet's `taken_source` is 'reservations' it counts toward that hamlet's
 * homes taken, so deleting it would hand the home back on the public map with
 * nobody having decided that. The row keeps its home type, hamlet, route and
 * status, and loses everything that names the person: the name becomes the
 * tombstone's label, the address becomes the tombstone's address, and the
 * phone, the notes and the account link go.
 *
 * WHICH ROWS ARE THEIRS. Every row on their account, and every row sent under
 * their address before they had one (the public form needs no sign-in, so a
 * request made before joining carries no `user_id`). The address is matched
 * the way the path facts match it (server/repos/commsPathFacts.ts), trimmed and
 * lower-cased. A resume past the tombstone still has the old address, held in
 * `member_erasures` (0282). `emailKey` is empty only for a record from before
 * that, and then only the account's rows are found, the same limit the comms
 * step states.
 *
 * `updated_at` is held where it was: a scrub is not the founder moving the
 * request along, and the column would otherwise say it was touched today.
 *
 * Idempotent: it writes constants, and a second run either matches nothing or
 * writes the same values again.
 */
export async function scrubReservationsOf(
  pool: Pool,
  input: { userId: string; emailKey: string; name: string; address: string },
): Promise<number> {
  const [r]: any = await pool.query(
    "UPDATE housing_reservations SET name = ?, email = ?, phone = NULL, notes = NULL, user_id = NULL, updated_at = updated_at " +
      "WHERE village_id = ? AND (user_id = ? OR (? <> '' AND LOWER(TRIM(email)) = ?))",
    [input.name, input.address, VILLAGE, input.userId, input.emailKey, input.emailKey],
  );
  return Number(r?.affectedRows ?? 0);
}
