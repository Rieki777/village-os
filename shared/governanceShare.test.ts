import { describe, expect, it } from "vitest";
import { shareOfTotal, topShares } from "./governanceShare";

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
