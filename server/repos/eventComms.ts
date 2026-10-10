/**
 * The SQL behind one gathering's emails (the comms build spec 5.7): the
 * gathering's own email settings in `event_comms` (drizzle/0229), and the
 * reads the event email handlers make of the tables around them.
 *
 * WHAT IS WRITTEN HERE, AND WHERE IT BELONGS:
 *
 *   event_comms        this lane's own table: reminders, guests, the host and
 *                      the calendar file's SEQUENCE.
 *   comms_enrollments  the gathering keys inside `facts` of a `gathering.*`
 *                      enrollment only (`updateGatheringFacts`). The journey
 *                      engine owns the rows; the facts of a gathering journey
 *                      are this lane's to keep current.
 *
 * Everything else is read: who said yes (`event_rsvps`), who waits
 * (`event_waitlist`), whether a time vote is open (`event_time_polls`), whether
 * a journey is on (`comms_journeys`), and which journey emails still wait in
 * the post office's queue, so a cancellation can withdraw them through the post
 * office's own `cancelQueued`.
 *
 * TIME. Every instant is read as `UNIX_TIMESTAMP(col)` and compared in SQL,
 * because a test pool and the app pool may disagree about the session zone
 * (the comms build spec section 1, rule 7). Gathering times themselves are
 * never read here: they go through server/lib/calendar.ts.
 *
 * Raw SQL lives here and nowhere else in this lane. No cache sits above any of
 * these tables.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

/** Escape a value for use inside a LIKE pattern with `ESCAPE '\\'`. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A JSON column, read whichever way the driver hands it back. */
function jsonOf(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(raw)) return jsonOf(raw.toString("utf8"));
  return raw;
}

const objectOf = (raw: unknown): Record<string, unknown> => {
  const v = jsonOf(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

// ── event_comms ─────────────────────────────────────────────────────────────

export interface EventCommsRow {
  eventId: string;
  /** NULL follows the village dial, 1 on, 0 off. */
  guests: 0 | 1 | null;
  /** NULL follows the village dial, [] is off, a list is this gathering's own. */
  reminders: unknown;
  icsSequence: number;
  hostUserId: string | null;
  /** False when the gathering has no row yet, and every field is its default. */
  stored: boolean;
}

/** One gathering's settings, or the defaults when it has never had any. */
export async function readEventComms(pool: Pool, eventId: string): Promise<EventCommsRow> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_comms, one row by its key
    "SELECT event_id, guests, reminders, ics_sequence, host_user_id FROM event_comms WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  const r = rows[0];
  if (!r) return { eventId, guests: null, reminders: null, icsSequence: 0, hostUserId: null, stored: false };
  return {
    eventId,
    guests: r.guests === null || r.guests === undefined ? null : Number(r.guests) === 1 ? 1 : 0,
    reminders: jsonOf(r.reminders),
    icsSequence: Math.max(0, Number(r.ics_sequence ?? 0)),
    hostUserId: r.host_user_id == null ? null : String(r.host_user_id),
    stored: true,
  };
}

/**
 * Write the settings a caller named, and leave the others as they are. Each
 * key present is written, an explicit null included: null is a real answer
 * here, "follow the village".
 */
export async function saveEventComms(
  pool: Pool,
  eventId: string,
  patch: { guests?: 0 | 1 | null; reminders?: number[] | null; hostUserId?: string | null },
): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  if (patch.guests !== undefined) {
    cols.push("guests");
    vals.push(patch.guests);
  }
  if (patch.reminders !== undefined) {
    cols.push("reminders");
    vals.push(patch.reminders === null ? null : JSON.stringify(patch.reminders));
  }
  if (patch.hostUserId !== undefined) {
    cols.push("host_user_id");
    vals.push(patch.hostUserId);
  }
  if (!cols.length) return;
  const updates = cols.map((c) => `${c} = VALUES(${c})`).join(", ");
  await pool.query( // module-review-ok: event_comms' one writer of settings, by its key
    `INSERT INTO event_comms (event_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")}) ` +
      `ON DUPLICATE KEY UPDATE ${updates}, updated_at = CURRENT_TIMESTAMP`,
    [eventId, ...vals],
  );
}

/**
 * Move the calendar file's SEQUENCE on by one and answer the new value. One
 * statement, so two changes saved at once each get their own number.
 */
export async function bumpIcsSequence(pool: Pool, eventId: string): Promise<number> {
  await pool.query( // module-review-ok: event_comms, the SEQUENCE counter, one row by its key
    "INSERT INTO event_comms (event_id, ics_sequence) VALUES (?, 1) " +
      "ON DUPLICATE KEY UPDATE ics_sequence = ics_sequence + 1, updated_at = CURRENT_TIMESTAMP",
    [eventId],
  );
  return (await readEventComms(pool, eventId)).icsSequence;
}

/** Raise the SEQUENCE to at least `atLeast`, never lower it. For a number already sent. */
export async function raiseIcsSequence(pool: Pool, eventId: string, atLeast: number): Promise<void> {
  await pool.query( // module-review-ok: event_comms, the SEQUENCE counter, one row by its key, only upward
    "INSERT INTO event_comms (event_id, ics_sequence) VALUES (?, ?) " +
      "ON DUPLICATE KEY UPDATE ics_sequence = GREATEST(ics_sequence, VALUES(ics_sequence)), updated_at = CURRENT_TIMESTAMP",
    [eventId, Math.max(0, Math.trunc(atLeast))],
  );
}

// ── The gathering's people ──────────────────────────────────────────────────

/** Who put the gathering on the calendar, or null (an imported item, or one a password made). */
export async function eventCreatorOf(pool: Pool, eventId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: events, the author of one row by id
    "SELECT created_by FROM events WHERE id = ? LIMIT 1",
    [eventId],
  );
  const v = rows[0]?.created_by;
  return v == null || v === "" ? null : String(v);
}

export interface PersonOnEvening {
  /** A user id, or `guest:<contactId>`. */
  personKey: string;
  occurrenceKey: string;
}

/** Everybody whose answer is `going`, on every evening of the gathering. */
export async function goingAnswers(pool: Pool, eventId: string, occurrenceKey?: string): Promise<PersonOnEvening[]> {
  const params: unknown[] = [eventId];
  let occ = "";
  if (occurrenceKey !== undefined) {
    occ = " AND occurrence_key = ?";
    params.push(occurrenceKey);
  }
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_rsvps, the yes answers to one gathering
    `SELECT user_id, occurrence_key FROM event_rsvps WHERE event_id = ? AND status = 'going'${occ} ORDER BY occurrence_key, created_at, id`,
    params,
  );
  return rows.map((r) => ({ personKey: String(r.user_id), occurrenceKey: String(r.occurrence_key ?? "") }));
}

/** One person's answer to one evening, or null when they gave none. */
export async function rsvpStatusOf(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_rsvps, one person's answer to one evening
    "SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, personKey, occurrenceKey],
  );
  return rows[0] ? String(rows[0].status) : null;
}

export interface WaitlistPlace extends PersonOnEvening {
  /** When they joined the queue, in epoch milliseconds. Rejoining resets it. */
  joinedAtMs: number;
  /** When a freed seat went to them, in epoch milliseconds, or null while they wait. */
  promotedAtMs: number | null;
  /** True while they still wait: neither seated nor gone. */
  waiting: boolean;
}

const placeOf = (r: RowDataPacket): WaitlistPlace => ({
  personKey: String(r.user_id),
  occurrenceKey: String(r.occurrence_key ?? ""),
  joinedAtMs: Math.round(Number(r.joined_at ?? 0) * 1000),
  promotedAtMs: r.promoted_at == null ? null : Math.round(Number(r.promoted_at) * 1000),
  waiting: r.promoted_at == null && r.left_at == null,
});

/** Everybody still waiting for a seat, on every evening of the gathering. */
export async function waitingPlaces(pool: Pool, eventId: string): Promise<WaitlistPlace[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_waitlist, the live queue of one gathering
    "SELECT user_id, occurrence_key, UNIX_TIMESTAMP(created_at) AS joined_at, NULL AS promoted_at, NULL AS left_at " +
      "FROM event_waitlist WHERE event_id = ? AND promoted_at IS NULL AND left_at IS NULL ORDER BY occurrence_key, created_at, id",
    [eventId],
  );
  return rows.map(placeOf);
}

/** One person's place in the queue for one evening, or null when they never queued. */
export async function waitlistPlaceOf(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<WaitlistPlace | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_waitlist, one person's place by its unique key
    "SELECT user_id, occurrence_key, UNIX_TIMESTAMP(created_at) AS joined_at, UNIX_TIMESTAMP(promoted_at) AS promoted_at, " +
      "UNIX_TIMESTAMP(left_at) AS left_at FROM event_waitlist WHERE event_id = ? AND user_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, personKey, occurrenceKey],
  );
  return rows[0] ? placeOf(rows[0]) : null;
}

/** Members by id, with their names, for choosing a host. Example identities and closed accounts are left out. */
export async function memberNamesOf(pool: Pool, userIds: readonly string[]): Promise<Array<{ id: string; name: string }>> {
  const ids = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id && !id.startsWith("guest:"))));
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: users, names of a bounded list of members
    `SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(",")}) ` +
      "AND COALESCE(is_example, 0) = 0 AND email NOT LIKE '%@anonymized.invalid' ORDER BY name, id",
    ids,
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "").trim() || "A member" }));
}

// ── Time votes and journeys ─────────────────────────────────────────────────

/** The mode of the gathering's time vote while it is open, or null when none is open. */
export async function openTimePollMode(pool: Pool, eventId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_time_polls, one gathering's poll by its unique key
    "SELECT mode FROM event_time_polls WHERE event_id = ? AND state = 'open' LIMIT 1",
    [eventId],
  );
  return rows[0] ? String(rows[0].mode) : null;
}

/** True when the village has turned this journey on. Absent is off, which is how every journey ships. */
export async function journeyIsOn(pool: Pool, journeyKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_journeys, one journey's state by its key
    "SELECT state FROM comms_journeys WHERE village_id = ? AND journey_key = ? LIMIT 1",
    [VILLAGE, journeyKey],
  );
  return String(rows[0]?.state ?? "off") === "on";
}

// ── Enrollments on a gathering ──────────────────────────────────────────────

export interface GatheringEnrollment {
  id: string;
  journeyKey: string;
  contactId: string;
  subjectRef: string;
  state: string;
  facts: Record<string, unknown>;
}

const toEnrollment = (r: RowDataPacket): GatheringEnrollment => ({
  id: String(r.id),
  journeyKey: String(r.journey_key),
  contactId: String(r.contact_id),
  subjectRef: String(r.subject_ref),
  state: String(r.state),
  facts: objectOf(r.facts),
});

/**
 * The ACTIVE enrollments on one gathering's journeys: every evening of it
 * (`event:<id>`, matched where the id ends) or one (`event:<id>:<occ>`).
 */
export async function activeEnrollmentsOn(
  pool: Pool,
  journeyKeys: readonly string[],
  subjectRef: string,
): Promise<GatheringEnrollment[]> {
  if (!journeyKeys.length || !subjectRef) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_enrollments, the active ones on one gathering's subject
    `SELECT id, journey_key, contact_id, subject_ref, state, facts FROM comms_enrollments ` +
      `WHERE village_id = ? AND state = 'active' AND journey_key IN (${journeyKeys.map(() => "?").join(",")}) ` +
      "AND (subject_ref = ? OR subject_ref LIKE CONCAT(?, ':%') ESCAPE '\\\\') ORDER BY enrolled_at, id",
    [VILLAGE, ...journeyKeys, subjectRef, likeEscape(subjectRef)],
  );
  return rows.map(toEnrollment);
}

/** One person's enrollment on one journey and subject, whatever its state, or null. */
export async function enrollmentFor(pool: Pool, journeyKey: string, contactId: string, subjectRef: string): Promise<GatheringEnrollment | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_enrollments, one row by its unique key
    "SELECT id, journey_key, contact_id, subject_ref, state, facts FROM comms_enrollments " +
      "WHERE village_id = ? AND journey_key = ? AND contact_id = ? AND subject_ref = ? LIMIT 1",
    [VILLAGE, journeyKey, contactId, subjectRef],
  );
  return rows[0] ? toEnrollment(rows[0]) : null;
}

/**
 * Change one gathering enrollment's facts, under the row's lock, so two
 * handlers changing the same person's facts at once cannot lose either's
 * change. `mutate` answers the whole new facts object.
 */
export async function updateGatheringFacts(
  pool: Pool,
  enrollmentId: string,
  mutate: (facts: Record<string, unknown>) => Record<string, unknown>,
): Promise<boolean> {
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: comms_enrollments, one row by id, locked for its facts
      "SELECT facts FROM comms_enrollments WHERE village_id = ? AND id = ? AND journey_key LIKE 'gathering.%' FOR UPDATE",
      [VILLAGE, enrollmentId],
    );
    if (!rows[0]) {
      await conn.rollback();
      return false;
    }
    const next = mutate(objectOf(rows[0].facts));
    await conn.query( // module-review-ok: comms_enrollments, the facts of the row locked above
      "UPDATE comms_enrollments SET facts = ?, updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ?",
      [JSON.stringify(next), VILLAGE, enrollmentId],
    );
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** The post office rows still waiting in the queue for these enrollments: their journey emails not yet sent. */
export async function queuedMessageIdsFor(pool: Pool, enrollmentIds: readonly string[]): Promise<string[]> {
  const ids = Array.from(new Set(enrollmentIds.filter(Boolean)));
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_messages, the queued rows of a bounded list of enrollments
    `SELECT id FROM comms_messages WHERE village_id = ? AND status = 'queued' AND enrollment_id IN (${ids.map(() => "?").join(",")})`,
    [VILLAGE, ...ids],
  );
  return rows.map((r) => String(r.id));
}

/**
 * True when "the time is set" has gone, or is going, to this contact for this
 * gathering's vote. A held confirmation is then not sent as well: the lock
 * email already carries the time and the calendar file. A lock email that was
 * skipped, failed or cancelled does not count, so that person still gets the
 * confirmation.
 */
export async function lockNoticeReached(pool: Pool, eventId: string, contactId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, one contact's lock email for one gathering's vote
    "SELECT m.id FROM comms_messages m JOIN event_time_polls p ON p.event_id = ? " +
      "WHERE m.village_id = ? AND m.contact_id = ? AND m.origin = 'poll.locked' " +
      "AND m.idempotency_key LIKE CONCAT('poll:', p.id, ':locked:%') " +
      "AND m.status IN ('queued', 'sending', 'sent', 'delivered', 'rehearsed') LIMIT 1",
    [eventId, VILLAGE, contactId],
  );
  return rows.length > 0;
}
