/**
 * `agent_tokens`: the bulk revoke (lane tokens-on-reset), and the mint's insert
 * (adversarial round 4).
 *
 * The rest of this table's SQL still lives in server/lib/agentTokens.ts, where
 * it is recorded debt in scripts/module-sql-pending.json and may only shrink.
 * New queries on the table are born here, so that number never has to grow.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Revoke every LIVE token one member holds, and return the ids it revoked.
 *
 * The ids are read FOR UPDATE inside the same transaction as the write, so the
 * list is exactly the set of rows that changed and the caller can write one
 * audit line per token without guessing. A mint that lands while this runs
 * waits behind the lock and is minted after it. That is the caller's window to
 * close, and `withAgentReachEnded` in server/lib/agentTokens.ts says how: the
 * mint writes only while the session still holds (`insertToken` below).
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

/** One new token row, as `mintToken` (server/lib/agentTokens.ts) makes it. The hash, never the value. */
export interface NewTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: readonly string[];
  expiresAt: Date;
}

/**
 * Write one minted token. `mintToken` hands it the connection that holds the
 * member's row while the session still holds (`whileSessionHolds`,
 * server/lib/sessionHold.ts), so a token is never written for a session a new
 * password or a revoke ended since its check. A pool is for a caller that acts
 * for no session.
 */
export async function insertToken(db: Pool | PoolConnection, row: NewTokenRow): Promise<void> {
  await db.query(
    "INSERT INTO agent_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at) VALUES (?,?,?,?,?,?,?)",
    [row.id, row.userId, row.name, row.tokenHash, row.prefix, JSON.stringify(row.scopes), row.expiresAt],
  );
}
