/**
 * Two statements about badge awards that the vote path and the admin path share.
 *
 * `deleteBadgeAward` is the one revoke, whichever door asked for it: the admin
 * route (server/routes/badges.ts) and a carried `badge_grant` revoke ballot
 * (server/lib/badgeGrantCloser.ts). `openBadgeBallotIds` is how the admin edit
 * route learns that the village is voting on a badge, so the definition the
 * roll is reading cannot be rewritten under it.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Take one award away. False when there was none to take. */
export async function deleteBadgeAward(pool: Pool, badgeId: string, userId: string): Promise<boolean> {
  const [r] = await pool.query<any>("DELETE FROM badge_awards WHERE badge_id = ? AND user_id = ?", [badgeId, userId]); // module-review-ok: the badges module's own revoke, moved verbatim from the admin route so the vote path and the admin path share one statement
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * The `badge_grant` ballots naming this badge, award or revoke, that are still
 * running or have carried and not landed yet. Badge ids are slugs of letters,
 * digits and dashes, so neither LIKE wildcard can appear in one.
 */
export async function openBadgeBallotIds(pool: Pool, badgeId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE subject_type = 'badge_grant' " +
      "AND (status = 'open' OR (status = 'passed' AND landing_status IN ('pending', 'applying'))) " +
      "AND (subject_ref LIKE ? OR subject_ref LIKE ?)",
    [`%@${badgeId}`, `%@-${badgeId}`],
  );
  return rows.map((r) => String(r.id));
}
