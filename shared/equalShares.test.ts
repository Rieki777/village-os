import { describe, expect, it } from "vitest";
import {
  countBothWays,
  divergenceOf,
  equalShares,
  greedyByWeight,
  seededOrder,
  type ShareBallot,
} from "./equalShares";

// The worked example of internal research note 03: a pot of 1,000,000 minor
// units, ten members, A holding 40% of counted Voice, B 20%, eight members 5%.
const small = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
const members = ["A", "B", ...small];
const voice = new Map<string, number>([["A", 40], ["B", 20], ...small.map((id): [string, number] => [id, 5])]);
const equal = new Map<string, number>(members.map((id): [string, number] => [id, 1]));
const quests = [
  { id: "X", cost: 400_000 },
  { id: "Y", cost: 300_000 },
  { id: "Z", cost: 300_000 },
  { id: "V", cost: 200_000 },
  { id: "U", cost: 250_000 },
];
const marks: ShareBallot["marks"] = [
  { voter: "A", option: "X" }, { voter: "B", option: "X" },
  { voter: "A", option: "Y" },
  ...small.slice(0, 6).map((v) => ({ voter: v, option: "Z" })),
  ...small.map((v) => ({ voter: v, option: "V" })),
  { voter: "B", option: "U" }, ...small.slice(0, 3).map((v) => ({ voter: v, option: "U" })),
];
const ballot = (weights: Map<string, number>): ShareBallot => ({ pot: 1_000_000, weights, options: quests, marks, seed: "round-1" });

describe("equalShares", () => {
  it("funds what the people back when every member holds the same share", () => {
    const out = equalShares(ballot(equal));
    expect(out.funded.sort()).toEqual(["U", "V", "Z"]);
    expect(out.spent).toBe(750_000);
    expect(out.spent).toBeLessThanOrEqual(1_000_000);
  });

  it("funds what Voice backs, proportionally, when shares follow Voice", () => {
    const out = equalShares(ballot(voice));
    expect(out.funded.sort()).toEqual(["U", "V", "X"]);
    expect(out.spent).toBe(850_000);
  });

  it("never lets one large holder take what only they back once their share is spent", () => {
    // Greedy by weight funds Y on A's weight alone; equal shares does not.
    expect(greedyByWeight(ballot(voice)).funded).toContain("Y");
    expect(equalShares(ballot(voice)).funded).not.toContain("Y");
  });

  it("records the steps in the order they were funded, each with what it cost", () => {
    const out = equalShares(ballot(equal));
    expect(out.steps.map((s) => s.option)).toEqual(out.funded);
    expect(out.steps.reduce((a, s) => a + s.cost, 0)).toBe(out.spent);
    for (const s of out.steps) expect(s.backers).toBeGreaterThan(0);
  });

  it("never spends more than the pot, whatever the completion step finds", () => {
    const tight: ShareBallot = { ...ballot(equal), pot: 450_000 };
    const out = equalShares(tight);
    expect(out.spent).toBeLessThanOrEqual(450_000);
    expect(out.leftover).toBe(450_000 - out.spent);
  });

  it("funds nothing that costs more than the pot", () => {
    const out = equalShares({ pot: 100, weights: equal, options: [{ id: "big", cost: 101 }], marks: [{ voter: "A", option: "big" }], seed: "s" });
    expect(out.funded).toEqual([]);
    expect(out.leftover).toBe(100);
  });

  it("ignores marks from voters with no weight and marks on unknown options", () => {
    const out = equalShares({
      pot: 100,
      weights: new Map([["a", 1], ["z", 0]]),
      options: [{ id: "p", cost: 50 }],
      marks: [{ voter: "z", option: "p" }, { voter: "ghost", option: "p" }, { voter: "a", option: "nope" }],
      seed: "s",
    });
    expect(out.funded).toEqual([]);
  });

  it("answers an empty round with nothing funded and the whole pot left", () => {
    const out = equalShares({ pot: 500, weights: new Map(), options: [], marks: [], seed: "s" });
    expect(out).toMatchObject({ funded: [], spent: 0, leftover: 500 });
  });

  it("breaks an exact tie by the seeded order, the same on every run", () => {
    const tie: ShareBallot = {
      pot: 100,
      weights: new Map([["a", 1], ["b", 1]]),
      options: [{ id: "p", cost: 100 }, { id: "q", cost: 100 }],
      marks: [{ voter: "a", option: "p" }, { voter: "b", option: "p" }, { voter: "a", option: "q" }, { voter: "b", option: "q" }],
      seed: "tie-seed",
    };
    const first = equalShares(tie).funded;
    expect(first).toHaveLength(1);
    expect(equalShares(tie).funded).toEqual(first);
    expect(first[0]).toBe(seededOrder(["p", "q"], "tie-seed")[0]);
  });
});

describe("seededOrder", () => {
  it("is a deterministic permutation of its input", () => {
    const a = seededOrder(["x", "y", "z", "w"], "seed");
    expect(a.slice().sort()).toEqual(["w", "x", "y", "z"]);
    expect(seededOrder(["x", "y", "z", "w"], "seed")).toEqual(a);
  });
});

describe("countBothWays and divergenceOf", () => {
  it("runs the power count on capped Voice and the people count on equal shares", () => {
    const both = countBothWays({ pot: 1_000_000, voice, options: quests, marks, seed: "round-1", capPct: 100 });
    expect(both.power.funded.sort()).toEqual(["U", "V", "X"]);
    expect(both.people.funded.sort()).toEqual(["U", "V", "Z"]);
  });

  it("names each quest only one count funds, with its cost", () => {
    const both = countBothWays({ pot: 1_000_000, voice, options: quests, marks, seed: "round-1", capPct: 100 });
    const d = divergenceOf(both, quests);
    expect(d).toEqual([
      { option: "X", fundedBy: "power", cost: 400_000 },
      { option: "Z", fundedBy: "people", cost: 300_000 },
    ]);
  });

  it("finds no divergence when the two counts agree", () => {
    const agree = countBothWays({ pot: 1_000_000, voice: equal, options: quests, marks, seed: "round-1", capPct: 100 });
    expect(divergenceOf(agree, quests)).toEqual([]);
  });

  it("applies the per-member cap before the power count runs", () => {
    // A capped to 25% cannot change this example (A and B still hold half);
    // the cap is applied, which the weights it reports show.
    const both = countBothWays({ pot: 1_000_000, voice, options: quests, marks, seed: "round-1", capPct: 25 });
    const total = Array.from(both.powerWeights.values()).reduce((a, w) => a + w, 0);
    expect((both.powerWeights.get("A") ?? 0) / total).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(both.power.funded.sort()).toEqual(["U", "V", "X"]);
  });
});
