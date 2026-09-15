/**
 * The reads the failed-actions report makes: one function per place a failure
 * is recorded, each named for the table it reads.
 *
 * ── WHY ONE FILE FOR SEVERAL TABLES ─────────────────────────────────────────
 *
 * These are diagnostics about other domains' tables, not those domains' own
 * reads, and putting each in its domain's repo would scatter one report across
 * a dozen files owned by as many lanes, several of them mid-refactor. What a
 * repo module exists for still holds: every statement is under server/repos,
 * and everything the report reads is enumerable in this one file. Where a
 * table already has a repo that claims to hold EVERY statement on it
 * (`governanceExecutorPending.ts`, `memberErasure.ts`), the read went there
 * instead, so that claim stays true.
 *
 * ── EVERY WINDOW IS THE DATABASE'S CLOCK ────────────────────────────────────
 *
 * `CURRENT_TIMESTAMP - INTERVAL ? HOUR` for every age, never a JavaScript Date
 * bound, for the reason `failedActionItems.ts` gives: the app's pool pins UTC,
 * a test suite's pool does not, and SQL on one clock is right under both.
 *
 * ── EVERY READ IS BOUNDED ───────────────────────────────────────────────────
 *
 * The report runs hourly in the background. A village with ten thousand of
 * anything must cost it one page of rows, never ten thousand.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const bound = (n: number, max: number) => Math.max(1, Math.min(max, Math.trunc(n)));
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown): string | null => (v == null ? null : String(v));

export interface ScheduledJobRow {
  job: string;
  lastResult: string | null;
  /** Seconds since `last_run_at`, or null when the job has never been claimed. */
  sinceLastRunSeconds: number | null;
}

/** Every job the scheduler has ever claimed, with how long since each last ran. */
export async function scheduledJobRows(pool: Pool): Promise<ScheduledJobRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT job, last_result, TIMESTAMPDIFF(SECOND, last_run_at, CURRENT_TIMESTAMP) AS since_s FROM scheduled_jobs ORDER BY job",
  );
  return rows.map((r) => ({
    job: String(r.job),
    lastResult: str(r.last_result),
    sinceLastRunSeconds: r.since_s == null ? null : Math.max(0, num(r.since_s)),
  }));
}

export interface SettleErrorGroup {
  module: string | null;
  orderId: string | null;
  /** How many failed deliveries this order has had in the window. */
  errors: number;
  /** Seconds since the oldest of them, by the database's clock. */
  oldestAgeSeconds: number;
  /** What the most recent one said. */
  latestDetail: string | null;
}

/**
 * Orders with a settle error in the last `days` days that no later completed
 * delivery healed: one group per order, oldest first.
 *
 * GROUPED AND LIMITED BY ORDER. Stripe redelivers a failing event many times and
 * every redelivery writes another error row, so a limit on ROWS let a few dozen
 * stuck orders fill the page and hide every newer one.
 *
 * WHAT HEALS AN ERROR is an `ok` row for the same module, order and event type,
 * at or after the error, whose dispatch FINISHED (`handled_at`). The `ok` row is
 * written as a claim before dispatch (server/lib/payments.ts), so an unfinished
 * one proves nothing, and neither does an ignored event of another type that
 * happened to carry the same order.
 *
 * An error with no module or no order is never healed. Plain `=` and not `<=>`:
 * two rows that both lack an order are not the same order. Renewals, refunds and
 * disputes are logged that way, and they come back as one group with both null.
 *
 * `more` says the limit was reached, so the caller can say it listed only the
 * oldest orders instead of passing a page off as the total.
 */
export async function unhealedSettleErrors(
  pool: Pool,
  days = 30,
  limit = 200,
): Promise<{ groups: SettleErrorGroup[]; more: boolean }> {
  const cap = bound(limit, 1000);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT e.module, e.order_id, COUNT(*) AS errors, MAX(TIMESTAMPDIFF(SECOND, e.at, CURRENT_TIMESTAMP)) AS oldest_s, " +
      "SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(e.detail, '') ORDER BY e.at DESC, e.id DESC SEPARATOR '\\n'), '\\n', 1) AS latest_detail " +
      "FROM payments_log e " +
      "WHERE e.outcome = 'settle_error' AND e.at >= CURRENT_TIMESTAMP - INTERVAL ? DAY " +
      "AND NOT EXISTS (SELECT 1 FROM payments_log ok WHERE ok.outcome = 'ok' AND ok.handled_at IS NOT NULL " +
      "AND ok.type = e.type AND ok.module = e.module AND ok.order_id = e.order_id AND ok.at >= e.at) " +
      "GROUP BY e.module, e.order_id ORDER BY MIN(e.at), e.module, e.order_id LIMIT ?",
    [bound(days, 365), cap + 1],
  );
  const groups = rows.slice(0, cap).map((r) => ({
    module: str(r.module),
    orderId: str(r.order_id),
    errors: num(r.errors),
    oldestAgeSeconds: Math.max(0, num(r.oldest_s)),
    latestDetail: r.latest_detail == null || r.latest_detail === "" ? null : String(r.latest_detail),
  }));
  return { groups, more: rows.length > cap };
}

/** How many webhook deliveries in the last `hours` hours were refused, by outcome. */
export async function paymentRefusalCounts(pool: Pool, hours = 24): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT outcome, COUNT(*) AS n FROM payments_log WHERE outcome IN ('sig_fail','no_handler','no_order') " +
      "AND at >= CURRENT_TIMESTAMP - INTERVAL ? HOUR GROUP BY outcome",
    [bound(hours, 24 * 30)],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.outcome)] = num(r.n);
  return out;
}

export interface FailingIntegrationRow {
  moduleId: string;
  operation: string;
  status: string | null;
  detail: string | null;
  consecutiveFailures: number;
}

/**
 * Connections that have failed `minConsecutive` times in a row and have not
 * succeeded since. One failure is weather; three in a row is a broken
 * connection somebody should look at.
 */
export async function failingIntegrations(pool: Pool, minConsecutive = 3): Promise<FailingIntegrationRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT module_id, operation, last_failure_status, last_failure_detail, consecutive_failures FROM integration_health " +
      "WHERE consecutive_failures >= ? AND last_failure_at IS NOT NULL " +
      "AND (last_success_at IS NULL OR last_failure_at > last_success_at) ORDER BY module_id, operation LIMIT 100",
    [Math.max(1, Math.trunc(minConsecutive))],
  );
  return rows.map((r) => ({
    moduleId: String(r.module_id),
    operation: String(r.operation),
    status: str(r.last_failure_status),
    detail: str(r.last_failure_detail),
    consecutiveFailures: num(r.consecutive_failures),
  }));
}

export interface QuarantineEventRow {
  id: string;
  /** `module` when a module was switched off; `village` when a check found rows that grant nothing and switched nothing off. */
  entityType: string | null;
  /** The module's id, or the name of the village-wide check. */
  entityRef: string | null;
}

/**
 * Startup checks that failed within the last `seconds` seconds, newest first.
 * The caller passes this process's uptime, so the answer is "what the checks
 * found when THIS process started", which is what is true right now.
 *
 * The event's `text` is deliberately not selected. It quotes every line the
 * check printed, and a repair printed on the way can name a member, which the
 * report must never keep. server/lib/failedActions.ts `quarantineFindings`.
 */
export async function recentQuarantines(pool: Pool, seconds: number): Promise<QuarantineEventRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, entity_type, entity_ref FROM health_events WHERE kind = 'module_quarantine' " +
      "AND at >= CURRENT_TIMESTAMP - INTERVAL ? SECOND ORDER BY at DESC, id LIMIT 50",
    [bound(seconds, 60 * 60 * 24 * 365)],
  );
  return rows.map((r) => ({ id: String(r.id), entityType: str(r.entity_type), entityRef: str(r.entity_ref) }));
}

export interface TroubledPeerRow {
  id: string;
  name: string;
  status: string;
  lastError: string | null;
  sinceSyncSeconds: number;
}

/**
 * Linked villages that need a person: every paused link, and every link that
 * has carried an error without syncing for `staleHours` hours. An active link
 * with a fresh error is usually a peer mid-deploy, and heals on the next sweep.
 */
export async function troubledPeers(pool: Pool, staleHours = 48): Promise<TroubledPeerRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, status, last_error, TIMESTAMPDIFF(SECOND, COALESCE(last_sync_at, created_at), CURRENT_TIMESTAMP) AS since_s " +
      "FROM peer_instances WHERE is_example = 0 AND (status = 'paused' OR (last_error IS NOT NULL " +
      "AND COALESCE(last_sync_at, created_at) < CURRENT_TIMESTAMP - INTERVAL ? HOUR)) ORDER BY name, id LIMIT 100",
    [bound(staleHours, 24 * 365)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status),
    lastError: str(r.last_error),
    sinceSyncSeconds: Math.max(0, num(r.since_s)),
  }));
}

export interface FailedCalendarRow {
  id: string;
  name: string;
  lastError: string | null;
}

/** External calendar feeds whose last fetch failed. `'failed'` is the stored value. */
export async function failedCalendars(pool: Pool): Promise<FailedCalendarRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, last_error FROM external_calendars WHERE last_status = 'failed' ORDER BY name, id LIMIT 100",
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), lastError: str(r.last_error) }));
}

/**
 * Feedback the member agreed to relay that has not reached the hub within
 * `olderThanHours` hours. `may_relay = 1` is the consent recorded at capture;
 * an item without it is meant to stay home and is never late.
 */
export async function unrelayedFeedbackCount(pool: Pool, olderThanHours = 24): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM feedback_items WHERE relayed_at IS NULL AND may_relay = 1 " +
      "AND created_at < CURRENT_TIMESTAMP - INTERVAL ? HOUR",
    [bound(olderThanHours, 24 * 365)],
  );
  return num(rows[0]?.n);
}

/**
 * Deliveries to members' agents dropped in the last `days` days for one reason
 * this village can fix. The caller passes the reason string from the inbox
 * that writes it, so the text has one home.
 */
export async function droppedDeliveries(pool: Pool, reason: string, days = 30): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM agent_deliveries WHERE dropped_at IS NOT NULL AND last_error = ? " +
      "AND dropped_at >= CURRENT_TIMESTAMP - INTERVAL ? DAY",
    [reason, bound(days, 365)],
  );
  return num(rows[0]?.n);
}

/**
 * Recordings whose batch summary ended `'failed'` in the last `days` days and
 * that still have no summary at all. `'failed'` is final; `'errored'` is still
 * owed its automatic second attempt and is not counted. A recording an admin
 * has since summarised by hand has a `call_syntheses` row and drops out, so a
 * fixed failure clears on the next run instead of lingering for the week.
 *
 * Two reads, the ids bound as parameters, never a join: the tables were created
 * seventy migrations apart, and comparing columns across differently collated
 * tables is the failure `server/db/collation.ts` records.
 */
export async function failedSynthesisRecordings(pool: Pool, days = 7): Promise<number> {
  const [failed] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT recording_id FROM synthesis_batch_items WHERE status = 'failed' " +
      "AND created_at >= CURRENT_TIMESTAMP - INTERVAL ? DAY LIMIT 500",
    [bound(days, 365)],
  );
  const ids = failed.map((r) => String(r.recording_id));
  if (ids.length === 0) return 0;
  const [done] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT recording_id FROM call_syntheses WHERE recording_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const summarised = new Set(done.map((r) => String(r.recording_id)));
  return ids.filter((id) => !summarised.has(id)).length;
}

export interface KeptSeatChargeRow {
  id: string;
  eventId: string;
  userId: string;
  occurrenceKey: string;
  chargeSeq: number;
  tokenType: string;
  amount: number;
  /** Seconds since the charge was marked kept, by the database's clock. */
  settledAgeSeconds: number;
}

/**
 * One page of seat charges marked kept more than an hour ago, newest id first,
 * after `beforeId`. Whether each one's transfer to the treasury actually landed
 * is the caller's second question, asked of the ledger by key, because
 * settlement marks the charge BEFORE it posts.
 *
 * PAGED, AND THE CALLER PAGES ON. `kept` is where every paid seat ends, so kept
 * rows only ever accumulate. A single capped read of the OLDEST saw the same
 * landed fees every hour, forever, and never the one whose transfer failed
 * tonight. Paged on the primary key, so each page is a range read, and the
 * ledger is asked by bound keys, so no comparison crosses two tables' collations.
 */
export async function keptSeatChargesBefore(pool: Pool, beforeId: string | null, size = 200): Promise<KeptSeatChargeRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, event_id, user_id, occurrence_key, charge_seq, token_type, amount, " +
      "TIMESTAMPDIFF(SECOND, settled_at, CURRENT_TIMESTAMP) AS settled_s FROM event_seat_charges " +
      "WHERE status = 'kept' AND settled_at IS NOT NULL AND settled_at < CURRENT_TIMESTAMP - INTERVAL 1 HOUR " +
      (beforeId == null ? "" : "AND id < ? ") +
      "ORDER BY id DESC LIMIT ?",
    beforeId == null ? [bound(size, 1000)] : [beforeId, bound(size, 1000)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    eventId: String(r.event_id),
    userId: String(r.user_id),
    occurrenceKey: String(r.occurrence_key ?? ""),
    chargeSeq: num(r.charge_seq),
    tokenType: String(r.token_type),
    amount: num(r.amount),
    settledAgeSeconds: Math.max(0, num(r.settled_s)),
  }));
}

/**
 * Which of these ledger idempotency keys already have a posting. Bound as
 * parameters, so each takes the column's own collation and no cross-table join
 * can meet a collation mismatch.
 */
export async function ledgerKeysPresent(pool: Pool, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT idempotency_key FROM token_ledger WHERE idempotency_key IN (${keys.map(() => "?").join(",")})`,
    [...keys],
  );
  return new Set(rows.map((r) => String(r.idempotency_key)));
}
