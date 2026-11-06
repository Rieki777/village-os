/**
 * The invoice rails' four tables (0329): the email to the Sera inbox, Sera's
 * own invoice records, each member's last reconciled treasury view, and the
 * disagreements a sync found. Raw SQL, every write keyed so a retry is a no-op.
 *
 * Nothing here writes the ledger, the token balances or cash owed: the sync is
 * read-only by construction, and server/lib/treasurySync.test.ts holds it to
 * that over every statement this file can send.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SeraInvoice, SyncFlag } from "../../shared/invoiceTrack";

type Queryable = Pool | PoolConnection;

// ── invoice_mail ─────────────────────────────────────────────────────────────

export type MailStatus = "queued" | "sent" | "failed";

export interface InvoiceMailRow {
  id: string;
  invoiceId: string;
  invoiceRef: string;
  userId: string;
  contentHash: string;
  toEmail: string;
  status: MailStatus;
  messageId: string | null;
  attempts: number;
  queuedAt: string;
  sentAt: string | null;
}

const toMail = (r: RowDataPacket): InvoiceMailRow => ({
  id: String(r.id), invoiceId: String(r.invoice_id), invoiceRef: String(r.invoice_ref), userId: String(r.user_id), contentHash: String(r.content_hash),
  toEmail: String(r.to_email), status: String(r.status) as MailStatus, messageId: r.message_id == null ? null : String(r.message_id),
  attempts: Number(r.attempts), queuedAt: String(r.queued_at), sentAt: r.sent_at == null ? null : String(r.sent_at),
});

/** Every email for these invoices, oldest first. */
export async function mailForInvoices(db: Queryable, invoiceIds: readonly string[]): Promise<InvoiceMailRow[]> {
  if (invoiceIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `invoice_mail` WHERE `invoice_id` IN (?) ORDER BY `queued_at`, `id`", [invoiceIds]);
  return rows.map(toMail);
}

export async function mailForRef(db: Queryable, ref: string): Promise<InvoiceMailRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `invoice_mail` WHERE `invoice_ref` = ? ORDER BY `queued_at`, `id`", [ref]);
  return rows.map(toMail);
}

/** One row per (reference, content). Answers false when that row already exists. */
export async function insertMail(db: Queryable, m: Omit<InvoiceMailRow, "status" | "messageId" | "sentAt" | "attempts">): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO `invoice_mail` (`id`, `invoice_id`, `invoice_ref`, `user_id`, `content_hash`, `to_email`, `status`, `message_id`, `attempts`, `queued_at`, `sent_at`) " +
      "VALUES (?,?,?,?,?,?,'queued',NULL,0,?,NULL)",
    [m.id, m.invoiceId, m.invoiceRef, m.userId, m.contentHash, m.toEmail, m.queuedAt],
  );
  return res.affectedRows === 1;
}

/** Takes the next attempt on a row that has not gone out. Answers the attempt number, or 0 when it was sent or lost the race. */
export async function claimMailAttempt(db: Queryable, id: string, seenAttempts: number): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `invoice_mail` SET `attempts` = `attempts` + 1 WHERE `id` = ? AND `status` <> 'sent' AND `attempts` = ?",
    [id, seenAttempts],
  );
  return res.affectedRows === 1 ? seenAttempts + 1 : 0;
}

export async function settleMail(db: Queryable, id: string, r: { status: MailStatus; messageId: string | null; sentAt: string | null }): Promise<void> {
  await db.query("UPDATE `invoice_mail` SET `status` = ?, `message_id` = ?, `sent_at` = ? WHERE `id` = ? AND `status` <> 'sent'", [r.status, r.messageId, r.sentAt, id]);
}

/** Rows that never went out, for the daily retry, capped. */
export async function unsentMail(db: Queryable, maxAttempts: number, limit: number): Promise<InvoiceMailRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `invoice_mail` WHERE `status` <> 'sent' AND `attempts` < ? ORDER BY `queued_at` LIMIT ?",
    [maxAttempts, limit],
  );
  return rows.map(toMail);
}

// ── sera_invoice_reports ─────────────────────────────────────────────────────

export type MatchState = "matched" | "unmatched" | "ambiguous";

export interface SeraReportRow extends SeraInvoice {
  matchState: MatchState;
  matchedInvoiceId: string | null;
  matchBy: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

const toReport = (r: RowDataPacket): SeraReportRow => ({
  id: String(r.sera_id), reference: r.reference == null ? null : String(r.reference), member: r.member_code == null ? null : String(r.member_code),
  moon: r.moon == null ? null : String(r.moon), currency: String(r.currency), amountMinor: Number(r.amount_minor),
  status: String(r.status) as SeraInvoice["status"], receivedAt: String(r.received_at), statusAt: String(r.status_at), changedAt: String(r.changed_at),
  matchState: String(r.match_state) as MatchState, matchedInvoiceId: r.matched_invoice_id == null ? null : String(r.matched_invoice_id),
  matchBy: r.match_by == null ? null : String(r.match_by), firstSeenAt: String(r.first_seen_at), lastSeenAt: String(r.last_seen_at),
});

/**
 * One Sera record, written or refreshed by Sera's id. A record once matched
 * keeps its match: a later read can update Sera's status and amount (which
 * the sync then compares) but never moves it to another invoice.
 */
export async function upsertSeraReport(db: Queryable, r: SeraInvoice, match: { state: MatchState; invoiceId: string | null; by: string | null }, seenAt: string): Promise<void> {
  await db.query(
    "INSERT INTO `sera_invoice_reports` (`sera_id`, `reference`, `member_code`, `moon`, `currency`, `amount_minor`, `status`, `received_at`, `status_at`, `changed_at`, " +
      "`match_state`, `matched_invoice_id`, `match_by`, `first_seen_at`, `last_seen_at`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `reference` = VALUES(`reference`), `member_code` = VALUES(`member_code`), `moon` = VALUES(`moon`), `currency` = VALUES(`currency`), " +
      "`amount_minor` = VALUES(`amount_minor`), `status` = VALUES(`status`), `status_at` = VALUES(`status_at`), `changed_at` = VALUES(`changed_at`), " +
      "`match_by` = IF(`match_state` = 'matched', `match_by`, VALUES(`match_by`)), " +
      "`matched_invoice_id` = IF(`match_state` = 'matched', `matched_invoice_id`, VALUES(`matched_invoice_id`)), " +
      "`match_state` = IF(`match_state` = 'matched', `match_state`, VALUES(`match_state`)), `last_seen_at` = VALUES(`last_seen_at`)",
    [r.id, r.reference, r.member, r.moon, r.currency, r.amountMinor, r.status, r.receivedAt, r.statusAt, r.changedAt, match.state, match.invoiceId, match.by, seenAt, seenAt],
  );
}

export async function seraReportsForInvoices(db: Queryable, invoiceIds: readonly string[]): Promise<SeraReportRow[]> {
  if (invoiceIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `sera_invoice_reports` WHERE `matched_invoice_id` IN (?) ORDER BY `received_at`", [invoiceIds]);
  return rows.map(toReport);
}

export async function unmatchedSeraReports(db: Queryable, limit = 200): Promise<SeraReportRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `sera_invoice_reports` WHERE `match_state` <> 'matched' ORDER BY `received_at` DESC LIMIT ?", [limit]);
  return rows.map(toReport);
}

/** The newest `changed_at` seen, for the next read's `since`. */
export async function seraReportsSince(db: Queryable): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT MAX(`changed_at`) AS `at` FROM `sera_invoice_reports`");
  return rows[0]?.at == null ? null : String(rows[0].at);
}

// ── treasury_sync_views ──────────────────────────────────────────────────────

export async function syncViewOf(db: Queryable, userId: string): Promise<{ view: unknown; syncedAt: string; trigger: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `treasury_sync_views` WHERE `user_id` = ?", [userId]);
  const r = rows[0];
  if (!r) return null;
  try {
    return { view: JSON.parse(String(r.view_json)), syncedAt: String(r.synced_at), trigger: String(r.sync_trigger) };
  } catch {
    return null;
  }
}

export async function saveSyncView(db: Queryable, userId: string, view: unknown, syncedAt: string, trigger: string): Promise<void> {
  await db.query(
    "INSERT INTO `treasury_sync_views` (`user_id`, `view_json`, `synced_at`, `sync_trigger`) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `view_json` = VALUES(`view_json`), `synced_at` = VALUES(`synced_at`), `sync_trigger` = VALUES(`sync_trigger`)",
    [userId, JSON.stringify(view), syncedAt, trigger],
  );
}

// ── treasury_sync_flags ──────────────────────────────────────────────────────

export interface FlagRow {
  id: string;
  dedupeKey: string;
  userId: string | null;
  kind: string;
  subject: string;
  amora: string;
  other: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

const toFlag = (r: RowDataPacket): FlagRow => ({
  id: String(r.id), dedupeKey: String(r.dedupe_key), userId: r.user_id == null ? null : String(r.user_id), kind: String(r.kind), subject: String(r.subject),
  amora: String(r.amora_value), other: String(r.other_value), firstSeenAt: String(r.first_seen_at), lastSeenAt: String(r.last_seen_at),
  resolvedAt: r.resolved_at == null ? null : String(r.resolved_at),
});

/** The key a flag is stored under: the member's id first, so two members' equal differences stay two flags. */
export const storedFlagKey = (userId: string | null, f: Pick<SyncFlag, "dedupeKey">) => `${userId ?? "-"}:${f.dedupeKey}`.slice(0, 191);

/**
 * Writes the flags one sync saw for one member (or for the village, userId
 * null): a new difference is one new row, a seen one is touched, a reopened
 * one is opened again. Every OPEN flag of that owner and those kinds the sync
 * did not see is marked resolved, and kept.
 */
export async function writeFlags(db: Queryable, userId: string | null, kinds: readonly string[], flags: readonly SyncFlag[], at: string, newId: () => string): Promise<void> {
  const keys: string[] = [];
  for (const f of flags) {
    const key = storedFlagKey(userId, f);
    keys.push(key);
    await db.query(
      "INSERT INTO `treasury_sync_flags` (`id`, `dedupe_key`, `user_id`, `kind`, `subject`, `amora_value`, `other_value`, `first_seen_at`, `last_seen_at`, `resolved_at`) " +
        "VALUES (?,?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE `last_seen_at` = VALUES(`last_seen_at`), `resolved_at` = NULL",
      [newId(), key, userId, f.kind, f.subject.slice(0, 120), f.amora.slice(0, 100), f.other.slice(0, 100), at, at],
    );
  }
  if (kinds.length === 0) return;
  const owner = userId === null ? "`user_id` IS NULL" : "`user_id` = ?";
  const params: unknown[] = userId === null ? [at, kinds] : [at, userId, kinds];
  let sql = `UPDATE \`treasury_sync_flags\` SET \`resolved_at\` = ? WHERE ${owner} AND \`kind\` IN (?) AND \`resolved_at\` IS NULL`;
  if (keys.length) {
    sql += " AND `dedupe_key` NOT IN (?)";
    params.push(keys);
  }
  await db.query(sql, params);
}

export async function openFlags(db: Queryable, limit = 500): Promise<FlagRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `treasury_sync_flags` WHERE `resolved_at` IS NULL ORDER BY `first_seen_at` DESC LIMIT ?", [limit]);
  return rows.map(toFlag);
}

export async function openFlagsFor(db: Queryable, userId: string): Promise<FlagRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `treasury_sync_flags` WHERE `user_id` = ? AND `resolved_at` IS NULL ORDER BY `first_seen_at` DESC", [userId]);
  return rows.map(toFlag);
}

// ── The cash-owed rows an invoice's payment wrote, for its reference ─────────

/**
 * The bank reference of the transfer that paid an invoice's rows, read back
 * out of the note the transfers door writes (`cashTransferNote`,
 * shared/cashOwed.ts), when every row carries the same one.
 */
export async function paidReferenceOf(db: Queryable, cashOwedIds: readonly string[]): Promise<string | null> {
  if (cashOwedIds.length === 0) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT DISTINCT `paid_note` AS `note` FROM `cash_owed` WHERE `id` IN (?) AND `state` = 'paid'", [cashOwedIds]);
  const refs = new Set(rows.map((r) => /Reference: (.+)$/.exec(String(r.note ?? ""))?.[1]?.trim() ?? null));
  return refs.size === 1 ? ([...refs][0] ?? null) : null;
}
