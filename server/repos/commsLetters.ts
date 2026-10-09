/**
 * The readers and writers for letters: `comms_letters` and its snapshot,
 * `comms_letter_recipients` (drizzle/0230), plus the audience reads a letter
 * makes over the address book, the path table and the gathering tables. The
 * behaviour is server/lib/comms/letters.ts; this file is only its SQL.
 *
 * EVERY STATE MOVE IS A CONDITIONAL UPDATE on the state it expects, so two
 * confirmations, two scheduler runs, or a confirmation racing a cancel, can
 * each win once at most. The caller reads `affectedRows` and decides.
 *
 * INSTANTS GO IN AS EPOCH SECONDS through FROM_UNIXTIME and come out through
 * UNIX_TIMESTAMP, and "due", "stale" and "in the last 24 hours" are decided IN
 * SQL against CURRENT_TIMESTAMP, never against this process's clock (the comms
 * build spec section 1, rule 7).
 *
 * `sent_at` IS WHEN A LETTER BEGAN GOING OUT: it is written by the claim, not
 * at the end, so the daily limit and the ten-minute gap count a letter from
 * the moment it was claimed, and a second letter cannot slip in while the
 * first is still being handed over.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { parseLetterAudience, type LetterAudience, type LetterLayout, type LetterRecipientState, type LetterState } from "../../shared/comms/letters";

const VILLAGE = "local";

const isDuplicate = (err: unknown): boolean => (err as { code?: string } | null)?.code === "ER_DUP_ENTRY";
const epoch = (v: unknown): number | null => (v == null ? null : Number(v));

// ── Letters ─────────────────────────────────────────────────────────────────

export interface LetterRow {
  id: string;
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: LetterLayout;
  /** Null when the stored JSON names no audience this build knows. */
  audience: LetterAudience | null;
  state: LetterState;
  /** Epoch seconds. */
  scheduledFor: number | null;
  bodyHash: string | null;
  idempotencyKey: string;
  recipientCount: number;
  postedCount: number;
  skippedCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number | null;
  sentAt: number | null;
}

const LETTER_COLUMNS =
  "id, subject, preheader, body_md, layout, audience, state, UNIX_TIMESTAMP(scheduled_for) AS scheduled_for, body_hash, " +
  "idempotency_key, recipient_count, posted_count, skipped_count, created_by, UNIX_TIMESTAMP(created_at) AS created_at, " +
  "UNIX_TIMESTAMP(updated_at) AS updated_at, UNIX_TIMESTAMP(sent_at) AS sent_at";

const toLetter = (r: RowDataPacket): LetterRow => ({
  id: String(r.id),
  subject: String(r.subject),
  preheader: r.preheader == null ? null : String(r.preheader),
  bodyMd: String(r.body_md),
  layout: String(r.layout) as LetterLayout,
  audience: parseLetterAudience(r.audience),
  state: String(r.state) as LetterState,
  scheduledFor: epoch(r.scheduled_for),
  bodyHash: r.body_hash == null ? null : String(r.body_hash),
  idempotencyKey: String(r.idempotency_key),
  recipientCount: Number(r.recipient_count ?? 0),
  postedCount: Number(r.posted_count ?? 0),
  skippedCount: Number(r.skipped_count ?? 0),
  createdBy: String(r.created_by),
  createdAt: Number(r.created_at),
  updatedAt: epoch(r.updated_at),
  sentAt: epoch(r.sent_at),
});

export interface NewLetter {
  id: string;
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: LetterLayout;
  audience: LetterAudience;
  /** A draft's key until a confirmation replaces it: `draft:<id>`, unique like every key. */
  idempotencyKey: string;
  createdBy: string;
}

export async function insertLetter(pool: Pool, l: NewLetter): Promise<void> {
  await pool.query( // module-review-ok: the letters table's one writer of new rows
    "INSERT INTO comms_letters (id, village_id, subject, preheader, body_md, layout, audience, state, idempotency_key, created_by, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, CURRENT_TIMESTAMP)",
    [l.id, VILLAGE, l.subject, l.preheader, l.bodyMd, l.layout, JSON.stringify(l.audience), l.idempotencyKey, l.createdBy],
  );
}

/**
 * New words for a letter still being written. Clears the preview's hash and
 * snapshot count, because the confirmation they backed no longer describes it.
 */
export async function updateLetterWords(
  pool: Pool,
  id: string,
  w: { subject: string; preheader: string | null; bodyMd: string; layout: LetterLayout; audience: LetterAudience },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one letter by id, only while its words may change
    "UPDATE comms_letters SET subject = ?, preheader = ?, body_md = ?, layout = ?, audience = ?, body_hash = NULL, recipient_count = 0, " +
      "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND state IN ('draft', 'cancelled')",
    [w.subject, w.preheader, w.bodyMd, w.layout, JSON.stringify(w.audience), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

export async function letterById(pool: Pool, id: string): Promise<LetterRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one letter by its primary key
    `SELECT ${LETTER_COLUMNS} FROM comms_letters WHERE village_id = ? AND id = ? LIMIT 1`,
    [VILLAGE, id],
  );
  return rows[0] ? toLetter(rows[0]) : null;
}

export async function letterByIdempotencyKey(pool: Pool, key: string): Promise<LetterRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one letter by its unique idempotency key
    `SELECT ${LETTER_COLUMNS} FROM comms_letters WHERE village_id = ? AND idempotency_key = ? LIMIT 1`,
    [VILLAGE, key],
  );
  return rows[0] ? toLetter(rows[0]) : null;
}

/** The newest letters first, for the screen and History. */
export async function listLetters(pool: Pool, limit = 100): Promise<LetterRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: a page of the letters table, newest first
    `SELECT ${LETTER_COLUMNS} FROM comms_letters WHERE village_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [VILLAGE, Math.max(1, Math.min(500, Math.trunc(limit)))],
  );
  return rows.map(toLetter);
}

/** The preview's hash and how many it found, kept beside the snapshot it wrote. */
export async function recordPreview(pool: Pool, id: string, hash: string, count: number): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one letter by id, only while its words may change
    "UPDATE comms_letters SET body_hash = ?, recipient_count = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state IN ('draft', 'cancelled')",
    [hash, count, VILLAGE, id],
  );
  return res.affectedRows > 0;
}

export type ClaimResult = "claimed" | "lost" | "key_taken";

/**
 * THE STATUS CLAIM. Moves a letter from one of `from` to `sending` (stamping
 * `sent_at`, see the header) or to `scheduled`, carrying the confirmation's
 * idempotency key. Exactly one caller wins; a key already on another letter
 * answers `key_taken`.
 */
export async function claimLetter(
  pool: Pool,
  id: string,
  input: { from: readonly LetterState[]; to: "sending" | "scheduled"; idempotencyKey: string; bodyHash: string; count: number; scheduledFor?: number | null },
): Promise<ClaimResult> {
  const sending = input.to === "sending";
  try {
    const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the letter's status claim, one row by id from the states it expects
      "UPDATE comms_letters SET state = ?, idempotency_key = ?, body_hash = ?, recipient_count = ?, " +
        (sending ? "sent_at = CURRENT_TIMESTAMP, " : "scheduled_for = FROM_UNIXTIME(?), ") +
        "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND state IN (?)",
      [
        input.to,
        input.idempotencyKey,
        input.bodyHash,
        input.count,
        ...(sending ? [] : [input.scheduledFor ?? null]),
        VILLAGE,
        id,
        input.from,
      ],
    );
    return res.affectedRows > 0 ? "claimed" : "lost";
  } catch (err) {
    if (isDuplicate(err)) return "key_taken";
    throw err;
  }
}

/** A scheduled letter whose moment came: `scheduled` to `sending`, once. */
export async function claimDueLetter(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the scheduler's claim of one due letter
    "UPDATE comms_letters SET state = 'sending', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'scheduled' AND scheduled_for <= CURRENT_TIMESTAMP",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/**
 * A letter left `sending` past the lease, taken again by one caller. The
 * lease renews on every heartbeat, so a send still at work is never taken.
 */
export async function reclaimStaleLetter(pool: Pool, id: string, minutes: number): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the resume claim of one stopped letter, by its stale heartbeat
    "UPDATE comms_letters SET updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'sending' AND updated_at <= CURRENT_TIMESTAMP - INTERVAL ? MINUTE",
    [VILLAGE, id, minutes],
  );
  return res.affectedRows > 0;
}

/** A send at work says so, so its claim stays its own. */
export async function heartbeatLetter(pool: Pool, id: string): Promise<void> {
  await pool.query( // module-review-ok: one letter by id, only while it is sending
    "UPDATE comms_letters SET updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND state = 'sending'",
    [VILLAGE, id],
  );
}

/** Scheduled letters whose moment has come, oldest first. */
export async function dueLetterIds(pool: Pool, limit = 20): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the scheduled letters that are due, by the due index
    "SELECT id FROM comms_letters WHERE village_id = ? AND state = 'scheduled' AND scheduled_for <= CURRENT_TIMESTAMP " +
      "ORDER BY scheduled_for, id LIMIT ?",
    [VILLAGE, limit],
  );
  return rows.map((r) => String(r.id));
}

/** Letters left `sending` past the lease. */
export async function staleSendingIds(pool: Pool, minutes: number, limit = 20): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: letters whose send stopped, by their stale heartbeat
    "SELECT id FROM comms_letters WHERE village_id = ? AND state = 'sending' AND updated_at <= CURRENT_TIMESTAMP - INTERVAL ? MINUTE " +
      "ORDER BY updated_at, id LIMIT ?",
    [VILLAGE, minutes, limit],
  );
  return rows.map((r) => String(r.id));
}

/** A letter's numbers, and `sent` once nothing is left pending. */
export async function settleLetter(pool: Pool, id: string): Promise<{ pending: number; posted: number; skipped: number }> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one letter's snapshot, counted by state
    "SELECT status, COUNT(*) AS n FROM comms_letter_recipients WHERE letter_id = ? GROUP BY status",
    [id],
  );
  const count = (s: LetterRecipientState) => Number(rows.find((r) => String(r.status) === s)?.n ?? 0);
  const out = { pending: count("pending"), posted: count("posted"), skipped: count("skipped") };
  await pool.query( // module-review-ok: one letter by id, only while it is sending
    "UPDATE comms_letters SET posted_count = ?, skipped_count = ?, state = IF(? = 0, 'sent', state), updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'sending'",
    [out.posted, out.skipped, out.pending, VILLAGE, id],
  );
  return out;
}

/** A scheduled letter taken back. */
export async function cancelScheduledLetter(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one letter by id, only while it waits to send
    "UPDATE comms_letters SET state = 'cancelled', scheduled_for = NULL, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'scheduled'",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** A scheduled letter moved to another moment (epoch seconds). */
export async function rescheduleLetter(pool: Pool, id: string, at: number): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one letter by id, only while it waits to send
    "UPDATE comms_letters SET scheduled_for = FROM_UNIXTIME(?), updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND state = 'scheduled'",
    [at, VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/**
 * How many letters began going out in the last 24 hours, and how many
 * minutes ago the latest did (null when none did).
 */
export async function lettersWindow(pool: Pool): Promise<{ today: number; minutesSinceLast: number | null }> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the letters that went in the last day, counted in SQL against the database clock
    "SELECT COUNT(*) AS n, TIMESTAMPDIFF(SECOND, MAX(sent_at), CURRENT_TIMESTAMP) AS since FROM comms_letters " +
      "WHERE village_id = ? AND state IN ('sending', 'sent') AND sent_at > CURRENT_TIMESTAMP - INTERVAL 24 HOUR",
    [VILLAGE],
  );
  const n = Number(rows[0]?.n ?? 0);
  const since = rows[0]?.since == null ? null : Number(rows[0].since) / 60;
  return { today: n, minutesSinceLast: n > 0 ? since : null };
}

// ── The snapshot ────────────────────────────────────────────────────────────

export interface RecipientRow {
  letterId: string;
  emailKey: string;
  contactId: string;
  status: LetterRecipientState;
  skipReason: string | null;
  messageId: string | null;
}

const toRecipient = (r: RowDataPacket): RecipientRow => ({
  letterId: String(r.letter_id),
  emailKey: String(r.email_key),
  contactId: String(r.contact_id),
  status: String(r.status) as LetterRecipientState,
  skipReason: r.skip_reason == null ? null : String(r.skip_reason),
  messageId: r.message_id == null ? null : String(r.message_id),
});

/** The preview's snapshot, written whole: whoever the audience is at this moment, each one pending. */
export async function replaceRecipients(pool: Pool, letterId: string, rows: ReadonlyArray<{ emailKey: string; contactId: string }>): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM comms_letter_recipients WHERE letter_id = ?", [letterId]); // module-review-ok: one letter's snapshot, rewritten by its preview
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await conn.query( // module-review-ok: one letter's snapshot, rewritten by its preview
        `INSERT INTO comms_letter_recipients (letter_id, email_key, contact_id, status) VALUES ${chunk.map(() => "(?, ?, ?, 'pending')").join(", ")}`,
        chunk.flatMap((r) => [letterId, r.emailKey, r.contactId]),
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function recipientsOf(pool: Pool, letterId: string, status?: LetterRecipientState): Promise<RecipientRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one letter's snapshot
    "SELECT letter_id, email_key, contact_id, status, skip_reason, message_id FROM comms_letter_recipients WHERE letter_id = ?" +
      (status ? " AND status = ?" : "") +
      " ORDER BY email_key",
    status ? [letterId, status] : [letterId],
  );
  return rows.map(toRecipient);
}

/** One snapshot row's outcome. Only a pending row moves, so a resume never rewrites a settled one. */
export async function markRecipient(
  pool: Pool,
  letterId: string,
  emailKey: string,
  outcome: { status: "posted" | "skipped"; skipReason?: string | null; messageId?: string | null },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one snapshot row by its primary key, only while pending
    "UPDATE comms_letter_recipients SET status = ?, skip_reason = ?, message_id = ? WHERE letter_id = ? AND email_key = ? AND status = 'pending'",
    [outcome.status, outcome.skipReason ? outcome.skipReason.slice(0, 64) : null, outcome.messageId ?? null, letterId, emailKey],
  );
  return res.affectedRows > 0;
}

// ── History: what the post office did with each letter ──────────────────────

export interface LetterNumbers {
  /** Post office rows written for the letter. */
  posted: number;
  /** The provider accepted it (sent, and every report after). */
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  /** Refused at the door or by the drain: no permission, suppressed, and the rest. */
  skipped: number;
  /** Still in the queue, or being sent. */
  waiting: number;
  failed: number;
  rehearsed: number;
}

const ZERO: LetterNumbers = { posted: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, skipped: 0, waiting: 0, failed: 0, rehearsed: 0 };

/** The post office's numbers for each letter, by `comms_messages.letter_id`. */
export async function letterNumbers(pool: Pool, letterIds: readonly string[]): Promise<Map<string, LetterNumbers>> {
  const out = new Map<string, LetterNumbers>();
  if (!letterIds.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the ledger's rows for a page of letters, counted by the letter index
    "SELECT letter_id, COUNT(*) AS posted, " +
      "SUM(status IN ('sent', 'delivered', 'bounced', 'complained')) AS sent, " +
      "SUM(status = 'delivered' OR delivered_at IS NOT NULL) AS delivered, " +
      "SUM(status = 'bounced') AS bounced, SUM(status = 'complained') AS complained, " +
      "SUM(status IN ('skipped', 'expired', 'cancelled')) AS skipped, SUM(status IN ('queued', 'sending')) AS waiting, " +
      "SUM(status = 'failed') AS failed, SUM(status = 'rehearsed') AS rehearsed " +
      "FROM comms_messages WHERE village_id = ? AND letter_id IN (?) GROUP BY letter_id",
    [VILLAGE, letterIds],
  );
  for (const r of rows) {
    out.set(String(r.letter_id), {
      posted: Number(r.posted ?? 0),
      sent: Number(r.sent ?? 0),
      delivered: Number(r.delivered ?? 0),
      bounced: Number(r.bounced ?? 0),
      complained: Number(r.complained ?? 0),
      skipped: Number(r.skipped ?? 0),
      waiting: Number(r.waiting ?? 0),
      failed: Number(r.failed ?? 0),
      rehearsed: Number(r.rehearsed ?? 0),
    });
  }
  for (const id of letterIds) if (!out.has(id)) out.set(id, { ...ZERO });
  return out;
}

/** Snapshot rows skipped before reaching the post office, per letter. */
export async function snapshotSkips(pool: Pool, letterIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!letterIds.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: a page of letters' snapshots, counted by state
    "SELECT letter_id, COUNT(*) AS n FROM comms_letter_recipients WHERE letter_id IN (?) AND status = 'skipped' AND message_id IS NULL GROUP BY letter_id",
    [letterIds],
  );
  for (const r of rows) out.set(String(r.letter_id), Number(r.n ?? 0));
  return out;
}

// ── Who an audience is ──────────────────────────────────────────────────────

export interface AudienceContact {
  id: string;
  emailKey: string;
  email: string;
  name: string | null;
  userId: string | null;
}

const toAudience = (r: RowDataPacket): AudienceContact => ({
  id: String(r.id),
  emailKey: String(r.email_key),
  email: String(r.email),
  name: r.name == null ? null : String(r.name),
  userId: r.user_id == null ? null : String(r.user_id),
});

const CONTACT_COLUMNS = "c.id, c.email_key, c.email, c.name, c.user_id";

/**
 * Every contact with a stored yes to letters, oldest first. A stored yes is a
 * candidate only: the caller asks `permissionFor` of each, which knows about
 * a pause and a suppression, and never reads the state column on its own.
 */
export async function contactsWithLettersYes(pool: Pool): Promise<AudienceContact[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book joined to its letters answers
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts c JOIN comms_permissions p ON p.contact_id = c.id AND p.kind = 'letters' AND p.state = 'yes' ` +
      "WHERE c.village_id = ? ORDER BY c.created_at, c.id",
    [VILLAGE],
  );
  return rows.map(toAudience);
}

/** Contacts by id. */
export async function contactsByIds(pool: Pool, ids: readonly string[]): Promise<AudienceContact[]> {
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, a set of contacts by id
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts c WHERE c.village_id = ? AND c.id IN (?) ORDER BY c.created_at, c.id`,
    [VILLAGE, ids],
  );
  return rows.map(toAudience);
}

/** Contacts linked to member accounts, by user id. */
export async function contactsByUserIds(pool: Pool, userIds: readonly string[]): Promise<AudienceContact[]> {
  if (!userIds.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, a set of contacts by their member id
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts c WHERE c.village_id = ? AND c.user_id IN (?) ORDER BY c.created_at, c.id`,
    [VILLAGE, userIds],
  );
  return rows.map(toAudience);
}

/** Contacts by address key. */
export async function contactsByEmailKeys(pool: Pool, keys: readonly string[]): Promise<AudienceContact[]> {
  if (!keys.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the address book, a set of contacts by address key
    `SELECT ${CONTACT_COLUMNS} FROM comms_contacts c WHERE c.village_id = ? AND c.email_key IN (?) ORDER BY c.created_at, c.id`,
    [VILLAGE, keys],
  );
  return rows.map(toAudience);
}

/** Who is walking one path now: their person key, and the contact or account the row names. */
export async function walkersOfPath(pool: Pool, pathId: string): Promise<Array<{ personKey: string; userId: string | null; contactId: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the path table, one path's active walkers by its index
    "SELECT person_key, user_id, contact_id FROM path_enrollments WHERE village_id = ? AND path_id = ? AND state = 'active' ORDER BY joined_at, id",
    [VILLAGE, pathId],
  );
  return rows.map((r) => ({
    personKey: String(r.person_key),
    userId: r.user_id == null ? null : String(r.user_id),
    contactId: r.contact_id == null ? null : String(r.contact_id),
  }));
}

/**
 * The person keys of everyone marked as having come to a gathering, any
 * evening of it; when nobody was marked at all, everyone who said yes to it.
 */
export async function attendeesOf(pool: Pool, eventId: string): Promise<{ personKeys: string[]; marked: boolean }> {
  const [came] = await pool.query<RowDataPacket[]>( // module-review-ok: one gathering's attendance marks
    "SELECT DISTINCT person_key FROM event_attendance WHERE event_id = ? AND status = 'came' ORDER BY person_key",
    [eventId],
  );
  const [anyMark] = await pool.query<RowDataPacket[]>( // module-review-ok: whether one gathering has any attendance marked
    "SELECT 1 FROM event_attendance WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  if (anyMark.length) return { personKeys: came.map((r) => String(r.person_key)), marked: true };
  const [going] = await pool.query<RowDataPacket[]>( // module-review-ok: one gathering's answers, the people who said yes
    "SELECT DISTINCT user_id FROM event_rsvps WHERE event_id = ? AND status = 'going' ORDER BY user_id",
    [eventId],
  );
  return { personKeys: going.map((r) => String(r.user_id)), marked: false };
}

export interface GatheringChoice {
  id: string;
  title: string;
  /** `YYYY-MM-DD HH:MM` in the calendar's own convention (server/lib/calendar.ts). */
  startsAt: string;
}

/** Gatherings a letter may be addressed to: recent and coming ones, newest first. */
export async function gatheringChoices(pool: Pool, limit = 60): Promise<GatheringChoice[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the events table, recent and coming gatherings by the start index
    "SELECT id, title, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i') AS starts FROM events " +
      "WHERE is_example = 0 AND status <> 'draft' AND starts_at > CURRENT_TIMESTAMP - INTERVAL 180 DAY AND starts_at < CURRENT_TIMESTAMP + INTERVAL 90 DAY " +
      "ORDER BY starts_at DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => ({ id: String(r.id), title: String(r.title), startsAt: String(r.starts) }));
}

/** One gathering's title, or null. */
export async function gatheringTitle(pool: Pool, eventId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one gathering's title by its primary key
    "SELECT title FROM events WHERE id = ? LIMIT 1",
    [eventId],
  );
  return rows[0] ? String(rows[0].title) : null;
}
