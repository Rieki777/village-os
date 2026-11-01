/**
 * A role priced from the source's monthly figure (valuation model, first
 * slice): the value per moon, Voice as the whole value and the value split
 * between Credits, Earned Equity and cash with the 10% floors (Rye,
 * 2026-10-31), and his two defaults of the same day (only a settled figure
 * writes, only the paid models split themselves). Every line of the working is
 * held, because the working is what a member reads.
 */
import { describe, expect, it } from "vitest";
import { CREDITS, EARNED_EQUITY, HEARTS, VILLAGE_VOICE } from "../server/lib/economy";
import type { SourcePay } from "./structurePlan";
import {
  AUTO_SPLIT_MODELS,
  autoSplits,
  cashCapPct,
  holdSplit,
  PLATFORM_DEFAULT_MODEL,
  priceRoleFromMonthly,
  rolePriceTokens,
  sourcePayWrites,
  type ValuationModel,
} from "./valuation";

const pay = (over: Partial<SourcePay> = {}): SourcePay => ({
  model: "Stipend",
  standing: "settled",
  statusLabel: "Active",
  terms: null,
  monthlyUsd: 1200,
  ...over,
});

const line = (r: ReturnType<typeof priceRoleFromMonthly>, key: string) => r?.lines.find((l) => l.key === key);
const amountOf = (r: ReturnType<typeof priceRoleFromMonthly>, token: string) => r?.payTokens?.find((t) => t.token === token)?.amount;
/** $1,030.82 a month is exactly $1,000.00 a moon: Rye's own example figure. */
const THOUSAND_A_MOON = 1030.82;

describe("the platform default model", () => {
  it("names the server's own Credits, Earned Equity and Voice slugs", () => {
    expect(PLATFORM_DEFAULT_MODEL.tokens).toEqual({ credits: CREDITS, equity: EARNED_EQUITY, voice: VILLAGE_VOICE });
  });

  it("never pays Gratitude, and starts at dollars, 1 Voice per $1, half Credits and half Earned Equity, 10% floors", () => {
    expect(Object.values(PLATFORM_DEFAULT_MODEL.tokens)).not.toContain(HEARTS);
    expect(PLATFORM_DEFAULT_MODEL.currency).toBe("USD");
    expect(PLATFORM_DEFAULT_MODEL.voicePerUnit).toBe(1);
    expect(PLATFORM_DEFAULT_MODEL.defaultSplit).toEqual({ creditsPct: 50, equityPct: 50, cashPct: 0 });
    expect(PLATFORM_DEFAULT_MODEL.floors).toEqual({ creditsPct: 10, equityPct: 10 });
    expect(cashCapPct(PLATFORM_DEFAULT_MODEL)).toBe(80);
    expect(PLATFORM_DEFAULT_MODEL.version).toBe(0);
  });
});

describe("Rye's example: a job worth 1000 (2026-10-31)", () => {
  const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: THOUSAND_A_MOON }), {
    split: { creditsPct: 20, equityPct: 50, cashPct: 30 },
  });

  it("is 1000 Voice, and 200 Credits, 500 Earned Equity and $300 cash", () => {
    expect(r?.valueMinorPerMoon).toBe(100000);
    expect(r?.voice).toEqual({ token: "village-voice", amount: 1000 });
    expect(r?.cashMinor).toBe(30000);
    expect(r?.payTokens).toEqual([
      { token: "credits", amount: 200 },
      { token: "earned-equity", amount: 500 },
    ]);
    expect(line(r, "split")?.working).toBe("Credits 20%, Earned Equity 50%, cash 30%");
  });

  it("stores Voice beside the paid tokens", () => {
    expect(rolePriceTokens(r!)).toEqual([
      { token: "village-voice", amount: 1000 },
      { token: "credits", amount: 200 },
      { token: "earned-equity", amount: 500 },
    ]);
  });
});

describe("a stipend role at $1,200 a month", () => {
  const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), {});

  it("is $1,164.13 a moon: the month times 29.53 days over 30.44", () => {
    expect(r?.valueMinorPerMoon).toBe(116413);
    expect(r?.currency).toBe("USD");
    expect(line(r, "moon")).toMatchObject({ working: "$1,200.00 × 29.53 days ÷ 30.44 days", result: "$1,164.13" });
  });

  it("earns its whole value as Voice: 1,164", () => {
    expect(r?.voice).toEqual({ token: "village-voice", amount: 1164 });
    expect(line(r, "token:village-voice")).toMatchObject({ token: "village-voice", working: "$1,164.13 of value × 1 per $1", result: "1164" });
  });

  it("pays half Credits and half Earned Equity with no cash at the default", () => {
    expect(r?.splitBy).toBe("model");
    expect(r?.split).toEqual({ creditsPct: 50, equityPct: 50, cashPct: 0 });
    expect(r?.cashMinor).toBeNull();
    expect(r?.payTokens).toEqual([
      { token: "credits", amount: 582 },
      { token: "earned-equity", amount: 582 },
    ]);
  });

  it("shows every step in order, ready to follow by hand", () => {
    expect(r?.lines.map((l) => l.key)).toEqual([
      "model",
      "source",
      "moon",
      "token:village-voice",
      "split",
      "cash",
      "token:credits",
      "token:earned-equity",
    ]);
    expect(line(r, "model")).toMatchObject({ working: "platform default (no village version yet)", result: "v0" });
    expect(line(r, "source")).toMatchObject({ working: "Stipend, Active", result: "$1,200.00 a month" });
    expect(line(r, "split")).toMatchObject({ working: "Credits 50%, Earned Equity 50%, cash 0% (the model's default)", result: "100%" });
    expect(line(r, "cash")).toMatchObject({ working: "0% of $1,164.13, rounded down to whole dollars", result: "$0.00" });
    expect(line(r, "token:credits")).toMatchObject({ token: "credits", working: "50% of $1,164.13", result: "582" });
    expect(line(r, "token:earned-equity")).toMatchObject({
      token: "earned-equity",
      working: "$1,164.13 − $0.00 cash − 582 Credits, to whole units",
      result: "582",
    });
  });

  it("says which village version priced it once a village has its own", () => {
    const v3: ValuationModel = { ...PLATFORM_DEFAULT_MODEL, version: 3 };
    const priced = priceRoleFromMonthly(v3, pay());
    expect(priced?.modelVersion).toBe(3);
    expect(line(priced, "model")).toMatchObject({ working: "village version 3", result: "v3" });
  });

  it("scales Voice with the model's rate", () => {
    const two: ValuationModel = { ...PLATFORM_DEFAULT_MODEL, voicePerUnit: 2 };
    expect(priceRoleFromMonthly(two, pay())?.voice.amount).toBe(2328);
  });
});

describe("cash comes from the budget, and the tokens take what it leaves", () => {
  it("takes 30% as whole dollars and shares the rest at the default ratio", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), { split: { cashPct: 30 } });
    // 30% of $1,164.13 is $349.24, which rounds to $349; $815.13 is left for the tokens.
    expect(r?.split).toEqual({ creditsPct: 35, equityPct: 35, cashPct: 30 });
    expect(r?.cashMinor).toBe(34900);
    expect(amountOf(r, "credits")).toBe(407);
    expect(amountOf(r, "earned-equity")).toBe(408);
    expect(line(r, "cash")?.working).toBe("30% of $1,164.13, rounded down to whole dollars");
    expect(r?.voice.amount).toBe(1164);
  });

  it("keeps cash a person or a budget already set on the role", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), { cashMinorPerMoon: 20000 });
    expect(r?.cashMinor).toBe(20000);
    expect(line(r, "cash")).toMatchObject({ working: "already set on the role, kept as it is", result: "$200.00" });
    expect(200 + (amountOf(r, "credits") ?? 0) + (amountOf(r, "earned-equity") ?? 0)).toBe(1164);
    expect(line(r, "split")?.working).not.toContain("held to the floors");
  });

  it("holds cash already set above the cap, so the floors still pay in whole tokens", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), { cashMinorPerMoon: 200000 });
    // 10% of $1,164.13 is 116.41, so each floor is 117 whole tokens and cash takes at most $930.
    expect(r?.cashMinor).toBe(93000);
    expect(r?.split).toEqual({ creditsPct: 10, equityPct: 10, cashPct: 80 });
    expect(line(r, "cash")?.working).toBe("set at $2,000.00, held to $930.00 by the floors");
    expect(line(r, "split")?.working).toContain("held to the floors: at least 10% Credits and 10% Earned Equity");
    expect(amountOf(r, "credits")).toBe(117);
    expect(amountOf(r, "earned-equity")).toBe(117);
    expect(line(r, "token:credits")?.working).toBe("10% of $1,164.13, lifted to the floor of 10% rounded up");
  });

  it("never lets rounding carry a payout under a floor, at any value or split", () => {
    // The economy simulation found 71% of payouts at the 80% cash maximum a fraction under a floor
    // when cash rounded to the nearest dollar. Cash now rounds down and the floors round up.
    for (const monthlyUsd of [2.5, 7.77, 27.21, 37.5, 99.99, 400, 1200, 3333.33, THOUSAND_A_MOON]) {
      for (const split of [{ cashPct: 80 }, { cashPct: 79 }, { cashPct: 50 }, { creditsPct: 95, equityPct: 5, cashPct: 0 }, { creditsPct: 0, equityPct: 100, cashPct: 0 }]) {
        const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd }), { split });
        const units = (r?.valueMinorPerMoon ?? 0) / 100;
        const credits = amountOf(r, "credits") ?? 0;
        const equity = amountOf(r, "earned-equity") ?? 0;
        expect(credits).toBeGreaterThanOrEqual(units * 0.1);
        expect(equity).toBeGreaterThanOrEqual(units * 0.1);
        expect((r?.cashMinor ?? 0) / 100 + credits + equity).toBe(Math.round(units));
      }
    }
  });

  it("never pays more than the value at the smallest amounts, where whole tokens round hardest", () => {
    // $0.01, $0.50, $1.00, $1.50 and $2.00 a moon, at the 80% cash maximum and at none.
    for (const monthlyUsd of [0.01, 0.52, 1.03, 1.55, 2.06]) {
      for (const split of [{ cashPct: 80 }, { cashPct: 0 }]) {
        const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd }), { split });
        const units = (r?.valueMinorPerMoon ?? 0) / 100;
        const cash = (r?.cashMinor ?? 0) / 100;
        const credits = amountOf(r, "credits") ?? 0;
        const equity = amountOf(r, "earned-equity") ?? 0;
        for (const part of [cash, credits, equity]) expect(part).toBeGreaterThanOrEqual(0);
        expect(cash + credits + equity).toBe(Math.round(units));
        expect(cash + credits + equity).toBeLessThanOrEqual(Math.ceil(units));
      }
    }
  });

  it.each([0, 10, 30, 50, 80, 100])("cash, Credits and Earned Equity add up to the value at a %s percent cash share", (pct) => {
    for (const monthlyUsd of [0.5, 37.5, 400, 1200, 3333.33, THOUSAND_A_MOON]) {
      const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd }), { split: { cashPct: pct } });
      const total = (r?.cashMinor ?? 0) / 100 + (amountOf(r, "credits") ?? 0) + (amountOf(r, "earned-equity") ?? 0);
      expect(total).toBe(Math.round((r?.valueMinorPerMoon ?? 0) / 100));
    }
  });
});

describe("the floors (Rye, 2026-10-31: at least 10% Credits and 10% Earned Equity)", () => {
  it("caps cash at 80%, and shares what is left at the default ratio", () => {
    expect(holdSplit(PLATFORM_DEFAULT_MODEL, { cashPct: 100 })).toEqual({ creditsPct: 10, equityPct: 10, cashPct: 80 });
  });

  it("lifts a token asked below its floor", () => {
    expect(holdSplit(PLATFORM_DEFAULT_MODEL, { creditsPct: 95, equityPct: 5, cashPct: 0 })).toEqual({ creditsPct: 90, equityPct: 10, cashPct: 0 });
    expect(holdSplit(PLATFORM_DEFAULT_MODEL, { creditsPct: 5, equityPct: 45, cashPct: 50 })).toEqual({ creditsPct: 10, equityPct: 40, cashPct: 50 });
  });

  it("says so on the working when it held a split", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: THOUSAND_A_MOON }), { split: { creditsPct: 0, equityPct: 0, cashPct: 100 } });
    expect(line(r, "split")?.working).toBe(
      "Credits 10%, Earned Equity 10%, cash 80% (held to the floors: at least 10% Credits and 10% Earned Equity)",
    );
    expect(r?.cashMinor).toBe(80000);
  });

  it("always gives whole percents that add to 100, inside every floor", () => {
    for (const c of [0, 5, 10, 33.3, 50, 90, 100]) {
      for (const e of [0, 7, 10, 40, 66.6, 100]) {
        for (const k of [0, 10, 25, 79, 80, 81, 100]) {
          const s = holdSplit(PLATFORM_DEFAULT_MODEL, { creditsPct: c, equityPct: e, cashPct: k });
          expect(s.creditsPct + s.equityPct + s.cashPct).toBe(100);
          expect(s.creditsPct).toBeGreaterThanOrEqual(10);
          expect(s.equityPct).toBeGreaterThanOrEqual(10);
          expect(s.cashPct).toBeLessThanOrEqual(80);
          for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
        }
      }
    }
  });

  it("follows a village's own floors", () => {
    const strict: ValuationModel = { ...PLATFORM_DEFAULT_MODEL, floors: { creditsPct: 25, equityPct: 25 } };
    expect(cashCapPct(strict)).toBe(50);
    expect(holdSplit(strict, { cashPct: 70 })).toEqual({ creditsPct: 25, equityPct: 25, cashPct: 50 });
  });
});

describe("only the paid models split themselves (Rye, 2026-10-31)", () => {
  it.each(["Volunteer", "Reciprocity / In-Kind", "Revenue Share", "Equity / Ownership", "Something new"])(
    "%s shows the figure and its Voice, and leaves the split to a person",
    (model) => {
      const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ model }));
      expect(r?.valueMinorPerMoon).toBe(116413);
      expect(r?.voice.amount).toBe(1164);
      expect(r?.splitBy).toBe("person");
      expect(r?.split).toBeNull();
      expect(r?.cashMinor).toBeNull();
      expect(r?.payTokens).toBeNull();
      expect(rolePriceTokens(r!)).toEqual([{ token: "village-voice", amount: 1164 }]);
      expect(line(r, "split")).toMatchObject({ working: `${model} is not split by the model`, result: "set by a person" });
    },
  );

  it("leaves a figure with no model to a person too", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ model: null }));
    expect(r?.splitBy).toBe("person");
    expect(line(r, "source")?.working).toBe("Active");
  });

  it("reads the four paid models whatever their case, spacing or dashes", () => {
    expect(AUTO_SPLIT_MODELS).toEqual(["Stipend", "Part-Time Salaried", "Full-Time Salaried", "Hybrid"]);
    for (const m of ["stipend", "part time salaried", "FULL-TIME SALARIED", " Hybrid ", "Part–Time  Salaried"]) {
      expect(autoSplits(m)).toBe(true);
    }
    for (const m of ["Revenue Share", "Volunteer", "", null, undefined]) expect(autoSplits(m)).toBe(false);
  });
});

describe("only a settled figure may be written (Rye, 2026-10-31)", () => {
  it("writes the source's Active figure", () => {
    expect(sourcePayWrites(pay())).toBe(true);
  });

  it.each([
    ["pending", pay({ standing: "pending", statusLabel: "Under Review" })],
    ["agreed, not paying yet", pay({ standing: "agreed-not-paying", statusLabel: "Deferred" })],
    ["another status", pay({ standing: "other", statusLabel: "Paused" })],
    ["settled with no figure", pay({ monthlyUsd: null })],
    ["no status", pay({ standing: null, statusLabel: null })],
  ])("never writes %s", (_, sp) => {
    expect(sourcePayWrites(sp)).toBe(false);
  });

  it("never writes nothing", () => {
    expect(sourcePayWrites(null)).toBe(false);
    expect(sourcePayWrites(undefined)).toBe(false);
  });

  it("still prices a pending figure, so it can be shown", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ standing: "pending", statusLabel: "Proposed" }));
    expect(r?.valueMinorPerMoon).toBe(116413);
  });
});

describe("what it refuses to price", () => {
  it("prices nothing when the source sends no figure", () => {
    expect(priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, null)).toBeNull();
    expect(priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: null }))).toBeNull();
  });

  it("prices nothing in a model that is not dollars, because the figure is dollars and nothing converts it", () => {
    expect(priceRoleFromMonthly({ ...PLATFORM_DEFAULT_MODEL, currency: "CRC" }, pay())).toBeNull();
    expect(priceRoleFromMonthly({ ...PLATFORM_DEFAULT_MODEL, currency: " usd " }, pay())?.valueMinorPerMoon).toBe(116413);
  });

  it("prices a $0 figure as $0, with nothing to pay", () => {
    const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: 0 }));
    expect(r?.valueMinorPerMoon).toBe(0);
    expect(r?.payTokens).toEqual([]);
    expect(rolePriceTokens(r!)).toEqual([]);
  });
});
