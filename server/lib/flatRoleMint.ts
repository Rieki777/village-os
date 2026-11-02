/**
 * THE FLAT ROLE MINT IS OFF (Rye, 2026-11-01, item 13): "Yes send a lane to
 * turn off the automatic mint - if this is turned on again it would be
 * attached to those who are paying members, so that each cycle they're paying
 * membership dues they're getting these tokens minted to them."
 *
 * The automatic mint was the `role.cycle` rules' own flat amounts: 50 Voice
 * and 25 Credits to every live seat, every cycle, whatever the role did
 * (economySeed.ts; 0125 added the Credits row to villages that predate it).
 *
 * OFF MEANS THE FLAT AMOUNT GOES BLANK, NEVER THE RULE. An enabled `role.cycle`
 * rule is also what lets a role's own pay list (`value_tokens`, the valuation
 * model, and the packages Saberra will propose) pay that token. Disabling the
 * rule would stop every role's pay along with the flat one. A blank amount
 * means "read it from the role", so a role that names its own pay keeps it and
 * a role that names none is paid nothing by this rule.
 *
 * FROM THE NEXT CYCLE, through the same queue an admin's edit uses
 * (`queueRuleChange`, 0075), so nobody loses pay in the cycle they are in. A
 * change an admin had already queued keeps its moon, its ceiling and its
 * switch; only its amount goes blank.
 *
 * New villages are seeded blank (economySeed.ts). Running villages get this
 * once at boot (server/index.ts, `runOnce`). It is TypeScript, never a SQL
 * migration, because the next cycle's number comes from the village's clock,
 * which SQL cannot compute. A village that sets a flat amount again afterwards
 * keeps it, because `runOnce` never replays.
 */
import type { Pool } from "mysql2/promise";
import { currentCycleNumber } from "./gratitude-cycles";
import { queueRuleChange, villageId } from "./economy";
import { roleCycleRuleRows } from "../repos/duesPaid";

/** Who queued it, on the rule's own `pending_by`. Nothing displays it. */
export const FLAT_ROLE_MINT_OFF_BY = "platform:flat-role-mint-off-2026-11-01";

export async function blankFlatRoleMint(pool: Pool, at: Date = new Date()): Promise<{ queued: string[] }> {
  const rows = await roleCycleRuleRows(pool, villageId());
  const queued: string[] = [];
  for (const r of rows) {
    const pending = r.pending_from_cycle !== null && r.pending_from_cycle !== undefined;
    const flatNow = r.amount !== null && r.amount !== undefined;
    const flatQueued = pending && r.pending_amount !== null && r.pending_amount !== undefined;
    if (!flatNow && !flatQueued) continue;
    const res = pending
      ? await queueRuleChange(
          pool, String(r.id),
          { amount: null, ceiling: Number(r.pending_ceiling ?? r.ceiling ?? 0), enabled: !!Number(r.pending_enabled ?? r.enabled) },
          FLAT_ROLE_MINT_OFF_BY, Number(r.pending_from_cycle),
        )
      : await queueRuleChange(pool, String(r.id), { amount: null }, FLAT_ROLE_MINT_OFF_BY, currentCycleNumber(at) + 1);
    if (!res.ok) throw new Error(`could not blank the flat amount on ${r.id}: ${res.error}`);
    queued.push(String(r.id));
  }
  return { queued };
}
