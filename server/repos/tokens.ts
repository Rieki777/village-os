/**
 * `tokens`: the village's token registry, as rows.
 *
 * A home being started, like `tokenBalances.ts` beside it. The registry is
 * read at boot by `loadTokenRegistry` (server/lib/ledger.ts). The edit route
 * (server/routes/tokenEdit.ts) writes through the four statements here; the
 * create and mint routes in server/index.ts still hold their own.
 */
import type { Pool } from "mysql2/promise";

/** A token's own description, the village's words for what it means. null clears it. */
export async function writeTokenDescription(pool: Pool, slug: string, description: string | null): Promise<void> {
  await pool.query("UPDATE `tokens` SET `description` = ? WHERE `slug` = ?", [description, slug]);
}

/** The village's display name for a token. The slug never moves. */
export async function writeTokenName(pool: Pool, slug: string, name: string): Promise<void> {
  await pool.query("UPDATE `tokens` SET `name` = ? WHERE `slug` = ?", [name, slug]);
}

/** Whether members see a token. Balances and history are untouched either way. */
export async function writeTokenActive(pool: Pool, slug: string, active: boolean): Promise<void> {
  await pool.query("UPDATE `tokens` SET `active` = ? WHERE `slug` = ?", [active ? 1 : 0, slug]);
}

/** Whether members may send a token to each other. The route asks `mayToggleTransferable` first. */
export async function writeTokenTransferable(pool: Pool, slug: string, transferable: boolean): Promise<void> {
  await pool.query("UPDATE `tokens` SET `transferable` = ? WHERE `slug` = ?", [transferable ? 1 : 0, slug]);
}
