/**
 * FOUNDER-HELD DIALS: ANYONE PROPOSES, WHOEVER HOLDS THE POWER ADOPTS.
 *
 * Rye, 2026-09-25: "the community can always from day one be able to suggest
 * upgrades and changes to all the dials in the admin section." A founder-held
 * dial (Ring 1, `ringOf` in shared/gameVariables.ts) used to refuse every
 * proposal, which was stricter than the ruling. The coordinator relayed the
 * adoption rule on 2026-10-31: adoption follows whoever holds the power, the
 * founders before handover and governance after, and `governance.weight_mode`
 * keeps its own door (a mode switch).
 *
 * WHERE THE RULE LIVES. At the doors, never in the executor:
 *
 *   before the start   the vote doors (open a ballot, take it to Hypha) answer
 *                      `founderHeldVoteProblem`, and a founder adopts the
 *                      proposal through the admin apply route, which is the
 *                      hand that lands a change before the start and is
 *                      closed after it (server/index.ts).
 *   after the start    nothing here refuses, so the proposal goes to the vote
 *                      like any other and the landing applies it.
 *
 * So a carried ballot can never hold a founder-held change the landing then
 * refuses, which would leave it retrying on every tick.
 */
import { VARIABLES_BY_KEY, ringOf } from "../../shared/gameVariables";
import { asChangeItem, type ChangeInput } from "./mechanics";

/** The dial keys in a change set that the founders hold. */
export function founderHeldKeys(changes: readonly ChangeInput[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    let item;
    try {
      item = asChangeItem(c);
    } catch {
      continue;
    }
    if (item.kind !== "dial") continue;
    const def = VARIABLES_BY_KEY[item.key];
    if (def && ringOf(def) !== "open") out.push(item.key);
  }
  return out;
}

/** A proposal a founder may adopt by hand before the start: still open, and made only of founder-held dials. */
export function founderAdoptable(p: { status: string; changeSet: readonly ChangeInput[] }): boolean {
  if (p.status !== "open" && p.status !== "draft") return false;
  return p.changeSet.length > 0 && founderHeldKeys(p.changeSet).length === p.changeSet.length;
}

export const FOUNDERS_ADOPT =
  "Before the Game starts, the founders hold founder-held dials, so a founder adopts this proposal and it does not go to the vote. After the start, the village votes on it like any other.";

/** The vote doors' answer for a founder-held set before the start, or null. */
export async function founderHeldVoteProblem(
  changes: readonly ChangeInput[],
  foundersHold: () => Promise<boolean>,
): Promise<string | null> {
  if (founderHeldKeys(changes).length === 0) return null;
  return (await foundersHold()) ? FOUNDERS_ADOPT : null;
}
