import { describe, expect, it } from "vitest";
import { makeRng, toWord } from "./rng";

const take = (seed: number, n: number): number[] => {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("makeRng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(12345, 20)).toEqual(take(12345, 20));
  });

  it("gives a different sequence for a different seed", () => {
    expect(take(12345, 20)).not.toEqual(take(12346, 20));
  });

  it("stays inside [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 2000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("pins the first values for seed 1, so a change of algorithm is visible", () => {
    // Recorded off this implementation, which is mulberry32 verbatim. If this
    // row ever moves, every seeded preview anybody has recorded answers
    // differently from the run they recorded, so the row is the tripwire on
    // that and it fails loudly instead of drifting.
    const got = take(1, 4).map((v) => v.toFixed(12));
    expect(got).toEqual(["0.627073940588", "0.002735721180", "0.527447039960", "0.981050967472"]);
  });

  it("int stays inside [0, n) and answers 0 for a bound of none", () => {
    const rng = makeRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const v = rng.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
    expect(rng.int(Number.NaN)).toBe(0);
  });

  it("int is deterministic for a seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const first = Array.from({ length: 30 }, () => a.int(100));
    const second = Array.from({ length: 30 }, () => b.int(100));
    expect(first).toEqual(second);
  });

  it("reduces every seed to a 32-bit word, so no input is undefined", () => {
    expect(toWord(0)).toBe(0);
    expect(toWord(1.9)).toBe(1);
    expect(toWord(-1)).toBe(4294967295);
    expect(toWord(Number.NaN)).toBe(0);
    expect(toWord(Number.POSITIVE_INFINITY)).toBe(0);
    // A generator made from a fractional seed and one made from its truncation
    // are the same generator, which is what "defined for every input" buys.
    expect(take(1.9, 5)).toEqual(take(1, 5));
  });
});
