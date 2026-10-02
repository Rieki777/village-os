/**
 * The readers and writers for the post office ledger, `comms_messages`, and
 * for what the provider reported about it, `comms_provider_events`
 * (drizzle/0228). One family: a delivery report is a fact about a message.
 *
 * THE ROW IS WRITTEN BEFORE THE SEND, and every status move after it is a
 * conditional UPDATE on the status it expects, so a slow retry can never walk
 * a row backwards over a newer answer.
 *
 * INSTANTS GO IN AS EPOCH SECONDS through FROM_UNIXTIME and come out through
 * UNIX_TIMESTAMP, never as a JavaScript Date. The app pool pins the session
 * to UTC and a test pool does not, and a Date written or read through the
 * driver shifts by the database host's offset (the comms build spec
 * section 1, rule 7).
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { EmailKind, MessageStatus, SkipReason } from "../../shared/comms/kinds";

const VILLAGE = "local";

export interface NewMessageRow {
  id: string;
  idempotencyKey: string;
  contactId: string | null;
  userId: string | null;
  toEmail: string;
  emailKey: string;
  kind: EmailKind;
  origin: string;
  subject: string;
  templateKey: string | null;
  templateVersion: number | null;
  journeyKey: string | null;
  stepKey: string | null;
  enrollmentId: string | null;
  letterId: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: unknown[] | null;
  replyTo: string | null;
  status: Extract<MessageStatus, "queued" | "skipped">;
  skipReason: SkipReason | null;
  /** Epoch seconds, or null for as soon as possible. */
  sendAfter: number | null;
  /** Epoch seconds, or null for never. */
  expiresAt: number | null;
}

export interface MessageRow {
  id: string;
  idempotencyKey: string;
  contactId: string | null;
  userId: string | null;
  toEmail: string;
  kind: string;
  origin: string;
  subject: string;
  status: string;
  skipReason: string | null;
  attempts: number;
  provider: string | null;
  providerMessageId: string | null;
  lastError: string | null;
  /** Epoch seconds, read through UNIX_TIMESTAMP. */
  createdAt: number;
  sentAt: number | null;
}

const isDuplicate = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "ER_DUP_ENTRY";

const epoch = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Write one ledger row. A second row under the same idempotency key is a
 * duplicate, and the answer names the row that was there first.
 */
export async function insertMessage(
  pool: Pool,
  row: NewMessageRow,
): Promise<{ inserted: true; id: string } | { inserted: false; existingId: string | null }> {
  try {
    await pool.query( // module-review-ok: the post office ledger's one writer of new rows, no cache above it
      "INSERT INTO comms_messages (id, village_id, idempotency_key, contact_id, user_id, to_email, email_key, " +
        "kind, origin, subject, template_key, template_version, journey_key, step_key, enrollment_id, letter_id, " +
        "body_html, body_text, attachments, reply_to, status, skip_reason, send_after, expires_at) " +
        // FROM_UNIXTIME(NULL) is NULL, which is what an absent instant means here.
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?))",
      [
        row.id,
        VILLAGE,
        row.idempotencyKey,
        row.contactId,
        row.userId,
        row.toEmail.slice(0, 320),
        row.emailKey.slice(0, 191),
        row.kind,
        row.origin.slice(0, 64),
        row.subject.slice(0, 500),
        row.templateKey,
        row.templateVersion,
        row.journeyKey,
        row.stepKey,
        row.enrollmentId,
        row.letterId,
        row.bodyHtml,
        row.bodyText,
        row.attachments ? JSON.stringify(row.attachments) : null,
        row.replyTo ? row.replyTo.slice(0, 320) : null,
        row.status,
        row.skipReason,
        row.sendAfter,
        row.expiresAt,
      ],
    );
    return { inserted: true, id: row.id };
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, read by its idempotency key
      "SELECT id FROM comms_messages WHERE village_id = ? AND idempotency_key = ? LIMIT 1",
      [VILLAGE, row.idempotencyKey],
    );
    return { inserted: false, existingId: rows[0] ? String(rows[0].id) : null };
  }
}

/** The provider accepted it. Only a row that is still waiting moves. */
export async function markSent(
  pool: Pool,
  id: string,
  input: { provider: string; providerMessageId: string },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'sent', provider = ?, provider_message_id = ?, attempts = attempts + 1, " +
      "sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_error = NULL " +
      "WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [input.provider.slice(0, 32), input.providerMessageId.slice(0, 128), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** The provider refused it, or the call never reached it. The words of the refusal are kept. */
export async function markFailed(pool: Pool, id: string, input: { provider: string; error: string }): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'failed', provider = ?, last_error = ?, attempts = attempts + 1, " +
      "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [input.provider.slice(0, 32), input.error.slice(0, 500), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** It was never sent, and this is why. */
export async function markSkipped(pool: Pool, id: string, reason: SkipReason): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'skipped', skip_reason = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [reason, VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** One ledger row by id, or null. */
export async function messageById(pool: Pool, id: string): Promise<MessageRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, one row by id
    "SELECT id, idempotency_key, contact_id, user_id, to_email, kind, origin, subject, status, skip_reason, attempts, " +
      "provider, provider_message_id, last_error, UNIX_TIMESTAMP(created_at) AS created_at, " +
      "UNIX_TIMESTAMP(sent_at) AS sent_at FROM comms_messages WHERE village_id = ? AND id = ? LIMIT 1",
    [VILLAGE, id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    contactId: r.contact_id == null ? null : String(r.contact_id),
    userId: r.user_id == null ? null : String(r.user_id),
    toEmail: String(r.to_email),
    kind: String(r.kind),
    origin: String(r.origin),
    subject: String(r.subject),
    status: String(r.status),
    skipReason: r.skip_reason == null ? null : String(r.skip_reason),
    attempts: Number(r.attempts ?? 0),
    provider: r.provider == null ? null : String(r.provider),
    providerMessageId: r.provider_message_id == null ? null : String(r.provider_message_id),
    lastError: r.last_error == null ? null : String(r.last_error),
    createdAt: Number(r.created_at),
    sentAt: epoch(r.sent_at),
  };
}

/**
 * How many rows stand in each status, over the last `days` days. The
 * Overview reads this, and it names no person: a count is all it carries.
 */
export async function messageCountsByStatus(pool: Pool, days: number): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, counted, no person named
    "SELECT status, COUNT(*) AS n FROM comms_messages WHERE village_id = ? " +
      "AND created_at > CURRENT_TIMESTAMP - INTERVAL ? DAY GROUP BY status",
    [VILLAGE, Math.max(1, Math.trunc(days))],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.status)] = Number(r.n ?? 0);
  return out;
}

// ── Delivery reports ────────────────────────────────────────────────────────

/**
 * Store one delivery report, once. The provider's delivery id is the primary
 * key, so a report delivered twice is stored once and the second answer says
 * so. Applying the report to the message it is about is a separate step,
 * which is why `processed_at` stays NULL here.
 */
export async function storeProviderEvent(
  pool: Pool,
  input: { id: string; type: string; providerMessageId: string | null; messageId: string | null; payload: unknown },
): Promise<{ stored: boolean }> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: delivery reports' one writer, keyed by the provider's delivery id
    "INSERT IGNORE INTO comms_provider_events (id, type, provider_message_id, message_id, payload) VALUES (?, ?, ?, ?, ?)",
    [
      input.id.slice(0, 191),
      input.type.slice(0, 64),
      input.providerMessageId ? input.providerMessageId.slice(0, 128) : null,
      input.messageId ? input.messageId.slice(0, 64) : null,
      JSON.stringify(input.payload ?? null),
    ],
  );
  return { stored: res.affectedRows > 0 };
}

/** How many delivery reports arrived, and how many still wait to be applied. */
export async function providerEventCounts(pool: Pool): Promise<{ received: number; unprocessed: number }> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: delivery reports, counted, no person named
    "SELECT COUNT(*) AS received, SUM(processed_at IS NULL) AS unprocessed FROM comms_provider_events",
  );
  return { received: Number(rows[0]?.received ?? 0), unprocessed: Number(rows[0]?.unprocessed ?? 0) };
}
