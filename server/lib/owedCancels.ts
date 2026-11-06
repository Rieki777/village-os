/**
 * THE CANCELS A DEPARTED MEMBER'S RECURRING PAYMENTS STILL OWE, derived from
 * the audit trail (round 4, finding 2, and the derived-obligation design).
 *
 * A departed member's subscription is cancelled in Stripe by their erasure's
 * `product-subscriptions-after-tombstone` step (server/lib/erasure.ts), or by
 * the renewal gate when a charge lands after the account is gone
 * (`settleLeaversSubscription` below, called by `settleProductPurchase` in
 * server/index.ts). With no Stripe key, or with a Stripe that fails, neither
 * can, and a person has to. That hand-off is written as an audit row, and THE
 * ROW IS THE OBLIGATION (server/repos/subscriptionCancels.ts):
 *
 *   - a subscription id is OWED while the newest row naming it is by-hand;
 *   - a later cancel (the erasure step, the renewal gate, Finish on /review,
 *     the hourly failed-actions job) writes a cancelled row naming it;
 *   - a person who cancelled it in the Stripe dashboard says so on /review,
 *     and that writes the cancelled row with their id as the actor.
 *
 * Nothing touches the erasure record: `steps_done` keeps the step, and the
 * record reads finished, because the sweep in this database did finish.
 *
 * WHY THIS SHAPE IS SAFE, and the one condition on reusing it: the re-run
 * needs only the tombstone's id and a Stripe id (`liveSubscriptionsOf(pool,
 * userId)` and the ids on the row), never the identity the erasure cleared.
 * A step that needs the cleared identity to retry cannot be carried this way.
 * The same id-only matching is what leaves the guest-purchase gap: a recurring
 * purchase made signed out under the member's address has no user id, so no
 * erasure, renewal gate or Finish ever finds it.
 *
 * NAMES NOBODY. What /review reads is a count and an age; the ids stay in the
 * audit trail and on the admins' bell, which is where the Stripe dashboard
 * search starts.
 */
import type { Pool } from "mysql2/promise";
import { BUYER_HAS_LEFT, cancelSubscription, stripeConfigured } from "./payments";
import { liveSubscriptionsOf } from "../repos/productPurchases";
import { recordSubscriptionCancels, subscriptionCancelRows, type SubscriptionCancelRow } from "../repos/subscriptionCancels";

/** One departed member's owed cancels, as derived. */
export interface OwedCancel {
  userId: string;
  /** Every subscription id still owed, in the order first handed over. */
  subscriptionIds: string[];
  /** When the oldest of them was handed to a person. */
  since: string;
}

/** Fold the rows, oldest first, into what is still owed. Pure, so a test can read it. */
export function owedFrom(rows: readonly SubscriptionCancelRow[]): OwedCancel[] {
  const byUser = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const owed = byUser.get(row.userId) ?? new Map<string, string>();
    for (const id of row.subscriptionIds) {
      if (row.kind === "cancelled") owed.delete(id);
      else if (!owed.has(id)) owed.set(id, row.at);
    }
    byUser.set(row.userId, owed);
  }
  const out: OwedCancel[] = [];
  for (const [userId, owed] of Array.from(byUser)) {
    if (!owed.size) continue;
    const since = Array.from(owed.values()).sort()[0];
    out.push({ userId, subscriptionIds: Array.from(owed.keys()), since });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.userId.localeCompare(b.userId));
}

/** Everything owed now. */
export async function owedCancels(pool: Pool): Promise<OwedCancel[]> {
  return owedFrom(await subscriptionCancelRows(pool));
}

/**
 * What /review reads: how many departed members still owe a cancel, since
 * when, and `asOf`, the newest row the count was read from. The confirm sends
 * `asOf` back, so a hand-off that lands after the person read the card is
 * never cleared by a press that never saw it.
 */
export async function owedCancelsSummary(pool: Pool): Promise<{ count: number; oldestSince: string | null; asOf: string | null }> {
  const rows = await subscriptionCancelRows(pool);
  const owed = owedFrom(rows);
  return { count: owed.length, oldestSince: owed[0]?.since ?? null, asOf: rows.length ? rows[rows.length - 1].id : null };
}

/** What became of one departed member's subscription a charge just arrived on. */
export type RefusedSubscription =
  /** The purchase holds no subscription: a one-time charge. */
  | "none"
  /** A refusal for another reason: the subscription is the buyer's, and stays. */
  | "kept"
  | "cancelled"
  /** Stripe says it is over already, or holds no such subscription. */
  | "ended"
  /** Stripe is not connected: handed to a person. */
  | "by-hand-no-key"
  /** Stripe failed: handed to a person, and asked again on the next charge. */
  | "by-hand-failed";

/**
 * The renewal gate's half (round 4, finding 2). A recurring checkout opened
 * before the account was deleted can complete after it. The erasure's step
 * ran before Stripe had made the subscription, found nothing, and finished,
 * so nothing would ever cancel it, and the card was charged every period.
 *
 * Called by `settleProductPurchase` (server/index.ts) on EVERY refused charge,
 * a redelivery included: `cancelSubscription` reads first and is idempotent,
 * so a cancel that failed on the first event is asked again on the next.
 *
 * NEVER THROWS FOR STRIPE. The charge is already recorded by then, and a
 * throw makes Stripe redeliver a decision forever; a failure is handed to a
 * person instead. A failed write of the by-hand row does throw, on purpose:
 * that row is the obligation, and the redelivery writes it.
 */
export async function settleLeaversSubscription(
  pool: Pool,
  input: { userId: string | null; subscriptionId: string | null | undefined; refusal: string | null },
): Promise<RefusedSubscription> {
  const subscriptionId = String(input.subscriptionId ?? "").trim();
  if (!subscriptionId) return "none";
  if (input.refusal !== BUYER_HAS_LEFT || !input.userId) return "kept";
  const hand = (outcome: RefusedSubscription) => async () => {
    await recordSubscriptionCancels(pool, { userId: String(input.userId), kind: "by-hand", subscriptionIds: [subscriptionId], actorUserId: null });
    return outcome;
  };
  if (!stripeConfigured()) return hand("by-hand-no-key")();
  let outcome: Awaited<ReturnType<typeof cancelSubscription>>;
  try {
    outcome = await cancelSubscription(subscriptionId);
  } catch (err: any) {
    console.error(`[payments] could not cancel subscription ${subscriptionId} of a departed member: ${err?.message ?? err}`);
    return hand("by-hand-failed")();
  }
  await recordSubscriptionCancels(pool, { userId: String(input.userId), kind: "cancelled", subscriptionIds: [subscriptionId], actorUserId: null });
  return outcome === "cancelled" ? "cancelled" : "ended";
}

/** What a pass over the owed cancels did. */
export interface OwedCancelPass {
  /** Departed members who owed a cancel when the pass began. */
  owed: number;
  /** Of those, how many are now settled. */
  cleared: number;
  /** False when Stripe is not connected, so nothing was asked. */
  connected: boolean;
}

/**
 * Finish on /review and the hourly failed-actions job: with Stripe connected,
 * cancel what each departed member still owes and write the cancelled row.
 *
 * Every subscription `liveSubscriptionsOf` still holds for the tombstone is
 * asked, plus every owed id on the rows (a purchase whose status moved on
 * still names a subscription a person was asked to cancel). One already over
 * or unknown to Stripe counts as done. A Stripe failure leaves that member
 * owed, and the pass moves on to the next.
 */
export async function finishOwedCancels(
  pool: Pool,
  opts: { actorUserId?: string | null; deadline?: number; now?: () => number } = {},
): Promise<OwedCancelPass> {
  const owed = await owedCancels(pool);
  if (!owed.length || !stripeConfigured()) return { owed: owed.length, cleared: 0, connected: owed.length ? stripeConfigured() : true };
  const now = opts.now ?? Date.now;
  let cleared = 0;
  for (const o of owed) {
    if (opts.deadline != null && now() > opts.deadline) break;
    const ids = Array.from(new Set([...(await liveSubscriptionsOf(pool, o.userId)).map((s) => s.subscriptionId), ...o.subscriptionIds]));
    try {
      for (const id of ids) await cancelSubscription(id);
    } catch (err: any) {
      console.error(`[erasure] an owed subscription cancel failed and stays owed: ${err?.message ?? err}`);
      continue;
    }
    await recordSubscriptionCancels(pool, { userId: o.userId, kind: "cancelled", subscriptionIds: ids, actorUserId: opts.actorUserId ?? null });
    cleared += 1;
  }
  return { owed: owed.length, cleared, connected: true };
}

/** The hourly job's line, or null when it had nothing to do. */
export async function finishOwedCancelsJob(pool: Pool, deadline: number): Promise<string | null> {
  if (!stripeConfigured()) return null;
  const pass = await finishOwedCancels(pool, { deadline });
  if (!pass.owed) return null;
  return `cancelled the owed subscriptions of ${pass.cleared} of ${pass.owed} departed members`;
}

/**
 * A person says they cancelled the owed subscriptions in the Stripe dashboard
 * (/review, `intake.moderate`). Writes the cancelled row for each, with their
 * id as the actor, so the audit trail says who settled it and how.
 *
 * Only what was owed as of `asOf`, the newest row the card was read from: a
 * hand-off written after that is one this person never saw. An `asOf` this
 * village has no row for clears nothing.
 */
export async function confirmOwedCancelsByHand(pool: Pool, actorUserId: string | null, asOf: string): Promise<{ cleared: number } | null> {
  const rows = await subscriptionCancelRows(pool);
  const at = rows.findIndex((r) => r.id === asOf);
  if (at < 0) return null;
  const seen = owedFrom(rows.slice(0, at + 1));
  const now = new Map(owedFrom(rows).map((o) => [o.userId, new Set(o.subscriptionIds)] as const));
  let cleared = 0;
  for (const o of seen) {
    const still = o.subscriptionIds.filter((id) => now.get(o.userId)?.has(id));
    if (!still.length) continue;
    await recordSubscriptionCancels(pool, { userId: o.userId, kind: "cancelled", subscriptionIds: still, actorUserId });
    cleared += 1;
  }
  return { cleared };
}
