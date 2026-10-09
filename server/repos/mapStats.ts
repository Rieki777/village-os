/**
 * The counts the map's crown bar reads (shared/mapStatChips.ts).
 *
 * Each statement here is a COUNT over rows the village already keeps, with
 * the same two exclusions every other village figure makes: a standing example
 * is content and never a person or a piece of work, and an anonymised account
 * is somebody who has left. The Village Health snapshot (server/lib/health.ts,
 * `snapshotCycle`) counts its members and its active members the same way,
 * so the bar and the health page cannot disagree about who is here.
 *
 * Under server/repos because the raw-SQL burn-down counts query code outside
 * it, and that register only shrinks. The other readings the bar draws reuse
 * functions that already exist (gratitude, the org chart, the calendar and the
 * land's ledger), so this file holds only the counts nothing else was asking.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Distinct members who did something the event spine heard about in a window.
 * The snapshot's `members_active_cycle`, read live for the cycle under way.
 */
export async function countActiveMembers(pool: Pool, start: Date, end: Date): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(DISTINCT actor_user_id) AS n FROM health_events " +
      "WHERE at >= ? AND at < ? AND actor_user_id IS NOT NULL AND is_example = 0",
    [start, end],
  );
  return Number(row?.n ?? 0);
}

/**
 * The status word of every quest that is not an example. The caller decides
 * which are open with `questClosed` (server/repos/quests.ts), so the bar uses
 * the same reading of a free-text status as every door into a claim.
 */
export async function realQuestStatuses(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT status FROM quests WHERE COALESCE(is_example, 0) = 0",
  );
  return rows.map((r) => String(r.status ?? ""));
}

/**
 * Quest work consented to in a window.
 *
 * LEFT JOIN on the quest, where the life-signs reads use a plain JOIN: a
 * consented claim outlives its quest (drizzle/0196), and work the village
 * accepted is still work done after somebody tidies the board. An example
 * quest or an example member is still left out.
 */
export async function countConsentedClaims(pool: Pool, start: Date, end: Date): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM quest_claims c " +
      "LEFT JOIN quests q ON q.id = c.quest_id " +
      "LEFT JOIN users u ON u.id = c.user_id " +
      "WHERE c.status = 'consented' AND c.consented_at >= ? AND c.consented_at < ? " +
      "AND COALESCE(q.is_example, 0) = 0 AND COALESCE(u.is_example, 0) = 0",
    [start, end],
  );
  return Number(row?.n ?? 0);
}

/**
 * Circles that are active or forming. A row written before `status` existed
 * reads as active, the same default `circleView` (shared/circleView.ts) gives
 * it on every page that draws one.
 */
export async function countLiveCircles(pool: Pool): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM circles " +
      "WHERE COALESCE(is_example, 0) = 0 AND COALESCE(NULLIF(status, ''), 'active') IN ('active', 'forming')",
  );
  return Number(row?.n ?? 0);
}
