import { describe, expect, it } from "vitest";
import type { ValuationModel } from "@shared/valuation";
import { modelForVillage } from "@shared/valuationEngine";
import { storedPayFor } from "@shared/valuationSetting";
import { draftFromEngine } from "./engineQuestDraft";
import { draftToBody, type PayOption } from "@/components/WorkValueEditor";

const src = { sentence: "Decree 45303-MTSS, daily rate ÷ 8", date: "2026-10-31" };
const CRC: ValuationModel = {
  ...modelForVillage("CRC"),
  version: 1,
  bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: src }],
};
const offered = (m: ValuationModel): PayOption[] => [
  { token: m.tokens.credits, name: "Credits", standard: 25, decimals: 2 },
  { token: m.tokens.equity, name: "Earned Equity", standard: null, decimals: 2 },
  { token: m.tokens.voice, name: "Voice", standard: 10, decimals: 2 },
];

describe("a new quest priced by the village's rule", () => {
  it("fills the boxes with exactly what the pay door would store, so the save writes the engine's figure", () => {
    const total = 3000000;
    const d = draftFromEngine(CRC, total, { eeHeld: false, offered: offered(CRC), currency: "CRC" });
    const body = draftToBody(d.draft, offered(CRC), "CRC", { required: true });
    if (!body.ok) throw new Error(body.error);
    const stored = storedPayFor(CRC, total, { eeHeld: false });
    expect(body.valueMinor).toBe(stored.valueMinor);
    const byToken = (a: { token: string }, b: { token: string }) => a.token.localeCompare(b.token);
    expect([...body.valueTokens].sort(byToken)).toEqual(stored.valueTokens.filter((t) => t.amount > 0).sort(byToken));
    expect(body.cashMinor).toBe(stored.cashMinor);
    expect(d.unoffered).toEqual([]);
  });

  it("overwrites the board's standard amounts instead of keeping them beside the rule's", () => {
    const d = draftFromEngine(CRC, 3000000, { eeHeld: true, offered: offered(CRC), currency: "CRC" });
    // Earned Equity is owed, not paid, while its meaning is unwritten: its box reads 0.
    expect(d.draft.tokens[CRC.tokens.equity]).toBe("0");
    expect(d.draft.tokens[CRC.tokens.credits]).not.toBe("25");
  });

  it("pays no Voice before the village adopts its own model (the #995 guard)", () => {
    const v0 = { ...CRC, version: 0 };
    const d = draftFromEngine(v0, 3000000, { eeHeld: false, offered: offered(v0), currency: "CRC" });
    expect(d.draft.tokens[v0.tokens.voice]).toBe("0");
    expect(d.voiceHeld).toBe(true);
  });

  it("names a token the rule pays that the quest pay rules do not offer, so nothing is dropped silently", () => {
    const only = offered(CRC).filter((o) => o.token !== CRC.tokens.equity);
    const d = draftFromEngine(CRC, 3000000, { eeHeld: false, offered: only, currency: "CRC" });
    expect(d.unoffered).toEqual([CRC.tokens.equity]);
  });

  it("carries the cash the cycle's share takes out of the base", () => {
    const d = draftFromEngine(CRC, 2100000, { eeHeld: false, cashPct: 50, offered: offered(CRC), currency: "CRC" });
    expect(d.draft.cash).toBe(String(Math.floor(10000 * 0.5)));
  });
});
