/**
 * `tokens`: the village's token registry, as rows.
 *
 * A home being started, like `tokenBalances.ts` beside it. The registry is
 * read at boot by `loadTokenRegistry` (server/lib/ledger.ts) and written by
 * the admin token routes in server/index.ts, which still hold their own
 * statements. This file starts with the one write that is new (0283), so the
 * next statement to move has a named place to move to.
 */
import type { Pool } from "mysql2/promise";

/** A token's own description, the village's words for what it means. null clears it. */
export async function writeTokenDescription(pool: Pool, slug: string, description: string | null): Promise<void> {
  await pool.query("UPDATE `tokens` SET `description` = ? WHERE `slug` = ?", [description, slug]);
}
