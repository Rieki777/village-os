/**
 * EARNED EQUITY'S RULES, ON AND BLANK, FOR VILLAGES ALREADY RUNNING (Rye,
 * 2026-11-05: Earned Equity's meaning "is unique project to project, SET IN
 * ADMIN per village", "then enable the EE rule seeded blank accordingly").
 *
 * New villages are seeded on and blank (economySeed.ts). A running village was
 * seeded with them OFF at a placeholder of 1, so this queues "on, amount blank"
 * through the same pending columns an admin's edit uses (`queueRuleChange`,
 * 0075), from the next cycle. Blank pays nothing flat: a quest, role or
 * proposal that names an amount pays it, and none may name it until the
 * village has written what it means (`payLineProblem`, server/lib/workPay.ts).
 *
 * A rule the village already switched on is its own decision and is left
 * alone, and so is one with a change already queued. Runs once at boot
 * (server/index.ts, `runOnce`); TypeScript, because the next cycle's number
 * comes from the village's clock.
 */
import type { Pool } from "mysql2/promise";
import { currentCycleNumber } from "./gratitude-cycles";
import { EARNED_EQUITY, queueRuleChange, villageId } from "./economy";
import { mintRuleRowsForToken } from "../repos/earnedEquityRules";

/** Who queued it, on the rule's own `pending_by`. Nothing displays it. */
export const EARNED_EQUITY_RULES_ON_BY = "platform:earned-equity-rules-on-2026-11-05";

export async function enableEarnedEquityRules(pool: Pool, at: Date = new Date()): Promise<{ queued: string[] }> {
  const queued: string[] = [];
  for (const r of await mintRuleRowsForToken(pool, villageId(), EARNED_EQUITY)) {
    if (Number(r.enabled) === 1) continue;
    if (r.pending_from_cycle !== null && r.pending_from_cycle !== undefined) continue;
    const res = await queueRuleChange(pool, String(r.id), { amount: null, enabled: true }, EARNED_EQUITY_RULES_ON_BY, currentCycleNumber(at) + 1);
    if (!res.ok) throw new Error(`could not switch on ${r.id}: ${res.error}`);
    queued.push(String(r.id));
  }
  return { queued };
}
