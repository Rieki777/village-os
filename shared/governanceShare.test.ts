import { describe, expect, it } from "vitest";
import { capWeights, shareOfTotal, topShares } from "./governanceShare";

const m = (entries: [string, bigint | number][]): Map<string, bigint | number> => new Map(entries);

describe("shareOfTotal", () => {
  it("gives each holder their fraction of the sum", () => {
    const out = shareOfTotal(m([["a", 1], ["b", 3]]));
    expect(out.get("a")).toBeCloseTo(0.25, 12);
    expect(out.get("b")).toBeCloseTo(0.75, 12);
  });

  it("answers zero for every holder when the sum is zero, never NaN", () => {
    const out = shareOfTotal(m([["a", 0], ["b", 0]]));
    expect(out.get("a")).toBe(0);
    expect(out.get("b")).toBe(0);
    expect(Number.isNaN(out.get("a"))).toBe(false);
  });

  it("floors a negative weight at zero the way weightsFor does", () => {
    const out = shareOfTotal(m([["a", -5], ["b", 5]]));
    expect(out.get("a")).toBe(0);
    expect(out.get("b")).toBe(1);
  });

  it("reads bigint minor units and doubles the same way", () => {
    const asBig = shareOfTotal(m([["a", BigInt(1000)], ["b", BigInt(3000)]]));
    const asNum = shareOfTotal(m([["a", 1000], ["b", 3000]]));
    expect(asBig.get("a")).toBe(asNum.get("a"));
    expect(asBig.get("b")).toBe(asNum.get("b"));
  });

  it("keeps every holder, including the ones holding nothing", () => {
    const out = shareOfTotal(m([["a", 10], ["b", 0]]));
    expect([...out.keys()].sort()).toEqual(["a", "b"]);
    expect(out.get("b")).toBe(0);
  });

  it("is empty for an empty roll", () => {
    expect(shareOfTotal(new Map()).size).toBe(0);
  });

  it("survives a value that is not a number", () => {
    const out = shareOfTotal(m([["a", Number.NaN], ["b", 4]]));
    expect(out.get("a")).toBe(0);
    expect(out.get("b")).toBe(1);
  });
});

describe("topShares", () => {
  it("returns the biggest holders first", () => {
    const top = topShares(m([["a", 1], ["b", 6], ["c", 3]]), 2);
    expect(top.map((h) => h.id)).toEqual(["b", "c"]);
    expect(top[0].share).toBeCloseTo(0.6, 12);
  });

  it("breaks a tie on the id, so two runs agree", () => {
    const top = topShares(m([["z", 5], ["a", 5]]), 2);
    expect(top.map((h) => h.id)).toEqual(["a", "z"]);
  });

  it("returns everybody when n is larger than the roll", () => {
    expect(topShares(m([["a", 1]]), 9)).toHaveLength(1);
  });

  it("returns nothing for a bound of none", () => {
    expect(topShares(m([["a", 1]]), 0)).toEqual([]);
    expect(topShares(m([["a", 1]]), -2)).toEqual([]);
    expect(topShares(m([["a", 1]]), Number.NaN)).toEqual([]);
  });

  it("answers zero shares on a roll carrying no weight", () => {
    const top = topShares(m([["a", 0], ["b", 0]]), 1);
    expect(top).toHaveLength(1);
    expect(top[0].share).toBe(0);
  });
});

/*
 * THE CAP ON ONE MEMBER'S WEIGHT (Rye, 2026-11-05). The DB-backed proof that
 * a frozen roll carries it is server/lib/governanceWeights.cap.test.ts; these
 * are the edges of the arithmetic, where the few-holders cost is visible.
 */
describe("capWeights", () => {
  const n = (entries: [string, number][]): Map<string, number> => new Map(entries);

  it("clamps each weight to the cap's share of the uncapped total, once", () => {
    const out = capWeights(n([["big", 90], ["a", 2.5], ["b", 2.5], ["c", 2.5], ["d", 2.5]]), 20);
    expect(out.get("big")).toBe(20);
    for (const id of ["a", "b", "c", "d"]) expect(out.get(id)).toBe(2.5);
  });

  it("leaves a lone holder holding the whole of what is left, because nobody else holds any", () => {
    const out = capWeights(n([["only", 100], ["none", 0]]), 20);
    expect(out.get("only")).toBe(20);
    expect(out.get("none")).toBe(0);
    expect(shareOfTotal(out).get("only")).toBe(1);
  });

  it("reads 0 as zero, never as unlimited, and a number it cannot read as 0", () => {
    expect(capWeights(n([["a", 5], ["b", 5]]), 0).get("a")).toBe(0);
    expect(capWeights(n([["a", 5], ["b", 5]]), Number.NaN).get("a")).toBe(0);
  });

  it("changes nothing at 100, and floors a negative weight at zero on the way through", () => {
    const out = capWeights(n([["a", 7], ["b", -3]]), 100);
    expect(out.get("a")).toBe(7);
    expect(out.get("b")).toBe(0);
  });

  it("rounds the ceiling down to the four places a frozen weight is stored at", () => {
    // 20% of 10.00007 is 2.000014, and the column keeps 2.0000 of it.
    expect(capWeights(n([["big", 10], ["dust", 0.00007]]), 20).get("big")).toBe(2);
  });
});
