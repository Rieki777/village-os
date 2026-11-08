/**
 * REDEMPTION'S MONEY CEILINGS, AND THE ONE STEP THAT KEEPS THEM WHERE A
 * VILLAGE PUT THEM.
 *
 * Rye, 2026-11-05: redemption fails closed. These three dials used to read 0
 * as "no ceiling", the one place a cap of 0 did not mean zero. Now blank is
 * no ceiling and 0 is zero (`blank: "no ceiling"` in shared/gameVariables.ts).
 *
 * A village that stored a 0 meant "no ceiling" when it stored it, and would
 * wake up to a ceiling of zero without this step. `blankZeroRedemptionCeilings`
 * runs once at boot (server/index.ts, `redemption-ceilings-blank-2026-11-05`)
 * and turns a stored 0 into blank through `setVariable`, the one write path,
 * which removes the row because blank is now the default. A village that never
 * set a ceiling has no row and is untouched. A ceiling with a number above 0
 * is untouched. Each change it makes is written to the amendment ledger as a
 * platform change, so the dial's own history says what moved and why. Nothing
 * else is read or written.
 */
import type { Pool } from "mysql2/promise";
import { recordMechanicsChangeRow } from "./changeset";
import { setVariable, storedOverride } from "./variables";

export const CEILING_BLANK_NOTE =
  "Redemption ceilings fail closed (2026-11-05): 0 now means zero, so a stored 0, which meant no ceiling, became blank, which is no ceiling.";

export const REDEMPTION_CEILINGS = [
  "redemption.max_per_request",
  "redemption.max_per_member_per_cycle",
  "redemption.max_village_per_cycle",
] as const;

/** Turn every stored 0 ceiling into blank. Returns the keys it changed. */
export async function blankZeroRedemptionCeilings(pool: Pool): Promise<string[]> {
  const changed: string[] = [];
  for (const key of REDEMPTION_CEILINGS) {
    const stored = storedOverride(key);
    if (stored === undefined || stored.trim() === "" || Number(stored) !== 0) continue;
    const result = await setVariable(pool, key, "");
    if (!result.ok) throw new Error(`${key}: ${result.error}`);
    await recordMechanicsChangeRow(pool, key, result, null, "platform", null, CEILING_BLANK_NOTE);
    changed.push(key);
  }
  return changed;
}
