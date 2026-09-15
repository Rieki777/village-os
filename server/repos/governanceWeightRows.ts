/**
 * `governance_weights`, read as a ROW and never as a weight.
 *
 * ── THE DISTINCTION THIS FILE IS FOR ───────────────────────────────────────
 *
 * `server/lib/governanceWeights.ts` answers "how much does this member's vote
 * weigh", which is a different question with a different answer. That file
 * reads the village's weight MODE first: equal gives everybody 1, token reads
 * `token_balances`, and only `custom` looks at this table at all. It then
 * clamps a missing row to 0, because a member with no row has no allocated
 * weight and a vote cannot weigh a negative amount.
 *
 * This module answers the narrower question the executor asks before it writes:
 * WHAT DOES THE ROW SAY, and is there one? Null means no row, and the caller
 * records that as "the member had no allocation", which is not the same fact as
 * "the member's vote weighs zero" — under `equal` mode a member with no row
 * still votes with weight 1. Collapsing the two would put a wrong `old_value`
 * on the element trail, and the trail is what a reversion reads.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * THE LOCKING READ, and this is the important omission.
 * `server/lib/governanceWeights.ts` holds a `SELECT weight … FOR UPDATE`
 * followed by an upsert, on a connection it took out of the pool and will
 * commit itself. That statement cannot move into a function taking a `Pool`:
 * it would run on a DIFFERENT connection, outside the caller's transaction,
 * and the lock it exists to take would be taken and released against nobody.
 * It stays where the transaction is, and it stays correct.
 *
 * The roll-wide read (`WHERE user_id IN (…)`, and the unbounded one behind the
 * admin surface) also stayed. Both are that file's own, both are shaped by the
 * mode logic immediately around them, and moving a fragment of a decision is
 * how a decision stops being reviewable.
 *
 * ── NO CACHE ───────────────────────────────────────────────────────────────
 *
 * Nothing caches this table. Weights are power, as 0089 puts it, and every read
 * of them goes to the database at the moment it is asked.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One column. The caller decides what its absence means in context. */
const COLUMNS = "weight";

/**
 * The weight allocated to one member, or null when there is no row.
 *
 * `decimal(18,4)` arrives from the driver as a string, and `Number()` is what
 * the raw statement did with it. That is lossless for every value this column
 * can hold: four decimal places and eighteen digits of scale are inside a
 * double's exact range for anything a village would allocate, and the caller
 * turns the number straight back into a string for the trail.
 */
export async function allocatedWeight(pool: Pool, userId: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM governance_weights WHERE user_id = ?`,
    [userId],
  );
  return rows[0] ? Number(rows[0].weight) : null;
}
