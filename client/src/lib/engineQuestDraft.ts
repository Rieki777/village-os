/**
 * A NEW QUEST PRICED BY THE VILLAGE'S RULE (quest re-price Q3b).
 *
 * The quest editor's boxes, filled with exactly what the pay door
 * (`PUT /api/quests/:id/pay`, `writeQuestPay`) would store for a figure:
 * `storedPayFor` shares it out by Rye's rule, Earned Equity is left off while
 * its meaning is unwritten, and no Voice line is written before the village
 * adopts its own model (the #995 guard). So posting the quest stores the
 * engine's figure, and the setting the editor records next matches it.
 */
import type { ValuationModel } from "@shared/valuation";
import { storedPayFor } from "@shared/valuationSetting";
import type { PayOption, WorkValueDraft } from "@/components/WorkValueEditor";
import { currencyExponent } from "@/lib/workPay";

const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));

export function draftFromEngine(
  model: ValuationModel,
  totalMinor: number,
  opts: { eeHeld: boolean; cashPct?: number; offered: readonly PayOption[]; currency: string },
): { draft: WorkValueDraft; voiceHeld: boolean; unoffered: string[] } {
  const stored = storedPayFor(model, totalMinor, { cashPct: opts.cashPct, eeHeld: opts.eeHeld });
  const voiceHeld = model.version === 0;
  const tokens = voiceHeld ? stored.valueTokens.filter((t) => t.token !== model.tokens.voice) : stored.valueTokens;
  const exp = currencyExponent(opts.currency);
  const boxes: Record<string, string> = {};
  for (const o of opts.offered) {
    const own = tokens.find((t) => t.token === o.token);
    boxes[o.token] = own ? plain(own.amount) : "0";
  }
  const offeredIds = new Set(opts.offered.map((o) => o.token));
  const unoffered = tokens.filter((t) => t.amount > 0 && !offeredIds.has(t.token)).map((t) => t.token);
  return {
    draft: {
      value: plain(stored.valueMinor / 10 ** exp),
      tokens: boxes,
      cash: stored.cashMinor === null ? "" : plain(stored.cashMinor / 10 ** exp),
    },
    voiceHeld,
    unoffered,
  };
}
