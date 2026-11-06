/**
 * Setting a figure with the engine: the Treasurer AND the algorithm (Rye,
 * 2026-11-06), the record every set act leaves, how that record feeds back,
 * and the cycle's cash share with the member's choice for any deficit.
 *
 * Rye's answers this file builds (spec §6): C1 inside ±10% the setter's word
 * stands; C3 outside it a written reason and a second, different signer
 * (role.pay or steward.veto), else the village vote after 7 days; C7 cash
 * shared pro rata, the deficit the member's choice, money owed by default; C10
 * the setter may change inputs only with a log, judged against the original
 * suggestion. II.6: nothing here refuses or trims a figure for its size.
 */
import { describe, expect, it } from "vitest";
import type { ValuationModel, WorkInputs } from "./valuation";
import { modelForVillage, suggestValuation, type PayeeSuggestion } from "./valuationEngine";
import {
  CALIBRATION_DEFAULTS,
  calibrate,
  combineSetting,
  cycleCashShare,
  settleDeficit,
  settingRecord,
  storedPayFor,
  widenRange,
  type SettingContext,
  type SettingRecord,
} from "./valuationSetting";

const src = { sentence: "Decree 45303-MTSS, daily rate ÷ 8", date: "2026-10-31" };
const CRC: ValuationModel = {
  ...modelForVillage("CRC"),
  version: 1,
  bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: src }],
};
const ROLE: WorkInputs = { kind: "role", lines: [{ band: "general", payee: "lead", estimatedHours: 20 }], responsibility: "coordinates" };
const first = (): PayeeSuggestion => {
  const s = suggestValuation(CRC, ROLE, { eeMeaningWritten: true });
  if (!s.ok) throw new Error("fixture");
  return s.payees[0];
};
const S = first();
const SET = (pct: number) => Math.round((S.expected.totalMinor * (100 + pct)) / 100);

/** Treasurer 1 sets the Garden Steward role, held by member 9. Member 2 is a second Treasurer, 3 a steward. */
const CTX: SettingContext = { setterId: 1, payeeIds: [9], secondSigners: [2, 3], setterSetPayOf: [] };

describe("the Treasurer and the algorithm (C1, C3)", () => {
  it("lets the Treasurer's word stand inside the band", () => {
    const r = combineSetting(S, { totalMinor: SET(8) }, CTX);
    expect(r).toMatchObject({ inside: true, needs: "none", missing: [] });
  });

  it("asks a written reason and a second, different signer outside the band, above or below", () => {
    for (const pct of [25, -25]) {
      const r = combineSetting(S, { totalMinor: SET(pct) }, CTX);
      expect(r).toMatchObject({ inside: false, needs: "second", missing: ["reason"], signers: [2, 3], voteAfterDays: 7 });
      expect(combineSetting(S, { totalMinor: SET(pct) }, CTX, { reason: "Local going rate differs" }).missing).toEqual([]);
    }
  });

  it("sends it to the village vote when no different signer is eligible", () => {
    const r = combineSetting(S, { totalMinor: SET(40) }, { ...CTX, secondSigners: [1] }, { reason: "Urgency" });
    expect(r).toMatchObject({ needs: "vote", signers: [] });
  });

  it("never refuses a figure for its size, however far above the band (II.6)", () => {
    const r = combineSetting(S, { totalMinor: S.expected.totalMinor * 50 }, CTX, { reason: "Fairness with similar work" });
    expect(r.ok).toBe(true);
    expect(r.needs).toBe("second");
  });

  it("states the gap in money and percent", () => {
    const r = combineSetting(S, { totalMinor: SET(-20) }, CTX);
    expect(r.gapMinor).toBe(SET(-20) - S.expected.totalMinor);
    expect(r.gapPct).toBe(-20);
  });
});

describe("the conflict rule (spec 3.4, QA F6 and G5)", () => {
  it("never lets a setter's word alone set pay on work that pays them, even inside the band", () => {
    const r = combineSetting(S, { totalMinor: S.expected.totalMinor }, { ...CTX, payeeIds: [1] });
    expect(r.inside).toBe(true);
    expect(r.needs).toBe("second");
  });

  it("never counts as a second signer someone the work pays, or whose own pay the setter set this season", () => {
    const r = combineSetting(S, { totalMinor: SET(30) }, { ...CTX, payeeIds: [9, 2], setterSetPayOf: [3] }, { reason: "Urgency" });
    expect(r.signers).toEqual([]);
    expect(r.needs).toBe("vote");
  });
});

describe("the setter changing the inputs (C10)", () => {
  it("is judged against the original suggestion, so doubling the hours and using the new suggestion is outside", () => {
    const doubled = suggestValuation(CRC, { ...ROLE, lines: [{ band: "general", payee: "lead", estimatedHours: 40 }] }, { eeMeaningWritten: true });
    if (!doubled.ok) throw new Error("fixture");
    const r = combineSetting(S, { totalMinor: doubled.payees[0].expected.totalMinor }, CTX, {
      inputChanges: [{ field: "estimatedHours", from: "20", to: "40" }],
    });
    expect(r.inside).toBe(false);
    expect(r.needs).toBe("second");
  });

  it("is always logged, line by line, on the record", () => {
    const changes = [{ field: "estimatedHours", from: "20", to: "40" }];
    const rec = settingRecord({ workKind: "role", workId: 7, category: "role:general", first: S, set: { totalMinor: SET(5) }, ctx: CTX, opts: { inputChanges: changes }, at: "2026-11-06T20:00:00Z" });
    expect(rec.inputChanges).toEqual(changes);
  });
});

describe("the record every set act leaves (spec 3.5)", () => {
  it("carries the frozen suggestion, the figure set, the gap, inside or not, the reason and the setter", () => {
    const rec = settingRecord({
      workKind: "role",
      workId: 7,
      category: "role:general",
      first: S,
      set: { totalMinor: SET(25) },
      ctx: CTX,
      opts: { reason: "Local going rate differs", note: "matches the river crew", ownNumberFirst: SET(30) },
      at: "2026-11-06T20:00:00Z",
    });
    expect(rec).toMatchObject({
      workKind: "role",
      workId: 7,
      suggestedMinor: S.expected.totalMinor,
      bandLowMinor: S.band.lowMinor,
      bandHighMinor: S.band.highMinor,
      setMinor: SET(25),
      gapMinor: SET(25) - S.expected.totalMinor,
      inside: false,
      needs: "second",
      reason: "Local going rate differs",
      setterId: 1,
      conflicted: false,
      ownNumberFirst: SET(30),
      eeHeld: false,
    });
  });
});

describe("calibration widens the range shown, never the centre or the band (spec 3.5, QA G6)", () => {
  const rec = (setter: number, signer: number | null, ratio: number, extra: Partial<SettingRecord> = {}): SettingRecord =>
    ({ category: "role:general", suggestedMinor: 100000, setMinor: Math.round(100000 * ratio), setterId: setter, signerId: signer, conflicted: false, eeHeld: false, ...extra }) as SettingRecord;
  const sixPairs = (ratio: number) => [1, 2, 3, 4, 5, 6].flatMap((s) => [rec(s, null, ratio), rec(s, 99, ratio)]);

  it("flags a category the village sets 20% higher over 12 records from distinct pairs, with a proposal", () => {
    const cal = calibrate(sixPairs(1.2));
    const c = cal.find((x) => x.category === "role:general")!;
    expect(c.pairs).toBeGreaterThanOrEqual(CALIBRATION_DEFAULTS.minPairs);
    expect(c.medianRatio).toBe(1.2);
    expect(c.flag).toMatchObject({ direction: "higher", pct: 20 });
    expect(c.flag?.proposal).toContain("20% higher");
  });

  it("leaves a category alone with too few distinct setter and signer pairs", () => {
    const fewPairs = Array.from({ length: 12 }, (_, i) => rec(i % 2 ? 1 : 2, null, 1.2));
    expect(calibrate(fewPairs).find((x) => x.category === "role:general")?.flag ?? null).toBeNull();
    expect(widenRange(S, calibrate(fewPairs).find((x) => x.category === "role:general"))).toEqual(S.range);
  });

  it("ignores records where the setter or signer was paid by the work, and never pools Earned Equity held with paid", () => {
    const poisoned = [...sixPairs(1.0), rec(7, 8, 3.0, { conflicted: true }), rec(8, 7, 3.0, { conflicted: true })];
    expect(calibrate(poisoned).find((x) => x.category === "role:general")?.highRatio).toBe(1);
    const mixed = [...sixPairs(1.0), ...[1, 2, 3, 4, 5, 6].map((s) => rec(s, 50 + s, 1.9, { eeHeld: true }))];
    const keys = calibrate(mixed).map((c) => c.key);
    expect(keys).toContain("role:general");
    expect(keys).toContain("role:general:ee-held");
  });

  it("widens only the range: the expected figure and the no-sign band never move", () => {
    const c = calibrate(sixPairs(1.6)).find((x) => x.category === "role:general")!;
    const widened = widenRange(S, c);
    expect(widened.highTotalMinor).toBeGreaterThan(S.range.highTotalMinor);
    expect(widened.lowTotalMinor).toBeLessThanOrEqual(S.range.lowTotalMinor);
    expect(widened.why).toContain("the village often sets this kind of work higher");
    // The suggestion object itself is untouched.
    expect(S.expected.totalMinor).toBe(first().expected.totalMinor);
    expect(S.band).toEqual(first().band);
  });

  it("flags a category set lower too (QA F12)", () => {
    expect(calibrate(sixPairs(0.8)).find((x) => x.category === "role:general")?.flag).toMatchObject({ direction: "lower", pct: 20 });
  });
});

describe("the cycle's cash share and the deficit (C7)", () => {
  it("offers no cash with no budget set, so the base is Credits as before (II.7)", () => {
    expect(cycleCashShare(null, 500000)).toBe(0);
  });

  it("shares a short budget pro rata: one share for every work this cycle", () => {
    expect(cycleCashShare(300000, 1000000)).toBe(30);
    expect(cycleCashShare(2000000, 1000000)).toBe(100);
    expect(cycleCashShare(0, 1000000)).toBe(0);
  });

  const base = { baseUnits: 1000, cashMinor: 30000, credits: 800, earnedEquity: 1000 };

  it("holds the deficit as money owed when the member does not answer, changing nothing they are owed", () => {
    const d = settleDeficit(base, 30, undefined);
    expect(d).toEqual({ choice: "owed", deficitUnits: 700, cashNowMinor: 30000, cashOwedLaterMinor: 70000, credits: 100, earnedEquity: 1000 });
  });

  it("pays it in Credits or in Earned Equity when the member chooses", () => {
    expect(settleDeficit(base, 30, "credits")).toMatchObject({ credits: 800, earnedEquity: 1000, cashOwedLaterMinor: 0 });
    expect(settleDeficit(base, 30, "equity")).toMatchObject({ credits: 100, earnedEquity: 1700, cashOwedLaterMinor: 0 });
  });

  it("keeps the total the same whatever the member chooses", () => {
    const total = (d: ReturnType<typeof settleDeficit>) => d.cashNowMinor + d.cashOwedLaterMinor + (d.credits + d.earnedEquity) * 100;
    const t = total(settleDeficit(base, 30, "owed"));
    expect(total(settleDeficit(base, 30, "credits"))).toBe(t);
    expect(total(settleDeficit(base, 30, "equity"))).toBe(t);
  });

  it("has no deficit when the budget covers the base, or when no budget offers cash", () => {
    expect(settleDeficit({ ...base, cashMinor: 100000, credits: 100 }, 100, "equity").deficitUnits).toBe(0);
    expect(settleDeficit({ ...base, cashMinor: null, credits: 1100 }, 0, "equity", { budgetSet: false })).toMatchObject({ deficitUnits: 0, credits: 1100 });
  });
});

describe("a set figure, as the role stores it", () => {
  it("shares the figure by Rye's rule as a whole reward, with Voice for everything paid (II.8, II.9)", () => {
    const p = storedPayFor(CRC, 3000000, { eeHeld: false });
    const tok = (t: string) => p.valueTokens.find((x) => x.token === t)?.amount ?? 0;
    expect(p.valueMinor).toBe(3000000);
    expect(tok(CRC.tokens.voice)).toBe(30000);
    expect(tok(CRC.tokens.equity)).toBe(Math.floor((30000 * 100) / 210));
    expect(p.earnedEquityOwed).toBe(0);
  });

  it("leaves Earned Equity off while its meaning is unwritten, counts it as owed, and pays Voice for what is paid now (C4)", () => {
    const paid = storedPayFor(CRC, 3000000, { eeHeld: false });
    const held = storedPayFor(CRC, 3000000, { eeHeld: true });
    const tok = (p: typeof paid, t: string) => p.valueTokens.find((x) => x.token === t)?.amount ?? 0;
    expect(tok(held, CRC.tokens.equity)).toBe(0);
    expect(held.earnedEquityOwed).toBe(tok(paid, CRC.tokens.equity));
    expect(tok(held, CRC.tokens.voice)).toBe(tok(paid, CRC.tokens.voice) - held.earnedEquityOwed);
    expect(held.valueMinor).toBe(paid.valueMinor);
  });

  it("takes the cycle's cash share out of the base only", () => {
    const p = storedPayFor(CRC, 2100000, { cashPct: 50, eeHeld: false });
    expect(p.cashMinor).toBe(Math.floor(10000 * 0.5) * 100);
  });
});
