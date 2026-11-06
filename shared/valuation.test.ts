/**
 * The valuation model (VALUATION_MODEL_PLAN.md). Each estimated hour is priced
 * at its band's minimum wage; Earned Equity matches that base and Credits add
 * 10% (Rye, 2026-11-01), and the total is the reward a member sees, broken into
 * cash + Credits + Earned Equity, with Voice for everything paid. Work is paid
 * on completion, contract by contract. Every line of the working is held,
 * because the working is what a member reads, and every figure a test names is
 * one a pencil reproduces.
 */
import { describe, expect, it } from "vitest";
import { CREDITS, EARNED_EQUITY, HEARTS, VILLAGE_VOICE } from "../server/lib/economy";
import type { SourcePay } from "./structurePlan";
import {
  AUTO_SPLIT_MODELS,
  autoSplits,
  bandSpread,
  capVoice,
  diffModels,
  doorFor,
  effortPerMoon,
  floorMultiple,
  HARD_MINIMUM_MULTIPLE,
  paidTokens,
  PLATFORM_DEFAULT_MODEL,
  previewImpact,
  priceRoleFromMonthly,
  priceWork,
  rewardFloorMultiple,
  rewardFromBase,
  rewardFromTotal,
  rewardMultiple,
  rolePriceTokens,
  sourcePayWrites,
  validateModel,
  voiceDistribution,
  type ValuationModel,
  type WorkInputs,
  type WorkPrice,
} from "./valuation";

// ── Fixtures ────────────────────────────────────────────────────────────────

const src = (sentence: string) => ({ sentence, date: "2026-10-31" });
const floor = (perHourMinor: number) => ({ perHourMinor, currency: "CRC", source: src("Decree 45303-MTSS, daily rate ÷ 8") });
/** A village's first version: each band at its Costa Rica minimum wage, converted at ₡455 and rounded up to the cent. */
const V1: ValuationModel = {
  ...PLATFORM_DEFAULT_MODEL,
  version: 1,
  bands: [
    { key: "general", label: "General help", hourValueMinor: 342, source: src("Unskilled minimum, ₡1,554.55 at ₡455"), floor: floor(155455) },
    { key: "semi", label: "Semi-skilled", hourValueMinor: 372, source: src("Semi-skilled minimum, ₡1,690.46 at ₡455"), floor: floor(169046) },
    { key: "skilled", label: "Skilled", hourValueMinor: 385, source: src("Skilled minimum, ₡1,748.98 at ₡455"), floor: floor(174898) },
    { key: "lead", label: "Lead", hourValueMinor: 447, source: src("Specialised minimum, ₡2,030.56 at ₡455, until a master builder's quote"), floor: floor(203056) },
  ],
  exchange: { currency: "CRC", perUnit: 455, source: src("BCCR reference rate") },
};
/** Sera's own rates, in colones (the parity check of 2026-10-30). */
const SERA: ValuationModel = {
  ...PLATFORM_DEFAULT_MODEL,
  currency: "CRC",
  bands: [
    { key: "unskilled", label: "Unskilled", hourValueMinor: 155455, source: src("Decree 45303-MTSS, daily rate ÷ 8") },
    { key: "skilled", label: "Skilled", hourValueMinor: 174898, source: src("Decree 45303-MTSS, daily rate ÷ 8") },
  ],
  complexity: [...PLATFORM_DEFAULT_MODEL.complexity, { key: "masonry", label: "Specialised masonry", pct: 20 }],
};

const priced = (model: ValuationModel, work: WorkInputs): WorkPrice => {
  const r = priceWork(model, work);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.price;
};
const refused = (model: ValuationModel, work: WorkInputs): string[] => {
  const r = priceWork(model, work);
  if (r.ok) throw new Error("expected a refusal");
  return r.problems;
};
type Line = { key: string; working: string; result: string; token?: string };
const lineOf = (lines: Line[] | undefined, key: string) => lines?.find((l) => l.key === key);
const amount = (tokens: { token: string; amount: number }[] | null | undefined, token: string) => tokens?.find((t) => t.token === token)?.amount ?? 0;
const paidUnits = (r: { cashMinor: number | null; payTokens: { token: string; amount: number }[] | null }) =>
  (r.cashMinor ?? 0) / 100 + amount(r.payTokens, "credits") + amount(r.payTokens, "earned-equity");

const GARDEN: WorkInputs = {
  kind: "quest",
  lines: [{ band: "general", payee: "each", estimatedHours: 4, estimateLow: 3, estimateHigh: 5 }],
  complexity: "routine",
  benefitPct: 10,
  benefitReason: "food for the shared kitchen",
  peopleExpected: 6,
};
const PIZZA: WorkInputs = {
  kind: "quest",
  lines: [{ band: "lead", payee: "lead", estimatedHours: 40, estimateLow: 30, estimateHigh: 50 }],
  complexity: "hazardous",
  benefitPct: 15,
  benefitReason: "a shared oven for gatherings",
  materials: [{ label: "Firebrick and mortar", amountMinor: 90000, source: "estimate" }],
  cashPct: 30,
};
const RIVER: WorkInputs = {
  kind: "quest",
  lines: [{ band: "general", payee: "each", estimatedHours: 3, estimateLow: 2, estimateHigh: 4 }],
  complexity: "conditions",
  benefitPct: 25,
  benefitReason: "the watershed and the neighbours downstream",
  materials: [{ label: "Gloves, bags, grabbers", amountMinor: 6000 }],
  peopleExpected: 8,
};
const GARDEN_ROLE: WorkInputs = {
  kind: "role",
  lines: [{ band: "skilled", payee: "lead", estimatedHours: effortPerMoon(4) }],
  responsibility: "coordinates",
};

// ── The platform default ────────────────────────────────────────────────────

describe("the platform default model", () => {
  it("names the server's own Credits, Earned Equity and Voice slugs, and never Gratitude", () => {
    expect(PLATFORM_DEFAULT_MODEL.tokens).toEqual({ credits: CREDITS, equity: EARNED_EQUITY, voice: VILLAGE_VOICE });
    expect(Object.values(PLATFORM_DEFAULT_MODEL.tokens)).not.toContain(HEARTS);
  });

  it("doubles the base with Earned Equity and adds 10% Credits, with no cash until a budget sets some (Rye, 2026-11-01)", () => {
    expect(PLATFORM_DEFAULT_MODEL.reward).toEqual({ equityMatchPct: 100, creditsBonusPct: 10, defaultCashPct: 0 });
    expect(rewardMultiple(PLATFORM_DEFAULT_MODEL)).toBe(2.1);
  });

  it("ships no rates, a benefit swing of ±25%, no Voice cap, and a $5 minimum quest reward", () => {
    expect(PLATFORM_DEFAULT_MODEL.bands).toEqual([]);
    expect(PLATFORM_DEFAULT_MODEL.benefit.maxPct).toBe(25);
    expect(PLATFORM_DEFAULT_MODEL.voiceCapPerMemberPerMoon).toBeNull();
    expect(PLATFORM_DEFAULT_MODEL.minQuestMinor).toBe(500);
    expect(HARD_MINIMUM_MULTIPLE).toBe(1.35);
    expect(validateModel(PLATFORM_DEFAULT_MODEL)).toEqual([]);
    expect(refused(PLATFORM_DEFAULT_MODEL, GARDEN)).toContain('The model has no band "general". Set your rates first.');
  });
});

// ── Quests and roles from effort lines ──────────────────────────────────────

describe("the garden working party", () => {
  const p = priced(V1, GARDEN);
  const each = p.payees[0];

  it("prices each person at $15.05: 4 estimated hours at the $3.42 minimum wage, plus 10% for the village", () => {
    expect(p.payees.map((x) => x.payee)).toEqual(["each"]);
    expect(each.priceMinor).toBe(1505);
    expect(each.rangeMinor).toEqual({ low: 1129, high: 1881 });
    expect(lineOf(each.lines, "labour:general")).toMatchObject({ working: "4 estimated hours × $3.42 minimum wage", result: "$13.68" });
    expect(lineOf(each.lines, "complexity")).toMatchObject({ working: "Routine, 0% of $13.68", result: "+$0.00" });
    expect(lineOf(each.lines, "benefit")).toMatchObject({ working: "10% of $13.68: food for the shared kitchen", result: "+$1.37" });
    expect(lineOf(each.lines, "base")).toMatchObject({ working: "for each person who joins, on completion", result: "$15.05" });
    expect(lineOf(each.lines, "range")?.result).toBe("$11.29 to $18.81");
  });

  it("rewards $31: 16 Credits (15 base, 1 bonus) and 15 Earned Equity matching the base, and 31 Voice", () => {
    expect(lineOf(each.lines, "match")).toMatchObject({ working: "100% of $15.05, rounded down", result: "15" });
    expect(lineOf(each.lines, "bonus")).toMatchObject({ working: "10% of $15.05, rounded down", result: "1" });
    expect(each.cashMinor).toBeNull();
    expect(amount(each.payTokens, "credits")).toBe(16);
    expect(amount(each.payTokens, "earned-equity")).toBe(15);
    expect(lineOf(each.lines, "token:credits")).toMatchObject({ working: "15 base − 0 cash + 1 bonus", result: "16" });
    expect(lineOf(each.lines, "total")).toMatchObject({ working: "$0.00 cash + 16 Credits + 15 Earned Equity", result: "$31.00" });
    expect(each.totalMinor).toBe(3100);
    expect(each.voice.amount).toBe(31);
  });

  it("costs the village six people's rewards", () => {
    expect(each.paidCount).toBe(6);
    expect(p.costMinor).toBe(6 * 3100);
    expect(p.cashNeededMinor).toBe(0);
  });
});

describe("leading the pizza oven build", () => {
  const p = priced(V1, PIZZA);
  const lead = p.payees[0];

  it("prices the lead's base at $250.32: 40 estimated hours at $4.47, plus 25% hazard and 15% for the village", () => {
    expect(lead.payee).toBe("lead");
    expect([lead.labourMinor, lead.complexityMinor, lead.benefitMinor, lead.priceMinor]).toEqual([17880, 4470, 2682, 25032]);
    expect(lead.rangeMinor).toEqual({ low: 18775, high: 31291 });
  });

  it("at 30% cash rewards $525: $75 cash, 200 Credits and 250 Earned Equity, and 525 Voice", () => {
    expect(lead.cashMinor).toBe(7500);
    expect(amount(lead.payTokens, "credits")).toBe(200);
    expect(amount(lead.payTokens, "earned-equity")).toBe(250);
    expect(lead.totalMinor).toBe(52500);
    expect(paidTokens(lead)).toEqual([
      { token: "village-voice", amount: 525 },
      { token: "credits", amount: 200 },
      { token: "earned-equity", amount: 250 },
    ]);
  });

  it("adds the bricks to what the village spends and the cash it needs, never to anyone's reward", () => {
    expect(p.materialsMinor).toBe(90000);
    expect(p.costMinor).toBe(52500 + 90000);
    expect(p.cashNeededMinor).toBe(7500 + 90000);
    expect(lineOf(p.lines, "material:0")).toMatchObject({ working: "budget, never pay · estimate", result: "$900.00" });
    expect(lineOf(p.lines, "cost")).toMatchObject({ working: "$525.00 + $900.00", result: "$1,425.00" });
  });
});

describe("the river clean-up", () => {
  const p = priced(V1, RIVER);

  it("prices each of eight at $13.86 and rewards each $27", () => {
    expect(p.payees[0].priceMinor).toBe(1386);
    expect(p.payees[0].rangeMinor).toEqual({ low: 923, high: 1847 });
    expect(p.payees[0].totalMinor).toBe(2700);
    expect(p.costMinor).toBe(8 * 2700 + 6000);
    expect(lineOf(p.lines, "cost")?.working).toBe("8 × $27.00 + $60.00");
  });

  it("refuses a benefit outside the village's swing", () => {
    expect(refused({ ...V1, benefit: { maxPct: 15 } }, RIVER)).toContain(
      "Village benefit is held to ±15% of labour. A wider swing needs a finance or steward role to change the model.",
    );
  });
});

describe("a garden care role estimated at 4 hours a week", () => {
  it("is a $71.45 base a moon by pencil, and a 149 reward", () => {
    expect(effortPerMoon(4)).toBe(16.87);
    const r = priced(V1, GARDEN_ROLE).payees[0];
    expect(lineOf(r.lines, "labour:skilled")).toMatchObject({ working: "16.87 estimated hours × $3.85 minimum wage", result: "$64.95" });
    expect(lineOf(r.lines, "responsibility")).toMatchObject({ working: "Holds a budget or coordinates others, 10% of $64.95", result: "+$6.50" });
    expect(r.priceMinor).toBe(7145);
    expect([amount(r.payTokens, "credits"), amount(r.payTokens, "earned-equity"), r.voice.amount]).toEqual([78, 71, 149]);
    expect(r.belowMinimum).toBe(false);
  });
});

describe("Sera's three examples in colones (the parity check of 2026-10-30)", () => {
  const sera = (work: WorkInputs) => {
    const p = priced(SERA, work);
    return Math.round((p.payees.reduce((s, x) => s + x.priceMinor * x.paidCount, 0) + p.materialsMinor) / 100);
  };

  it("matches the garden exactly on the base: ₡16,090", () => {
    expect(sera({ kind: "quest", lines: [{ band: "unskilled", payee: "crew", people: 3, estimatedHours: 3 }], benefitPct: 15, benefitReason: "food, a shared meal" })).toBe(16090);
  });

  it("gives ₡42,977 for the river and ₡151,356 for the pizza: Sera's figure less benefit on materials", () => {
    expect(
      sera({
        kind: "quest",
        lines: [{ band: "unskilled", payee: "crew", people: 6, estimatedHours: 3 }],
        benefitPct: 25,
        benefitReason: "ecological and health",
        materials: [{ label: "Gloves, bags", amountMinor: 800000 }],
      }),
    ).toBe(42977);
    const pizza: WorkInputs = {
      kind: "quest",
      lines: [
        { band: "skilled", payee: "lead", estimatedHours: 16 },
        { band: "unskilled", payee: "crew", people: 2, estimatedHours: 8 },
      ],
      complexity: "masonry",
      benefitPct: 15,
      benefitReason: "a permanent shared asset",
      materials: [{ label: "Clay, sand, firebrick", amountMinor: 8000000 }],
    };
    expect(priced(SERA, pizza).payees.map((x) => [x.payee, x.priceMinor])).toEqual([
      ["lead", 3777797],
      ["crew", 3357828],
    ]);
    expect(sera(pizza)).toBe(151356);
  });
});

describe("what priceWork refuses, with every reason", () => {
  it("names each problem at once", () => {
    const problems = refused(
      { ...V1, bands: [...V1.bands, { key: "unset", label: "Unset", hourValueMinor: 0, source: null }] },
      {
        kind: "quest",
        lines: [
          { band: "nope", payee: "each", estimatedHours: 2 },
          { band: "unset", payee: "each", estimatedHours: 2 },
          { band: "lead", payee: "lead", people: 2, estimatedHours: 3 },
          { band: "general", payee: "each", estimatedHours: 4, estimateLow: 5 },
        ],
        complexity: "volcanic",
        benefitPct: 5,
        materials: [{ label: "Rope", amountMinor: -100 }],
      },
    );
    expect(problems).toEqual([
      'The model has no complexity level "volcanic".',
      "Give a one-line reason for the village benefit.",
      'The model has no band "nope". Set your rates first.',
      'The band "Unset" has no value yet. Set your rates first.',
      "Line 3 pays the lead, which is one person.",
      "Line 4's estimates must run low, then expected, then high.",
      'The material "Rope" needs an amount of zero or more.',
    ]);
  });

  it("refuses work with no effort lines", () => {
    expect(refused(V1, { kind: "quest", lines: [] })).toEqual(["Add at least one effort line."]);
  });
});

describe("the minimum quest reward, and the benefit approval", () => {
  it("warns when a quest rewards a payee under $5, and never for a role", () => {
    const tiny = priced(V1, { kind: "quest", lines: [{ band: "general", payee: "each", estimatedHours: 0.5 }] });
    expect(tiny.payees[0].belowMinimum).toBe(true);
    expect(tiny.warnings).toEqual(["The reward for each person who joins is under the model's minimum quest value of $5.00."]);
    expect(priced(V1, { kind: "role", lines: [{ band: "general", payee: "lead", estimatedHours: 0.5 }] }).warnings).toEqual([]);
  });

  it("flags any work that carries a village benefit for a finance or steward role's approval (Rye, 2026-10-31)", () => {
    expect(priced(V1, GARDEN).benefitNeedsApproval).toBe(true);
    expect(priced(V1, GARDEN_ROLE).benefitNeedsApproval).toBe(false);
  });
});

describe("the working adds up by pencil", () => {
  it("holds for every line, band and level across a grid", () => {
    for (const hours of [0.33, 1, 2.5, 4.74, 16.87, 40]) {
      for (const band of ["general", "semi", "skilled", "lead"]) {
        for (const complexity of ["routine", "conditions", "hazardous"]) {
          for (const benefitPct of [-25, -10, 0, 7, 15, 25]) {
            for (const cashPct of [0, 30, 100]) {
              const p = priced(V1, { kind: "quest", lines: [{ band, payee: "lead", estimatedHours: hours }], complexity, benefitPct, benefitReason: "a reason", cashPct });
              const r = p.payees[0];
              const value = V1.bands.find((b) => b.key === band)!.hourValueMinor;
              expect(r.labourMinor).toBe(Math.round(hours * value));
              expect(r.priceMinor).toBe(r.labourMinor + r.complexityMinor + r.responsibilityMinor + r.benefitMinor);
              const base = r.priceMinor / 100;
              expect(r.equityUnits).toBe(Math.floor(base + 1e-9));
              expect(r.bonusUnits).toBe(Math.floor(base * 0.1 + 1e-9));
              expect(paidUnits(r)).toBe(r.totalMinor / 100);
              expect(r.totalMinor / 100).toBe(r.baseUnits + r.equityUnits + r.bonusUnits);
              expect(r.voice.amount).toBe(Math.floor(r.totalMinor / 100));
            }
          }
        }
      }
    }
  });

  it("keeps the total near 2.1x the base, and never above it", () => {
    for (const minor of [500, 1505, 7145, 25032, 116413]) {
      const r = rewardFromBase(V1, minor);
      expect(r.totalMinor / 100).toBeLessThanOrEqual((minor / 100) * 2.1);
      expect(r.totalMinor / 100).toBeGreaterThan((minor / 100) * 2.1 - 3);
    }
  });
});

describe("splitting a job never pays more than the whole job (the economics session's check)", () => {
  it("holds for Voice and for what is paid, down to the smallest pieces", () => {
    const job = (hours: number): WorkInputs => ({
      kind: "quest",
      lines: [{ band: "general", payee: "lead", estimatedHours: hours }],
      complexity: "conditions",
      benefitPct: 15,
      benefitReason: "a reason",
      cashPct: 80,
    });
    const whole = priced(V1, job(6)).payees[0];
    for (const [pieces, size] of [[6, 1], [4, 1.5], [8, 0.75], [12, 0.5], [18, 0.33], [60, 0.1]] as const) {
      const one = priced(V1, job(size)).payees[0];
      expect(pieces * one.voice.amount).toBeLessThanOrEqual(whole.voice.amount);
      expect(pieces * paidUnits(one)).toBeLessThanOrEqual(paidUnits(whole));
    }
  });
});

// ── The reward on its own ───────────────────────────────────────────────────

describe("the reward", () => {
  it("pays the base in cash up to the budget's share, the rest in Credits, and never cash for the match or bonus", () => {
    const all = rewardFromBase(PLATFORM_DEFAULT_MODEL, 10000, { cashPct: 100 });
    expect([all.cashMinor, amount(all.payTokens, "credits"), amount(all.payTokens, "earned-equity")]).toEqual([10000, 10, 100]);
    expect(rewardFromBase(PLATFORM_DEFAULT_MODEL, 10000, { cashPct: 140 }).cashMinor).toBe(10000);
    expect(rewardFromBase(PLATFORM_DEFAULT_MODEL, 10000, { cashPct: -5 }).cashMinor).toBeNull();
  });

  it("keeps cash already set, with cents, up to the base, and never pays over 2.1x", () => {
    const kept = rewardFromBase(PLATFORM_DEFAULT_MODEL, 116413, { fixedCashMinor: 20050 });
    expect(kept.cashMinor).toBe(20050);
    expect(kept.totalMinor).toBeLessThanOrEqual(Math.floor(1164.13 * 2.1) * 100);
    const capped = rewardFromBase(PLATFORM_DEFAULT_MODEL, 116413, { fixedCashMinor: 500000 });
    expect(capped.cashMinor).toBe(116400);
    expect(lineOf(capped.lines, "cash")?.working).toBe("set at $5,000.00, held to the base price");
  });

  it("follows a village's own match and bonus", () => {
    const generous: ValuationModel = { ...PLATFORM_DEFAULT_MODEL, reward: { equityMatchPct: 150, creditsBonusPct: 0, defaultCashPct: 0 } };
    expect(rewardMultiple(generous)).toBe(2.5);
    const r = rewardFromBase(generous, 10000);
    expect([amount(r.payTokens, "credits"), amount(r.payTokens, "earned-equity"), r.voice.amount]).toEqual([100, 150, 250]);
  });

  it("shares a given total into the base, the match and the bonus, adding up to it exactly", () => {
    for (const minor of [100, 1000, 2100, 100000, 116413, 333333]) {
      const r = rewardFromTotal(PLATFORM_DEFAULT_MODEL, minor, { cashPct: 30 });
      expect(r.totalMinor).toBe(Math.floor(minor / 100) * 100);
      expect(r.baseUnits + r.equityUnits + r.bonusUnits).toBe(Math.floor(minor / 100));
    }
  });
});

// ── A role from the source's monthly figure ─────────────────────────────────

const pay = (over: Partial<SourcePay> = {}): SourcePay => ({
  model: "Stipend",
  standing: "settled",
  statusLabel: "Active",
  terms: null,
  monthlyUsd: 1200,
  ...over,
});
/** $1,030.82 a month is exactly $1,000.00 a moon. */
const THOUSAND_A_MOON = 1030.82;

describe("a stipend role at $1,200 a month, the source's figure for the whole arrangement", () => {
  const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay());

  it("is a $1,164.13 total reward a moon, and 1,164 Voice", () => {
    expect(r?.valueMinorPerMoon).toBe(116413);
    expect(lineOf(r?.lines, "moon")).toMatchObject({ working: "$1,200.00 × 29.53 days ÷ 30.44 days", result: "$1,164.13" });
    expect(r?.voice).toEqual({ token: "village-voice", amount: 1164 });
  });

  it("shares it as a 555 base, 554 Earned Equity and a 55 Credits bonus, with no cash", () => {
    expect(lineOf(r?.lines, "shares")).toMatchObject({ working: "1164 as base 100, Earned Equity 100 and Credits bonus 10, out of 210", result: "555 + 554 + 55" });
    expect(r?.splitBy).toBe("model");
    expect(r?.cashMinor).toBeNull();
    expect(r?.payTokens).toEqual([
      { token: "credits", amount: 610 },
      { token: "earned-equity", amount: 554 },
    ]);
    expect(r?.lines.map((l) => l.key)).toEqual(["model", "source", "moon", "shares", "cash", "token:credits", "token:earned-equity", "total", "token:village-voice"]);
    expect(rolePriceTokens(r!)).toEqual([
      { token: "village-voice", amount: 1164 },
      { token: "credits", amount: 610 },
      { token: "earned-equity", amount: 554 },
    ]);
  });

  it("takes cash from a budget out of the base only", () => {
    const b = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: THOUSAND_A_MOON }), { cashPct: 30 });
    expect(b?.valueMinorPerMoon).toBe(100000);
    expect(b?.cashMinor).toBe(14300);
    expect(b?.payTokens).toEqual([
      { token: "credits", amount: 381 },
      { token: "earned-equity", amount: 476 },
    ]);
  });

  it("keeps cash already set on the role, held to the base", () => {
    expect(priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), { cashMinorPerMoon: 20000 })?.cashMinor).toBe(20000);
    const capped = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay(), { cashMinorPerMoon: 200000 });
    expect(capped?.cashMinor).toBe(55500);
    expect(lineOf(capped?.lines, "cash")?.working).toBe("set at $2,000.00, held to the base price");
  });
});

describe("only the paid models split themselves, and only a settled figure writes (Rye, 2026-10-31)", () => {
  it.each(["Volunteer", "Reciprocity / In-Kind", "Revenue Share", "Equity / Ownership", "Something new"])(
    "%s shows the figure and its Voice, and leaves the breakdown to a person",
    (model) => {
      const r = priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ model }));
      expect(r?.voice.amount).toBe(1164);
      expect([r?.splitBy, r?.cashMinor, r?.payTokens]).toEqual(["person", null, null]);
      expect(rolePriceTokens(r!)).toEqual([{ token: "village-voice", amount: 1164 }]);
      expect(r?.lines.map((l) => l.key)).toEqual(["model", "source", "moon", "token:village-voice", "split"]);
      expect(lineOf(r?.lines, "split")).toMatchObject({ working: `${model} is not split by the model`, result: "set by a person" });
    },
  );

  it("reads the four paid models whatever their case, spacing or dashes", () => {
    expect(AUTO_SPLIT_MODELS).toEqual(["Stipend", "Part-Time Salaried", "Full-Time Salaried", "Hybrid"]);
    for (const m of ["stipend", "part time salaried", "FULL-TIME SALARIED", " Hybrid ", "Part–Time  Salaried"]) expect(autoSplits(m)).toBe(true);
    for (const m of ["Revenue Share", "Volunteer", "", null, undefined]) expect(autoSplits(m)).toBe(false);
  });

  it.each([
    ["pending", pay({ standing: "pending", statusLabel: "Under Review" })],
    ["agreed, not paying yet", pay({ standing: "agreed-not-paying", statusLabel: "Deferred" })],
    ["another status", pay({ standing: "other", statusLabel: "Paused" })],
    ["settled with no figure", pay({ monthlyUsd: null })],
  ])("never writes %s, and writes the settled figure", (_, sp) => {
    expect(sourcePayWrites(sp)).toBe(false);
    expect(sourcePayWrites(pay())).toBe(true);
    expect(sourcePayWrites(null)).toBe(false);
  });

  it("prices nothing with no figure, or in a model that is not dollars", () => {
    expect(priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, null)).toBeNull();
    expect(priceRoleFromMonthly(PLATFORM_DEFAULT_MODEL, pay({ monthlyUsd: null }))).toBeNull();
    expect(priceRoleFromMonthly({ ...PLATFORM_DEFAULT_MODEL, currency: "CRC" }, pay())).toBeNull();
  });
});

// ── The model as a whole ────────────────────────────────────────────────────

describe("the minimum wage multiples, for the model's own page", () => {
  const band = (k: string) => V1.bands.find((b) => b.key === k)!;

  it("puts each band's base at 1x its legal floor and the total reward at 2.1x", () => {
    expect(floorMultiple(V1, band("general"))).toBe(1);
    expect(floorMultiple(V1, band("skilled"))).toBe(1);
    expect(rewardFloorMultiple(V1, band("general"))).toBe(2.1);
    expect(floorMultiple({ ...V1, exchange: null }, band("general"))).toBeNull();
    expect(bandSpread(V1)).toBe(1.31);
  });

  it("refuses a base under the floor, and a total under 1.35x it", () => {
    const under = { ...V1, bands: V1.bands.map((b) => (b.key === "general" ? { ...b, hourValueMinor: 300 } : b)) };
    expect(validateModel(under)).toEqual(['The band "General help" is valued under its legal floor.']);
    const thin = { ...V1, reward: { equityMatchPct: 0, creditsBonusPct: 10, defaultCashPct: 0 } };
    expect(validateModel(thin)).toEqual(V1.bands.map((b) => `The band "${b.label}" rewards under 1.35x its legal floor in total.`));
  });
});

describe("what a model may not be saved with", () => {
  it("names every reason", () => {
    const bad: ValuationModel = {
      ...V1,
      currency: "usd",
      voicePerUnit: 0,
      reward: { equityMatchPct: 400, creditsBonusPct: 10, defaultCashPct: 0 },
      bands: [...V1.bands, { key: "general", label: "Twin", hourValueMinor: 500, source: null }],
      complexity: [{ key: "x", label: "Volcanic", pct: 40 }],
      benefit: { maxPct: 30 },
      voiceCapPerMemberPerMoon: 0,
    };
    expect(validateModel(bad)).toEqual([
      "The currency must be a three-letter code.",
      "Voice per unit must be more than zero.",
      "The Earned Equity match must be between 0% and 300% of the base.",
      'Two bands share the key "general".',
      'The band "Twin" needs a source sentence and a date.',
      'The complexity level "Volcanic" must be between 0% and 30%.',
      "The village benefit range must be between 0% and 25%.",
      "A Voice cap must be more than zero, or off.",
    ]);
    expect(validateModel(V1)).toEqual([]);
  });
});

describe("what a change needs (plan 3.1)", () => {
  const v2: ValuationModel = {
    ...V1,
    version: 2,
    bands: V1.bands.map((b) => (b.key === "skilled" ? { ...b, hourValueMinor: 440, source: src("A new local quote") } : b.key === "general" ? { ...b, hourValueMinor: 360 } : b)),
  };

  it("lets a version move a value up to 10%, and sends a bigger move or a new spread to a proposal", () => {
    const changes = diffModels(V1, v2);
    const door = (key: string) => changes.find((c) => c.key === key)?.door;
    expect(door("band:general")).toBe("version");
    expect(door("band:skilled")).toBe("proposal");
    expect(door("source:skilled")).toBe("version");
    expect(door("spread")).toBe("proposal");
    expect(changes.find((c) => c.key === "band:skilled")).toMatchObject({ from: "$3.85 per estimated hour", to: "$4.40 per estimated hour" });
    expect(doorFor(changes)).toBe("proposal");
  });

  it("sends the currency, the Voice rate and the Voice cap to the founder ring, and the benefit swing to a finance or steward role", () => {
    expect(doorFor(diffModels(V1, { ...V1, voicePerUnit: 2 }))).toBe("founder");
    expect(doorFor(diffModels(V1, { ...V1, currency: "CRC" }))).toBe("founder");
    expect(doorFor(diffModels(V1, { ...V1, voiceCapPerMemberPerMoon: 500 }))).toBe("founder");
    expect(diffModels(V1, { ...V1, benefit: { maxPct: 20 } })).toEqual([{ key: "benefit", label: "Village benefit range", from: "±25%", to: "±20%", door: "steward" }]);
    expect(diffModels(V1, V1)).toEqual([]);
  });

  it("lets a version tweak the reward settings (Rye, 2026-10-31: settings in the valuation pages)", () => {
    const changes = diffModels(V1, { ...V1, reward: { equityMatchPct: 150, creditsBonusPct: 10, defaultCashPct: 0 } });
    expect(changes).toEqual([{ key: "equityMatch", label: "Earned Equity match", from: "100%", to: "150%", door: "version" }]);
  });

  it("previews who gains and who loses, and the change in total reward", () => {
    const preview = previewImpact(V1, v2, [
      { label: "Garden care role", inputs: GARDEN_ROLE },
      { label: "River clean-up", inputs: RIVER },
    ]);
    expect(preview.rows).toEqual([
      { work: "Garden care role", payee: "lead", beforeMinor: 14900, afterMinor: 17000 },
      { work: "River clean-up", payee: "each", beforeMinor: 2700, afterMinor: 2900 },
    ]);
    expect(preview.costAfterMinor - preview.costBeforeMinor).toBe(17000 - 14900 + 8 * (2900 - 2700));
  });
});

describe("Voice: the cap per member per moon (ships off) and the distribution the governance graphic reads", () => {
  it("changes nothing while off, and stops at the cap once a village turns it on", () => {
    expect(capVoice(PLATFORM_DEFAULT_MODEL, 5000, 672)).toBe(672);
    const capped: ValuationModel = { ...PLATFORM_DEFAULT_MODEL, voiceCapPerMemberPerMoon: 1000 };
    expect(capVoice(capped, 0, 672)).toBe(672);
    expect(capVoice(capped, 600, 672)).toBe(400);
    expect(capVoice(capped, 1200, 672)).toBe(0);
  });

  it("gives the top-3 share, the top-tenth share and the Gini", () => {
    expect(voiceDistribution([10, 10, 10, 10])).toEqual({ members: 4, total: 40, top3Share: 0.75, topTenthShare: 0.25, gini: 0 });
    expect(voiceDistribution([100, 0, 0, 0])).toEqual({ members: 4, total: 100, top3Share: 1, topTenthShare: 1, gini: 0.75 });
    expect(voiceDistribution([])).toEqual({ members: 0, total: 0, top3Share: 0, topTenthShare: 0, gini: 0 });
    expect(voiceDistribution([-5, 0, 20]).total).toBe(20);
  });
});
