/**
 * Queries on `product_purchases` that belong in a repo. Checkout and the admin
 * list still query the table from server/index.ts; this file holds what the
 * erasure and the exit desk need.
 */
import type { Pool } from "mysql2/promise";

/** One Stripe subscription a member's purchase holds, and what it sells. */
export interface LiveSubscription {
  purchaseId: string;
  subscriptionId: string;
  /** The product's name, or "" when the product row is gone. */
  productName: string;
  /** How often Stripe charges it, or null when the product row no longer says. */
  interval: "month" | "year" | null;
}

/**
 * Every Stripe subscription one member's purchases hold that may still charge
 * them, for the erasure's `product-subscriptions-after-tombstone` step
 * (server/lib/erasure.ts) and the exit desk's notice (`subscriptionsState`,
 * server/lib/exit.ts).
 *
 * WHICH ROWS. A purchase on their account that settled a period carries the
 * subscription id (`settleProductPurchase` writes it with `status = 'paid'`).
 * A REVERSED one is included on purpose: a dispute on a subscription's only
 * period marks the purchase reversed and leaves the subscription itself
 * running, so Stripe can still charge the next month. A pending or expired
 * checkout never got a subscription id.
 *
 * By user id alone. A recurring purchase made signed out, under an address,
 * is not found here: nothing ties it to the account but the address, and the
 * erasure clears that address from the order (`forgetPayerEmailOf`).
 *
 * Read only. Whether a subscription is still live is Stripe's to say, so the
 * caller asks Stripe and this list is the candidates.
 */
export async function liveSubscriptionsOf(pool: Pool, userId: string): Promise<LiveSubscription[]> {
  const [rows]: any = await pool.query(
    "SELECT pp.id, pp.stripe_subscription_id, p.name, p.recurring FROM product_purchases pp " +
      "LEFT JOIN payment_products p ON p.id = pp.product_id " +
      "WHERE pp.user_id = ? AND pp.stripe_subscription_id IS NOT NULL AND pp.status IN ('paid','reversed') " +
      "ORDER BY pp.created_at, pp.id",
    [userId],
  );
  return (rows as any[]).map((r) => ({
    purchaseId: String(r.id),
    subscriptionId: String(r.stripe_subscription_id),
    productName: String(r.name ?? ""),
    interval: r.recurring === "month" || r.recurring === "year" ? r.recurring : null,
  }));
}

/**
 * Clear the address on every order one member paid, for the erasure's
 * `purchase-emails-after-tombstone` step (server/lib/erasure.ts).
 *
 * THE ORDER STAYS, ITS ADDRESS GOES. An order is a value row: it records money
 * that came in and the receipt number it was given, and `GET
 * /api/admin/products` lists it joined to the buyer's name. After the
 * tombstone that name reads "A departed member", and the real address sat
 * beside it. `payer_email` is only how the village reached a payer with no
 * account; nothing reads it back to settle, refund or renew an order.
 *
 * WHICH ORDERS ARE THEIRS. Every order on their account, and every order paid
 * under their address before they had one, matched trimmed and lower-cased.
 * A resume past the tombstone still has the old address, held in
 * `member_erasures` (0282). `emailKey` is empty for a record from before that,
 * and for a resume whose old address another account holds now, and then only
 * the account's orders are found.
 *
 * Idempotent: an UPDATE writing NULL.
 */
export async function forgetPayerEmailOf(pool: Pool, input: { userId: string; emailKey: string }): Promise<number> {
  const [r]: any = await pool.query(
    "UPDATE product_purchases SET payer_email = NULL " +
      "WHERE payer_email IS NOT NULL AND (user_id = ? OR (? <> '' AND LOWER(TRIM(payer_email)) = ?))",
    [input.userId, input.emailKey, input.emailKey],
  );
  return Number(r?.affectedRows ?? 0);
}
