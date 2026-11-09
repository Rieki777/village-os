/**
 * The mint rules on one token, pending columns and all, for
 * `enableEarnedEquityRules` (server/lib/earnedEquityRules.ts).
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export async function mintRuleRowsForToken(pool: Pool, villageId: string, tokenSlug: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `mint_rules` WHERE `village_id` = ? AND `token_slug` = ?",
    [villageId, tokenSlug],
  );
  return rows;
}
