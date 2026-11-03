/**
 * THE END-OF-MOON REVIEW'S STORE (module moon-review, drizzle/0313 and 0314):
 * every statement against `moon_recaps`, `moon_recap_items`, `moon_invoices`,
 * `member_pay_routes` and `moon_review_events`, plus the one read of a
 * member's done tasks and the write of a task's role and goal tags.
 *
 * One function per statement, and each hands back what the driver handed
 * back, mapped to the contract's shapes (shared/moonRecap.ts). Every decision
 * stays in server/lib/moonRecap.ts, so this file imports nothing from
 * server/lib. A compare-and-set returns `affectedRows`: 0 means somebody else
 * moved the row first, and the caller says so.
 *
 * WHAT THIS FILE NEVER READS: `member_tasks.private_detail` and
 * `member_tasks.minutes`. The done-task read names its columns, so neither can
 * arrive by a `SELECT *` later.
 *
 * `moon_review_events` is append-only: the only statements against it are an
 * INSERT, a read, and the erasure sweep clearing the words of a note.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  ItemFields, ItemOrigin, ItemReview, ItemState, ItemVisibility, MoonAttestation, PayRoute, PayRouteInput,
  PayRouteRecord, RecapItem, RecapStatus, ReviewEventKind, TaxFormKind, InvoiceStatus,
} from "../../shared/moonRecap";

export type Queryable = Pool | PoolConnection;

const day = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ts = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null || v === "") return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

// ── moon_recaps ──────────────────────────────────────────────────────────────

export interface RecapRow {
  id: string;
  userId: string;
  cycleId: string;
  seasonId: string | null;
  status: RecapStatus;
  round: number;
  ownWords: string | null;
  roleAuditJson: string | null;
  workApprovedAt: string | null;
  workApprovedBy: string | null;
  financeApprovedAt: string | null;
  financeApprovedBy: string | null;
  approvalHash: string | null;
  returnedNote: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  sentAt: string | null;
  seraState: string | null;
  createdAt: string | null;
}

function toRecap(r: RowDataPacket): RecapRow {
  return {
    id: String(r.id), userId: String(r.user_id), cycleId: String(r.cycle_id), seasonId: str(r.season_id),
    status: String(r.status) as RecapStatus, round: Number(r.round) || 0, ownWords: str(r.own_words),
    roleAuditJson: str(r.role_audit_json), workApprovedAt: ts(r.work_approved_at), workApprovedBy: str(r.work_approved_by),
    financeApprovedAt: ts(r.finance_approved_at), financeApprovedBy: str(r.finance_approved_by), approvalHash: str(r.approval_hash),
    returnedNote: str(r.returned_note), returnedBy: str(r.returned_by), returnedAt: ts(r.returned_at), sentAt: ts(r.sent_at),
    seraState: str(r.sera_state), createdAt: ts(r.created_at),
  };
}

/** Make the member's recap for a moon, or leave the one already there. */
export async function ensureRecap(db: Queryable, r: { id: string; userId: string; cycleId: string; seasonId: string | null }): Promise<RecapRow> {
  await db.query(
    "INSERT INTO `moon_recaps` (`id`, `user_id`, `cycle_id`, `season_id`, `status`, `round`) VALUES (?, ?, ?, ?, 'draft', 0) " +
      "ON DUPLICATE KEY UPDATE `id` = `id`",
    [r.id, r.userId, r.cycleId, r.seasonId],
  );
  const row = await recapFor(db, r.userId, r.cycleId);
  if (!row) throw new Error(`moon_recaps: no row for ${r.userId} ${r.cycleId} after insert`);
  return row;
}

export async function recapFor(db: Queryable, userId: string, cycleId: string, forUpdate = false): Promise<RecapRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM \`moon_recaps\` WHERE \`user_id\` = ? AND \`cycle_id\` = ?${forUpdate ? " FOR UPDATE" : ""}`,
    [userId, cycleId],
  );
  return rows[0] ? toRecap(rows[0]) : null;
}

export async function recapById(db: Queryable, id: string, forUpdate = false): Promise<RecapRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`moon_recaps\` WHERE \`id\` = ?${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toRecap(rows[0]) : null;
}

/** A member's recaps, newest moon first, for the picker. */
export async function recapsOf(db: Queryable, userId: string, limit = 24): Promise<RecapRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `moon_recaps` WHERE `user_id` = ? ORDER BY `cycle_id` DESC LIMIT ?",
    [userId, limit],
  );
  return rows.map(toRecap);
}

/** Every recap of a moon, for the review queue and the room. */
export async function recapsForCycle(db: Queryable, cycleId: string): Promise<RecapRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_recaps` WHERE `cycle_id` = ? ORDER BY `sent_at` ASC, `id` ASC", [cycleId]);
  return rows.map(toRecap);
}

/** Every recap waiting on an approval, any moon, for the deadline job and the exit desk. */
export async function waitingRecaps(db: Queryable): Promise<RecapRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_recaps` WHERE `status` = 'waiting' ORDER BY `sent_at` ASC");
  return rows.map(toRecap);
}

/** When the member last sent a recap before this moon: gather brings in work done since. */
export async function previousSentAt(db: Queryable, userId: string, beforeCycleId: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT MAX(`sent_at`) AS `at` FROM `moon_recaps` WHERE `user_id` = ? AND `cycle_id` < ? AND `sent_at` IS NOT NULL",
    [userId, beforeCycleId],
  );
  return ts(rows[0]?.at);
}

/** The member's own words and role audit, while the recap is theirs to edit. */
export async function saveRecapWords(db: Queryable, id: string, ownWords: string | null, roleAuditJson: string | null): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `own_words` = ?, `role_audit_json` = ? WHERE `id` = ? AND `status` IN ('draft', 'returned')",
    [ownWords, roleAuditJson, id],
  );
  return res.affectedRows;
}

/** Send: Draft or Returned to Waiting, one round more, every approval cleared. */
export async function markRecapSent(db: Queryable, id: string, round: number): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `status` = 'waiting', `round` = ?, `sent_at` = CURRENT_TIMESTAMP, " +
      "`work_approved_at` = NULL, `work_approved_by` = NULL, `finance_approved_at` = NULL, `finance_approved_by` = NULL, `approval_hash` = NULL " +
      "WHERE `id` = ? AND `status` IN ('draft', 'returned') AND `round` = ?",
    [round + 1, id, round],
  );
  return res.affectedRows;
}

/** Take back: Waiting to Draft, both approvals cleared. Never from Approved. */
export async function takeBackRecap(db: Queryable, id: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `status` = 'draft', `work_approved_at` = NULL, `work_approved_by` = NULL, " +
      "`finance_approved_at` = NULL, `finance_approved_by` = NULL, `approval_hash` = NULL WHERE `id` = ? AND `status` = 'waiting'",
    [id],
  );
  return res.affectedRows;
}

/** The work approval, bound to the hash the approver read. The caller has checked the two-person rule. */
export async function setWorkApproved(db: Queryable, r: { id: string; by: string; hash: string; nextStatus: RecapStatus }): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `work_approved_at` = CURRENT_TIMESTAMP, `work_approved_by` = ?, `approval_hash` = ?, `status` = ? " +
      "WHERE `id` = ? AND `status` = 'waiting' AND `work_approved_at` IS NULL AND `user_id` <> ?",
    [r.by, r.hash, r.nextStatus, r.id, r.by],
  );
  return res.affectedRows;
}

/** The Finance approval: only after the work, only on the same hash, never by the work approver or the member. */
export async function setFinanceApproved(db: Queryable, r: { id: string; by: string; hash: string }): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `finance_approved_at` = CURRENT_TIMESTAMP, `finance_approved_by` = ?, `status` = 'approved' " +
      "WHERE `id` = ? AND `status` = 'waiting' AND `work_approved_at` IS NOT NULL AND `finance_approved_at` IS NULL " +
      "AND `approval_hash` = ? AND `user_id` <> ? AND `work_approved_by` <> ?",
    [r.by, r.id, r.hash, r.by, r.by],
  );
  return res.affectedRows;
}

/**
 * Return with a note. `keepWork` keeps the work approval (a Finance return
 * about the invoice); otherwise both approvals clear.
 */
export async function returnRecap(db: Queryable, r: { id: string; by: string; note: string; keepWork: boolean }): Promise<number> {
  const clear = r.keepWork ? "" : "`work_approved_at` = NULL, `work_approved_by` = NULL, `approval_hash` = NULL, ";
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE \`moon_recaps\` SET \`status\` = 'returned', ${clear}\`finance_approved_at\` = NULL, \`finance_approved_by\` = NULL, ` +
      "`returned_note` = ?, `returned_by` = ?, `returned_at` = CURRENT_TIMESTAMP WHERE `id` = ? AND `status` = 'waiting'",
    [r.note, r.by, r.id],
  );
  return res.affectedRows;
}

/** Any edit after an approval clears both. */
export async function clearApprovals(db: Queryable, id: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `work_approved_at` = NULL, `work_approved_by` = NULL, `finance_approved_at` = NULL, " +
      "`finance_approved_by` = NULL, `approval_hash` = NULL, `status` = IF(`status` = 'approved', 'waiting', `status`) " +
      "WHERE `id` = ? AND (`work_approved_at` IS NOT NULL OR `finance_approved_at` IS NOT NULL)",
    [id],
  );
  return res.affectedRows;
}

export async function setSeraState(db: Queryable, id: string, stateJson: string): Promise<void> {
  await db.query("UPDATE `moon_recaps` SET `sera_state` = ? WHERE `id` = ?", [stateJson, id]);
}

// ── moon_recap_items ─────────────────────────────────────────────────────────

function toItem(r: RowDataPacket): RecapItem {
  return {
    id: String(r.id), origin: String(r.origin) as ItemOrigin, text: String(r.text ?? ""), originNote: str(r.origin_note),
    doneOn: day(r.done_on), evidenceUrl: str(r.evidence_url), evidenceAsset: str(r.evidence_asset),
    proofInSummary: Number(r.proof_in_summary) === 1, roleId: str(r.role_id), accountabilityWords: str(r.accountability_words),
    seasonGoalId: str(r.season_goal_id), ownGoalWords: str(r.own_goal_words), state: String(r.state) as ItemState,
    visibility: String(r.visibility) as ItemVisibility, review: String(r.review) as ItemReview, reviewNote: str(r.review_note),
    position: Number(r.position) || 0,
  };
}

export async function itemsOf(db: Queryable, recapId: string): Promise<RecapItem[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `moon_recap_items` WHERE `recap_id` = ? ORDER BY `position` ASC, `created_at` ASC, `id` ASC",
    [recapId],
  );
  return rows.map(toItem);
}

export async function itemById(db: Queryable, id: string): Promise<(RecapItem & { recapId: string }) | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_recap_items` WHERE `id` = ?", [id]);
  return rows[0] ? { ...toItem(rows[0]), recapId: String(rows[0].recap_id) } : null;
}

export async function itemCount(db: Queryable, recapId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS `n` FROM `moon_recap_items` WHERE `recap_id` = ?", [recapId]);
  return Number(rows[0]?.n) || 0;
}

export interface ItemInsert {
  id: string;
  recapId: string;
  origin: ItemOrigin;
  dedupeKey: string;
  text: string;
  originNote: string | null;
  doneOn: string | null;
  evidenceUrl: string | null;
  roleId: string | null;
  seasonGoalId: string | null;
  state: ItemState;
  visibility: ItemVisibility;
  position: number;
}

/**
 * One item, or nothing when the recap already holds its key. Every NOT NULL
 * column is named, so no DEFAULT is relied on. Returns true when it wrote.
 */
export async function insertItem(db: Queryable, i: ItemInsert): Promise<boolean> {
  await db.query(
    "INSERT INTO `moon_recap_items` (`id`, `recap_id`, `origin`, `dedupe_key`, `text`, `origin_note`, `done_on`, `evidence_url`, " +
      "`proof_in_summary`, `role_id`, `season_goal_id`, `state`, `visibility`, `review`, `position`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending', ?) ON DUPLICATE KEY UPDATE `id` = `id`",
    [i.id, i.recapId, i.origin, i.dedupeKey, i.text, i.originNote, i.doneOn, i.evidenceUrl, i.roleId, i.seasonGoalId, i.state, i.visibility, i.position],
  );
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id` FROM `moon_recap_items` WHERE `recap_id` = ? AND `dedupe_key` = ?", [i.recapId, i.dedupeKey]);
  return rows[0] ? String(rows[0].id) === i.id : false;
}

/** The keys a member's OTHER recaps already hold: one piece of work is never in two recaps. */
export async function keysInOtherRecaps(db: Queryable, userId: string, recapId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT i.`dedupe_key` FROM `moon_recap_items` i JOIN `moon_recaps` r ON r.`id` = i.`recap_id` " +
      "WHERE r.`user_id` = ? AND r.`id` <> ? AND i.`state` <> 'dropped' AND i.`dedupe_key` IN (?)",
    [userId, recapId, keys],
  );
  return new Set(rows.map((r) => String(r.dedupe_key)));
}

const ITEM_COLUMNS: Record<keyof ItemFields, string> = {
  text: "text", evidenceUrl: "evidence_url", evidenceAsset: "evidence_asset", proofInSummary: "proof_in_summary",
  roleId: "role_id", accountabilityWords: "accountability_words", seasonGoalId: "season_goal_id",
  ownGoalWords: "own_goal_words", state: "state", visibility: "visibility", position: "position",
};

/** A member's edit to one item. Only the fields given move. */
export async function updateItem(db: Queryable, id: string, fields: ItemFields): Promise<number> {
  const keys = (Object.keys(fields) as Array<keyof ItemFields>).filter((k) => fields[k] !== undefined && ITEM_COLUMNS[k]);
  if (keys.length === 0) return 0;
  const set = keys.map((k) => `\`${ITEM_COLUMNS[k]}\` = ?`).join(", ");
  const vals = keys.map((k) => (k === "proofInSummary" ? (fields[k] ? 1 : 0) : fields[k]));
  const [res] = await db.query<ResultSetHeader>(`UPDATE \`moon_recap_items\` SET ${set} WHERE \`id\` = ?`, [...vals, id]);
  return res.affectedRows;
}

/** An approver's reading of one item. */
export async function setItemReview(db: Queryable, id: string, recapId: string, review: ItemReview, note: string | null): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recap_items` SET `review` = ?, `review_note` = ? WHERE `id` = ? AND `recap_id` = ?",
    [review, note, id, recapId],
  );
  return res.affectedRows;
}

/** A resend starts every item's review again. */
export async function resetItemReviews(db: Queryable, recapId: string): Promise<void> {
  await db.query("UPDATE `moon_recap_items` SET `review` = 'pending', `review_note` = NULL WHERE `recap_id` = ?", [recapId]);
}

// ── member_tasks: the done-task read and the tags (0314) ─────────────────────

export interface DoneTask {
  id: string;
  title: string;
  source: string;
  externalId: string | null;
  doneAt: string | null;
  roleId: string | null;
  servesGoalId: string | null;
}

/**
 * A member's tasks marked done in a window. Titles only: the columns are
 * named, and `private_detail` and `minutes` are not among them.
 */
export async function doneTasksBetween(db: Queryable, userId: string, fromIso: string | null, toIso: string): Promise<DoneTask[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `title`, `source`, `external_id`, `done_at`, `role_id`, `serves_goal_id` FROM `member_tasks` " +
      "WHERE `user_id` = ? AND `status` = 'done' AND `done_at` IS NOT NULL AND `done_at` < ? AND (? IS NULL OR `done_at` > ?) " +
      "ORDER BY `done_at` ASC, `id` ASC",
    [userId, new Date(toIso), fromIso === null ? null : new Date(fromIso), fromIso === null ? null : new Date(fromIso)],
  );
  return rows.map((r) => ({
    id: String(r.id), title: String(r.title ?? ""), source: String(r.source ?? "self"), externalId: str(r.external_id),
    doneAt: ts(r.done_at), roleId: str(r.role_id), servesGoalId: str(r.serves_goal_id),
  }));
}

/** Tag one of the member's own tasks to a role and a season goal. */
export async function setTaskTags(db: Queryable, userId: string, taskId: string, roleId: string | null, servesGoalId: string | null): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_tasks` SET `role_id` = ?, `serves_goal_id` = ? WHERE `id` = ? AND `user_id` = ?",
    [roleId, servesGoalId, taskId, userId],
  );
  return res.affectedRows;
}

// ── moon_invoices ────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  recapId: string;
  userId: string;
  cycleId: string;
  payerKey: string;
  revision: number;
  billRefSeq: number;
  memberNumber: string;
  currency: string;
  totalMinor: number;
  linesJson: string;
  fromJson: string | null;
  attestation: MoonAttestation | null;
  externalInvoiceKey: string | null;
  status: InvoiceStatus;
  approvalHash: string | null;
  expectedOn: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  paidOn: string | null;
  paidAmountMinor: number | null;
  paidCurrency: string | null;
  fxRate: string | null;
  fxSource: string | null;
  fxDate: string | null;
  feesMinor: number | null;
  fundsSource: string | null;
  voidOf: string | null;
  voidedAt: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toInvoice(r: RowDataPacket): InvoiceRow {
  return {
    id: String(r.id), recapId: String(r.recap_id), userId: String(r.user_id), cycleId: String(r.cycle_id), payerKey: String(r.payer_key),
    revision: Number(r.revision) || 1, billRefSeq: Number(r.bill_ref_seq), memberNumber: String(r.member_number), currency: String(r.currency),
    totalMinor: Number(r.total_minor), linesJson: String(r.lines_json ?? "[]"), fromJson: str(r.from_json),
    attestation: json<MoonAttestation | null>(r.attestation_json, null), externalInvoiceKey: str(r.external_invoice_key),
    status: String(r.status) as InvoiceStatus, approvalHash: str(r.approval_hash), expectedOn: day(r.expected_on), sentAt: ts(r.sent_at),
    approvedAt: ts(r.approved_at), approvedBy: str(r.approved_by), paidOn: day(r.paid_on), paidAmountMinor: num(r.paid_amount_minor),
    paidCurrency: str(r.paid_currency), fxRate: str(r.fx_rate), fxSource: str(r.fx_source), fxDate: day(r.fx_date),
    feesMinor: num(r.fees_minor), fundsSource: str(r.funds_source), voidOf: str(r.void_of), voidedAt: ts(r.voided_at),
  };
}

/** The live invoice of a recap: the newest revision that is not Void. */
export async function invoiceForRecap(db: Queryable, recapId: string, forUpdate = false): Promise<InvoiceRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM \`moon_invoices\` WHERE \`recap_id\` = ? AND \`status\` <> 'void' ORDER BY \`revision\` DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [recapId],
  );
  return rows[0] ? toInvoice(rows[0]) : null;
}

export async function invoiceById(db: Queryable, id: string, forUpdate = false): Promise<InvoiceRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`moon_invoices\` WHERE \`id\` = ?${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toInvoice(rows[0]) : null;
}

export async function invoicesByIds(db: Queryable, ids: readonly string[]): Promise<InvoiceRow[]> {
  if (ids.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_invoices` WHERE `id` IN (?)", [ids]);
  return rows.map(toInvoice);
}

export async function invoicesForCycle(db: Queryable, cycleId: string): Promise<InvoiceRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_invoices` WHERE `cycle_id` = ? ORDER BY `payer_key`, `bill_ref_seq`", [cycleId]);
  return rows.map(toInvoice);
}

/** Every revision a member's recap has had, Void ones included, for the record. */
export async function invoiceHistory(db: Queryable, recapId: string): Promise<InvoiceRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_invoices` WHERE `recap_id` = ? ORDER BY `revision` ASC", [recapId]);
  return rows.map(toInvoice);
}

/** The payer's next bill ref, read under a lock inside the send's transaction. */
export async function nextBillRefSeq(conn: PoolConnection, payerKey: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(`bill_ref_seq`), 0) AS `n` FROM `moon_invoices` WHERE `payer_key` = ? FOR UPDATE",
    [payerKey],
  );
  return (Number(rows[0]?.n) || 0) + 1;
}

/** The member's own next invoice number, moved under a lock inside the send's transaction. */
export async function nextMemberInvoiceSeq(conn: PoolConnection, userId: string): Promise<number> {
  await conn.query("UPDATE `member_pay_routes` SET `invoice_seq` = `invoice_seq` + 1 WHERE `user_id` = ?", [userId]);
  const [rows] = await conn.query<RowDataPacket[]>("SELECT `invoice_seq` FROM `member_pay_routes` WHERE `user_id` = ? FOR UPDATE", [userId]);
  if (!rows[0]) throw new Error(`member_pay_routes: no row for ${userId}; an invoice needs a pay route`);
  return Number(rows[0].invoice_seq);
}

/** The next revision for a member's moon and payer, after a Void. */
export async function nextInvoiceRevision(conn: PoolConnection, userId: string, cycleId: string, payerKey: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(`revision`), 0) AS `n` FROM `moon_invoices` WHERE `user_id` = ? AND `cycle_id` = ? AND `payer_key` = ? FOR UPDATE",
    [userId, cycleId, payerKey],
  );
  return (Number(rows[0]?.n) || 0) + 1;
}

export interface InvoiceInsert {
  id: string;
  recapId: string;
  userId: string;
  cycleId: string;
  payerKey: string;
  revision: number;
  billRefSeq: number;
  memberNumber: string;
  currency: string;
  totalMinor: number;
  linesJson: string;
  fromJson: string;
  attestationJson: string;
  voidOf: string | null;
}

/** A sent draft invoice. Every NOT NULL column is named. */
export async function insertInvoice(db: Queryable, i: InvoiceInsert): Promise<void> {
  await db.query(
    "INSERT INTO `moon_invoices` (`id`, `recap_id`, `user_id`, `cycle_id`, `payer_key`, `revision`, `bill_ref_seq`, `member_number`, " +
      "`currency`, `total_minor`, `lines_json`, `from_json`, `attestation_json`, `status`, `sent_at`, `void_of`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', CURRENT_TIMESTAMP, ?)",
    [i.id, i.recapId, i.userId, i.cycleId, i.payerKey, i.revision, i.billRefSeq, i.memberNumber, i.currency, i.totalMinor, i.linesJson, i.fromJson, i.attestationJson, i.voidOf],
  );
}

/**
 * A resend of an invoice that was taken back or returned: new lines, From and
 * attestation on the same row and number. Never on an approved, paid or void one.
 */
export async function resendInvoice(db: Queryable, id: string, r: { currency: string; totalMinor: number; linesJson: string; fromJson: string; attestationJson: string }): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `currency` = ?, `total_minor` = ?, `lines_json` = ?, `from_json` = ?, `attestation_json` = ?, " +
      "`status` = 'waiting', `sent_at` = CURRENT_TIMESTAMP, `approval_hash` = NULL, `approved_at` = NULL, `approved_by` = NULL, `expected_on` = NULL " +
      "WHERE `id` = ? AND `status` IN ('waiting', 'returned', 'draft')",
    [r.currency, r.totalMinor, r.linesJson, r.fromJson, r.attestationJson, id],
  );
  return res.affectedRows;
}

/** Move an invoice between the statuses before approval (take back, return). */
export async function setInvoiceStatus(db: Queryable, id: string, from: readonly InvoiceStatus[], to: InvoiceStatus): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `status` = ?, `approval_hash` = IF(? IN ('draft', 'returned'), NULL, `approval_hash`), " +
      "`approved_at` = IF(? IN ('draft', 'returned'), NULL, `approved_at`), `approved_by` = IF(? IN ('draft', 'returned'), NULL, `approved_by`) " +
      "WHERE `id` = ? AND `status` IN (?)",
    [to, to, to, to, id, from],
  );
  return res.affectedRows;
}

/** Finance's line amounts (ranges set, cash owed ids written) before or at approval. */
export async function setInvoiceLines(db: Queryable, id: string, linesJson: string, totalMinor: number): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `lines_json` = ?, `total_minor` = ? WHERE `id` = ? AND `status` = 'waiting'",
    [linesJson, totalMinor, id],
  );
  return res.affectedRows;
}

/** Finance approval, bound to the hash. The caller has checked the two-person rule and written the cash owed rows. */
export async function setInvoiceApproved(db: Queryable, r: { id: string; by: string; hash: string; expectedOn: string; linesJson: string; fxRate: string | null; fxSource: string | null; fxDate: string | null }): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `status` = 'approved', `approved_at` = CURRENT_TIMESTAMP, `approved_by` = ?, `approval_hash` = ?, " +
      "`expected_on` = ?, `lines_json` = ?, `fx_rate` = ?, `fx_source` = ?, `fx_date` = ? WHERE `id` = ? AND `status` = 'waiting' AND `user_id` <> ?",
    [r.by, r.hash, r.expectedOn, r.linesJson, r.fxRate, r.fxSource, r.fxDate, r.id, r.by],
  );
  return res.affectedRows;
}

/** Paid, read off the cash owed rows the transfers door paid. */
export async function markInvoicePaid(db: Queryable, id: string, r: { paidOn: string; paidAmountMinor: number | null; paidCurrency: string | null; feesMinor: number | null; fundsSource: string | null }): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `status` = 'paid', `paid_on` = ?, `paid_amount_minor` = ?, `paid_currency` = ?, `fees_minor` = ?, `funds_source` = ? " +
      "WHERE `id` = ? AND `status` = 'approved'",
    [r.paidOn, r.paidAmountMinor, r.paidCurrency, r.feesMinor, r.fundsSource, id],
  );
  return res.affectedRows;
}

/** Void: kept for the record, never edited again. */
export async function voidInvoice(db: Queryable, id: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `status` = 'void', `voided_at` = CURRENT_TIMESTAMP WHERE `id` = ? AND `status` <> 'void'",
    [id],
  );
  return res.affectedRows;
}

/** Invoices waiting on Finance whose cash owed rows are all paid: the paid sweep reads these. */
export async function approvedInvoices(db: Queryable): Promise<InvoiceRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_invoices` WHERE `status` = 'approved' ORDER BY `approved_at` ASC");
  return rows.map(toInvoice);
}

/** The year-end export for one payer: paid invoices by transfer date. */
export async function paidInvoicesForYear(db: Queryable, year: number, payerKey: string): Promise<InvoiceRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `moon_invoices` WHERE `payer_key` = ? AND `status` = 'paid' AND `paid_on` >= ? AND `paid_on` < ? ORDER BY `paid_on`, `bill_ref_seq`",
    [payerKey, `${year}-01-01`, `${year + 1}-01-01`],
  );
  return rows.map(toInvoice);
}

// ── member_pay_routes ────────────────────────────────────────────────────────

function toRoute(r: RowDataPacket): PayRouteRecord {
  return {
    userId: String(r.user_id), route: String(r.route) as PayRoute, payerKey: str(r.payer_key), currency: str(r.currency),
    legalName: str(r.legal_name), address: str(r.address), statusValidUntil: day(r.status_valid_until),
    taxFormKind: String(r.tax_form_kind ?? "none") as TaxFormKind, taxFormSignedOn: day(r.tax_form_signed_on),
    taxFormExpiresOn: day(r.tax_form_expires_on), taxFormFiledWhere: str(r.tax_form_filed_where), confirmedAt: ts(r.confirmed_at),
    confirmedBy: str(r.confirmed_by), pilotAckVersion: str(r.pilot_ack_version), pilotAckAt: ts(r.pilot_ack_at),
    bankChangedOn: day(r.bank_changed_on), bankConfirmedByRole: str(r.bank_confirmed_by_role),
  };
}

export async function payRouteOf(db: Queryable, userId: string): Promise<PayRouteRecord | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `member_pay_routes` WHERE `user_id` = ?", [userId]);
  return rows[0] ? toRoute(rows[0]) : null;
}

export async function payRoutesOf(db: Queryable, userIds: readonly string[]): Promise<PayRouteRecord[]> {
  if (userIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `member_pay_routes` WHERE `user_id` IN (?)", [userIds]);
  return rows.map(toRoute);
}

/**
 * The member's own route. `clearConfirmation` is the lib's reading of
 * `routeChangeClearsConfirmation`; confirmation itself is never written here.
 */
export async function upsertPayRoute(db: Queryable, userId: string, r: PayRouteInput, clearConfirmation: boolean): Promise<void> {
  const clear = clearConfirmation ? ", `confirmed_at` = NULL, `confirmed_by` = NULL" : "";
  await db.query(
    "INSERT INTO `member_pay_routes` (`user_id`, `route`, `payer_key`, `currency`, `legal_name`, `address`, `status_valid_until`, " +
      "`tax_form_kind`, `tax_form_signed_on`, `tax_form_expires_on`, `tax_form_filed_where`, `invoice_seq`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE `route` = VALUES(`route`), `payer_key` = VALUES(`payer_key`), " +
      "`currency` = VALUES(`currency`), `legal_name` = VALUES(`legal_name`), `address` = VALUES(`address`), " +
      "`status_valid_until` = VALUES(`status_valid_until`), `tax_form_kind` = VALUES(`tax_form_kind`), " +
      "`tax_form_signed_on` = VALUES(`tax_form_signed_on`), `tax_form_expires_on` = VALUES(`tax_form_expires_on`), " +
      `\`tax_form_filed_where\` = VALUES(\`tax_form_filed_where\`)${clear}`,
    [userId, r.route, r.payerKey, r.currency, r.legalName, r.address, r.statusValidUntil, r.taxFormKind, r.taxFormSignedOn, r.taxFormExpiresOn, r.taxFormFiledWhere],
  );
}

/** Confirm another member's route. The SQL refuses one's own as well as the lib. */
export async function confirmPayRoute(db: Queryable, userId: string, by: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_pay_routes` SET `confirmed_at` = CURRENT_TIMESTAMP, `confirmed_by` = ? WHERE `user_id` = ? AND `user_id` <> ?",
    [by, userId, by],
  );
  return res.affectedRows;
}

export async function setPilotAck(db: Queryable, userId: string, version: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_pay_routes` SET `pilot_ack_version` = ?, `pilot_ack_at` = CURRENT_TIMESTAMP WHERE `user_id` = ?",
    [version, userId],
  );
  return res.affectedRows;
}

/** A change of bank account, confirmed on a channel known to be the member's: its date and the role only. */
export async function setBankChange(db: Queryable, userId: string, changedOn: string, confirmedByRole: string): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `member_pay_routes` SET `bank_changed_on` = ?, `bank_confirmed_by_role` = ? WHERE `user_id` = ?",
    [changedOn, confirmedByRole, userId],
  );
  return res.affectedRows;
}

// ── moon_review_events (append-only) ─────────────────────────────────────────

export interface ReviewEventInsert {
  recapId: string | null;
  invoiceId: string | null;
  userId: string | null;
  kind: ReviewEventKind;
  actorUserId: string | null;
  actorRole: string | null;
  amountMinor: number | null;
  currency: string | null;
  hash: string | null;
  note: string | null;
}

export async function insertReviewEvent(db: Queryable, e: ReviewEventInsert): Promise<void> {
  await db.query(
    "INSERT INTO `moon_review_events` (`recap_id`, `invoice_id`, `user_id`, `kind`, `actor_user_id`, `actor_role`, `amount_minor`, `currency`, `hash`, `note`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [e.recapId, e.invoiceId, e.userId, e.kind, e.actorUserId, e.actorRole, e.amountMinor, e.currency, e.hash, e.note],
  );
}

export async function reviewEventsFor(db: Queryable, recapId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_review_events` WHERE `recap_id` = ? ORDER BY `id` ASC", [recapId]);
  return rows;
}

// ── Erasure and export ───────────────────────────────────────────────────────

/**
 * The erasure sweep's statements for a member. Words are cleared; amounts,
 * dates, numbers, bill refs and events stay, as `cash_owed` keeps them. The
 * pay route goes whole: it is nothing but the member's own declaration. Item
 * text is NOT NULL, so it becomes empty. `lines_json` carries item ids and
 * role names, never item text, so it is kept as it is.
 */
export async function forgetMoonReviews(db: Queryable, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const [items] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recap_items` i JOIN `moon_recaps` r ON r.`id` = i.`recap_id` SET i.`text` = '', i.`origin_note` = NULL, " +
      "i.`evidence_url` = NULL, i.`evidence_asset` = NULL, i.`accountability_words` = NULL, i.`own_goal_words` = NULL, i.`review_note` = NULL " +
      "WHERE r.`user_id` = ?",
    [uid],
  );
  const [recaps] = await db.query<ResultSetHeader>(
    "UPDATE `moon_recaps` SET `own_words` = NULL, `role_audit_json` = NULL, `returned_note` = NULL, `sera_state` = NULL WHERE `user_id` = ?",
    [uid],
  );
  const [invoices] = await db.query<ResultSetHeader>(
    "UPDATE `moon_invoices` SET `from_json` = NULL, `attestation_json` = NULL, `funds_source` = NULL WHERE `user_id` = ?",
    [uid],
  );
  await db.query("UPDATE `moon_review_events` SET `note` = NULL WHERE `user_id` = ?", [uid]);
  const [routes] = await db.query<ResultSetHeader>("DELETE FROM `member_pay_routes` WHERE `user_id` = ?", [uid]);
  return items.affectedRows + recaps.affectedRows + invoices.affectedRows + routes.affectedRows;
}

/** The member's own data export: their recaps, items, invoices, route and events. */
export async function exportMoonReviews(db: Queryable, userId: string): Promise<{ recaps: RecapRow[]; items: Array<RecapItem & { recapId: string }>; invoices: InvoiceRow[]; payRoute: PayRouteRecord | null; events: RowDataPacket[] }> {
  const recaps = await recapsOf(db, userId, 1000);
  const ids = recaps.map((r) => r.id);
  const items: Array<RecapItem & { recapId: string }> = [];
  let invoices: InvoiceRow[] = [];
  let events: RowDataPacket[] = [];
  if (ids.length > 0) {
    const [ir] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_recap_items` WHERE `recap_id` IN (?) ORDER BY `recap_id`, `position`", [ids]);
    for (const r of ir) items.push({ ...toItem(r), recapId: String(r.recap_id) });
    const [vr] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_invoices` WHERE `user_id` = ? ORDER BY `cycle_id`, `revision`", [userId]);
    invoices = vr.map(toInvoice);
    const [er] = await db.query<RowDataPacket[]>("SELECT * FROM `moon_review_events` WHERE `user_id` = ? ORDER BY `id`", [userId]);
    events = er;
  }
  return { recaps, items, invoices, payRoute: await payRouteOf(db, userId), events };
}
