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
 * THE CAP ON ONE MEMBER'S SHARE OF THE VOTE (Rye, 2026-11-05). The DB-backed
 * proof that a frozen roll carries it is server/lib/governanceWeights.cap.test.ts;
 * these are the edges of the arithmetic.
 */
describe("capWeights", () => {
  const n = (entries: [string, number][]): Map<string, number> => new Map(entries);
  const total = (m: Map<string, number>): number => Array.from(m.values()).reduce((s, w) => s + w, 0);

  it("brings one holder of 90 among four of 2.5 to exactly 20% of the vote, like everybody else", () => {
    const out = capWeights(n([["big", 90], ["a", 2.5], ["b", 2.5], ["c", 2.5], ["d", 2.5]]), 20);
    for (const id of ["big", "a", "b", "c", "d"]) {
      expect(out.get(id), id).toBe(2.5);
      expect(out.get(id)! * 5, `${id} is a fifth of the frozen total`).toBe(total(out));
    }
  });

  it("holds one large holder among ten to 20% of the vote and leaves the other nine as they were", () => {
    const others: [string, number][] = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((w) => [`m${w}`, w]);
    const out = capWeights(n([["big", 1000], ...others]), 20);
    expect(out.get("big")! / total(out)).toBeLessThanOrEqual(0.2);
    // Same numbers, so the same order and the same proportions between them.
    for (const [id, w] of others) expect(out.get(id), id).toBe(w);
  });

  it("keeps clamping while the redistribution lifts somebody else over the cap", () => {
    // 300 is under 20% of the raw total and over it once 1000 is capped.
    const others: [string, number][] = [10, 20, 30, 40, 50, 60, 70, 80].map((w) => [`m${w}`, w]);
    const out = capWeights(n([["big", 1000], ["second", 300], ...others]), 20);
    expect(out.get("big")).toBe(120);
    expect(out.get("second")).toBe(120);
    expect(out.get("big")! / total(out)).toBe(0.2);
    for (const [id, w] of others) expect(out.get(id), id).toBe(w);
  });

  it("weighs two holders the same at a cap of 20, because neither can stay under it", () => {
    const out = capWeights(n([["big", 100], ["small", 1], ["none", 0]]), 20);
    expect(out.get("big")).toBe(out.get("small"));
    expect(out.get("big")).toBeGreaterThan(0);
    expect(out.get("none")).toBe(0);
  });

  it("weighs everybody the same below five holders at 20, and a lone holder is still the whole vote", () => {
    const four = capWeights(n([["a", 50], ["b", 30], ["c", 15], ["d", 5]]), 20);
    expect(new Set(four.values()).size).toBe(1);
    const lone = capWeights(n([["only", 100], ["none", 0]]), 20);
    expect(lone.get("none")).toBe(0);
    expect(shareOfTotal(lone).get("only")).toBe(1);
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

  it("rounds a capped weight down to the four places a frozen weight is stored at", () => {
    // At 30, three holders of 1 leave 70% of the vote for 3, so 30% is
    // 3 x 30 / 70 = 1.285714..., and the column keeps 1.2857 of it.
    const out = capWeights(n([["big", 1000], ["a", 1], ["b", 1], ["c", 1]]), 30);
    expect(out.get("big")).toBe(1.2857);
    expect(out.get("big")! / total(out)).toBeLessThanOrEqual(0.3);
  });
});
