/**
 * `calendar_feed_tokens`: the mint's write (adversarial round 4).
 *
 * The rest of this table's SQL still lives in server/lib/icsFeed.ts, where it
 * is recorded debt in scripts/module-sql-pending.json and may only shrink.
 * New queries on the table are born here.
 */
import type { PoolConnection } from "mysql2/promise";

/**
 * Retire the member's live feed key and write the new one, on the connection
 * that holds the member's row while the session still holds
 * (`mintFeedToken`, server/lib/icsFeed.ts, through `whileSessionHolds`,
 * server/lib/sessionHold.ts). It takes a connection and never a pool, so it
 * cannot run outside that lock. One live key per member: both statements are
 * in the caller's transaction, so a failure between them leaves the old key
 * as it was.
 */
export async function replaceFeedTokenOn(conn: PoolConnection, userId: string, id: string, tokenHash: string): Promise<void> {
  await conn.query(
    "UPDATE `calendar_feed_tokens` SET `revoked_at` = UTC_TIMESTAMP() WHERE `user_id` = ? AND `revoked_at` IS NULL",
    [userId],
  );
  await conn.query("INSERT INTO `calendar_feed_tokens` (`id`, `user_id`, `token_hash`) VALUES (?,?,?)", [id, userId, tokenHash]);
}
