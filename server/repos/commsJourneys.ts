/**
 * The readers and writers for the journey tables: `comms_enrollments` now,
 * and `comms_journeys` with its versions when the journey engine lands
 * (drizzle/0228). One family: an enrollment is a person on a journey.
 *
 * ONE ENROLLMENT PER PERSON, JOURNEY AND SUBJECT, held by
 * `comms_enrollments_once`, so two triggers racing to enroll the same person
 * (a member's yes and a guest's confirmation, say) make one row.
 *
 * A SUBJECT PREFIX STOPS WHERE AN ID DOES. `touch` and `stop` match a subject
 * exactly or as `<prefix>:...`, never as a bare string prefix, so touching
 * `event:ev-1` can never reach `event:ev-10`. The prefix is escaped for LIKE
 * so an id carrying `%` or `_` matches only itself.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

/** Escape a value for use inside a LIKE pattern with `ESCAPE '\\'`. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The version a village is running for one journey, or null when it holds no row of its own. */
export async function villageJourneyVersion(pool: Pool, journeyKey: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by key
    "SELECT version FROM comms_journeys WHERE village_id = ? AND journey_key = ? LIMIT 1",
    [VILLAGE, journeyKey],
  );
  return rows[0] ? Number(rows[0].version) : null;
}

/**
 * Put a person on a journey, once.
 *
 * A fresh row starts `active` with `next_check_at` now, so the next tick plans
 * it. When the row already exists the answer names it and says it was not
 * created; a row that had been STOPPED is picked up again, because the only
 * way here is a fresh act by the person (a new yes, a path joined again),
 * and the post office still checks their permission before anything is sent.
 * A FINISHED row stays finished.
 */
export async function insertEnrollment(
  pool: Pool,
  input: {
    id: string;
    journeyKey: string;
    journeyVersion: number;
    contactId: string;
    subjectRef: string;
    facts: Record<string, unknown> | null;
    /** Epoch seconds for `enrolled_at`, or null for now. */
    enrolledAt: number | null;
  },
): Promise<{ enrollmentId: string; created: boolean }> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables' one writer of new enrollments
    "INSERT IGNORE INTO comms_enrollments " +
      "(id, village_id, journey_key, journey_version, contact_id, subject_ref, facts, state, enrolled_at, next_check_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', COALESCE(FROM_UNIXTIME(?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)",
    [
      input.id,
      VILLAGE,
      input.journeyKey,
      input.journeyVersion,
      input.contactId,
      input.subjectRef,
      input.facts ? JSON.stringify(input.facts) : null,
      input.enrolledAt,
    ],
  );
  if (res.affectedRows > 0) return { enrollmentId: input.id, created: true };
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, read by the unique key that refused the insert
    "SELECT id, state FROM comms_enrollments WHERE village_id = ? AND journey_key = ? AND contact_id = ? AND subject_ref = ? LIMIT 1",
    [VILLAGE, input.journeyKey, input.contactId, input.subjectRef],
  );
  const existing = rows[0];
  if (!existing) throw new Error("comms_enrollments: an enrollment refused as a duplicate could not be read back");
  if (String(existing.state) === "stopped") {
    await pool.query( // module-review-ok: the journey tables, one row by id, only while it is stopped
      "UPDATE comms_enrollments SET state = 'active', stop_reason = NULL, next_check_at = CURRENT_TIMESTAMP, " +
        "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND state = 'stopped'",
      [VILLAGE, existing.id],
    );
  }
  return { enrollmentId: String(existing.id), created: false };
}

/**
 * Stop every ACTIVE enrollment matching all of the given conditions, and say
 * how many. An empty condition stops nothing: a call that could end every
 * journey in the village is refused by shape, never run.
 */
export async function stopEnrollments(
  pool: Pool,
  where: { journeyKey?: string; contactId?: string; subjectRef?: string },
  reason: string,
): Promise<number> {
  const clauses: string[] = [];
  const params: unknown[] = [VILLAGE];
  if (where.journeyKey) {
    clauses.push("journey_key = ?");
    params.push(where.journeyKey);
  }
  if (where.contactId) {
    clauses.push("contact_id = ?");
    params.push(where.contactId);
  }
  if (where.subjectRef) {
    clauses.push("(subject_ref = ? OR subject_ref LIKE CONCAT(?, ':%') ESCAPE '\\\\')");
    params.push(where.subjectRef, likeEscape(where.subjectRef));
  }
  if (!clauses.length) return 0;
  params.unshift(reason.slice(0, 64));
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables, bounded by at least one condition
    `UPDATE comms_enrollments SET state = 'stopped', stop_reason = ?, updated_at = CURRENT_TIMESTAMP ` +
      `WHERE village_id = ? AND state = 'active' AND ${clauses.join(" AND ")}`,
    params,
  );
  return res.affectedRows;
}

/**
 * Ask the next tick to re-plan every active enrollment on a subject, because
 * something about it moved (a gathering's time, its place). Sets
 * `next_check_at` to now and nothing else.
 */
export async function touchEnrollments(pool: Pool, subjectRefPrefix: string): Promise<number> {
  if (!subjectRefPrefix) return 0;
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables, bounded by one subject
    "UPDATE comms_enrollments SET next_check_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND state = 'active' AND (subject_ref = ? OR subject_ref LIKE CONCAT(?, ':%') ESCAPE '\\\\')",
    [VILLAGE, subjectRefPrefix, likeEscape(subjectRefPrefix)],
  );
  return res.affectedRows;
}

export interface EnrollmentRow {
  id: string;
  journeyKey: string;
  journeyVersion: number;
  contactId: string;
  subjectRef: string;
  state: string;
  stopReason: string | null;
  /** Epoch seconds. */
  enrolledAt: number;
  /** Epoch seconds, or null. */
  nextCheckAt: number | null;
}

/** One enrollment by id, or null. */
export async function enrollmentById(pool: Pool, id: string): Promise<EnrollmentRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by id
    "SELECT id, journey_key, journey_version, contact_id, subject_ref, state, stop_reason, " +
      "UNIX_TIMESTAMP(enrolled_at) AS enrolled_at, UNIX_TIMESTAMP(next_check_at) AS next_check_at " +
      "FROM comms_enrollments WHERE village_id = ? AND id = ? LIMIT 1",
    [VILLAGE, id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    journeyKey: String(r.journey_key),
    journeyVersion: Number(r.journey_version),
    contactId: String(r.contact_id),
    subjectRef: String(r.subject_ref),
    state: String(r.state),
    stopReason: r.stop_reason == null ? null : String(r.stop_reason),
    enrolledAt: Number(r.enrolled_at),
    nextCheckAt: r.next_check_at == null ? null : Number(r.next_check_at),
  };
}
