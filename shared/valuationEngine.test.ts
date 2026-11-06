/**
 * The valuation engine: one suggestion any editing surface asks for. It wraps
 * the pricer (`shared/valuation.ts`, whose own tests hold the arithmetic) and
 * adds what a person needs to set a figure: the total reward price with its
 * split, a range in words and numbers, a narrow band inside which one person's
 * word stands, a receipt a member can follow, and levers for the setter.
 *
 * Rulings this file defends (constitution numbers): II.4 Gratitude is never
 * read; II.6 no caps; II.7-II.9 the reward rule; II.10-II.11 no hourly figure
 * on anything a member reads; II.27 no assumed currency; 0.4 every refusal
 * names where it is fixed.
 */
import { describe, expect, it } from "vitest";
import { PLATFORM_DEFAULT_MODEL, priceWork, rewardFromBase, type ValuationModel, type WorkInputs } from "./valuation";
import { ENGINE_DEFAULTS, modelForVillage, suggestValuation, wholeMoney, type PayeeSuggestion, type Suggestion } from "./valuationEngine";

const src = { sentence: "Decree 45303-MTSS, daily rate ÷ 8", date: "2026-10-31" };
/** A colón village's first version: each band at its legal minimum wage. */
const CRC: ValuationModel = {
  ...modelForVillage("CRC"),
  version: 1,
  bands: [
    { key: "general", label: "General help", hourValueMinor: 155455, source: src },
    { key: "skilled", label: "Skilled", hourValueMinor: 174898, source: src },
  ],
};
const MEANING = { eeMeaningWritten: true };

/** Goat fence repair: one lead, 4 estimated hours, hard conditions, 10% for the village. */
const FENCE: WorkInputs = {
  kind: "quest",
  lines: [{ band: "general", payee: "lead", estimatedHours: 4 }],
  complexity: "conditions",
  benefitPct: 10,
  benefitReason: "keeps the goats in",
};
const FENCE_RANGED: WorkInputs = { ...FENCE, lines: [{ band: "general", payee: "lead", estimatedHours: 4, estimateLow: 3, estimateHigh: 6 }] };

const ok = (s: Suggestion | { ok: false }): Extract<Suggestion, { ok: true }> => {
  if (!s.ok) throw new Error("expected a suggestion");
  return s as Extract<Suggestion, { ok: true }>;
};
const lead = (s: Suggestion): PayeeSuggestion => ok(s).payees.find((p) => p.payee === "lead")!;
const everyString = (p: PayeeSuggestion): string[] => [
  ...p.receipt.folded.flatMap((l) => [l.label, l.result]),
  ...p.receipt.unfolded.flatMap((l) => [l.label, l.result]),
  ...p.levers.map((l) => l.label),
  ...p.range.why,
];

describe("the model a village prices with before it saves its own", () => {
  it("takes the village's own currency and keeps every rule figure (II.27)", () => {
    const m = modelForVillage("CRC");
    expect(m.currency).toBe("CRC");
    expect(m.reward).toEqual(PLATFORM_DEFAULT_MODEL.reward);
    expect(m.complexity).toEqual(PLATFORM_DEFAULT_MODEL.complexity);
    expect(m.bands).toEqual([]);
  });

  it("leaves the minimum quest value blank, never 500 minor units of whatever the village holds", () => {
    expect(modelForVillage("CRC").minQuestMinor).toBe(0);
    expect(modelForVillage("usd").currency).toBe("USD");
  });

  it("returns a village's saved version unchanged", () => {
    expect(modelForVillage("CRC", CRC)).toBe(CRC);
  });
});

describe("the suggestion for a goat fence repair, in colones", () => {
  const s = suggestValuation(CRC, FENCE, MEANING);
  const p = lead(s);
  const priced = priceWork(CRC, FENCE);
  if (!priced.ok) throw new Error("fixture");
  const base = priced.price.payees[0];

  it("is exactly the pricer's total reward, split and Voice (US1.1)", () => {
    expect(p.expected.totalMinor).toBe(base.totalMinor);
    expect(p.expected.credits).toBe(base.payTokens.find((t) => t.token === CRC.tokens.credits)?.amount ?? 0);
    expect(p.expected.earnedEquity).toBe(base.equityUnits);
    expect(p.expected.earnedEquityHeld).toBe(0);
    expect(p.expected.voice).toBe(base.voice.amount);
    expect(p.expected.voice).toBe(Math.floor(p.expected.totalMinor / 100));
  });

  it("prices 4 hours at ₡1,554.55, plus 10% hard conditions and 10% for the village, as a ₡7,462 base and a ₡15,670 reward", () => {
    // 4 × 155455 = 621820; +10% 62182 twice; base 746184 minor = ₡7,461.84.
    expect(base.priceMinor).toBe(746184);
    // 7461 base units, 7461 Earned Equity, 746 Credits bonus: 15,668 units.
    expect(p.expected.totalMinor).toBe(1566800);
  });

  it("gives one estimate a range of -15% / +25% on the base, worked through the reward rule, read as medium (US1.3)", () => {
    const low = rewardFromBase(CRC, Math.round(746184 * 0.85)).totalMinor;
    const high = rewardFromBase(CRC, Math.round(746184 * 1.25)).totalMinor;
    expect(p.range).toMatchObject({ lowTotalMinor: low, highTotalMinor: high, width: "medium" });
    expect(p.range.why).toContain("one estimate only");
  });

  it("holds a no-sign band of the expected total ±10%, separate from the range (US1.4)", () => {
    expect(p.band).toEqual({ lowMinor: Math.round(1566800 * 0.9), highMinor: Math.round(1566800 * 1.1) });
  });

  it("folds to the reward and the likely range, and unfolds into lines that add up", () => {
    expect(p.receipt.folded.map((l) => l.key)).toEqual(["reward", "likely"]);
    expect(p.receipt.folded[0].result).toBe("₡15,668");
    const keys = p.receipt.unfolded.map((l) => l.key);
    expect(keys).toEqual(["labour:0", "complexity", "benefit", "base", "added", "reward", "range"]);
    expect(p.receipt.unfolded.find((l) => l.key === "labour:0")).toMatchObject({ label: "Estimated effort, General help", result: "₡6,218" });
    expect(p.receipt.unfolded.find((l) => l.key === "benefit")?.label).toBe("Good for the village, 10%: keeps the goats in");
    expect(p.receipt.unfolded.length).toBeLessThanOrEqual(9);
  });

  it("says what is paid, in token slugs the card renders by name, with no cash line when there is no cash", () => {
    expect(p.paidAs).toEqual([
      { token: CRC.tokens.credits, amount: p.expected.credits },
      { token: CRC.tokens.equity, amount: 7461 },
      { token: CRC.tokens.voice, amount: 15668 },
    ]);
  });
});

describe("no hourly figure on anything a member reads (II.10, II.11)", () => {
  it("never prints a band's per-hour value, in any receipt line, lever or reason", () => {
    for (const work of [FENCE, FENCE_RANGED, { ...FENCE, lines: [{ band: "skilled", payee: "crew" as const, people: 3, estimatedHours: 2.5 }] }]) {
      const p = lead(suggestValuation(CRC, work, MEANING)) ?? ok(suggestValuation(CRC, work, MEANING)).payees[0];
      const all = everyString(p).join(" | ");
      for (const band of CRC.bands) {
        expect(all).not.toContain(wholeMoney(band.hourValueMinor, "CRC"));
        expect(all).not.toContain("1,554");
        expect(all).not.toContain("1,748");
      }
      expect(all).not.toMatch(/per hour|an hour|\/h\b|hourly/i);
    }
  });

  it("never offers a lever that changes the hours alone, so no lever's step is an hourly figure (QA F13)", () => {
    const p = lead(suggestValuation(CRC, FENCE, MEANING));
    expect(p.levers.length).toBeGreaterThan(0);
    for (const l of p.levers) expect(l.changes).not.toContain("hours");
  });
});

describe("receipts do not show hours unless the village turns them on (C13, Rye 2026-11-06, US0)", () => {
  // Rye: "we're not paying for hours we're paying for contributions (value in)".
  const HOURS = /\bhours?\b|\d\s*h\b/i;
  const works = [FENCE, FENCE_RANGED, { ...FENCE, lines: [{ band: "skilled", payee: "crew" as const, people: 3, estimatedHours: 2.5, estimateLow: 2, estimateHigh: 4 }] }];

  it("names no number of hours in any folded or unfolded line, lever or reason by default", () => {
    for (const work of works) {
      for (const p of ok(suggestValuation(CRC, work, MEANING)).payees) {
        for (const text of everyString(p)) expect(text).not.toMatch(HOURS);
      }
    }
  });

  it("shows them when the village's setting is on", () => {
    const shown = { ...CRC, receiptShowsHours: true };
    const p = lead(suggestValuation(shown, FENCE_RANGED, MEANING));
    expect(p.receipt.unfolded.find((l) => l.key === "labour:0")?.label).toBe("Estimated effort, General help, 4 hours");
    expect(p.range.why).toContain("the hours could be 3 to 6");
  });

  it("prices the same either way: the setting changes what is shown, never the figure", () => {
    const a = lead(suggestValuation(CRC, FENCE_RANGED, MEANING));
    const b = lead(suggestValuation({ ...CRC, receiptShowsHours: true }, FENCE_RANGED, MEANING));
    expect(b.expected).toEqual(a.expected);
    expect(b.range.lowTotalMinor).toBe(a.range.lowTotalMinor);
    expect(b.band).toEqual(a.band);
  });
});

describe("the range from the person's own estimates (US1.2)", () => {
  const p = lead(suggestValuation(CRC, FENCE_RANGED, MEANING));
  const priced = priceWork(CRC, FENCE_RANGED);
  if (!priced.ok) throw new Error("fixture");
  const r = priced.price.payees[0].rangeMinor!;

  it("is the TOTAL at the low and high estimates", () => {
    expect(p.range.lowTotalMinor).toBe(rewardFromBase(CRC, r.low).totalMinor);
    expect(p.range.highTotalMinor).toBe(rewardFromBase(CRC, r.high).totalMinor);
    expect(p.range.why).toContain("the effort estimate is a range");
    expect(p.range.width).toBe("wide");
  });

  it("never widens the no-sign band, however wide the estimates (QA G3)", () => {
    const wild = lead(suggestValuation(CRC, { ...FENCE, lines: [{ band: "general", payee: "lead", estimatedHours: 4, estimateLow: 0.01, estimateHigh: 100 }] }, MEANING));
    const plain = lead(suggestValuation(CRC, FENCE, MEANING));
    expect(wild.band).toEqual(plain.band);
    expect(wild.range.highTotalMinor).toBeGreaterThan(plain.range.highTotalMinor);
  });

  it("reads narrow when the estimates are close", () => {
    const close = lead(suggestValuation(CRC, { ...FENCE, lines: [{ band: "general", payee: "lead", estimatedHours: 4, estimateLow: 3.8, estimateHigh: 4.2 }] }, MEANING));
    expect(close.range.width).toBe("narrow");
  });
});

describe("Earned Equity before the village says what it means (#892, US2)", () => {
  const held = lead(suggestValuation(CRC, FENCE, { eeMeaningWritten: false }));
  const paid = lead(suggestValuation(CRC, FENCE, MEANING));

  it("keeps the whole reward price and records the Earned Equity share as owed, not paid", () => {
    expect(held.expected.totalMinor).toBe(paid.expected.totalMinor);
    expect(held.expected.earnedEquity).toBe(0);
    expect(held.expected.earnedEquityHeld).toBe(paid.expected.earnedEquity);
  });

  it("pays Voice only for what is paid now, and keeps cash and Credits at their shares of the whole (II.8, II.9)", () => {
    expect(held.expected.voice).toBe(paid.expected.voice - paid.expected.earnedEquity);
    expect(held.expected.credits).toBe(paid.expected.credits);
    expect(held.expected.cashMinor).toBe(paid.expected.cashMinor);
    expect(held.paidAs.find((t) => t.token === CRC.tokens.equity)).toEqual({ token: CRC.tokens.equity, amount: 7461, owed: true });
  });

  it("warns, with the exact setting to fix (IV.8)", () => {
    const s = ok(suggestValuation(CRC, FENCE, { eeMeaningWritten: false }));
    expect(s.warnings.map((w) => w.fixAt)).toContain("admin:tokens:earned-equity");
  });
});

describe("cash from the cycle's budget", () => {
  it("takes the cycle's one cash share, and the rest of the base in Credits (II.7)", () => {
    const p = lead(suggestValuation(CRC, FENCE, { ...MEANING, cashSharePct: 50 }));
    expect(p.expected.cashMinor).toBe(Math.floor(7461 * 0.5) * 100);
    expect(p.expected.totalMinor).toBe(1566800);
    expect(p.paidAs[0]).toEqual({ token: "cash", amount: p.expected.cashMinor });
  });
});

describe("what the engine refuses, and where each is fixed (0.4, IV.8)", () => {
  it("names the rate settings when the village has set no rates", () => {
    const s = suggestValuation(modelForVillage("CRC"), FENCE, MEANING);
    expect(s.ok).toBe(false);
    if (s.ok) return;
    expect(s.refusals.length).toBeGreaterThan(0);
    expect(s.refusals.every((r) => r.fixAt === "valuation:bands")).toBe(true);
  });

  it("names the work's own inputs for a bad estimate", () => {
    const s = suggestValuation(CRC, { ...FENCE, lines: [{ band: "general", payee: "lead", estimatedHours: 0 }] }, MEANING);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.refusals[0].fixAt).toBe("work:inputs");
  });
});

describe("no caps on work pay (II.6)", () => {
  it("suggests any size of work in full, with no ceiling", () => {
    const huge = lead(suggestValuation(CRC, { ...FENCE, lines: [{ band: "skilled", payee: "lead", estimatedHours: 5000 }] }, MEANING));
    const priced = priceWork(CRC, { ...FENCE, lines: [{ band: "skilled", payee: "lead", estimatedHours: 5000 }] });
    if (!priced.ok) throw new Error("fixture");
    expect(huge.expected.totalMinor).toBe(priced.price.payees[0].totalMinor);
  });
});

describe("levers for the setter (spec 3.2)", () => {
  const p = lead(suggestValuation(CRC, FENCE, MEANING));

  it("offers the nearest levels up and down, each repriced by the engine itself", () => {
    const up = p.levers.find((l) => l.key === "complexity:hazardous")!;
    const down = p.levers.find((l) => l.key === "complexity:routine")!;
    expect(up.totalMinor).toBe(lead(suggestValuation(CRC, { ...FENCE, complexity: "hazardous" }, MEANING)).expected.totalMinor);
    expect(down.totalMinor).toBe(lead(suggestValuation(CRC, { ...FENCE, complexity: "routine" }, MEANING)).expected.totalMinor);
    expect(up.totalMinor).toBeGreaterThan(p.expected.totalMinor);
    expect(down.totalMinor).toBeLessThan(p.expected.totalMinor);
    expect(p.levers.length).toBeLessThanOrEqual(3);
  });
});

describe("Gratitude is never read (II.4)", () => {
  it("gives the same suggestion whatever Gratitude anyone holds or gave", () => {
    const plain = suggestValuation(CRC, FENCE, MEANING);
    const withGratitude = suggestValuation(CRC, FENCE, { ...MEANING, ...({ gratitudeReceived: 9999, gratitudeBalances: { a: 500 } } as object) });
    expect(JSON.stringify(withGratitude)).toBe(JSON.stringify(plain));
  });
});

describe("the engine's own dials", () => {
  it("ship the spec's defaults and follow a village's own", () => {
    expect(ENGINE_DEFAULTS).toEqual({ bandPct: 10, singleLowPct: 15, singleHighPct: 25, narrowPct: 20, mediumPct: 50 });
    const wide = lead(suggestValuation({ ...CRC, engine: { bandPct: 20 } }, FENCE, MEANING));
    expect(wide.band.highMinor).toBe(Math.round(1566800 * 1.2));
  });
});
