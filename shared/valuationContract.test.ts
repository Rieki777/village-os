/**
 * P1, THE CONTRACT-PRICE PATH (Rye's pick, 2026-11-06, spec 3.10).
 *
 * Rye: "we're not paying for hours we're paying for contributions (value in)".
 * So a proposer may name a contract price for the deliverable. The engine:
 *   1. shares that price out as a whole reward (`rewardFromTotal`: base, Earned
 *      Equity match, Credits bonus), exactly as a role's source figure (II.9);
 *   2. works the effort-based figure beside it as a REFERENCE, never paid;
 *   3. uses hours for one thing only, the legal-floor check: a contract whose
 *      base is under minimum wage for the estimated effort is a warning with the
 *      figures (II.10), never a refusal;
 *   4. holds the no-sign band around the contract price, since that is the
 *      suggestion being set (C1, C3).
 */
import { describe, expect, it } from "vitest";
import { rewardFromTotal, type ValuationModel, type WorkInputs } from "./valuation";
import { modelForVillage, suggestValuation } from "./valuationEngine";
import { suggestContract } from "./valuationContract";

const src = { sentence: "Decree 45303-MTSS, daily rate ÷ 8", date: "2026-10-31" };
const CRC: ValuationModel = { ...modelForVillage("CRC"), version: 1, bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: src }] };
const EFFORT: WorkInputs = { kind: "quest", lines: [{ band: "general", payee: "lead", estimatedHours: 4, estimateLow: 3, estimateHigh: 6 }] };
const BASE = { priceMinor: 5000000, deliverable: "a goat-proof fence on the north bed", acceptance: "walked by the garden circle", effort: EFFORT };
const ok = (s: ReturnType<typeof suggestContract>) => {
  if (!s.ok) throw new Error(JSON.stringify(s.refusals));
  return s;
};

describe("the contract-price path", () => {
  it("shares the named price as a whole reward, by Rye's rule (II.9)", () => {
    const p = ok(suggestContract(CRC, BASE, { eeMeaningWritten: true })).payees[0];
    const r = rewardFromTotal(CRC, 5000000);
    expect(p.expected.totalMinor).toBe(r.totalMinor);
    expect(p.expected.earnedEquity).toBe(r.equityUnits);
    expect(p.expected.voice).toBe(r.voice.amount);
  });

  it("works the effort-based figure beside it as a reference, never as the figure", () => {
    const p = ok(suggestContract(CRC, BASE, { eeMeaningWritten: true })).payees[0];
    const effort = suggestValuation(CRC, EFFORT, { eeMeaningWritten: true });
    if (!effort.ok) throw new Error("fixture");
    expect(p.contract?.reference).toEqual({
      totalMinor: effort.payees[0].expected.totalMinor,
      lowTotalMinor: effort.payees[0].range.lowTotalMinor,
      highTotalMinor: effort.payees[0].range.highTotalMinor,
    });
    expect(p.expected.totalMinor).not.toBe(effort.payees[0].expected.totalMinor);
  });

  it("holds the no-sign band around the contract price", () => {
    const p = ok(suggestContract(CRC, BASE, { eeMeaningWritten: true })).payees[0];
    expect(p.band).toEqual({ lowMinor: Math.round(p.expected.totalMinor * 0.9), highMinor: Math.round(p.expected.totalMinor * 1.1) });
  });

  it("warns, with the figures, when the contract's base is under minimum wage for the estimated effort, and never refuses it", () => {
    const low = suggestContract(CRC, { ...BASE, priceMinor: 600000 }, { eeMeaningWritten: true });
    const s = ok(low);
    expect(s.payees[0].contract?.belowFloor).toBe(true);
    expect(s.warnings.map((w) => w.text).join(" ")).toMatch(/under the legal minimum for the estimated effort/);
    expect(ok(suggestContract(CRC, BASE, { eeMeaningWritten: true })).payees[0].contract?.belowFloor).toBe(false);
  });

  it("reads as a contract on the receipt, names no hours, and keeps Earned Equity owed while its meaning is unwritten", () => {
    const p = ok(suggestContract(CRC, BASE, { eeMeaningWritten: false })).payees[0];
    const text = [...p.receipt.folded, ...p.receipt.unfolded].map((l) => `${l.label} ${l.result}`).join(" | ");
    expect(text).toContain("Contract price for a goat-proof fence on the north bed");
    expect(text).not.toMatch(/\bhours?\b/i);
    expect(text).not.toContain("1,554");
    expect(p.expected.earnedEquity).toBe(0);
    expect(p.expected.earnedEquityHeld).toBeGreaterThan(0);
  });

  it("refuses, with where to fix it, a contract with no price or no deliverable", () => {
    const a = suggestContract(CRC, { ...BASE, priceMinor: 0 }, { eeMeaningWritten: true });
    const b = suggestContract(CRC, { ...BASE, deliverable: "  " }, { eeMeaningWritten: true });
    for (const s of [a, b]) {
      expect(s.ok).toBe(false);
      if (!s.ok) expect(s.refusals[0].fixAt).toBe("work:inputs");
    }
  });

  it("names no ceiling: any contract price is shared out in full (II.6)", () => {
    const p = ok(suggestContract(CRC, { ...BASE, priceMinor: 9000000000 }, { eeMeaningWritten: true })).payees[0];
    expect(p.expected.totalMinor).toBe(rewardFromTotal(CRC, 9000000000).totalMinor);
  });
});
