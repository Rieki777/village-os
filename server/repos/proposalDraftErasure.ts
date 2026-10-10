/**
 * The erasure step's one statement against `proposal_drafts` (red team S2):
 * a departed member's unfinished proposals go whole. The wizard's own reads
 * and writes stay in server/lib/proposalDrafts.ts, which re-exports this.
 */
import type { Pool } from "mysql2/promise";

export async function deleteDraftsOf(pool: Pool, userId: string): Promise<number> {
  const [result] = await pool.query<any>("DELETE FROM proposal_drafts WHERE user_id = ?", [userId]);
  return Number(result.affectedRows ?? 0);
}
