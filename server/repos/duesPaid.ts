/**
 * WHO PAID THEIR MEMBERSHIP DUES BY CARD, AND WHICH FLAT ROLE AMOUNTS ARE ON
 * THEIR WAY OUT (item 13, 2026-11-01). The two reads `runSettlement` makes
 * for the dues dividend (server/lib/economy.ts), and the role rules
 * `blankFlatRoleMint` reads to turn the automatic mint off.
 *
 * CARD DUES ONLY (Rye, 2026-11-01). A card payment for a `membership` payment
 * product writes one `fiat_charges` row per billed period, its `order_id` the
 * purchase id then `#` and the period (`settleProductPurchase`,
 * server/index.ts), and a refund or a dispute marks that one row `reversed`.
 * Dues paid through Zeffy or by hand write no such row, so nothing here can
 * see them, and Admin says so.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** A dues payer, with the fields the former-member check reads. */
export interface DuesPayer {
  id: string;
  email: string;
  membershipGranted: unknown;
  stageGranted: unknown;
}

/** Members with a card charge for membership dues, paid and never reversed, inside [from, to). */
export async function cardDuesPayersBetween(pool: Pool, from: Date, to: Date): Promise<DuesPayer[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT u.`id`, u.`email`, u.`membership_granted`, u.`stage_granted` " +
      "FROM `fiat_charges` fc " +
      "JOIN `product_purchases` pp ON pp.`id` = SUBSTRING_INDEX(fc.`order_id`, '#', 1) " +
      "JOIN `payment_products` p ON p.`id` = pp.`product_id` " +
      "JOIN `users` u ON u.`id` = fc.`user_id` " +
      "WHERE fc.`module` = 'commerce' AND fc.`status` = 'paid' AND p.`kind` = 'membership' " +
      "AND fc.`paid_at` >= ? AND fc.`paid_at` < ?",
    [from, to],
  );
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email ?? ""),
    membershipGranted: r.membership_granted,
    stageGranted: r.stage_granted,
  }));
}

/** Every `role.cycle` rule of one village, pending columns and all, for `blankFlatRoleMint`. */
export async function roleCycleRuleRows(pool: Pool, villageId: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = 'role.cycle'",
    [villageId],
  );
  return rows;
}

/**
 * The role rules whose flat amount is queued to go blank: the automatic mint
 * being retired (server/lib/flatRoleMint.ts). Until the blank lands they keep
 * paying each seat as they always did, so the cycle a change lands in pays
 * what it promised and never a surprise dividend.
 */
export async function retiringFlatRoleRuleIds(pool: Pool, villageId: string): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = 'role.cycle' " +
      "AND `amount` IS NOT NULL AND `pending_from_cycle` IS NOT NULL AND `pending_amount` IS NULL",
    [villageId],
  );
  return new Set(rows.map((r) => String(r.id)));
}
