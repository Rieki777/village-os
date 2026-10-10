/**
 * The readers and writers for what happens after a gathering: who came
 * (`event_attendance`), the recap (`event_recaps`), and the answers to its two
 * questions (`event_feedback`), all from drizzle/0245. One family: the record
 * of one evening once it has happened.
 *
 * PERSON KEYS throughout: a member's user id, or `guest:<contactId>` for
 * somebody with no account (shared/comms/kinds.ts). Every name read here comes
 * from `users` or `comms_contacts`; no address ever leaves this file.
 *
 * Instants a caller computes with are read as `UNIX_TIMESTAMP(col)` (the comms
 * build spec section 1, rule 7).
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AttendanceMark, RecapQuestionKey } from "../../shared/comms/recap";

// ── Who said yes, and who came ──────────────────────────────────────────────

export interface AnswerWithName {
  personKey: string;
  status: "going" | "maybe" | "declined";
  name: string | null;
  guest: boolean;
}

/**
 * Everybody who answered one evening, with their names: a member's from
 * `users`, a guest's from `comms_contacts`. The same join `listRsvps` makes for
 * the organiser's list (server/lib/gatherings.ts), so the two cannot name a
 * person differently.
 */
export async function answersWithNames(pool: Pool, eventId: string, occurrenceKey: string): Promise<AnswerWithName[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one evening's answers with names, never addresses, read-only
    "SELECT r.user_id, r.status, COALESCE(u.name, c.name) AS name, (r.user_id LIKE 'guest:%') AS is_guest " +
      "FROM event_rsvps r " +
      "LEFT JOIN users u ON u.id = r.user_id " +
      "LEFT JOIN comms_contacts c ON r.user_id LIKE 'guest:%' AND c.id = SUBSTRING(r.user_id, 7) " +
      "WHERE r.event_id = ? AND r.occurrence_key = ? " +
      "ORDER BY FIELD(r.status, 'going', 'maybe', 'declined'), COALESCE(u.name, c.name) IS NULL, COALESCE(u.name, c.name), r.user_id",
    [eventId, occurrenceKey],
  );
  return rows.map((r) => ({
    personKey: String(r.user_id),
    status: String(r.status) as AnswerWithName["status"],
    name: r.name == null ? null : String(r.name),
    guest: Number(r.is_guest) === 1,
  }));
}

/** The attendance the host marked for one evening, by person key. */
export async function attendanceMarks(pool: Pool, eventId: string, occurrenceKey: string): Promise<Map<string, AttendanceMark>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one evening's attendance, read-only
    "SELECT person_key, status FROM event_attendance WHERE event_id = ? AND occurrence_key = ?",
    [eventId, occurrenceKey],
  );
  const out = new Map<string, AttendanceMark>();
  for (const r of rows) {
    const s = String(r.status);
    if (s === "came" || s === "missed") out.set(String(r.person_key), s);
  }
  return out;
}

/** Record who came and who missed it. A second mark for the same person replaces the first. */
export async function setAttendance(
  pool: Pool,
  eventId: string,
  occurrenceKey: string,
  marks: ReadonlyArray<{ personKey: string; status: AttendanceMark }>,
  markedBy: string,
): Promise<number> {
  if (!marks.length) return 0;
  const values = marks.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (const m of marks) params.push(eventId, occurrenceKey, m.personKey, m.status, markedBy);
  await pool.query( // module-review-ok: event_attendance's one writer of marks, keyed on the evening and the person
    `INSERT INTO event_attendance (event_id, occurrence_key, person_key, status, marked_by) VALUES ${values} ` +
      "ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), marked_at = CURRENT_TIMESTAMP",
    params,
  );
  return marks.length;
}

/**
 * "Everyone who said yes came": every `going` answer for the evening marked
 * `came`, in one statement, replacing any mark they had. The caller reads the
 * marks back for the count; an upsert's affected-row count says nothing about
 * people.
 */
export async function markEveryoneCame(pool: Pool, eventId: string, occurrenceKey: string, markedBy: string): Promise<void> {
  await pool.query( // module-review-ok: event_attendance, one evening, from that evening's own answers
    "INSERT INTO event_attendance (event_id, occurrence_key, person_key, status, marked_by) " +
      "SELECT r.event_id, r.occurrence_key, r.user_id, 'came', ? FROM event_rsvps r " +
      "WHERE r.event_id = ? AND r.occurrence_key = ? AND r.status = 'going' " +
      "ON DUPLICATE KEY UPDATE status = 'came', marked_by = VALUES(marked_by), marked_at = CURRENT_TIMESTAMP",
    [markedBy, eventId, occurrenceKey],
  );
}

// ── The recap ───────────────────────────────────────────────────────────────

export interface RecapRow {
  eventId: string;
  occurrenceKey: string;
  bodyMd: string;
  missedNoteMd: string | null;
  recordingUrl: string | null;
  state: "draft" | "sent";
  authorUserId: string;
  /** Epoch seconds. */
  sentAt: number | null;
}

/** One evening's recap, or null when nobody has written one. */
export async function recapFor(pool: Pool, eventId: string, occurrenceKey: string): Promise<RecapRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_recaps, one row by its key
    "SELECT event_id, occurrence_key, body_md, missed_note_md, recording_url, state, author_user_id, " +
      "UNIX_TIMESTAMP(sent_at) AS sent_at FROM event_recaps WHERE event_id = ? AND occurrence_key = ? LIMIT 1",
    [eventId, occurrenceKey],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    eventId: String(r.event_id),
    occurrenceKey: String(r.occurrence_key ?? ""),
    bodyMd: String(r.body_md ?? ""),
    missedNoteMd: r.missed_note_md == null ? null : String(r.missed_note_md),
    recordingUrl: r.recording_url == null ? null : String(r.recording_url),
    state: String(r.state) === "sent" ? "sent" : "draft",
    authorUserId: String(r.author_user_id),
    sentAt: r.sent_at == null ? null : Number(r.sent_at),
  };
}

/**
 * Save the draft. Answers false, and writes nothing, once the recap has been
 * sent: what went out is the record, and editing it afterwards would make the
 * host's panel say something nobody received.
 */
export async function saveRecapDraft(
  pool: Pool,
  r: { eventId: string; occurrenceKey: string; bodyMd: string; missedNoteMd: string | null; recordingUrl: string | null; authorUserId: string },
): Promise<boolean> {
  const [ins] = await pool.query<ResultSetHeader>( // module-review-ok: event_recaps, the first save of one evening's draft
    "INSERT IGNORE INTO event_recaps (event_id, occurrence_key, body_md, missed_note_md, recording_url, state, author_user_id) " +
      "VALUES (?, ?, ?, ?, ?, 'draft', ?)",
    [r.eventId, r.occurrenceKey, r.bodyMd, r.missedNoteMd, r.recordingUrl, r.authorUserId],
  );
  if (ins.affectedRows > 0) return true;
  const [upd] = await pool.query<ResultSetHeader>( // module-review-ok: event_recaps, one row by key, only while a draft
    "UPDATE event_recaps SET body_md = ?, missed_note_md = ?, recording_url = ?, author_user_id = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE event_id = ? AND occurrence_key = ? AND state = 'draft'",
    [r.bodyMd, r.missedNoteMd, r.recordingUrl, r.authorUserId, r.eventId, r.occurrenceKey],
  );
  return upd.affectedRows > 0;
}

/** Mark the recap sent, once. Answers false when it already was. */
export async function markRecapSent(pool: Pool, eventId: string, occurrenceKey: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: event_recaps, one row by key, only while a draft
    "UPDATE event_recaps SET state = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP " +
      "WHERE event_id = ? AND occurrence_key = ? AND state = 'draft'",
    [eventId, occurrenceKey],
  );
  return res.affectedRows > 0;
}

// ── The answers ─────────────────────────────────────────────────────────────

/** Record one answer to one question. Answering again replaces it. */
export async function upsertFeedback(
  pool: Pool,
  f: { eventId: string; occurrenceKey: string; personKey: string; questionKey: RecapQuestionKey; answer: string },
): Promise<void> {
  await pool.query( // module-review-ok: event_feedback's one writer, keyed on the evening, the person and the question
    "INSERT INTO event_feedback (event_id, occurrence_key, person_key, question_key, answer) VALUES (?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE answer = VALUES(answer), updated_at = CURRENT_TIMESTAMP",
    [f.eventId, f.occurrenceKey, f.personKey, f.questionKey, f.answer],
  );
}

/** One person's answer to one question, or null. */
export async function feedbackOf(
  pool: Pool,
  eventId: string,
  occurrenceKey: string,
  personKey: string,
  questionKey: RecapQuestionKey,
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: event_feedback, one row by its key
    "SELECT answer FROM event_feedback WHERE event_id = ? AND occurrence_key = ? AND person_key = ? AND question_key = ? LIMIT 1",
    [eventId, occurrenceKey, personKey, questionKey],
  );
  return rows[0] ? String(rows[0].answer) : null;
}

export interface FeedbackWithName {
  personKey: string;
  questionKey: RecapQuestionKey;
  answer: string;
  name: string | null;
  guest: boolean;
  /** Epoch seconds of the latest answer. */
  at: number;
}

/** Every answer for one evening, oldest first, with the answerer's name and never their address. */
export async function feedbackFor(pool: Pool, eventId: string, occurrenceKey: string): Promise<FeedbackWithName[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one evening's answers with names, never addresses, read-only
    "SELECT f.person_key, f.question_key, f.answer, COALESCE(u.name, c.name) AS name, " +
      "(f.person_key LIKE 'guest:%') AS is_guest, UNIX_TIMESTAMP(COALESCE(f.updated_at, f.created_at)) AS at " +
      "FROM event_feedback f " +
      "LEFT JOIN users u ON u.id = f.person_key " +
      "LEFT JOIN comms_contacts c ON f.person_key LIKE 'guest:%' AND c.id = SUBSTRING(f.person_key, 7) " +
      "WHERE f.event_id = ? AND f.occurrence_key = ? ORDER BY at, f.person_key, f.question_key",
    [eventId, occurrenceKey],
  );
  return rows
    .filter((r) => r.question_key === "q1" || r.question_key === "q2")
    .map((r) => ({
      personKey: String(r.person_key),
      questionKey: r.question_key as RecapQuestionKey,
      answer: String(r.answer),
      name: r.name == null ? null : String(r.name),
      guest: Number(r.is_guest) === 1,
      at: Number(r.at ?? 0),
    }));
}
