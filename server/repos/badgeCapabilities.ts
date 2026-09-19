/**
 * `badge_awards` joined to `badges`, read across the WHOLE village.
 *
 * ── WHY THIS EXISTS BESIDE `badgeGrantsFor` ────────────────────────────────
 *
 * `badgeGrantsFor` in server/lib/badges.ts answers about ONE member: what do
 * this person's badges grant and deny. `liveHoldersOfCapability` asks the other
 * question, and it is the one Rye's redemption rule turns on: has this village
 * given a power to ANYBODY. Asking the per-member reader once per member would
 * be one query per person in the village to answer a question about a key.
 *
 * So this is the same join, unfiltered by member, and the caller folds it into
 * the map the counter takes.
 *
 * ── THE FILTERS ARE THE GATE'S OWN, and the omission is deliberate ─────────
 *
 * `b.active = 1` excludes a badge an admin retired, and an award whose
 * `expires_at` has passed grants nothing: both are `badgeGrantsFor`'s
 * conditions, verbatim, so the count cannot disagree with the gate about which
 * awards are live.
 *
 * DORMANT SEASONAL BADGES ARE NOT FILTERED HERE, because that list is computed
 * in the lib from the village's season and this file reads rows. The caller
 * passes it on, exactly as `badgeGrantsFor` takes `dormant` as an argument
 * rather than deriving it. A denial is never dormant (0050), which is why the
 * two halves come back separately rather than already merged.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One award, with the badge's grants and denies as the columns hold them. */
export async function badgeCapabilityRows(pool: Pool): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.user_id, b.id AS badge_id, b.capabilities, b.denies FROM badge_awards a " +
      "JOIN badges b ON b.id = a.badge_id " +
      "WHERE b.active = 1 AND (a.expires_at IS NULL OR a.expires_at > NOW())",
  );
  return rows;
}
