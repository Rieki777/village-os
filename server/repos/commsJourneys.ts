/**
 * The readers and writers for the journey tables: `comms_enrollments` now,
 * and `comms_journeys` with its versions when the journey engine lands
 * (drizzle/0244). One family: an enrollment is a person on a journey.
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
  /** What the trigger stored when it enrolled the person. */
  facts: Record<string, unknown>;
}

/** A JSON column, whichever way the driver hands it back. */
function jsonOf(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const objectOf = (raw: unknown): Record<string, unknown> => {
  const v = jsonOf(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

const ENROLLMENT_COLUMNS =
  "e.id, e.journey_key, e.journey_version, e.contact_id, e.subject_ref, e.state, e.stop_reason, e.facts, " +
  "UNIX_TIMESTAMP(e.enrolled_at) AS enrolled_at, UNIX_TIMESTAMP(e.next_check_at) AS next_check_at";

const toEnrollment = (r: RowDataPacket): EnrollmentRow => ({
  id: String(r.id),
  journeyKey: String(r.journey_key),
  journeyVersion: Number(r.journey_version),
  contactId: String(r.contact_id),
  subjectRef: String(r.subject_ref),
  state: String(r.state),
  stopReason: r.stop_reason == null ? null : String(r.stop_reason),
  enrolledAt: Number(r.enrolled_at),
  nextCheckAt: r.next_check_at == null ? null : Number(r.next_check_at),
  facts: objectOf(r.facts),
});

/** One enrollment by id, or null. */
export async function enrollmentById(pool: Pool, id: string): Promise<EnrollmentRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by id
    `SELECT ${ENROLLMENT_COLUMNS} FROM comms_enrollments e WHERE e.village_id = ? AND e.id = ? LIMIT 1`,
    [VILLAGE, id],
  );
  return rows[0] ? toEnrollment(rows[0]) : null;
}

/** One enrollment by its natural key, or null. */
export async function enrollmentFor(pool: Pool, journeyKey: string, contactId: string, subjectRef: string): Promise<EnrollmentRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by the unique key
    `SELECT ${ENROLLMENT_COLUMNS} FROM comms_enrollments e ` +
      "WHERE e.village_id = ? AND e.journey_key = ? AND e.contact_id = ? AND e.subject_ref = ? LIMIT 1",
    [VILLAGE, journeyKey, contactId, subjectRef],
  );
  return rows[0] ? toEnrollment(rows[0]) : null;
}

/**
 * Active enrollments whose next look is due, oldest first. `atEpoch` is the
 * moment to compare with; null compares IN SQL with `CURRENT_TIMESTAMP`, which
 * is what the running server does. A test passes its own clock.
 */
export async function dueEnrollments(pool: Pool, opts: { limit: number; atEpoch: number | null; ids?: readonly string[] | null }): Promise<EnrollmentRow[]> {
  const params: unknown[] = [VILLAGE, opts.atEpoch];
  let only = "";
  if (opts.ids) {
    if (!opts.ids.length) return [];
    only = ` AND e.id IN (${opts.ids.map(() => "?").join(",")})`;
    params.push(...opts.ids);
  }
  params.push(Math.max(1, Math.trunc(opts.limit)));
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, bounded by the due index and a limit
    `SELECT ${ENROLLMENT_COLUMNS} FROM comms_enrollments e ` +
      "WHERE e.village_id = ? AND e.state = 'active' AND e.next_check_at IS NOT NULL " +
      `AND e.next_check_at <= COALESCE(FROM_UNIXTIME(?), CURRENT_TIMESTAMP)${only} ` +
      "ORDER BY e.next_check_at ASC, e.id ASC LIMIT ?",
    params,
  );
  return rows.map(toEnrollment);
}

/** When to look at one enrollment next. Null: only a touch or a stop moves it. */
export async function setNextCheck(pool: Pool, id: string, atEpoch: number | null): Promise<void> {
  await pool.query( // module-review-ok: the journey tables, one row by id
    "UPDATE comms_enrollments SET next_check_at = FROM_UNIXTIME(?), updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'active'",
    [atEpoch, VILLAGE, id],
  );
}

/** Every step sent or skipped: the journey is over for this person. */
export async function finishEnrollment(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables, one row by id, only while active
    "UPDATE comms_enrollments SET state = 'finished', next_check_at = NULL, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'active'",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** Stop one enrollment by id, while it is active. */
export async function stopEnrollmentById(pool: Pool, id: string, reason: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables, one row by id, only while active
    "UPDATE comms_enrollments SET state = 'stopped', stop_reason = ?, next_check_at = NULL, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'active'",
    [reason.slice(0, 64), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** Look at every active enrollment of one journey on the next tick (a journey turned on). */
export async function touchJourney(pool: Pool, journeyKey: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the journey tables, bounded by one journey
    "UPDATE comms_enrollments SET next_check_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND journey_key = ? AND state = 'active'",
    [VILLAGE, journeyKey],
  );
  return res.affectedRows;
}

/**
 * Which of these ledger keys the post office already holds: the steps of an
 * enrollment that were posted, whatever became of them. Read by the unique
 * key, so it is exact and cheap.
 */
export async function postedLedgerKeys(pool: Pool, keys: readonly string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger read by its unique key, for the journey that wrote these keys
    `SELECT idempotency_key FROM comms_messages WHERE village_id = ? AND idempotency_key IN (${keys.map(() => "?").join(",")})`,
    [VILLAGE, ...keys],
  );
  return new Set(rows.map((r) => String(r.idempotency_key)));
}

/** Active enrollments per journey key. */
export async function activeCountsByJourney(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one count per journey
    "SELECT journey_key, COUNT(*) AS n FROM comms_enrollments WHERE village_id = ? AND state = 'active' GROUP BY journey_key",
    [VILLAGE],
  );
  return new Map(rows.map((r) => [String(r.journey_key), Number(r.n)]));
}

export interface EnrollmentListRow extends EnrollmentRow {
  name: string | null;
  email: string | null;
}

/** One journey's active enrollments with each person's name and address, soonest next look first. */
export async function activeEnrollmentsOf(pool: Pool, journeyKey: string, limit: number): Promise<EnrollmentListRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables beside the address book, bounded by a limit
    `SELECT ${ENROLLMENT_COLUMNS}, c.name AS contact_name, c.email AS contact_email FROM comms_enrollments e ` +
      "LEFT JOIN comms_contacts c ON c.id = e.contact_id AND c.village_id = e.village_id " +
      "WHERE e.village_id = ? AND e.journey_key = ? AND e.state = 'active' " +
      "ORDER BY e.next_check_at IS NULL, e.next_check_at ASC, e.id ASC LIMIT ?",
    [VILLAGE, journeyKey, Math.max(1, Math.trunc(limit))],
  );
  return rows.map((r) => ({
    ...toEnrollment(r),
    name: r.contact_name == null ? null : String(r.contact_name),
    email: r.contact_email == null ? null : String(r.contact_email),
  }));
}

// ── The village's journeys and their versions ───────────────────────────────

export interface JourneyRow {
  journeyKey: string;
  state: string;
  version: number;
  /** The village's own definition, or null while the platform's applies. */
  definition: unknown;
  platformVersion: number | null;
  updatedBy: string | null;
  /** Epoch seconds. */
  updatedAt: number;
}

const toJourney = (r: RowDataPacket): JourneyRow => ({
  journeyKey: String(r.journey_key),
  state: String(r.state),
  version: Number(r.version),
  definition: jsonOf(r.definition),
  platformVersion: r.platform_version == null ? null : Number(r.platform_version),
  updatedBy: r.updated_by == null ? null : String(r.updated_by),
  updatedAt: Number(r.updated_at),
});

const JOURNEY_COLUMNS = "journey_key, state, version, definition, platform_version, updated_by, UNIX_TIMESTAMP(updated_at) AS updated_at";

/** Every journey the village holds a row for. */
export async function journeyRows(pool: Pool): Promise<JourneyRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, a handful of rows
    `SELECT ${JOURNEY_COLUMNS} FROM comms_journeys WHERE village_id = ? ORDER BY journey_key`,
    [VILLAGE],
  );
  return rows.map(toJourney);
}

/** One journey's row, or null while the village holds none. */
export async function journeyRow(pool: Pool, journeyKey: string): Promise<JourneyRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by key
    `SELECT ${JOURNEY_COLUMNS} FROM comms_journeys WHERE village_id = ? AND journey_key = ? LIMIT 1`,
    [VILLAGE, journeyKey],
  );
  return rows[0] ? toJourney(rows[0]) : null;
}

/**
 * Turn a journey on or off. A journey the village held no row for gets one at
 * `version`, with no definition of its own.
 */
export async function writeJourneyState(pool: Pool, journeyKey: string, state: "on" | "off", version: number, by: string | null): Promise<void> {
  await pool.query( // module-review-ok: the journey tables, one row by key
    "INSERT INTO comms_journeys (village_id, journey_key, state, version, definition, platform_version, updated_by) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, ?) " +
      "ON DUPLICATE KEY UPDATE state = VALUES(state), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP",
    [VILLAGE, journeyKey, state, version, by],
  );
}

/**
 * Save an edited definition as the journey's next version, in one
 * transaction: the row is locked, the version is counted past every number in
 * use, the definition the village is leaving is kept as its own version when
 * it was never written down (so people on it keep their steps), the new one
 * is written, and the row points at it. Answers the new version.
 */
export async function saveJourneyVersion(
  pool: Pool,
  input: {
    journeyKey: string;
    /** The platform default's version, the floor of the numbering. */
    platformVersion: number;
    /** The definition in force before this save, with its version. */
    leaving: { version: number; definition: unknown };
    /** Builds the new definition once its version is known. */
    definition: (version: number) => unknown;
    by: string | null;
  },
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query( // module-review-ok: the journey tables, one row by key, made to exist before it is locked
      "INSERT IGNORE INTO comms_journeys (village_id, journey_key, state, version, definition, platform_version, updated_by) " +
        "VALUES (?, ?, 'off', ?, NULL, NULL, ?)",
      [VILLAGE, input.journeyKey, input.leaving.version, input.by],
    );
    const [[row]] = await conn.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by key, locked for the version count
      "SELECT version FROM comms_journeys WHERE village_id = ? AND journey_key = ? FOR UPDATE",
      [VILLAGE, input.journeyKey],
    );
    const [[top]] = await conn.query<RowDataPacket[]>( // module-review-ok: the journey tables, the highest version of one journey
      "SELECT COALESCE(MAX(version), 0) AS v FROM comms_journey_versions WHERE village_id = ? AND journey_key = ?",
      [VILLAGE, input.journeyKey],
    );
    const version = Math.max(Number(row?.version ?? 0), Number(top?.v ?? 0), input.platformVersion, input.leaving.version) + 1;
    await conn.query( // module-review-ok: the journey tables, the definition being left, kept once
      "INSERT IGNORE INTO comms_journey_versions (village_id, journey_key, version, definition, created_by) VALUES (?, ?, ?, ?, NULL)",
      [VILLAGE, input.journeyKey, input.leaving.version, JSON.stringify(input.leaving.definition)],
    );
    const definition = JSON.stringify(input.definition(version));
    await conn.query( // module-review-ok: the journey tables, the new version
      "INSERT INTO comms_journey_versions (village_id, journey_key, version, definition, created_by) VALUES (?, ?, ?, ?, ?)",
      [VILLAGE, input.journeyKey, version, definition, input.by],
    );
    await conn.query( // module-review-ok: the journey tables, one row by key
      "UPDATE comms_journeys SET version = ?, definition = ?, platform_version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP " +
        "WHERE village_id = ? AND journey_key = ?",
      [version, definition, input.platformVersion, input.by, VILLAGE, input.journeyKey],
    );
    await conn.commit();
    return version;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** One stored version's definition, or null. */
export async function journeyVersionDefinition(pool: Pool, journeyKey: string, version: number): Promise<unknown> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one row by key and version
    "SELECT definition FROM comms_journey_versions WHERE village_id = ? AND journey_key = ? AND version = ? LIMIT 1",
    [VILLAGE, journeyKey, version],
  );
  return rows[0] ? jsonOf(rows[0].definition) : null;
}

/** Every stored version of one journey, newest first, with how many people walk each. */
export async function journeyVersionList(
  pool: Pool,
  journeyKey: string,
): Promise<Array<{ version: number; createdBy: string | null; createdAt: number; active: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey tables, one journey's versions with a count each
    "SELECT v.version, v.created_by, UNIX_TIMESTAMP(v.created_at) AS created_at, " +
      "(SELECT COUNT(*) FROM comms_enrollments e WHERE e.village_id = v.village_id AND e.journey_key = v.journey_key " +
      "AND e.journey_version = v.version AND e.state = 'active') AS active " +
      "FROM comms_journey_versions v WHERE v.village_id = ? AND v.journey_key = ? ORDER BY v.version DESC LIMIT 100",
    [VILLAGE, journeyKey],
  );
  return rows.map((r) => ({
    version: Number(r.version),
    createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: Number(r.created_at),
    active: Number(r.active),
  }));
}
