/**
 * THE QUEST CLAIMS A MEMBER WHO HAS LEFT STILL HELD OPEN, for the erasure
 * sweep (server/lib/erasure.ts: "quest-claims-after-tombstone"). Rye's ruling
 * of 2026-10-31, item 9: an erased member's quest claims are released.
 *
 * WHY. The sweep kept every claim, open ones included, renamed to "A departed
 * member". Nobody can work an open claim any more: the tombstone cannot sign
 * in, and consent refuses to pay it (server/lib/departed.ts). Kept, it counted
 * as somebody working the quest on the board (`fieldCounts`), sat in the
 * steward's queue and the attention list, and held the quest against its own
 * delete, which refuses a quest with a claim in flight (`removeIfSettled`).
 *
 * WHAT HAPPENS, BY STATUS.
 *
 *   `claimed`: deleted, the way `claimsRepo.remove` puts back a quest picked
 *   up and not yet worked on. No work and no value is attached to it.
 *
 *   `submitted`: declined, the way a steward hands a quest back. The work was
 *   handed in and is part of the record, so the row stays, resolved, and
 *   nobody is told.
 *
 *   `consented` and `declined`: untouched. Those are history, and a consented
 *   claim is work witnessed and paid.
 *
 * Each statement names the status it moves from in its WHERE, so a claim a
 * steward resolved a moment earlier is left as the steward left it. Reads only
 * by the member's id, so it runs after the tombstone and a resume may run it
 * any number of times.
 */
import type { Pool, ResultSetHeader } from "mysql2/promise";

export async function releaseOpenClaimsOf(pool: Pool, userId: string): Promise<{ removed: number; declined: number }> {
  const [gone] = await pool.query<ResultSetHeader>(
    "DELETE FROM `quest_claims` WHERE `user_id` = ? AND `status` = 'claimed'",
    [userId],
  );
  const [handedBack] = await pool.query<ResultSetHeader>(
    "UPDATE `quest_claims` SET `status` = 'declined', `consented_at` = CURRENT_TIMESTAMP " +
      "WHERE `user_id` = ? AND `status` = 'submitted'",
    [userId],
  );
  return { removed: gone.affectedRows, declined: handedBack.affectedRows };
}
