/**
 * The readers and writers for guests at gatherings: `event_guest_requests`
 * (drizzle/0229), and the few reads of one person's own answer that the
 * confirmation and the next-gathering link need.
 *
 * A REQUEST IS PENDING UNTIL THE PERSON PRESSES THE LINK. The link carries a
 * random token; only its SHA-256 is stored, so a read of this table cannot
 * confirm anybody, and the unique key on the hash is how the press finds its
 * row.
 *
 * EXPIRY IS DECIDED IN SQL, against `CURRENT_TIMESTAMP`, never by reading the
 * column into JavaScript: the app pool pins UTC and a test pool may not, and a
 * TIMESTAMP read across that gap shifts by the host's offset (the comms build
 * spec section 1, rule 7). `live` is the database's own answer.
 *
 * A GUEST'S PERSON KEY is `guest:<contactId>` (shared/comms/kinds.ts), and it
 * is what `event_rsvps.user_id` and `event_waitlist.user_id` hold for them.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface GuestRequestRow {
  id: string;
  eventId: string;
  occurrenceKey: string;
  contactId: string;
  status: string;
  /** True while the request can still be confirmed: its expiry is in the future. */
  live: boolean;
}

const toRequest = (r: RowDataPacket): GuestRequestRow => ({
  id: String(r.id),
  eventId: String(r.event_id),
  occurrenceKey: String(r.occurrence_key ?? ""),
  contactId: String(r.contact_id),
  status: String(r.status),
  live: Number(r.live) === 1,
});

/** Write a pending request that expires `hours` from now, by the database's clock. */
export async function insertGuestRequest(
  pool: Pool,
  r: { id: string; eventId: string; occurrenceKey: string; contactId: string; tokenHash: string; hours: number },
): Promise<void> {
  await pool.query( // module-review-ok: event_guest_requests' one writer of new rows
    "INSERT INTO event_guest_requests (id, event_id, occurrence_key, contact_id, token_hash, status, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP + INTERVAL ? HOUR)",
    [r.id, r.eventId, r.occurrenceKey, r.contactId, r.tokenHash, Math.max(1, Math.trunc(r.hours))],
  );
}

/** The request a confirm token's hash names, with the database's word on whether it is still live. */
export async function guestRequestByTokenHash(pool: Pool, tokenHash: string): Promise<GuestRequestRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_guest_requests, one row by its unique token hash
    "SELECT id, event_id, occurrence_key, contact_id, status, " +
      "(expires_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP) AS live " +
      "FROM event_guest_requests WHERE token_hash = ? LIMIT 1",
    [tokenHash],
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

/**
 * Mark a pending request confirmed, only while it is live. Answers false when
 * it was already confirmed or has expired: the expiry is decided here, in the
 * same statement as the write, so a press one second late changes nothing.
 */
export async function confirmGuestRequest(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: event_guest_requests, one row by id, only while pending and live
    "UPDATE event_guest_requests SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP " +
      "WHERE id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP",
    [id],
  );
  return res.affectedRows > 0;
}

/**
 * A gathering's own guest setting: true, false, or null when it follows the
 * village dial (drizzle/0229's header). Read here because the guest door asks
 * it; the gathering's email settings are written by their own routes.
 */
export async function guestSettingFor(pool: Pool, eventId: string): Promise<boolean | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_comms, one row by event id, read-only
    "SELECT guests FROM event_comms WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  const v = rows[0]?.guests;
  return v === null || v === undefined ? null : Number(v) === 1;
}

/** One person's answer to one evening, or null when they gave none. */
export async function rsvpStatusOf(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one person's own answer, read-only
    "SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, personKey, occurrenceKey],
  );
  return rows[0] ? String(rows[0].status) : null;
}

/** One person's place in an evening's queue (1 is next), or null when they are not waiting. */
export async function waitlistPlaceOf(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one person's own queue place, read-only
    "SELECT COUNT(*) AS ahead FROM event_waitlist w " +
      "JOIN event_waitlist me ON me.event_id = w.event_id AND me.occurrence_key = w.occurrence_key " +
      "AND me.user_id = ? AND me.promoted_at IS NULL AND me.left_at IS NULL " +
      "WHERE w.event_id = ? AND w.occurrence_key = ? AND w.promoted_at IS NULL AND w.left_at IS NULL " +
      "AND (w.created_at < me.created_at OR (w.created_at = me.created_at AND w.id <= me.id))",
    [personKey, eventId, occurrenceKey],
  );
  const n = Number(rows[0]?.ahead ?? 0);
  return n > 0 ? n : null;
}

/**
 * Names for a set of person keys, for the host's lists: a member's name from
 * `users`, a guest's from `comms_contacts`. Never an address. A key with no
 * row (a member who has since left, a guest forgotten) has no entry.
 */
export async function namesOfPeople(pool: Pool, personKeys: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const guests = personKeys.filter((k) => k.startsWith("guest:") && k.length > 6);
  const members = personKeys.filter((k) => !k.startsWith("guest:"));
  if (members.length) {
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: names only, for the host's list, read-only
      "SELECT id, name FROM users WHERE id IN (?)",
      [members],
    );
    for (const r of rows) out.set(String(r.id), r.name == null ? null : String(r.name));
  }
  if (guests.length) {
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: names only, for the host's list, read-only
      "SELECT id, name FROM comms_contacts WHERE village_id = 'local' AND id IN (?)",
      [guests.map((k) => k.slice(6))],
    );
    for (const r of rows) out.set(`guest:${String(r.id)}`, r.name == null ? null : String(r.name));
  }
  return out;
}
