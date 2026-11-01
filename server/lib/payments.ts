/**
 * The fiat trio (S32) — built ONCE, consumed by every fiat module (economy
 * invariant 2.2 #10). Three responsibilities, one file:
 *
 *  1. CHECKOUT: Stripe Checkout Sessions via the REST API (no SDK — one
 *     fewer dependency, and the surface we use is three endpoints). Every
 *     session is stamped with metadata {module, orderId}; the webhook
 *     dispatches on nothing else.
 *  2. SETTLEMENT + REVERSAL: signature verification on the RAW body (manual
 *     HMAC per Stripe's v1 scheme), event-level dedupe via the unique
 *     stripe_event_id in payments_log, and dispatch to per-module handlers.
 *     Disputes and refunds are MECHANICAL: reversal handlers claw back what
 *     was granted (balances may go negative — that is the truthful state),
 *     auto-suspend the buyer, and queue for admins. Never manual
 *     reconstruction.
 *  3. LIMITS: one cross-module per-member purchase-limit helper over
 *     fiat_charges. Limits that only see one module are theater.
 *
 * Money math: ROUNDING FAVORS THE TREASURY — ceil what the member pays,
 * floor what the member receives. The property test asserts no round trip
 * ever extracts value.
 */
import crypto from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { numberVar } from "./variables";
import { recordEvent } from "./events";
import { secretConfigured, secretValue } from "./secrets";
import { PLATFORM_CALLS, notePlatformCall } from "./integrations";
import { LIVE_EVENT, SIGNED_REFUSAL, TEST_EVENT, UNSIGNED_REFUSAL } from "../repos/stripeDeliveries";
import { reportError } from "./errors";
import { isTombstone } from "./oauthAccounts";
import type { RefusedSubscription } from "./owedCancels";

// ── Configuration ────────────────────────────────────────────────────────────
// S63: keys resolve through the secrets store — admin-typed first, env
// fallback — so a founder can connect Stripe without Railway access. Env-only
// deployments keep working unchanged.

export function stripeConfigured(): boolean {
  return secretConfigured("stripe_secret_key");
}

export function webhookSecretConfigured(): boolean {
  return secretConfigured("stripe_webhook_secret");
}

// ── Rounding: the treasury never loses to arithmetic ────────────────────────

/** What the member PAYS: rounds up. */
export function ceilMinor(value: number): number {
  return Math.ceil(value - 1e-9);
}

/** What the member RECEIVES: rounds down. */
export function floorTokens(value: number): number {
  return Math.floor(value + 1e-9);
}

// ── Checkout ─────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  module: string;
  orderId: string;
  /** One line item: a description and an amount in minor units (cents). */
  name: string;
  amountMinor: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  /**
   * S69: recurring turns the session into a Stripe SUBSCRIPTION. The first
   * period settles through checkout.session.completed exactly like a
   * one-time payment; renewals arrive as invoice.paid and dispatch to the
   * module's `renew` handler. Metadata is duplicated onto the subscription
   * so renewal events can find their way home.
   */
  recurring?: { interval: "month" | "year" };
}

export async function createCheckout(input: CheckoutInput): Promise<{ url: string; sessionId: string }> {
  const key = secretValue("stripe_secret_key");
  if (!key) throw new Error("Stripe is not configured (set it in Admin → Integrations, or STRIPE_SECRET_KEY)");
  const params = new URLSearchParams();
  params.set("mode", input.recurring ? "subscription" : "payment");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("line_items[0][price_data][currency]", input.currency ?? "usd");
  params.set("line_items[0][price_data][product_data][name]", input.name.slice(0, 120));
  params.set("line_items[0][price_data][unit_amount]", String(ceilMinor(input.amountMinor)));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[module]", input.module);
  params.set("metadata[orderId]", input.orderId);
  if (input.recurring) {
    params.set("line_items[0][price_data][recurring][interval]", input.recurring.interval);
    // Subscriptions have no payment_intent_data at session-create time;
    // metadata rides the subscription itself so invoice.paid can route.
    params.set("subscription_data[metadata][module]", input.module);
    params.set("subscription_data[metadata][orderId]", input.orderId);
  } else {
    params.set("payment_intent_data[metadata][module]", input.module);
    params.set("payment_intent_data[metadata][orderId]", input.orderId);
  }
  if (input.customerEmail) params.set("customer_email", input.customerEmail);

  // Every answer is recorded (server/lib/integrations.ts PLATFORM_CALLS): it is
  // the evidence the launch journey's `stripe-keys` row reads, never the key's presence.
  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", { // module-review-ok: the fixed Stripe API host, never an address anybody typed in; this call was here before, re-indented to record its outcome
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err: any) {
    await notePlatformCall(PLATFORM_CALLS.stripeCheckout, { ok: false, status: "network", detail: String(err?.message ?? err) });
    throw err;
  }
  const data: any = await res.json();
  if (!res.ok) {
    // Stripe's code, never its message: a message can quote what was sent,
    // a member's email among it, and that record holds no member content.
    await notePlatformCall(PLATFORM_CALLS.stripeCheckout, { ok: false, status: String(res.status), detail: String(data?.error?.code ?? data?.error?.type ?? "") });
    throw new Error(`Stripe checkout failed: ${data?.error?.message ?? res.status}`);
  }
  await notePlatformCall(PLATFORM_CALLS.stripeCheckout, { ok: true });
  return { url: String(data.url), sessionId: String(data.id) };
}

// ── Stopping a subscription ─────────────────────────────────────────────────

/** The Stripe statuses a subscription never charges from again. */
const ENDED_SUBSCRIPTION = new Set(["canceled", "incomplete_expired"]);

/** What became of one subscription the village asked Stripe to stop. */
export type SubscriptionCancel = "cancelled" | "already-ended" | "missing";

/**
 * Stop one Stripe subscription charging again, now. The erasure's
 * `product-subscriptions-after-tombstone` step calls this for every
 * subscription a departed member's purchases hold (server/lib/erasure.ts),
 * because the village offers a member no door to cancel one themselves and
 * nothing else would ever stop it.
 *
 * IT READS FIRST, then cancels, so a second run is a read and nothing more.
 * A subscription Stripe says is already over (cancelled in the dashboard, or
 * by an earlier run of the step) is done, and so is one Stripe has no record
 * of: neither can charge anybody. Reading the state is the check, because
 * Stripe's answer to cancelling twice is an error whose wording is not a
 * contract.
 *
 * IT NEVER REFUNDS AND NEVER MOVES A TOKEN. A cancel ends future charges and
 * leaves every period already paid as it stands. Whether a period is refunded
 * stays a person's call in Stripe, which the renewal alarm in
 * `settleProductPurchase` asks for when a charge lands after the account is
 * gone.
 *
 * IT THROWS on anything else: Stripe not connected, an error, a timeout.
 * The erasure records the step as stopped and the sweep is resumed, so the
 * failure is loud and retried and never recorded as done. The step checks
 * for a key before it calls this, and with none it hands the cancel to the
 * admins and finishes, so the no-key throw here is for any other caller.
 */
export async function cancelSubscription(subscriptionId: string): Promise<SubscriptionCancel> {
  const id = String(subscriptionId ?? "").trim();
  if (!id) throw new Error("No subscription id to cancel");
  const key = secretValue("stripe_secret_key");
  if (!key) {
    throw new Error(
      `Stripe is not connected, so subscription ${id} cannot be cancelled and may keep charging. ` +
        "Connect Stripe in Admin, Integrations, and the next retry of this erasure cancels it",
    );
  }
  const url = `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`;
  const ask = async (method: "GET" | "DELETE"): Promise<{ missing: boolean; status: string | null }> => {
    const verb = method === "GET" ? "read" : "cancel";
    let res: Response;
    try {
      res = await fetch(url, { // module-review-ok: the fixed Stripe API host, never an address anybody typed in, called the way createCheckout calls it; guardedFetchJson pins typed-in hosts and has no DELETE
        method,
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err: any) {
      throw new Error(`Stripe could not ${verb} subscription ${id}: ${err?.message ?? err}`);
    }
    const data: any = await res.json().catch(() => null);
    if (res.status === 404 || data?.error?.code === "resource_missing") return { missing: true, status: null };
    if (!res.ok) throw new Error(`Stripe could not ${verb} subscription ${id}: ${data?.error?.message ?? res.status}`);
    return { missing: false, status: data?.status == null ? null : String(data.status) };
  };
  const now = await ask("GET");
  if (now.missing) return "missing";
  if (now.status && ENDED_SUBSCRIPTION.has(now.status)) return "already-ended";
  const after = await ask("DELETE");
  return after.missing ? "missing" : "cancelled";
}

// ── Signature verification (Stripe v1 scheme, on the RAW body) ──────────────

export function verifyStripeSignature(rawBody: Buffer | string, sigHeader: string | undefined, secret: string): boolean {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  // 5-minute tolerance against replay.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Handler registry: settle + reversal, per module ──────────────────────────

type SettleHandler = (orderId: string, event: any) => Promise<void>;
type ReversalHandler = (orderId: string, event: any) => Promise<void>;
/** S69: a paid renewal period on a subscription the module sold. */
type RenewHandler = (orderId: string, event: any) => Promise<void>;

const settleHandlers = new Map<string, SettleHandler>();
const reversalHandlers = new Map<string, ReversalHandler>();
const renewHandlers = new Map<string, RenewHandler>();

export function registerPaymentHandlers(
  moduleId: string,
  handlers: { settle: SettleHandler; reversal?: ReversalHandler; renew?: RenewHandler },
) {
  settleHandlers.set(moduleId, handlers.settle);
  if (handlers.reversal) reversalHandlers.set(moduleId, handlers.reversal);
  if (handlers.renew) renewHandlers.set(moduleId, handlers.renew);
}

// ── The ops rider: log everything, alert on failures ────────────────────────

export interface PaymentsLogEntry {
  stripeEventId?: string | null;
  module?: string | null;
  orderId?: string | null;
  type: string;
  outcome: "ok" | "sig_fail" | "no_handler" | "no_order" | "settle_error" | "duplicate";
  latencyMs?: number;
  detail?: string;
}

export async function logPayment(pool: Pool, e: PaymentsLogEntry): Promise<boolean> {
  try {
    await pool.query(
      "INSERT INTO payments_log (id, stripe_event_id, module, order_id, type, outcome, latency_ms, detail) VALUES (?,?,?,?,?,?,?,?)",
      [
        `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        e.stripeEventId ?? null,
        e.module ?? null,
        e.orderId ?? null,
        e.type,
        e.outcome,
        e.latencyMs ?? null,
        e.detail?.slice(0, 500) ?? null,
      ],
    );
    return true;
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") return false; // event already processed
    console.error("[payments] log write failed", err);
    return true; // fail open on logging trouble; the ledger keys still dedupe
  }
}

/**
 * How long a claimed-but-unfinished event waits before another delivery is
 * allowed to pick it up. Long enough that two deliveries racing each other
 * in the normal case never both run; short enough that Stripe's retry
 * schedule (which runs for days) still heals a crashed settle.
 */
const CLAIM_GRACE_MINUTES = 10;

/** True when a prior claim on this event exists but never finished. */
async function claimIsAbandoned(pool: Pool, eventId: string): Promise<boolean> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM payments_log WHERE stripe_event_id = ? AND handled_at IS NULL " +
        `AND at < (NOW() - INTERVAL ${CLAIM_GRACE_MINUTES} MINUTE) LIMIT 1`,
      [eventId],
    );
    return rows.length > 0;
  } catch {
    return false; // unreadable log: treat the replay as a replay, not a retry
  }
}

/** Stamp the claim as finished. Only a completed dispatch reaches this. */
async function markEventHandled(pool: Pool, eventId: string): Promise<void> {
  try {
    await pool.query("UPDATE payments_log SET handled_at = NOW() WHERE stripe_event_id = ?", [eventId]);
  } catch (err) {
    console.error("[payments] could not stamp handled_at", err);
  }
}

/**
 * The one webhook entry point, called by the S13 seam with the RAW body.
 * Verifies, dedupes at event level, dispatches by event type + metadata.
 */
export async function handleStripeEvent(
  pool: Pool,
  rawBody: Buffer | string,
  sigHeader: string | undefined,
  alertAdmins: (title: string, dedupeKey: string) => Promise<void>,
): Promise<{ status: number; body: any }> {
  const started = Date.now();
  const secret = secretValue("stripe_webhook_secret");
  // FAIL CLOSED. An unsigned event is an anonymous instruction to mint
  // credits; a missing secret is a misconfiguration, not permission. The
  // earlier `if (secret && …)` meant a deployment that never set the secret
  // accepted forged settlements from anyone who knew the URL.
  if (!secret) {
    await logPayment(pool, { type: "signature", outcome: "sig_fail", detail: "webhook signing secret is not set" });
    await alertAdmins(
      "Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not configured",
      `payments-nosecret:${new Date().toISOString().slice(0, 13)}`,
    );
    return { status: 400, body: { error: "webhook signing secret is not configured" } };
  }
  if (!verifyStripeSignature(rawBody, sigHeader, secret)) {
    // Which refusal it was: server/repos/stripeDeliveries.ts reads a signed one
    // back for the launch journey, and an unsigned call is never Stripe.
    await logPayment(pool, { type: "signature", outcome: "sig_fail", detail: sigHeader ? SIGNED_REFUSAL : UNSIGNED_REFUSAL });
    await alertAdmins("Stripe webhook signature verification FAILED", `payments-sigfail:${new Date().toISOString().slice(0, 13)}`);
    return { status: 400, body: { error: "signature verification failed" } };
  }

  let event: any;
  try {
    event = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "unparseable event" } };
  }
  const eventId = String(event?.id ?? "");
  const type = String(event?.type ?? "unknown");
  const obj = event?.data?.object ?? {};
  const meta = obj?.metadata ?? {};
  const moduleId = String(meta.module ?? "");
  const orderId = String(meta.orderId ?? "");

  // Event-level dedupe: the unique stripe_event_id makes a replay a no-op.
  if (eventId) {
    // The claim row says which mode Stripe sent the event in, so a test event
    // can never prove the live endpoint's secret (server/repos/stripeDeliveries.ts).
    const mode = event?.livemode === true ? LIVE_EVENT : event?.livemode === false ? TEST_EVENT : undefined;
    const fresh = await logPayment(pool, { stripeEventId: eventId, module: moduleId || null, orderId: orderId || null, type, outcome: "ok", latencyMs: Date.now() - started, detail: mode });
    // A claim is not a completion. If the previous attempt finished, this is
    // a genuine replay and we stop. If it did not — the process died between
    // claiming and finishing, so nothing deleted the claim and no alarm
    // fired — then answering "duplicate" would strand the purchase forever.
    // Past the grace window, an unfinished claim is an abandoned one and the
    // event runs again; the handlers are idempotent on their period keys, so
    // a rerun that turns out to be redundant costs nothing.
    if (!fresh && !(await claimIsAbandoned(pool, eventId))) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
  }

  const dispatch = async (): Promise<{ status: number; body: any }> => {
    if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      /**
       * COMPLETED IS NOT PAID.
       *
       * For delayed-notification methods — SEPA debit, ACH, Boleto, some
       * bank redirects — Stripe fires `checkout.session.completed` the
       * moment the customer finishes the form, with `payment_status:
       * "unpaid"`, and only days later confirms with
       * `checkout.session.async_payment_succeeded` (or fails). Settling on
       * the first event handed over tokens, credits and waitlist places for
       * money that had not moved and might never arrive.
       *
       * So: deliver on `paid` (or `no_payment_required`, a legitimately free
       * or fully-discounted session), and wait otherwise. The async success
       * event carries the same session and lands right back here.
       */
      const payStatus = String(obj?.payment_status ?? "paid");
      if (payStatus !== "paid" && payStatus !== "no_payment_required") {
        await logPayment(pool, { module: moduleId || null, orderId: orderId || null, type, outcome: "ok", detail: `awaiting payment (${payStatus})` });
        return { status: 200, body: { received: true, pending: true } };
      }
      const handler = moduleId ? settleHandlers.get(moduleId) : undefined;
      if (!handler) {
        await logPayment(pool, { module: moduleId || null, orderId: orderId || null, type, outcome: moduleId ? "no_handler" : "no_order" });
        await alertAdmins(`Stripe settle event with ${moduleId ? "no handler for module " + moduleId : "no module metadata"}`, `payments-nohandler:${new Date().toISOString().slice(0, 13)}`);
        return { status: 200, body: { received: true, unhandled: true } };
      }
      await handler(orderId, event);
      return { status: 200, body: { received: true } };
    }

    if (type === "invoice.paid") {
      // S69: a renewal period on a subscription. The FIRST period settles as
      // checkout.session.completed like any purchase; this path is periods
      // two onward. Metadata rides the subscription (subscription_details on
      // the invoice) because invoices carry none of their own.
      const subMeta = obj?.subscription_details?.metadata ?? obj?.lines?.data?.[0]?.metadata ?? {};
      const renewModule = String(subMeta.module ?? "");
      const renewOrder = String(subMeta.orderId ?? "");
      // The first invoice is NOT skipped, even though checkout.session
      // already settled that period. Both events carry the same invoice id,
      // so the period key is identical and the settle is idempotent — but
      // only the INVOICE carries a payment_intent, and without it the
      // period has no charge reference a chargeback can ever match. Letting
      // both converge is what makes a subscription's first period
      // disputable at all; skipping it left the opening month unrefundable.
      const renew = renewModule ? renewHandlers.get(renewModule) : undefined;
      if (!renew || !renewOrder) {
        await logPayment(pool, { module: renewModule || null, orderId: renewOrder || null, type, outcome: renewModule ? "no_handler" : "no_order" });
        return { status: 200, body: { received: true, unhandled: true } };
      }
      await renew(renewOrder, event);
      return { status: 200, body: { received: true, renewed: true } };
    }

    if (type === "charge.dispute.created" || type === "charge.refunded") {
      // Map the payment intent back to the module order via fiat_charges.
      const pi = String(obj?.payment_intent ?? obj?.id ?? "");
      // `status` HAS to be in this list. It was not, so `row.status` was
      // undefined, `villageInitiated` below could never be true, and every
      // refund the village itself issued suspended the member's purchasing
      // across every fiat module — punishing them for our own decision, with
      // only a manual lift to undo it.
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT module, order_id, user_id, status FROM fiat_charges WHERE stripe_payment_intent_id = ? LIMIT 1",
        [pi],
      );
      if (!rows[0]) {
        await logPayment(pool, { type, outcome: "no_order", detail: `pi=${pi}` });
        await alertAdmins("Stripe dispute/refund event matched no known charge", `payments-noorder:${new Date().toISOString().slice(0, 13)}`);
        return { status: 200, body: { received: true, unmatched: true } };
      }
      const row = rows[0];
      /**
       * A PARTIAL refund is not a reversal.
       *
       * Stripe fires `charge.refunded` for any refund, including a $5
       * goodwill gesture on a $500 charge. Treating that as a full reversal
       * clawed back the entire period's tokens, marked the whole charge
       * reversed — erasing it from the member's spend caps — and, for a
       * single-period purchase, closed it outright. The member lost
       * everything they bought because the village gave a little back.
       *
       * Only a refund that returns the WHOLE amount undoes the purchase.
       * Anything less is money moving, not a purchase unwinding, so it is
       * recorded and a human is told.
       */
      const chargeTotal = Number(obj?.amount ?? 0);
      const refundedSoFar = Number(obj?.amount_refunded ?? 0);
      const partial = type === "charge.refunded"
        && chargeTotal > 0 && refundedSoFar > 0 && refundedSoFar < chargeTotal;
      if (partial) {
        await logPayment(pool, { stripeEventId: eventId || undefined, module: String(row.module), orderId: String(row.order_id), type, outcome: "ok", detail: `partial refund ${refundedSoFar}/${chargeTotal}` });
        await alertAdmins(
          `Partial refund on ${row.module} order ${row.order_id}: ${refundedSoFar} of ${chargeTotal} returned. ` +
            `Nothing was clawed back. Settle the difference by hand if the purchase should unwind.`,
          `payments-partialrefund:${row.module}:${row.order_id}`,
        );
        await recordEvent(pool, { kind: "audit", text: `payments:partial_refund:${row.module}:${row.order_id}`, entityType: "user", entityRef: String(row.user_id), audience: "admin" });
        return { status: 200, body: { received: true, partial: true } };
      }
      // A refund the VILLAGE issued already marked the charge reversed (the
      // admin refund-hold runs first, by design). Suspending the member for
      // a refund we chose to give them would be punishing them for our own
      // decision — so suspension follows DISPUTES, and refunds only when
      // they arrive from outside our own flow.
      const villageInitiated = String(row.status) === "reversed";
      const reversal = reversalHandlers.get(String(row.module));
      if (reversal) await reversal(String(row.order_id), event);
      await pool.query("UPDATE fiat_charges SET status = 'reversed' WHERE module = ? AND order_id = ?", [row.module, row.order_id]);
      // No member behind an anonymous charge, so there is nobody to
      // suspend — the reversal above still runs and the alert still fires.
      const suspend = (type === "charge.dispute.created" || !villageInitiated) && !!row.user_id;
      if (suspend) {
        await suspendPurchasing(pool, String(row.user_id), `${type} on ${row.module}:${row.order_id}`, `${row.module}:${row.order_id}`);
      }
      const why = suspend
        ? ", buyer suspended pending review"
        : !row.user_id
          ? ", bought without an account; nobody to suspend"
          : ", the village issued this refund; no suspension";
      await alertAdmins(
        `Payment ${type === "charge.refunded" ? "refund" : "DISPUTE"}: ${row.module} order ${row.order_id}${why}`,
        `payments-dispute:${row.module}:${row.order_id}`,
      );
      await recordEvent(pool, {
        kind: "audit", text: `payments:${type}:${row.module}:${row.order_id}`,
        ...(row.user_id ? { entityType: "user" as const, entityRef: String(row.user_id) } : {}),
        audience: "admin",
      });
      return { status: 200, body: { received: true } };
    }

    // Everything else: acknowledged, logged, ignored.
    return { status: 200, body: { received: true, ignored: type } };
  };

  try {
    const out = await dispatch();
    if (eventId) await markEventHandled(pool, eventId);
    return out;
  } catch (e: any) {
    // Release the event-level dedupe claim: a FAILED dispatch must stay
    // retryable, or one transient error would orphan the order forever.
    // Concurrent redeliveries stay safe — the ledger keys absorb them.
    if (eventId) {
      try { await pool.query("DELETE FROM payments_log WHERE stripe_event_id = ?", [eventId]); } catch { /* the alert below still fires */ }
    }
    await logPayment(pool, { module: moduleId || null, orderId: orderId || null, type, outcome: "settle_error", detail: String(e?.message ?? e) });
    await alertAdmins(`Payment settle handler FAILED for ${moduleId}:${orderId}`, `payments-settleerr:${moduleId}:${orderId}`);
    // The loudest path in the system also goes to the error sink, so a
    // village that has wired one hears about a failed settlement wherever
    // they actually watch — not only inside the app they may not be in.
    await reportError(e, { where: "a payment settlement", detail: { module: moduleId, order: orderId, event: type } });
    // 500 so Stripe retries — the ledger keys make retries safe.
    return { status: 500, body: { error: "settle failed; will retry" } };
  }
}

// ── Charges, suspensions, limits ─────────────────────────────────────────────

export async function recordFiatCharge(
  pool: Pool,
  // userId is nullable (0039): a fee, donation or waitlist place bought by
  // someone who never signed in still needs a charge row, or the dispute
  // path has nothing to match the payment intent against.
  c: { userId: string | null; module: string; orderId: string; amountMinor: number; currency?: string; paymentIntentId?: string | null },
): Promise<void> {
  await pool.query(
    "INSERT INTO fiat_charges (id, user_id, module, order_id, amount_minor, currency, stripe_payment_intent_id) VALUES (?,?,?,?,?,?,?) " +
      // COALESCE, not a plain overwrite: a subscription's first period is
      // recorded twice — once from the checkout session, which carries no
      // payment intent, and once from the invoice, which does. Stripe does
      // not promise those arrive in that order, and a later NULL must never
      // erase a known intent or the dispute path loses its only handle on
      // the charge.
      "ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), " +
      "stripe_payment_intent_id = COALESCE(VALUES(stripe_payment_intent_id), stripe_payment_intent_id)",
    [`fch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, c.userId ?? null, c.module, c.orderId, c.amountMinor, c.currency ?? "usd", c.paymentIntentId ?? null],
  );
}

export async function suspendPurchasing(pool: Pool, userId: string, reason: string, orderRef?: string): Promise<void> {
  await pool.query(
    "INSERT INTO payment_suspensions (id, user_id, reason, order_ref) VALUES (?,?,?,?)",
    [`sus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId, reason.slice(0, 500), orderRef ?? null],
  );
}

/** The refusal a charge for somebody no longer in the village is given (round 3, finding 5). */
export const BUYER_HAS_LEFT = "the buyer has left the village";

/**
 * Whether a purchase's buyer can be delivered anything: false for a tombstone,
 * and for a user row that is gone. `settleProductPurchase` (server/index.ts)
 * asks it of EVERY period it settles, a first one included, because a checkout
 * opened before the member left can complete after, and the two events for a
 * subscription's first period can land either side of the delete. A refusal
 * banks the money, posts no grant and no receipt, and tells the admins.
 */
export function buyerHasLeft(member: { email?: unknown } | null | undefined): boolean {
  return !member || isTombstone({ email: String(member.email ?? "") });
}

/**
 * The last sentence of the admins' "charged but NOT delivered" alarm in
 * `settleProductPurchase` (server/index.ts): what to do about a charge the
 * village banked and refused to deliver.
 *
 * FOR A BUYER WHO HAS LEFT, IT SAYS WHAT REALLY HAPPENED to the subscription
 * (round 4, finding 2). The renewal gate tries the cancel itself on every
 * such charge (`settleLeaversSubscription`, server/lib/owedCancels.ts) and
 * hands this sentence the outcome. It used to say "their erasure cancels the
 * subscription", which was false for a recurring checkout that completed
 * after the erasure ran: the erasure had already finished, nothing would ever
 * cancel it, and the card was charged every period.
 *
 * SHORT ON PURPOSE. The whole alarm is the notice's title, and
 * `insertNotification` cuts a title at 255 characters. With Stripe's real ids
 * the words before this sentence run to about 128 characters plus the product
 * name, so each sentence here stays under 100 to survive a product name of 30.
 *
 * Every other refusal reads as it always did, key or no key.
 */
export function refusedChargeAdvice(subscription: RefusedSubscription, refusal: string): string {
  if (subscription === "none") return "Refund this payment.";
  if (refusal !== BUYER_HAS_LEFT || subscription === "kept") return "Cancel the subscription in Stripe and refund this period.";
  if (subscription === "cancelled") return "The subscription is now cancelled in Stripe; refund this period there.";
  if (subscription === "ended") return "The subscription had already ended in Stripe; refund this period there.";
  if (subscription === "by-hand-failed") return "Stripe did not cancel it: cancel the subscription in the Stripe dashboard and refund this period.";
  return "Stripe is not connected: cancel the subscription in the Stripe dashboard and refund this period.";
}

export async function isSuspended(pool: Pool, userId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM payment_suspensions WHERE user_id = ? AND lifted_at IS NULL LIMIT 1",
    [userId],
  );
  return rows.length > 0;
}

export type PurchaseCheck = { ok: true } | { ok: false; error: string };

/**
 * The cross-module limit helper (2.2 #10): per MEMBER, across ALL fiat
 * modules, against the three platform variables. The refusal names which
 * cap fired.
 */
export async function assertCanPurchase(pool: Pool, userId: string, amountMinor: number): Promise<PurchaseCheck> {
  if (await isSuspended(pool, userId)) {
    return { ok: false, error: "Purchasing is paused on your account pending a payment review. Talk to the stewards" };
  }
  const perOrder = numberVar("payments.purchase_limit_per_order_usd") * 100;
  if (perOrder > 0 && amountMinor > perOrder) {
    return { ok: false, error: `That exceeds the per-order limit (payments.purchase_limit_per_order_usd)` };
  }
  const [[m30]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(amount_minor),0) AS s FROM fiat_charges WHERE user_id = ? AND status = 'paid' AND paid_at >= (NOW() - INTERVAL 30 DAY)",
    [userId],
  );
  const cap30 = numberVar("payments.purchase_limit_30d_usd") * 100;
  if (cap30 > 0 && Number(m30.s) + amountMinor > cap30) {
    return { ok: false, error: "That would exceed your 30-day purchase limit (payments.purchase_limit_30d_usd)" };
  }
  const [[my]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(amount_minor),0) AS s FROM fiat_charges WHERE user_id = ? AND status = 'paid' AND paid_at >= (NOW() - INTERVAL 365 DAY)",
    [userId],
  );
  const capY = numberVar("payments.purchase_limit_annual_usd") * 100;
  if (capY > 0 && Number(my.s) + amountMinor > capY) {
    return { ok: false, error: "That would exceed your annual purchase limit (payments.purchase_limit_annual_usd)" };
  }
  return { ok: true };
}
