/**
 * `badges.multipliers` (drizzle/0278): the badges whose multipliers a card may
 * name. Read by `payBadgeBoosts` (server/lib/workPay.ts) with the same filter
 * `rewardMultipliersFor` pays from, less the holder: active, no example, never
 * a self or a hypha badge. Dormancy is the caller's, since it is per season.
 */
import type { Pool, PoolConnection } from "mysql2/promise";

export interface BadgeMultiplierRow {
  id: string;
  name: string;
  /** The raw column, parsed by `readBadgeMultipliers`. */
  multipliers: unknown;
}

/** Every awake-eligible badge carrying multipliers, by name. */
export async function listBadgesWithMultipliers(pool: Pool | PoolConnection): Promise<BadgeMultiplierRow[]> {
  const [rows]: any = await pool.query(
    `SELECT id, name, multipliers FROM badges
      WHERE active = 1 AND multipliers IS NOT NULL AND is_example = 0
        AND kind NOT IN ('self','hypha')
      ORDER BY name`,
  );
  return (rows as any[]).map((r) => ({ id: String(r.id), name: String(r.name), multipliers: r.multipliers }));
}
