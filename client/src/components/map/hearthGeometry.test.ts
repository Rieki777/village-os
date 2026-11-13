import { describe, expect, it } from "vitest";
import { hearthLights, hearthThreads, pairSeed, threadPath, type Disc } from "./hearthGeometry";

const disc = (id: string, x: number, y: number, r = 10): Disc => ({ id, x, y, r });

describe("which circles a mycelial thread joins", () => {
  // Four siblings round the village at twelve, three, six and nine o'clock.
  const four = [disc("n", 0, -100), disc("e", 100, 0), disc("s", 0, 100), disc("w", -100, 0)];

  it("closes a ring of siblings clockwise from twelve", () => {
    const pairs = hearthThreads(four, () => null, []);
    const keys = pairs.map((p) => [p.a, p.b].sort().join("-")).sort();
    expect(keys).toEqual(["e-n", "e-s", "n-w", "s-w"]);
    expect(pairs.every((p) => p.kind === "kin")).toBe(true);
  });

  it("joins two siblings once and a lone circle not at all", () => {
    expect(hearthThreads([disc("a", 0, 0), disc("b", 50, 0)], () => null, [])).toHaveLength(1);
    expect(hearthThreads([disc("a", 0, 0)], () => null, [])).toEqual([]);
  });

  it("keeps circles in different containers apart unless the village declared a link", () => {
    const discs = [disc("a1", 0, 0), disc("b1", 300, 0)];
    const parent = (id: string) => (id === "a1" ? "A" : "B");
    expect(hearthThreads(discs, parent, [])).toEqual([]);
    const declared = hearthThreads(discs, parent, [{ fromKind: "circle", fromId: "b1", toKind: "circle", toId: "a1" }]);
    expect(declared).toEqual([{ a: "b1", b: "a1", kind: "declared" }]);
  });

  it("ignores links to seats, to itself and to circles not drawn", () => {
    const pairs = hearthThreads([disc("a", 0, 0)], () => null, [
      { fromKind: "org_role", fromId: "seat", toKind: "circle", toId: "a" },
      { fromKind: "circle", fromId: "a", toKind: "circle", toId: "a" },
      { fromKind: "circle", fromId: "a", toKind: "circle", toId: "gone" },
    ]);
    expect(pairs).toEqual([]);
  });

  it("lets a declared link win over kinship for the same pair", () => {
    const pairs = hearthThreads([disc("a", 0, 0), disc("b", 50, 0)], () => null, [
      { fromKind: "circle", fromId: "a", toKind: "circle", toId: "b" },
    ]);
    expect(pairs).toEqual([{ a: "a", b: "b", kind: "declared" }]);
  });
});

describe("one thread, edge to edge", () => {
  it("leaves each circle at its edge and is the same thread every time", () => {
    const a = disc("a", 0, 0, 10);
    const b = disc("b", 100, 0, 20);
    const t = threadPath(a, b)!;
    expect(t.main.startsWith("M10 0 Q")).toBe(true);
    expect(t.main.endsWith(" 80 0")).toBe(true);
    expect(t.hyphae).toHaveLength(2);
    expect(threadPath(a, b)).toEqual(t);
    expect(pairSeed("a", "b")).toBe(pairSeed("b", "a"));
  });

  it("draws nothing between circles that overlap", () => {
    expect(threadPath(disc("a", 0, 0, 30), disc("b", 40, 0, 30))).toBeNull();
  });
});

describe("a hearth's fireflies", () => {
  it("sits them on the golden-angle spiral inside the hearth", () => {
    const spots = hearthLights(0, 0, 100, 5);
    expect(spots).toHaveLength(5);
    for (const s of spots) expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(62.0001);
    expect(new Set(spots.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`)).size).toBe(5);
  });

  it("never draws more than eight, and none for nothing", () => {
    expect(hearthLights(0, 0, 100, 40)).toHaveLength(8);
    expect(hearthLights(0, 0, 100, 0)).toEqual([]);
    expect(hearthLights(0, 0, 100, Number.NaN)).toEqual([]);
  });
});
