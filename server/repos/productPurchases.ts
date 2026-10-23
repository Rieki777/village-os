/**
 * Writes to `product_purchases` that belong in a repo. Checkout and the admin
 * list still query the table from server/index.ts; this file starts with the
 * one write the erasure needs.
 */
import type { Pool } from "mysql2/promise";

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
 * `emailKey` is empty on a resume that reads the tombstone and no longer knows
 * the old address, and then only the account's orders are found.
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
