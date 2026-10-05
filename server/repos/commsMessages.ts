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
 *
 * ── THE DRAIN'S STATEMENTS (the comms build spec 5.1) ─────────────────────
 *
 * Every row the drain sends is CLAIMED first: one UPDATE from `queued` to
 * `sending` on the row's id, which exactly one drain can win, so two drains
 * running at once still send each row once. Every outcome after that is a
 * conditional UPDATE from `sending`, so an answer that arrives late cannot
 * overwrite one that arrived first. "Due" is decided IN SQL against
 * CURRENT_TIMESTAMP, never against this process's clock.
 *
 * ESSENTIAL ROWS ARE NEVER DRAINED. They are born `sending` and sent inside
 * the request that asked for them, and their words are not kept, so the drain
 * would have nothing to send. One left behind by a crash is marked failed, in
 * words, after ten minutes.
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
  /**
   * `sending` is an urgent row, claimed at birth so no drain can take it while
   * the request that wrote it is sending it. `expired` was too late before it
   * was written. `skipped` says why in `skipReason`.
   */
  status: Extract<MessageStatus, "queued" | "sending" | "skipped" | "expired">;
  skipReason: SkipReason | null;
  /** A sentence beside a skip, when the reason needs one ("no rehearsal inbox"). */
  lastError?: string | null;
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
        "body_html, body_text, attachments, reply_to, status, skip_reason, last_error, send_after, expires_at) " +
        // FROM_UNIXTIME(NULL) is NULL, which is what an absent instant means here.
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?))",
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
        row.lastError ? row.lastError.slice(0, 500) : null,
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

/**
 * The provider accepted it. Only a row that is still waiting moves.
 *
 * `rehearsed` instead of `sent` when it went to the rehearsal inbox, and then
 * `rehearsalTo` records where it really went.
 */
export async function markSent(
  pool: Pool,
  id: string,
  input: { provider: string; providerMessageId: string; status?: "sent" | "rehearsed"; rehearsalTo?: string | null },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = ?, provider = ?, provider_message_id = ?, rehearsal_to = ?, " +
      "attempts = attempts + 1, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_error = NULL, " +
      "next_attempt_at = NULL WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [
      input.status === "rehearsed" ? "rehearsed" : "sent",
      input.provider.slice(0, 32),
      // Accepted with no id is still accepted, and an empty string is not an id.
      input.providerMessageId ? input.providerMessageId.slice(0, 128) : null,
      input.rehearsalTo ? input.rehearsalTo.slice(0, 320) : null,
      VILLAGE,
      id,
    ],
  );
  return res.affectedRows > 0;
}

/** The provider refused it, or the call never reached it. The words of the refusal are kept. */
export async function markFailed(pool: Pool, id: string, input: { provider: string; error: string }): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'failed', provider = ?, last_error = ?, attempts = attempts + 1, " +
      "next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [input.provider.slice(0, 32), input.error.slice(0, 500), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** It was never sent, and this is why, with a sentence when the reason needs one. */
export async function markSkipped(pool: Pool, id: string, reason: SkipReason, lastError: string | null = null): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'skipped', skip_reason = ?, last_error = COALESCE(?, last_error), " +
      "updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [reason, lastError ? lastError.slice(0, 500) : null, VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** It is still unsent and its moment has passed. */
export async function markExpired(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'expired', skip_reason = 'expired', updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status IN ('queued', 'sending')",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

// ── The drain ───────────────────────────────────────────────────────────────

/** A claimed row: everything a send needs, read back after the claim. */
export interface OutboundRow {
  id: string;
  kind: EmailKind;
  contactId: string | null;
  userId: string | null;
  address: string;
  emailKey: string;
  subject: string;
  /** Null once retention cleared it, and always for an essential row. */
  html: string | null;
  text: string | null;
  replyTo: string | null;
  attachments: Array<{ filename: string; contentType: string; contentBase64: string }> | null;
  attempts: number;
  /** Epoch seconds, or null for never. */
  expiresAt: number | null;
}

const DUE =
  "(send_after IS NULL OR send_after <= CURRENT_TIMESTAMP) AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)";

const parseAttachments = (v: unknown): OutboundRow["attachments"] => {
  if (v == null) return null;
  try {
    const list = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
};

/**
 * The ids of rows that are due, oldest first. Never an essential row. With
 * `onlyKinds`, only those kinds: while the village is paused, only notices.
 */
export async function dueMessageIds(pool: Pool, opts: { limit: number; onlyKinds?: readonly EmailKind[] | null }): Promise<string[]> {
  const only = opts.onlyKinds?.length ? opts.onlyKinds : null;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, the drain's due list, ids only
    `SELECT id FROM comms_messages WHERE village_id = ? AND status = 'queued' AND kind <> 'essential' AND ${DUE}` +
      (only ? ` AND kind IN (${only.map(() => "?").join(", ")})` : "") +
      " ORDER BY created_at, id LIMIT ?",
    [VILLAGE, ...(only ?? []), Math.max(1, Math.trunc(opts.limit))],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Claim one due row for this drain, and read it back. Null when another drain
 * won it, or when it stopped being due between the list and the claim.
 */
export async function claimMessage(pool: Pool, id: string): Promise<OutboundRow | null> {
  /*
   * TWO DRAINS CAN DEADLOCK ON THIS UPDATE, and the claim must survive it.
   * Each UPDATE locks entries of the (status, send_after) index as well as the
   * row, so two drains claiming neighbouring rows at once can take those locks
   * in opposite orders. InnoDB then picks a victim and fails its statement with
   * ER_LOCK_DEADLOCK (1213); MariaDB under snapshot isolation can answer 1020
   * instead, and a long wait answers 1205. Measured on the composed tree: the
   * "two drains at once" test threw 1213 out of drain() and lost the tick.
   *
   * The victim's statement was rolled back whole, so trying again is safe: the
   * retry either claims the row or finds the other drain already did
   * (affectedRows 0, answered as null). After three tries the row stays queued
   * for the next drain, which is never a lost email.
   */
  let res: ResultSetHeader | null = null;
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the claim one drain wins
        "UPDATE comms_messages SET status = 'sending', updated_at = CURRENT_TIMESTAMP " +
          `WHERE village_id = ? AND id = ? AND status = 'queued' AND kind <> 'essential' AND ${DUE}`,
        [VILLAGE, id],
      );
    } catch (e: any) {
      if (![1213, 1205, 1020].includes(Number(e?.errno))) throw e;
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 35)));
    }
  }
  if (!res || res.affectedRows === 0) return null;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, the row this drain just claimed
    "SELECT id, kind, contact_id, user_id, to_email, email_key, subject, body_html, body_text, reply_to, attachments, " +
      "attempts, UNIX_TIMESTAMP(expires_at) AS expires_at FROM comms_messages WHERE village_id = ? AND id = ? LIMIT 1",
    [VILLAGE, id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    kind: String(r.kind) as EmailKind,
    contactId: r.contact_id == null ? null : String(r.contact_id),
    userId: r.user_id == null ? null : String(r.user_id),
    address: String(r.to_email),
    emailKey: String(r.email_key),
    subject: String(r.subject),
    html: r.body_html == null ? null : String(r.body_html),
    text: r.body_text == null ? null : String(r.body_text),
    replyTo: r.reply_to == null ? null : String(r.reply_to),
    attachments: parseAttachments(r.attachments),
    attempts: Number(r.attempts ?? 0),
    expiresAt: epoch(r.expires_at),
  };
}

/** A retryable failure: back in the queue, to be tried again after `delaySeconds`. */
export async function scheduleRetry(
  pool: Pool,
  id: string,
  input: { provider: string; error: string; delaySeconds: number },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'queued', provider = ?, last_error = ?, attempts = attempts + 1, " +
      "next_attempt_at = CURRENT_TIMESTAMP + INTERVAL ? SECOND, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status = 'sending'",
    [input.provider.slice(0, 32), input.error.slice(0, 500), Math.max(1, Math.trunc(input.delaySeconds)), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** Over the daily cap: back in the queue until the next window opens. Never dropped. */
export async function deferMessage(pool: Pool, id: string, sendAfter: number): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'queued', send_after = FROM_UNIXTIME(?), updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status = 'sending'",
    [Math.trunc(sendAfter), VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** Held (paused, or a question that could not be answered): back in the queue as it was. */
export async function releaseClaim(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id
    "UPDATE comms_messages SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND status = 'sending'",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** Every queued row whose moment has passed becomes `expired`. Answers how many. */
export async function expireDue(pool: Pool): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the drain's expiry pass
    "UPDATE comms_messages SET status = 'expired', skip_reason = 'expired', updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND status = 'queued' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP",
    [VILLAGE],
  );
  return res.affectedRows;
}

/**
 * A row stuck in `sending` longer than `minutes` belonged to a drain that
 * died. It goes back in the queue, and the row id riding as the provider's
 * Idempotency-Key makes the second attempt one delivery even if the first
 * reached the provider.
 */
export async function recoverStaleSending(pool: Pool, minutes: number): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the drain's stale-claim pass
    "UPDATE comms_messages SET status = 'queued', updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND status = 'sending' AND kind <> 'essential' " +
      "AND COALESCE(updated_at, created_at) <= CURRENT_TIMESTAMP - INTERVAL ? MINUTE",
    [VILLAGE, Math.max(1, Math.trunc(minutes))],
  );
  return res.affectedRows;
}

/**
 * An essential row stuck unsent longer than `minutes`: its request died while
 * sending it, and its words were never kept, so nothing can try again. It is
 * marked failed, in those words, so Sent mail shows it instead of a row that
 * says `sending` for ever. A delivery report that arrives later still corrects
 * it (server/lib/comms/webhook.ts).
 */
export async function failStaleEssential(pool: Pool, minutes: number, why: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the drain's stale-claim pass
    "UPDATE comms_messages SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND kind = 'essential' AND status IN ('queued', 'sending') " +
      "AND COALESCE(updated_at, created_at) <= CURRENT_TIMESTAMP - INTERVAL ? MINUTE",
    [why.slice(0, 500), VILLAGE, Math.max(1, Math.trunc(minutes))],
  );
  return res.affectedRows;
}

/**
 * What the daily cap counts for one person (5.1): path emails and letters
 * that went out in the last 24 hours, plus any being sent right now, other
 * than `excludeId`. `nextWindowAt` is when the oldest of those leaves the
 * window, in epoch seconds, or null when none has a send time yet.
 */
export async function cappedSendsInWindow(
  pool: Pool,
  contactId: string,
  excludeId: string | null,
): Promise<{ count: number; nextWindowAt: number | null; now: number }> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, one person's sends counted for the cap
    "SELECT COUNT(*) AS n, UNIX_TIMESTAMP(MIN(sent_at) + INTERVAL 1 DAY) AS next_at, UNIX_TIMESTAMP(CURRENT_TIMESTAMP) AS now_at " +
      "FROM comms_messages WHERE village_id = ? AND contact_id = ? AND id <> ? AND kind IN ('paths', 'letters') " +
      "AND (status = 'sending' OR sent_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY)",
    [VILLAGE, contactId, excludeId ?? ""],
  );
  const r = rows[0];
  return { count: Number(r?.n ?? 0), nextWindowAt: epoch(r?.next_at), now: Number(r?.now_at ?? Math.floor(Date.now() / 1000)) };
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

// ── Sent mail (the admin screen) ────────────────────────────────────────────

export interface MessageFilters {
  status?: MessageStatus | null;
  kind?: EmailKind | null;
  origin?: string | null;
  /** A part of an address. `%` and `_` in it are matched as themselves. */
  search?: string | null;
  /** Epoch seconds: written at or after this. */
  from?: number | null;
  /** Epoch seconds: written before this. */
  before?: number | null;
  limit: number;
  offset: number;
}

export interface MessageListRow {
  id: string;
  createdAt: number;
  sentAt: number | null;
  toEmail: string;
  kind: string;
  origin: string;
  subject: string;
  status: string;
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  rehearsalTo: string | null;
  /** Whether the words are still kept: never for essential mail, and not after 30 days. */
  hasBody: boolean;
}

/** One page of the ledger, newest first, and how many rows match in all. */
export async function listMessages(pool: Pool, f: MessageFilters): Promise<{ rows: MessageListRow[]; total: number }> {
  const where = ["village_id = ?"];
  const params: unknown[] = [VILLAGE];
  if (f.status) {
    where.push("status = ?");
    params.push(f.status);
  }
  if (f.kind) {
    where.push("kind = ?");
    params.push(f.kind);
  }
  if (f.origin) {
    where.push("origin = ?");
    params.push(f.origin.slice(0, 64));
  }
  const search = String(f.search ?? "").trim().toLowerCase();
  if (search) {
    // `!` as the escape, never a backslash, whose meaning depends on sql_mode.
    where.push("email_key LIKE ? ESCAPE '!'");
    params.push(`%${search.slice(0, 191).replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  if (f.from != null) {
    where.push("created_at >= FROM_UNIXTIME(?)");
    params.push(Math.trunc(f.from));
  }
  if (f.before != null) {
    where.push("created_at < FROM_UNIXTIME(?)");
    params.push(Math.trunc(f.before));
  }
  const clause = where.join(" AND ");
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, a filtered page for Sent mail
    "SELECT id, UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(sent_at) AS sent_at, to_email, kind, origin, " +
      "subject, status, skip_reason, attempts, last_error, rehearsal_to, (body_html IS NOT NULL) AS has_body " +
      `FROM comms_messages WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, Math.max(1, Math.min(200, Math.trunc(f.limit))), Math.max(0, Math.trunc(f.offset))],
  );
  const [count] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, counted under the same filter
    `SELECT COUNT(*) AS n FROM comms_messages WHERE ${clause}`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      createdAt: Number(r.created_at),
      sentAt: epoch(r.sent_at),
      toEmail: String(r.to_email),
      kind: String(r.kind),
      origin: String(r.origin),
      subject: String(r.subject),
      status: String(r.status),
      skipReason: r.skip_reason == null ? null : String(r.skip_reason),
      attempts: Number(r.attempts ?? 0),
      lastError: r.last_error == null ? null : String(r.last_error),
      rehearsalTo: r.rehearsal_to == null ? null : String(r.rehearsal_to),
      hasBody: Number(r.has_body) === 1,
    })),
    total: Number(count[0]?.n ?? 0),
  };
}

/** Every origin the ledger holds, with how many rows each, for the filter. */
export async function messageOrigins(pool: Pool): Promise<Array<{ origin: string; count: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, grouped by what made each email
    "SELECT origin, COUNT(*) AS n FROM comms_messages WHERE village_id = ? GROUP BY origin ORDER BY origin",
    [VILLAGE],
  );
  return rows.map((r) => ({ origin: String(r.origin), count: Number(r.n ?? 0) }));
}

export interface MessageDetail extends MessageListRow {
  contactId: string | null;
  userId: string | null;
  replyTo: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  /** Names and sizes only. The bytes stay in the row. */
  attachments: Array<{ filename: string; contentType: string; bytes: number }>;
  templateKey: string | null;
  journeyKey: string | null;
  stepKey: string | null;
  letterId: string | null;
  provider: string | null;
  providerMessageId: string | null;
  sendAfter: number | null;
  nextAttemptAt: number | null;
  expiresAt: number | null;
  deliveredAt: number | null;
  bouncedAt: number | null;
  complainedAt: number | null;
  updatedAt: number | null;
}

/** One row, words and all, for Sent mail. */
export async function messageDetail(pool: Pool, id: string): Promise<MessageDetail | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, one row by id
    "SELECT id, contact_id, user_id, to_email, kind, origin, subject, status, skip_reason, attempts, last_error, " +
      "rehearsal_to, reply_to, body_html, body_text, attachments, template_key, journey_key, step_key, letter_id, " +
      "provider, provider_message_id, UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(sent_at) AS sent_at, " +
      "UNIX_TIMESTAMP(send_after) AS send_after, UNIX_TIMESTAMP(next_attempt_at) AS next_attempt_at, " +
      "UNIX_TIMESTAMP(expires_at) AS expires_at, UNIX_TIMESTAMP(delivered_at) AS delivered_at, " +
      "UNIX_TIMESTAMP(bounced_at) AS bounced_at, UNIX_TIMESTAMP(complained_at) AS complained_at, " +
      "UNIX_TIMESTAMP(updated_at) AS updated_at FROM comms_messages WHERE village_id = ? AND id = ? LIMIT 1",
    [VILLAGE, id],
  );
  const r = rows[0];
  if (!r) return null;
  const text = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    sentAt: epoch(r.sent_at),
    toEmail: String(r.to_email),
    kind: String(r.kind),
    origin: String(r.origin),
    subject: String(r.subject),
    status: String(r.status),
    skipReason: text(r.skip_reason),
    attempts: Number(r.attempts ?? 0),
    lastError: text(r.last_error),
    rehearsalTo: text(r.rehearsal_to),
    hasBody: r.body_html != null,
    contactId: text(r.contact_id),
    userId: text(r.user_id),
    replyTo: text(r.reply_to),
    bodyHtml: text(r.body_html),
    bodyText: text(r.body_text),
    attachments: (parseAttachments(r.attachments) ?? []).map((a) => ({
      filename: String(a?.filename ?? "attachment"),
      contentType: String(a?.contentType ?? "application/octet-stream"),
      // Base64 carries three bytes in every four characters.
      bytes: Math.floor((String(a?.contentBase64 ?? "").length * 3) / 4),
    })),
    templateKey: text(r.template_key),
    journeyKey: text(r.journey_key),
    stepKey: text(r.step_key),
    letterId: text(r.letter_id),
    provider: text(r.provider),
    providerMessageId: text(r.provider_message_id),
    sendAfter: epoch(r.send_after),
    nextAttemptAt: epoch(r.next_attempt_at),
    expiresAt: epoch(r.expires_at),
    deliveredAt: epoch(r.delivered_at),
    bouncedAt: epoch(r.bounced_at),
    complainedAt: epoch(r.complained_at),
    updatedAt: epoch(r.updated_at),
  };
}

/**
 * A failed row, back in the queue for another full run of tries. Only a row
 * whose words are still kept (never essential mail, never after retention
 * cleared them) and whose moment has not passed. True when it moved.
 */
export async function requeueFailed(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id, an admin's retry
    "UPDATE comms_messages SET status = 'queued', attempts = 0, next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND status = 'failed' AND kind <> 'essential' AND body_html IS NOT NULL " +
      "AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

/** A queued row withdrawn before it went. True when it moved. */
export async function cancelQueued(pool: Pool, id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row by id, an admin's cancel
    "UPDATE comms_messages SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ? AND status = 'queued'",
    [VILLAGE, id],
  );
  return res.affectedRows > 0;
}

// ── Retention (the comms build spec 5.17) ───────────────────────────────────

/**
 * The words of every row older than `days` are cleared; the row stays, so the
 * record of who was written to outlives the words. A row still waiting to go
 * keeps its words, because it cannot be sent without them. Bounded per run.
 */
export async function clearMessageBodies(pool: Pool, days: number): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the retention sweep's body pass
    "UPDATE comms_messages SET body_html = NULL, body_text = NULL, attachments = NULL " +
      "WHERE village_id = ? AND created_at < CURRENT_TIMESTAMP - INTERVAL ? DAY AND status NOT IN ('queued', 'sending') " +
      "AND (body_html IS NOT NULL OR body_text IS NOT NULL OR attachments IS NOT NULL) LIMIT 5000",
    [VILLAGE, Math.max(1, Math.trunc(days))],
  );
  return res.affectedRows;
}

/** Rows older than `months` are deleted, except one still waiting to go. Bounded per run. */
export async function deleteOldMessages(pool: Pool, months: number): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, the retention sweep's row pass
    "DELETE FROM comms_messages WHERE village_id = ? AND created_at < CURRENT_TIMESTAMP - INTERVAL ? MONTH " +
      "AND status NOT IN ('queued', 'sending') LIMIT 5000",
    [VILLAGE, Math.max(1, Math.trunc(months))],
  );
  return res.affectedRows;
}

/** The provider's raw reports older than `days` are deleted. Bounded per run. */
export async function deleteOldProviderEvents(pool: Pool, days: number): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: delivery reports, the retention sweep's pass
    "DELETE FROM comms_provider_events WHERE received_at < CURRENT_TIMESTAMP - INTERVAL ? DAY LIMIT 5000",
    [Math.max(1, Math.trunc(days))],
  );
  return res.affectedRows;
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

/** One stored report: whether it has been applied, and what it said. */
export async function providerEventById(
  pool: Pool,
  id: string,
): Promise<{ id: string; type: string; processedAt: number | null; outcome: string | null; payload: unknown } | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: delivery reports, one by the provider's delivery id
    "SELECT id, type, UNIX_TIMESTAMP(processed_at) AS processed_at, outcome, payload FROM comms_provider_events WHERE id = ? LIMIT 1",
    [id.slice(0, 191)],
  );
  const r = rows[0];
  if (!r) return null;
  let payload: unknown = r.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      /* stored as text by an engine that has no JSON type; keep the text */
    }
  }
  return { id: String(r.id), type: String(r.type), processedAt: epoch(r.processed_at), outcome: r.outcome == null ? null : String(r.outcome), payload };
}

/** A report has been applied, and to which row, and what came of it. */
export async function markProviderEventProcessed(pool: Pool, id: string, input: { messageId: string | null; outcome: string }): Promise<void> {
  await pool.query( // module-review-ok: delivery reports, one by the provider's delivery id
    "UPDATE comms_provider_events SET processed_at = CURRENT_TIMESTAMP, outcome = ?, message_id = COALESCE(?, message_id) WHERE id = ?",
    [input.outcome.slice(0, 64), input.messageId ? input.messageId.slice(0, 64) : null, id.slice(0, 191)],
  );
}

/** The provider events about one ledger row, oldest first, for Sent mail. */
export async function providerEventsForMessage(
  pool: Pool,
  messageId: string,
  providerMessageId: string | null,
): Promise<Array<{ id: string; type: string; receivedAt: number; processedAt: number | null; outcome: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: delivery reports, the ones about one row
    "SELECT id, type, UNIX_TIMESTAMP(received_at) AS received_at, UNIX_TIMESTAMP(processed_at) AS processed_at, outcome " +
      "FROM comms_provider_events WHERE message_id = ? " +
      (providerMessageId ? "OR provider_message_id = ? " : "") +
      "ORDER BY received_at, id LIMIT 100",
    providerMessageId ? [messageId, providerMessageId] : [messageId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    type: String(r.type),
    receivedAt: Number(r.received_at),
    processedAt: epoch(r.processed_at),
    outcome: r.outcome == null ? null : String(r.outcome),
  }));
}

/** What applying a report needs to know about the row it is about. */
export interface ReportTarget {
  id: string;
  status: string;
  kind: string;
  emailKey: string;
  rehearsalTo: string | null;
  providerMessageId: string | null;
}

/**
 * The row a report is about: by the provider's id for the email first, then
 * by our own row id from the `msg` tag every send carries. Nothing else is
 * ever used to find it. A report that matches neither is about no row of ours,
 * and a guess is how a bounce would suppress the wrong person.
 */
export async function reportTarget(
  pool: Pool,
  ref: { providerMessageId: string | null; messageId: string | null },
): Promise<ReportTarget | null> {
  const read = async (column: "provider_message_id" | "id", value: string): Promise<ReportTarget | null> => {
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the post office ledger, the row a delivery report names
      `SELECT id, status, kind, email_key, rehearsal_to, provider_message_id FROM comms_messages WHERE village_id = ? AND ${column} = ? LIMIT 1`,
      [VILLAGE, value],
    );
    const r = rows[0];
    return r
      ? {
          id: String(r.id),
          status: String(r.status),
          kind: String(r.kind),
          emailKey: String(r.email_key),
          rehearsalTo: r.rehearsal_to == null ? null : String(r.rehearsal_to),
          providerMessageId: r.provider_message_id == null ? null : String(r.provider_message_id),
        }
      : null;
  };
  if (ref.providerMessageId) {
    const byProvider = await read("provider_message_id", ref.providerMessageId);
    if (byProvider) return byProvider;
  }
  return ref.messageId ? read("id", ref.messageId) : null;
}

/** The timestamp a report stamps. A fixed list, so no column name is ever built from a report. */
export type ReportStamp = "sent_at" | "delivered_at" | "bounced_at" | "complained_at";
const STAMPS: Record<ReportStamp, string> = {
  sent_at: "sent_at",
  delivered_at: "delivered_at",
  bounced_at: "bounced_at",
  complained_at: "complained_at",
};

/**
 * Move a row to what a report says, but only from a status the report may
 * move it from, so a late `delivered` can never undo a `complained`. The
 * timestamp is kept from the first report that set it, and the provider's id
 * is filled in when the row was matched by its tag before the send recorded it.
 */
export async function applyReportStatus(
  pool: Pool,
  id: string,
  input: { status: MessageStatus; from: readonly string[]; stamp: ReportStamp | null; lastError: string | null; providerMessageId: string | null },
): Promise<boolean> {
  if (!input.from.length) return false;
  const stamp = input.stamp ? `, ${STAMPS[input.stamp]} = COALESCE(${STAMPS[input.stamp]}, CURRENT_TIMESTAMP)` : "";
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the post office ledger, one row moved by a delivery report
    `UPDATE comms_messages SET status = ?${stamp}, last_error = COALESCE(?, last_error), ` +
      "provider_message_id = COALESCE(provider_message_id, ?), updated_at = CURRENT_TIMESTAMP " +
      `WHERE village_id = ? AND id = ? AND status IN (${input.from.map(() => "?").join(", ")})`,
    [input.status, input.lastError ? input.lastError.slice(0, 500) : null, input.providerMessageId, VILLAGE, id, ...input.from],
  );
  return res.affectedRows > 0;
}

/** Record what a report says without moving the status: a delay, or a report about a rehearsal. */
export async function stampReport(
  pool: Pool,
  id: string,
  input: { stamp: ReportStamp | null; lastError: string | null; providerMessageId: string | null },
): Promise<void> {
  const stamp = input.stamp ? `${STAMPS[input.stamp]} = COALESCE(${STAMPS[input.stamp]}, CURRENT_TIMESTAMP), ` : "";
  await pool.query( // module-review-ok: the post office ledger, one row noted by a delivery report
    `UPDATE comms_messages SET ${stamp}last_error = COALESCE(?, last_error), ` +
      "provider_message_id = COALESCE(provider_message_id, ?), updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ?",
    [input.lastError ? input.lastError.slice(0, 500) : null, input.providerMessageId, VILLAGE, id],
  );
}
