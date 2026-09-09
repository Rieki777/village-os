/**
 * The one query the moon proposer makes: what has already been asked about
 * these moons.
 *
 * It is here rather than in `server/lib/moonProposal.ts` because the module
 * contract refuses raw SQL outside `server/repos`, and the burn-down register
 * does not grow. `validate-module.mjs` said so about this exact file:
 *
 *   NEW raw SQL: server/lib/moonProposal.ts carries 1 query call(s) outside
 *   server/repos and is not in the burn-down register at all.
 *
 * That is the whole reason for the split, and it is a good one: a settlement is
 * the one decision in the village that moves money on a schedule, so the set of
 * rows that decides whether to open another one should be readable in a single
 * file rather than found by grepping a job.
 *
 * ── WHY IT READS `ballots` AND NOT A VIEW OF ITS OWN ────────────────────────
 *
 * A settlement ballot has no subject table. `hasProposal` in
 * server/lib/applyDue.ts lists the two subject types backed by a proposal row
 * and this is not one of them: the ballot IS the record, and `subject_ref`
 * carries the cycle id. So the honest source for "has this moon been asked
 * about" is the ballots table, keyed on the subject type and the cycle.
 *
 * EVERY status comes back, `withdrawn` included. The decision in
 * shared/moonSettlement.ts treats a withdrawal as a person saying not this, and
 * filtering it out here would put that judgement in the wrong file and make the
 * withdraw button a button that does nothing.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

import { CYCLE_SETTLEMENT, type SettlementAsk, type SettlementRefusal } from "../../shared/moonSettlement";

/**
 * Every settlement ballot ever opened on any of these moons.
 *
 * An empty ask list short-circuits without touching the table: an `IN ()` with
 * no members is a syntax error in MySQL, and a village with no due moons is the
 * ordinary case rather than an edge one.
 */
export async function settlementAsks(pool: Pool, cycleIds: readonly string[]): Promise<SettlementAsk[]> {
  if (cycleIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT subject_ref, status FROM ballots WHERE subject_type = ? AND subject_ref IN (${cycleIds.map(() => "?").join(",")})`,
    [CYCLE_SETTLEMENT, ...cycleIds],
  );
  return rows.map((r) => {
    const status = String(r.status);
    return {
      cycleId: String(r.subject_ref),
      open: status === "open",
      outcome: status === "open" ? null : (status as SettlementAsk["outcome"]),
    };
  });
}

/**
 * The latest settlement vote on each of these moons, when it ended in a no.
 *
 * Rye, 2026-09-14: a founder may still close a moon the village voted down, and
 * the Cycles desk warns first. LATEST, because a no that a later re-ask
 * answered is no longer the village's word on that moon. A steward's veto also
 * ends `failed` (2026-09-08), and `vetoed_at` says which of the two it was.
 */
export async function latestSettlementRefusals(
  pool: Pool,
  cycleIds: readonly string[],
): Promise<Map<string, SettlementRefusal>> {
  const out = new Map<string, SettlementRefusal>();
  if (cycleIds.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, subject_ref, status, closed_at, vetoed_at FROM ballots WHERE subject_type = ? AND subject_ref IN (${cycleIds.map(() => "?").join(",")}) ORDER BY created_at DESC, id DESC`,
    [CYCLE_SETTLEMENT, ...cycleIds],
  );
  const seen = new Set<string>();
  for (const r of rows) {
    const ref = String(r.subject_ref);
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (String(r.status) !== "failed") continue;
    const when = r.vetoed_at ?? r.closed_at;
    out.set(ref, {
      ballotId: String(r.id),
      at: when instanceof Date ? when.toISOString() : String(when ?? ""),
      vetoed: r.vetoed_at != null,
    });
  }
  return out;
}
