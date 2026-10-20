/**
 * What the journey engine reads about one gathering occurrence, for its skip
 * and stop rules (server/lib/comms/conditions.ts): the person's answer, how
 * many said yes, who was marked as having come, whether the recap went, and
 * whether a time vote is still open. Read-only, one small query each, over
 * the gathering tables of drizzle/0059, 0085 and 0245.
 *
 * Person keys follow the rule in shared/comms/kinds.ts: a member is their user
 * id, a guest is `guest:<contactId>`, in `event_rsvps.user_id` and every
 * `person_key` column alike.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** The person's answer to one occurrence (`going`, `maybe`, `declined`), or null when they have none. */
export async function rsvpStatusOf(pool: Pool, eventId: string, occurrenceKey: string, personKey: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one answer by the unique key (event, person, occurrence)
    "SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, personKey, occurrenceKey],
  );
  return rows[0] ? String(rows[0].status) : null;
}

/** How many said they are going to one occurrence. */
export async function goingCountOf(pool: Pool, eventId: string, occurrenceKey: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one count over one occurrence's answers
    "SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ? AND occurrence_key = ? AND status = 'going'",
    [eventId, occurrenceKey],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Whether the host marked the person as having come (`came`, `missed`), or null when nobody marked them. */
export async function attendanceOf(pool: Pool, eventId: string, occurrenceKey: string, personKey: string): Promise<"came" | "missed" | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one mark by the primary key
    "SELECT status FROM event_attendance WHERE event_id = ? AND occurrence_key = ? AND person_key = ? LIMIT 1",
    [eventId, occurrenceKey, personKey],
  );
  const s = rows[0] ? String(rows[0].status) : null;
  return s === "came" || s === "missed" ? s : null;
}

/** True when the occurrence's recap was sent. */
export async function recapSentFor(pool: Pool, eventId: string, occurrenceKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one recap by the primary key
    "SELECT state FROM event_recaps WHERE event_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, occurrenceKey],
  );
  return rows[0] ? String(rows[0].state) === "sent" : false;
}
