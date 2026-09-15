/**
 * WHICH CYCLE END A DIGEST HAS ALREADY BEEN WRITTEN FOR.
 *
 * One read of `governance_moon_digests`, and it is the read the landing job
 * walks forward from.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT THE DIGEST TABLE'S HOME ───────────────
 *
 * `server/lib/moonDigest.ts` composes the digest and owns the writes: the
 * insert that CLAIMS a cycle (the table keys on the cycle id, so whoever writes
 * the row composes the digest and every other caller reads `already_composed`),
 * the update that records when it was posted, and the read that renders one
 * back. That file is being burned down by a neighbouring lane in the same wave
 * this one was written in, and a module here claiming the table would leave the
 * loser of that race as its second home. So this file claims one read and says
 * where the other three are.
 *
 * ── WHY MAX(ended_at) AND NOT A COUNT ──────────────────────────────────────
 *
 * The question the landing job asks is "which ended cycle is owed a digest",
 * and the answer is one step forward on the clock from the last one written.
 * Reading the maximum keeps that a single indexed lookup whatever the history
 * is — `governance_moon_digests_ended_idx` — where counting rows would grow with
 * the village's age for an answer that never needed the rows.
 *
 * ── THE VALUE COMES BACK RAW, AND THAT IS THE DEFECT THIS GUARDS ───────────
 *
 * `lastDigestedCycleEnd` hands over exactly what the driver gave it and
 * converts nothing. The caller has three cases and they are not
 * interchangeable: no digests at all (fall back to the edge test, because
 * walking forward has no honest starting point and the alternative is
 * retroactively composing every moon since the village was founded), a readable
 * stamp (walk forward from it), and a stamp that will not parse (fall back to
 * the edge test, because an unreadable value must not silently mean "nothing
 * owed"). A conversion here would collapse the third case into the first or
 * into a thrown error, and the whole reason this read exists is that the digest
 * used to be lost silently and report the same word a quiet Tuesday reports.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Nothing to invalidate. The read happens on each five-minute tick, which is
 * exactly as often as the answer can change.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The newest cycle end that has a digest row, as the driver returned it.
 *
 * Null when the village has never composed one. Null and an unparseable value
 * are different answers and the caller treats them differently; both are
 * handed back rather than judged here.
 */
export async function lastDigestedCycleEnd(pool: Pool): Promise<unknown> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT MAX(ended_at) AS last_ended FROM governance_moon_digests");
  return rows[0]?.last_ended ?? null;
}
