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
 * their address with NO account on it (the public form needs no sign-in, so a
 * request made before joining carries no `user_id`). The address is matched
 * the way the path facts match it (server/repos/commsPathFacts.ts), trimmed and
 * lower-cased. A resume past the tombstone still has the old address, held in
 * `member_erasures` (0282). `emailKey` is empty only for a record from before
 * that, and then only the account's rows are found, the same limit the comms
 * step states.
 *
 * A ROW ANOTHER ACCOUNT OWNS IS THAT MEMBER'S, even when the contact address
 * typed on it is the leaver's: a household where one partner filed for both
 * of them. It stays on their account, with their name, phone, notes and
 * status, so it stays on their resident path. Only the leaver's address comes
 * off it, replaced by the tombstone's, so nothing on it shows or mails the
 * person who left. That second write is the reason this is two statements:
 * matching such a row by address alone once unlinked a living member's held
 * home and wrote "A departed member" over their name. Whether the living
 * member's own address should go in its place is Rye's to decide (raised
 * 2026-10-23); until then a founder reaches them by the phone on the row.
 *
 * THE AUDIT LINE GOES WITH THE NAME. The request route writes an admin event
 * ("Wren Halloway asked for a casita in ridgeA") keyed to the row, a second
 * copy of the name the row held. Each one on a row scrubbed here is written
 * again with the tombstone's label, from the row's own home type and hamlet,
 * so the founder's history keeps what was asked for and loses who asked. It is
 * keyed on the tombstone address the scrub leaves, not on the address that
 * found the row, so a resume that no longer knows the old address still finds
 * every row the first run scrubbed.
 *
 * `updated_at` (and the event's `at`) is held where it was: a scrub is not the
 * founder moving the request along, and the column would otherwise say it was
 * touched today.
 *
 * Idempotent: every statement writes a constant or a value read off the row
 * it writes, so a second run either matches nothing or writes the same values
 * again.
 */
export async function scrubReservationsOf(
  pool: Pool,
  input: { userId: string; emailKey: string; name: string; address: string },
): Promise<{ scrubbed: number; addressOnly: number; auditLines: number }> {
  const [own]: any = await pool.query(
    "UPDATE housing_reservations SET name = ?, email = ?, phone = NULL, notes = NULL, user_id = NULL, updated_at = updated_at " +
      "WHERE village_id = ? AND (user_id = ? OR (user_id IS NULL AND ? <> '' AND LOWER(TRIM(email)) = ?))",
    [input.name, input.address, VILLAGE, input.userId, input.emailKey, input.emailKey],
  );
  const [shared]: any = await pool.query(
    "UPDATE housing_reservations SET email = ?, updated_at = updated_at " +
      "WHERE village_id = ? AND user_id IS NOT NULL AND user_id <> ? AND ? <> '' AND LOWER(TRIM(email)) = ?",
    [input.address, VILLAGE, input.userId, input.emailKey, input.emailKey],
  );
  // Read, then written by bound ids: 0077 pinned this table's charset and the
  // event spine inherits the database's, so the two are never compared in SQL.
  const [scrubbed] = await pool.query<RowDataPacket[]>(
    "SELECT id, home_type, structure_key FROM housing_reservations WHERE village_id = ? AND user_id IS NULL AND email = ? ORDER BY id",
    [VILLAGE, input.address],
  );
  let auditLines = 0;
  for (const r of scrubbed) {
    const text = `${input.name} asked for a ${String(r.home_type)}${r.structure_key == null ? "" : ` in ${String(r.structure_key)}`}`;
    const [line]: any = await pool.query( // module-review-ok: the admin event the request route wrote about this one scrubbed request
      "UPDATE health_events SET text = ?, at = at WHERE kind = 'housing_reservation' AND entity_type = 'housing_reservation' AND entity_ref = ?",
      [text, String(r.id)],
    );
    auditLines += Number(line?.affectedRows ?? 0);
  }
  return { scrubbed: Number(own?.affectedRows ?? 0), addressOnly: Number(shared?.affectedRows ?? 0), auditLines };
}

/**
 * The addresses a member typed into their own housing requests that are not
 * their account's and that nobody else holds, for the erasure's
 * `housing-contacts-after-tombstone` step (server/lib/erasure.ts).
 *
 * WHY. The request route hands the address it was given to comms, and with
 * the paths box ticked comms makes a contact for it, records the yes, and
 * walks it onto the resident path (server/lib/comms/paths.ts). That contact
 * carries no account, so the comms step, which finds a person by their
 * account and their account address, never sees it, and the housing scrub
 * then writes the tombstone address over the only row that said whose it
 * was. Read here, before that scrub, it is the last place the link exists.
 *
 * WHICH ADDRESSES. One on a request on their account, and only when NOBODY
 * ELSE can be holding it, because a contact is one row per address and
 * forgetting it forgets it for everyone:
 *   - not a tombstone address;
 *   - not any other member's account address;
 *   - on no request another account made, and on no request with no account
 *     at all, which may be somebody else's own public request;
 *   - on no contact linked to another member.
 * What is left was typed by them and is held by them alone. A shared inbox a
 * stranger also uses as a guest elsewhere cannot be told apart from theirs,
 * and that is the case this reading leaves behind on purpose.
 *
 * Read-only. On a resume after the scrub the rows no longer carry the address
 * and this finds nothing, which is why the step runs before the scrub. Each
 * other table is asked by bound addresses, never joined, because 0077 pinned
 * this table's charset and the others inherit the database's.
 */
export async function secondAddressesOf(pool: Pool, userId: string): Promise<string[]> {
  const [mine] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT LOWER(TRIM(email)) AS k FROM housing_reservations WHERE village_id = ? AND user_id = ? ORDER BY k",
    [VILLAGE, userId],
  );
  const keys = mine.map((r) => String(r.k ?? "")).filter((k) => k && !k.endsWith("@anonymized.invalid"));
  if (!keys.length) return [];
  const held = new Set<string>();
  const [accounts] = await pool.query<RowDataPacket[]>( // module-review-ok: which of these addresses is another member's account address
    "SELECT LOWER(TRIM(email)) AS k FROM users WHERE id <> ? AND LOWER(TRIM(email)) IN (?)",
    [userId, keys],
  );
  const [requests] = await pool.query<RowDataPacket[]>(
    "SELECT LOWER(TRIM(email)) AS k FROM housing_reservations WHERE village_id = ? AND (user_id IS NULL OR user_id <> ?) AND LOWER(TRIM(email)) IN (?)",
    [VILLAGE, userId, keys],
  );
  const [contacts] = await pool.query<RowDataPacket[]>( // module-review-ok: which of these addresses a contact linked to another member holds
    "SELECT email_key AS k FROM comms_contacts WHERE village_id = ? AND user_id IS NOT NULL AND user_id <> ? AND email_key IN (?)",
    [VILLAGE, userId, keys],
  );
  for (const r of [...accounts, ...requests, ...contacts]) held.add(String(r.k ?? ""));
  return keys.filter((k) => !held.has(k));
}
