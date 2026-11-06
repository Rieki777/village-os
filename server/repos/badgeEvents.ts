/**
 * `badge_events` (drizzle/0023): one row per tier a member reached, keyed by an
 * idempotency key, so a replayed award writes nothing.
 *
 * Only the award-now path writes through here (server/lib/badges.ts
 * `awardFirstTierNow`); the cycle-close engine still writes its own rows in
 * that file, a debt the raw-SQL register counts.
 */
import type { Pool, PoolConnection } from "mysql2/promise";

/** Record that `userId` reached `tier` of `badgeId`. False when that tier was already recorded. */
export async function recordBadgeTier(pool: Pool | PoolConnection, badgeId: string, userId: string, tier: number): Promise<boolean> {
  try {
    await pool.query("INSERT INTO badge_events (id, badge_id, user_id, tier, idempotency_key) VALUES (?,?,?,?,?)", [
      `be-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      badgeId,
      userId,
      tier,
      `rule:${badgeId}:${userId}:tier-${tier}`,
    ]);
    return true;
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return false;
    throw e;
  }
}
