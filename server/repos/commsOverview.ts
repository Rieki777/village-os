/**
 * WHAT THE COMMS SETUP CHECKLIST AND THE OVERVIEW READ, and nothing they
 * write (the comms build spec 5.15, 5.16 and 6).
 *
 * A READ MODEL ACROSS THE COMMS TABLES, kept in its own file on purpose. The
 * tables themselves belong to their writers' repos (`commsMessages.ts` for the
 * ledger and its delivery reports, `commsJourneys.ts` for journeys), and those
 * files are being built by other lanes at the same moment. Every statement
 * here is a SELECT, so this file can never change what those writers mean.
 *
 * INSTANTS COME OUT AS EPOCH SECONDS through UNIX_TIMESTAMP, never as a
 * JavaScript Date, for the reason the comms build spec's rule 7 gives: a test
 * pool does not pin UTC and a Date read through the driver shifts by the
 * database host's offset.
 *
 * Raw SQL lives here and nowhere else.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

/** The origin every "send me a test" email is posted under. */
export const TEST_EMAIL_ORIGIN = "comms.test";

const epoch = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

export interface TestEmailRow {
  id: string;
  toEmail: string;
  status: string;
  skipReason: string | null;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
  /** True when a stored delivery report says this email was delivered. */
  deliveredReport: boolean;
}

/**
 * The most recent test email, with whether the provider has reported it
 * delivered. The report is read beside the row's own status because the row
 * is moved to `delivered` by the step that applies reports, and a report that
 * has arrived and is still waiting to be applied is already the provider's
 * word that the email reached somebody.
 */
export async function latestTestEmail(pool: Pool): Promise<TestEmailRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the setup checklist's read of its own test email, newest first
    "SELECT id, to_email, status, skip_reason, last_error, provider_message_id, " +
      "UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(sent_at) AS sent_at, " +
      "UNIX_TIMESTAMP(delivered_at) AS delivered_at FROM comms_messages " +
      "WHERE village_id = ? AND origin = ? ORDER BY created_at DESC, sent_at DESC LIMIT 1",
    [VILLAGE, TEST_EMAIL_ORIGIN],
  );
  const r = rows[0];
  if (!r) return null;
  const providerMessageId = str(r.provider_message_id);
  const [reports] = await pool.query<RowDataPacket[]>( // module-review-ok: the setup checklist asking whether its test email's delivery report has arrived
    "SELECT 1 AS hit FROM comms_provider_events WHERE type = 'email.delivered' " +
      "AND (message_id = ? OR (? IS NOT NULL AND provider_message_id = ?)) LIMIT 1",
    [String(r.id), providerMessageId, providerMessageId],
  );
  return {
    id: String(r.id),
    toEmail: String(r.to_email),
    status: String(r.status),
    skipReason: str(r.skip_reason),
    lastError: str(r.last_error),
    providerMessageId,
    createdAt: Number(r.created_at),
    sentAt: epoch(r.sent_at),
    deliveredAt: epoch(r.delivered_at),
    deliveredReport: reports.length > 0,
  };
}

/** When the last delivery report of any kind arrived, in epoch seconds, or null. */
export async function lastDeliveryReportAt(pool: Pool): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: delivery reports, one instant, no person named
    "SELECT UNIX_TIMESTAMP(MAX(received_at)) AS at FROM comms_provider_events",
  );
  return epoch(rows[0]?.at);
}

/** How many emails of each kind were written in the last `days` days. Counts only. */
export async function messageCountsByKind(pool: Pool, days: number): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, counted by kind, no person named
    "SELECT kind, COUNT(*) AS n FROM comms_messages WHERE village_id = ? " +
      "AND created_at > CURRENT_TIMESTAMP - INTERVAL ? DAY GROUP BY kind",
    [VILLAGE, Math.max(1, Math.trunc(days))],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.kind)] = Number(r.n ?? 0);
  return out;
}

export interface UpcomingEmail {
  id: string;
  /** When it is due, in epoch seconds. Null means as soon as the post office next runs. */
  at: number | null;
  kind: string;
  origin: string;
  subject: string;
  journeyKey: string | null;
  stepKey: string | null;
}

/**
 * Queued emails due inside the next `days` days, soonest first, at most
 * `limit` of them, and how many there are in all. Who each one is for is left
 * out: the Overview is a schedule, and Sent mail is where a person is named.
 */
export async function upcomingEmails(
  pool: Pool,
  days: number,
  limit: number,
): Promise<{ total: number; next: UpcomingEmail[] }> {
  const window = Math.max(1, Math.trunc(days));
  const [[count]] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, queued rows counted, no person named
    "SELECT COUNT(*) AS n FROM comms_messages WHERE village_id = ? AND status = 'queued' " +
      "AND (send_after IS NULL OR send_after <= CURRENT_TIMESTAMP + INTERVAL ? DAY)",
    [VILLAGE, window],
  );
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, queued rows soonest first, no address selected
    "SELECT id, UNIX_TIMESTAMP(send_after) AS at, kind, origin, subject, journey_key, step_key " +
      "FROM comms_messages WHERE village_id = ? AND status = 'queued' " +
      "AND (send_after IS NULL OR send_after <= CURRENT_TIMESTAMP + INTERVAL ? DAY) " +
      "ORDER BY send_after IS NOT NULL, send_after, created_at LIMIT ?",
    [VILLAGE, window, Math.max(1, Math.trunc(limit))],
  );
  return {
    total: Number(count?.n ?? 0),
    next: rows.map((r) => ({
      id: String(r.id),
      at: epoch(r.at),
      kind: String(r.kind),
      origin: String(r.origin),
      subject: String(r.subject),
      journeyKey: str(r.journey_key),
      stepKey: str(r.step_key),
    })),
  };
}

export interface ScheduledLetter {
  id: string;
  subject: string;
  /** Epoch seconds. */
  scheduledFor: number;
  recipientCount: number;
}

/** Letters scheduled inside the next `days` days, soonest first. */
export async function scheduledLetters(pool: Pool, days: number): Promise<ScheduledLetter[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the letters table, scheduled rows inside a window, no person named
    "SELECT id, subject, UNIX_TIMESTAMP(scheduled_for) AS scheduled_for, recipient_count FROM comms_letters " +
      "WHERE village_id = ? AND state = 'scheduled' AND scheduled_for IS NOT NULL " +
      "AND scheduled_for <= CURRENT_TIMESTAMP + INTERVAL ? DAY ORDER BY scheduled_for LIMIT 50",
    [VILLAGE, Math.max(1, Math.trunc(days))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    subject: String(r.subject),
    scheduledFor: Number(r.scheduled_for),
    recipientCount: Number(r.recipient_count ?? 0),
  }));
}

export interface JourneyStateRow {
  journeyKey: string;
  state: string;
  version: number;
  /** True when the village holds its own edited definition. */
  edited: boolean;
}

/** Every journey row this village holds. A journey with no row is off and on the platform default. */
export async function journeyStates(pool: Pool): Promise<JourneyStateRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the journey table, read whole, a handful of rows
    "SELECT journey_key, state, version, definition IS NOT NULL AS edited FROM comms_journeys WHERE village_id = ?",
    [VILLAGE],
  );
  return rows.map((r) => ({
    journeyKey: String(r.journey_key),
    state: String(r.state),
    version: Number(r.version ?? 1),
    edited: Number(r.edited ?? 0) === 1,
  }));
}

/** How many people are walking each journey right now. */
export async function activeEnrollmentCounts(pool: Pool): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the enrollments table, counted by journey, no person named
    "SELECT journey_key, COUNT(*) AS n FROM comms_enrollments WHERE village_id = ? AND state = 'active' GROUP BY journey_key",
    [VILLAGE],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.journey_key)] = Number(r.n ?? 0);
  return out;
}

export interface FailedEmail {
  id: string;
  toEmail: string;
  kind: string;
  origin: string;
  subject: string;
  status: string;
  lastError: string | null;
  /** Epoch seconds, the last time the row moved. */
  at: number;
}

/**
 * Emails that did not reach their person in the last `days` days: the
 * provider refused them, they bounced, or the person marked them as spam.
 * Newest first. The address is included because a failure is something a
 * person has to look at, and this screen is behind the same power as Sent mail.
 */
export async function recentFailures(pool: Pool, days: number, limit: number): Promise<FailedEmail[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, the failures a person has to look at
    "SELECT id, to_email, kind, origin, subject, status, last_error, " +
      "UNIX_TIMESTAMP(COALESCE(updated_at, created_at)) AS at FROM comms_messages " +
      "WHERE village_id = ? AND status IN ('failed', 'bounced', 'complained') " +
      "AND created_at > CURRENT_TIMESTAMP - INTERVAL ? DAY ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?",
    [VILLAGE, Math.max(1, Math.trunc(days)), Math.max(1, Math.trunc(limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    toEmail: String(r.to_email),
    kind: String(r.kind),
    origin: String(r.origin),
    subject: String(r.subject),
    status: String(r.status),
    lastError: str(r.last_error),
    at: Number(r.at),
  }));
}
