/**
 * The readers and writers for `comms_contacts`, the village's one address
 * book (drizzle/0228).
 *
 * ONE ROW PER ADDRESS, keyed by `(village_id, email_key)`, where the key is
 * the address trimmed and lowercased (`emailKeyOf`, shared/comms/address.ts).
 * A member and the address they signed up with are the same row: `user_id`
 * links them when it is known, and it is never unlinked here.
 *
 * THE FIRST SOURCE IS KEPT. An upsert fills a missing name, a missing user id
 * and a missing time zone, and never overwrites `first_source`, which is the
 * record of how the village first met this address.
 *
 * Raw SQL lives here and nowhere else (the comms build spec section 1,
 * rule 6). No cache sits above this table.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

export interface ContactRow {
  id: string;
  emailKey: string;
  email: string;
  name: string | null;
  userId: string | null;
  firstSource: string;
  timezone: string | null;
}

const toRow = (r: RowDataPacket): ContactRow => ({
  id: String(r.id),
  emailKey: String(r.email_key),
  email: String(r.email),
  name: r.name == null ? null : String(r.name),
  userId: r.user_id == null ? null : String(r.user_id),
  firstSource: String(r.first_source),
  timezone: r.timezone == null ? null : String(r.timezone),
});

const COLUMNS = "id, email_key, email, name, user_id, first_source, timezone";

/** The contact filed under one key, or null. */
export async function contactByEmailKey(pool: Pool, emailKey: string): Promise<ContactRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book's one table, no cache above it
    `SELECT ${COLUMNS} FROM comms_contacts WHERE village_id = ? AND email_key = ? LIMIT 1`,
    [VILLAGE, emailKey],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** One contact by its id, or null. */
export async function contactById(pool: Pool, id: string): Promise<ContactRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book's one table, no cache above it
    `SELECT ${COLUMNS} FROM comms_contacts WHERE village_id = ? AND id = ? LIMIT 1`,
    [VILLAGE, id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Make sure an address has its row, and answer the row's id.
 *
 * One statement does the work, so two posts to a new address at the same
 * moment cannot make two rows: the unique key admits one INSERT and turns the
 * other into the UPDATE, and the UPDATE fills only what is still missing.
 * The id is read back by the key afterwards, because the row that won may not
 * be the one this call proposed.
 */
export async function upsertContact(
  pool: Pool,
  input: {
    id: string;
    emailKey: string;
    email: string;
    name: string | null;
    userId: string | null;
    source: string;
    timezone: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  await pool.query( // module-review-ok: the address book's one table, one row, no cache above it
    "INSERT INTO comms_contacts (id, village_id, email_key, email, name, user_id, first_source, timezone) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE " +
      "name = COALESCE(name, VALUES(name)), " +
      "user_id = COALESCE(user_id, VALUES(user_id)), " +
      "timezone = COALESCE(timezone, VALUES(timezone)), " +
      "updated_at = CURRENT_TIMESTAMP",
    [
      input.id,
      VILLAGE,
      input.emailKey,
      input.email.slice(0, 320),
      input.name ? input.name.slice(0, 255) : null,
      input.userId,
      input.source.slice(0, 64),
      input.timezone ? input.timezone.slice(0, 64) : null,
    ],
  );
  const row = await contactByEmailKey(pool, input.emailKey);
  if (!row) throw new Error("comms_contacts: the row this upsert wrote could not be read back");
  return { id: row.id, created: row.id === input.id };
}

/**
 * Record the time zone a person's own device reported, replacing an older
 * one. The upsert above keeps the FIRST zone it hears, which is right for a
 * name and a source and wrong for a zone: somebody who moves, or answers from
 * a phone set to where they actually are, is better served by the newest
 * reading. Callers validate the zone first (server/lib/comms/contacts.ts).
 */
export async function setContactTimezone(pool: Pool, id: string, timezone: string): Promise<void> {
  await pool.query( // module-review-ok: the address book's one table, one row by id
    "UPDATE comms_contacts SET timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? " +
      "AND (timezone IS NULL OR timezone <> ?)",
    [timezone.slice(0, 64), VILLAGE, id, timezone.slice(0, 64)],
  );
}
