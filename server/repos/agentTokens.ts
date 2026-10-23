/**
 * `agent_tokens`: the bulk revoke (lane tokens-on-reset).
 *
 * The rest of this table's SQL still lives in server/lib/agentTokens.ts, where
 * it is recorded debt in scripts/module-sql-pending.json and may only shrink.
 * New queries on the table are born here, so that number never has to grow.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Revoke every LIVE token one member holds, and return the ids it revoked.
 *
 * The ids are read FOR UPDATE inside the same transaction as the write, so the
 * list is exactly the set of rows that changed and the caller can write one
 * audit line per token without guessing. A mint that lands while this runs
 * waits behind the lock and is minted after it; see `revokeAllTokens` in
 * server/lib/agentTokens.ts for why that is the caller's window to state.
 *
 * Expired tokens are left as they are. They are already dead, and the member's
 * own list keeps calling them "expired" instead of claiming a revoke that
 * nobody made. A token revoked earlier keeps its own revoke time.
 *
 * Idempotent: a second call finds no live row and writes nothing.
 */
export async function revokeLiveTokensOf(pool: Pool, userId: string): Promise<string[]> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `agent_tokens` WHERE `user_id` = ? AND `revoked_at` IS NULL AND `expires_at` > UTC_TIMESTAMP() FOR UPDATE",
      [userId],
    );
    const ids = rows.map((r) => String(r.id));
    if (ids.length) {
      await conn.query("UPDATE `agent_tokens` SET `revoked_at` = UTC_TIMESTAMP() WHERE `id` IN (?) AND `revoked_at` IS NULL", [ids]);
    }
    await conn.commit();
    return ids;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
