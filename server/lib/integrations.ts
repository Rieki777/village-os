/**
 * The outbound integration wrapper, and the health record it writes.
 *
 * Every call a module library driver makes to an outside service goes through
 * `callVendor`. Not "should": the wrapper is where the correlation id is
 * minted, where the header carrying it is built, and where the outcome is
 * recorded, so a driver that skips it produces no evidence at all and a
 * listing that forgets to instrument itself cannot exist.
 *
 * WHY THIS IS NOT A FIELD ON THE SECRET STATUS. `secretStatus.setAt` records
 * when a key was TYPED, never when it last worked. A revoked or expired
 * credential reads as connected forever under that field, which fails in the
 * worst direction on the single most common way an integration dies. The hard
 * rule, in code below and not only in a comment: nothing in this file infers
 * health from `setAt`, and with no recorded success the answer is
 * "never confirmed working" rather than "fine".
 *
 * The shape is `peer_instances`, which already carries last_sync_at,
 * last_error and a status written from ONE central place (the sync job)
 * rather than by each caller. Same discipline, one row per (module,
 * operation) instead of one per peer.
 *
 * WHAT IS DELIBERATELY NOT HERE. This is a rolling CURRENT-STATE record, one
 * row per (module, operation), overwritten in place. The per-call incident
 * log (request metadata, latency, outcome, one row per call, generalising
 * `payments_log`) and the scheduled liveness probe are a separate landing.
 * The correlation id is minted here anyway, because the id is what makes the
 * later log checkable against a vendor's own records.
 *
 * PRIVACY. Nothing written here carries a payload or member content. Status,
 * a short detail string, timestamps and a correlation id: a row you would be
 * willing to show the vendor it describes.
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ModuleLiveness } from "../../shared/modules";

/**
 * The header every outbound call carries. Contract clause 11: the vendor logs
 * it on their side, so "our record says a timeout at 14:02, correlation
 * abc123" is checkable in a minute instead of an afternoon.
 */
export const CORRELATION_HEADER = "x-correlation-id";

/** Detail is truncated to fit the column, and to keep a stack trace out of it. */
const DETAIL_MAX = 500;

export interface IntegrationHealth {
  moduleId: string;
  operation: string;
  /** The ONLY evidence that a credential works. Null means never confirmed. */
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** HTTP status where there was one, otherwise an error code or name. */
  lastFailureStatus: string | null;
  lastFailureDetail: string | null;
  /** The correlation id of the most recent call, whichever way it went. */
  lastCorrelationId: string | null;
  consecutiveFailures: number;
}

let pool: Pool | null = null;
const health = new Map<string, IntegrationHealth>();

const rowKey = (moduleId: string, operation: string) => `${moduleId}::${operation}`;

function asIso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Boot-loaded cache, write-through, the store-db discipline every other store here uses. */
export async function loadIntegrationHealth(p: Pool): Promise<void> {
  pool = p;
  const [rows] = await p.query<RowDataPacket[]>(
    "SELECT module_id, operation, last_success_at, last_failure_at, last_failure_status, " +
      "last_failure_detail, last_correlation_id, consecutive_failures FROM integration_health",
  );
  health.clear();
  for (const r of rows) {
    const item: IntegrationHealth = {
      moduleId: String(r.module_id),
      operation: String(r.operation),
      lastSuccessAt: asIso(r.last_success_at),
      lastFailureAt: asIso(r.last_failure_at),
      lastFailureStatus: r.last_failure_status ?? null,
      lastFailureDetail: r.last_failure_detail ?? null,
      lastCorrelationId: r.last_correlation_id ?? null,
      consecutiveFailures: Number(r.consecutive_failures ?? 0),
    };
    health.set(rowKey(item.moduleId, item.operation), item);
  }
}

/** Current health for one operation, or null when no call has ever been made. */
export function integrationHealth(moduleId: string, operation: string): IntegrationHealth | null {
  return health.get(rowKey(moduleId, operation)) ?? null;
}

/** Every recorded operation, for the admin panel. */
export function allIntegrationHealth(moduleId?: string): IntegrationHealth[] {
  const out = Array.from(health.values());
  return moduleId ? out.filter((h) => h.moduleId === moduleId) : out;
}

async function persist(item: IntegrationHealth): Promise<void> {
  health.set(rowKey(item.moduleId, item.operation), item);
  if (!pool) return;
  await pool.query(
    "INSERT INTO integration_health (module_id, operation, last_success_at, last_failure_at, " +
      "last_failure_status, last_failure_detail, last_correlation_id, consecutive_failures) " +
      "VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE " +
      "last_success_at = VALUES(last_success_at), last_failure_at = VALUES(last_failure_at), " +
      "last_failure_status = VALUES(last_failure_status), last_failure_detail = VALUES(last_failure_detail), " +
      "last_correlation_id = VALUES(last_correlation_id), consecutive_failures = VALUES(consecutive_failures)",
    [
      item.moduleId,
      item.operation,
      item.lastSuccessAt ? new Date(item.lastSuccessAt) : null,
      item.lastFailureAt ? new Date(item.lastFailureAt) : null,
      item.lastFailureStatus,
      item.lastFailureDetail,
      item.lastCorrelationId,
      item.consecutiveFailures,
    ],
  );
}

function current(moduleId: string, operation: string): IntegrationHealth {
  return (
    integrationHealth(moduleId, operation) ?? {
      moduleId,
      operation,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureStatus: null,
      lastFailureDetail: null,
      lastCorrelationId: null,
      consecutiveFailures: 0,
    }
  );
}

export async function recordSuccess(moduleId: string, operation: string, correlationId: string): Promise<void> {
  const now = new Date().toISOString();
  await persist({ ...current(moduleId, operation), lastSuccessAt: now, lastCorrelationId: correlationId, consecutiveFailures: 0 });
}

export async function recordFailure(
  moduleId: string,
  operation: string,
  correlationId: string,
  status: string,
  detail: string,
): Promise<void> {
  const prior = current(moduleId, operation);
  await persist({
    ...prior,
    lastFailureAt: new Date().toISOString(),
    lastFailureStatus: String(status).slice(0, 32),
    lastFailureDetail: String(detail).slice(0, DETAIL_MAX),
    lastCorrelationId: correlationId,
    consecutiveFailures: prior.consecutiveFailures + 1,
  });
}

/** What the wrapper hands a driver: the id, and the headers to merge into the request. */
export interface VendorCallContext {
  correlationId: string;
  headers: Record<string, string>;
}

/**
 * Pull an HTTP status off whatever the driver threw, without assuming a shape.
 * A `fetch` Response error, an axios-style error and a plain Error all land
 * somewhere honest.
 */
function statusOf(e: any): string {
  const n = e?.status ?? e?.statusCode ?? e?.response?.status;
  if (typeof n === "number" && Number.isFinite(n)) return String(n);
  if (typeof e?.code === "string" && e.code) return e.code;
  if (typeof e?.name === "string" && e.name) return e.name;
  return "error";
}

/**
 * THE seam. One outbound call, one correlation id, one health row updated
 * whichever way it goes. The error is rethrown unchanged: recording an
 * outcome is not the same act as deciding what a failure means, and the
 * caller still owns the second one.
 */
export async function callVendor<T>(
  moduleId: string,
  operation: string,
  fn: (ctx: VendorCallContext) => Promise<T>,
): Promise<T> {
  const correlationId = randomUUID();
  const ctx: VendorCallContext = { correlationId, headers: { [CORRELATION_HEADER]: correlationId } };
  try {
    const result = await fn(ctx);
    await recordSuccess(moduleId, operation, correlationId);
    return result;
  } catch (e: any) {
    await recordFailure(moduleId, operation, correlationId, statusOf(e), String(e?.message ?? e));
    throw e;
  }
}

// ── The platform's own calls keep the same record ───────────────────────────

/**
 * THE CALLS THE PLATFORM ITSELF MAKES, recorded in the same table.
 *
 * Rye, 2026-10-13: green means a live check passed. The launch journey's
 * Stripe and guide rows went green on a key being set, which is the failure
 * this file was written against, so the platform's own outbound calls now keep
 * the record a listing's driver keeps. One row per call below, written only by
 * `notePlatformCall`, and read by server/lib/launchProofs.ts.
 *
 * The module ids name the outside service and collide with no module in
 * shared/modules.ts. No correlation header goes to Stripe or Anthropic, so the
 * id column stays empty on these rows rather than holding an id the vendor
 * never saw.
 */
export const PLATFORM_CALLS = {
  /** Stripe opening a checkout session, in server/lib/payments.ts. */
  stripeCheckout: { moduleId: "stripe", operation: "checkout" },
  /** The guide answering on the village's own key, in server/lib/assistant.ts. */
  guideReply: { moduleId: "assistant", operation: "reply" },
  /** The same, on the key the platform lends a village. */
  guideReplyBorrowed: { moduleId: "assistant", operation: "reply-borrowed" },
} as const;

export type PlatformCall = (typeof PLATFORM_CALLS)[keyof typeof PLATFORM_CALLS];
export type PlatformCallOutcome = { ok: true } | { ok: false; status: string; detail: string };

/**
 * Record one platform call's outcome. NEVER THROWS: a record that could not be
 * written must not turn the payment or the reply it describes into a failure.
 */
export async function notePlatformCall(call: PlatformCall, outcome: PlatformCallOutcome): Promise<void> {
  try {
    if (outcome.ok) await recordSuccess(call.moduleId, call.operation, "");
    else await recordFailure(call.moduleId, call.operation, "", outcome.status, outcome.detail);
  } catch (e: any) {
    console.warn(`[integrations] could not record ${call.moduleId} ${call.operation}: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

// ── Reading the record honestly ──────────────────────────────────────────────

/**
 * Five states, and `unknown` never collapses into healthy.
 *
 *   never-confirmed  no call has ever succeeded. Not the same as broken, and
 *                    very much not the same as fine.
 *   working          a success inside the declared window, no failure since.
 *   failing          the most recent outcome was a failure.
 *   stale            the last success is older than the declared window, and
 *                    the listing said a success was expected inside it.
 *   quiet            on-demand listing with a past success and no failure
 *                    since. Silence is normal here and is declared as such.
 */
export type HealthVerdict = "never-confirmed" | "working" | "failing" | "stale" | "quiet";

export interface HealthReading {
  verdict: HealthVerdict;
  /** One plain sentence, safe to show an admin. */
  detail: string;
}

/**
 * Pure, so it is testable without a database and cannot quietly grow a second
 * opinion about what healthy means.
 */
export function healthReading(
  h: IntegrationHealth | null,
  liveness: ModuleLiveness,
  now: Date = new Date(),
): HealthReading {
  const failedLast =
    !!h?.lastFailureAt && (!h.lastSuccessAt || Date.parse(h.lastFailureAt) >= Date.parse(h.lastSuccessAt));

  if (failedLast && h) {
    const n = h.consecutiveFailures;
    return {
      verdict: "failing",
      detail: `Last call failed with ${h.lastFailureStatus ?? "an error"}${n > 1 ? `, ${n} in a row` : ""}. Correlation ${h.lastCorrelationId ?? "not recorded"}`,
    };
  }
  if (!h?.lastSuccessAt) {
    return {
      verdict: "never-confirmed",
      detail: "Never confirmed working. A key being set is not evidence that it works",
    };
  }
  if (liveness.mode === "on-demand") {
    return { verdict: "quiet", detail: `Last confirmed working ${h.lastSuccessAt}. This listing is called on demand, so silence is normal` };
  }
  const ageHours = (now.getTime() - Date.parse(h.lastSuccessAt)) / 3_600_000;
  if (ageHours > liveness.withinHours) {
    return {
      verdict: "stale",
      detail: `Last confirmed working ${h.lastSuccessAt}, which is longer ago than the ${liveness.withinHours} hour window this listing declared`,
    };
  }
  return { verdict: "working", detail: `Last confirmed working ${h.lastSuccessAt}` };
}
