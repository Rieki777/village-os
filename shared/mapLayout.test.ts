/**
 * Determinism tests for the map layout (S20): same data in, identical pixels
 * out, forever. A member's spatial memory of the village is part of the UI
 * contract, so the layout must be a pure function — these tests are what
 * keeps someone from "improving" it with jitter or render-order dependence.
 */
import { describe, expect, it } from "vitest";
import { layoutMap, layoutNestedMap, layoutForShape, radiusForLabel, wrapLabel, CANVAS, QUEST_DISPLAY_CAP, type LayoutCircle, type NestedInput } from "./mapLayout";

const circle = (id: string, order: number, extra: Partial<LayoutCircle> = {}): LayoutCircle => ({
  id,
  order,
  memberCount: 3,
  roles: [
    { id: `${id}-lead`, vacant: false },
    { id: `${id}-scribe`, vacant: true },
  ],
  questCount: 2,
  ...extra,
});

describe("layoutMap", () => {
  it("is deterministic: identical input, identical output", () => {
    const data = [circle("a", 1), circle("b", 2), circle("c", 3)];
    expect(layoutMap(data)).toEqual(layoutMap(data));
  });

  it("ignores input array order — only sortOrder places a circle", () => {
    const forward = layoutMap([circle("a", 1), circle("b", 2)]);
    const reversed = layoutMap([circle("b", 2), circle("a", 1)]);
    expect(forward).toEqual(reversed);
  });

  it("puts the first circle at twelve o'clock", () => {
    const l = layoutMap([circle("a", 1), circle("b", 2), circle("c", 3), circle("d", 4)]);
    const a = l.circles.find((c) => c.id === "a")!;
    expect(a.x).toBeCloseTo(CANVAS / 2, 6);
    expect(a.y).toBeLessThan(CANVAS / 2); // above center
  });

  it("scales circle radius with membership, logarithmically", () => {
    const small = layoutMap([circle("a", 1, { memberCount: 1 })]).circles[0].r;
    const big = layoutMap([circle("a", 1, { memberCount: 100 })]).circles[0].r;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(small * 4); // log, not linear
  });

  it("sorts vacant roles last on the seat orbit", () => {
    const l = layoutMap([
      circle("a", 1, {
        roles: [
          { id: "z-vacant", vacant: true },
          { id: "a-filled", vacant: false },
        ],
      }),
    ]);
    expect(l.circles[0].roles.map((r) => r.id)).toEqual(["a-filled", "z-vacant"]);
  });

  it("caps quest satellites and reports the overflow", () => {
    const l = layoutMap([circle("a", 1, { questCount: QUEST_DISPLAY_CAP + 7 })]);
    expect(l.circles[0].questDots.length).toBe(QUEST_DISPLAY_CAP);
    expect(l.circles[0].questOverflow).toBe(7);
  });
});

// ── The nested layout and its labels ────────────────────────────────────────
//
// layoutNestedMap is what the map actually draws and it had no tests, so the
// canvas could sit at a fixed 1000 while the village drew into 340 of it and
// nothing failed. These two properties are the ones a person notices.

describe("layoutNestedMap canvas", () => {
  const nested = (id: string, order: number, parentId: string | null = null): NestedInput => ({
    id, parentId, order, memberCount: 2,
    roles: [{ id: `${id}-r1`, vacant: false }, { id: `${id}-r2`, vacant: true }],
    questCount: 0,
  });

  it("hugs the village instead of padding out to a fixed canvas", () => {
    const l = layoutNestedMap([nested("a", 1), nested("b", 2), nested("c", 3)]);
    // The drawing must occupy most of the box. Anything under this and the
    // map renders small in a large empty area, which is what it used to do.
    const occupancy = (l.village.r * 2) / l.width;
    expect(occupancy).toBeGreaterThan(0.8);
  });

  it("grows the canvas with the village, never shrinking below it", () => {
    const few = layoutNestedMap([nested("a", 1)]);
    const many = layoutNestedMap(
      Array.from({ length: 12 }, (_, i) => nested(`c${i}`, i)),
    );
    expect(many.width).toBeGreaterThan(few.width);
    // Nothing is ever drawn outside the box.
    for (const l of [few, many]) {
      expect(l.village.x + l.village.r).toBeLessThanOrEqual(l.width);
      expect(l.village.x - l.village.r).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic: same input, same picture", () => {
    const input = [nested("a", 1), nested("b", 2, "a"), nested("c", 3)];
    expect(JSON.stringify(layoutNestedMap(input))).toBe(JSON.stringify(layoutNestedMap(input)));
  });
});

// ── Cyclic parents ──────────────────────────────────────────────────────────
//
// `parent_circle_id` is written by three routes with one weak check, and the
// org editor turns nesting into a drag anyone can perform. A loop in that
// column used to leave EVERY node in the loop unreachable, so `roots` came
// back empty and the village drew as an empty ring: no throw, no console
// line, nothing to tell a member their map had gone. These assert the
// degrade the comment always promised, which is that a looping circle stands
// at the top instead of disappearing.

describe("cyclic parents never blank the map", () => {
  const nested = (id: string, order: number, parentId: string | null = null): NestedInput => ({
    id, parentId, order, memberCount: 2,
    roles: [{ id: `${id}-r1`, vacant: false }, { id: `${id}-r2`, vacant: true }],
    questCount: 0,
  });
  const drawn = (l: { circles: Array<{ id: string }> }) => l.circles.map((c) => c.id).sort();

  it("draws both circles when two are each other's parent", () => {
    const l = layoutNestedMap([nested("a", 1, "b"), nested("b", 2, "a")]);
    expect(drawn(l)).toEqual(["a", "b"]);
    expect(l.village.r).toBeGreaterThan(0);
  });

  it("draws all three when the loop is longer than a pair", () => {
    const l = layoutNestedMap([nested("a", 1, "c"), nested("b", 2, "a"), nested("c", 3, "b")]);
    expect(drawn(l)).toEqual(["a", "b", "c"]);
  });

  it("keeps the circles a loop does NOT touch nested where they belong", () => {
    // One healthy parent/child pair beside a two-circle loop. The loop must
    // not cost the healthy pair its nesting.
    const l = layoutNestedMap([
      nested("parent", 1), nested("child", 2, "parent"),
      nested("x", 3, "y"), nested("y", 4, "x"),
    ]);
    expect(drawn(l)).toEqual(["child", "parent", "x", "y"]);
    const byId = new Map(l.circles.map((c) => [c.id, c]));
    expect(byId.get("child")!.depth).toBeGreaterThan(byId.get("parent")!.depth);
    expect(byId.get("x")!.depth).toBe(byId.get("parent")!.depth);
  });

  it("still handles a circle that is its own parent", () => {
    const l = layoutNestedMap([nested("a", 1, "a"), nested("b", 2)]);
    expect(drawn(l)).toEqual(["a", "b"]);
  });

  it("survives a loop in every declared village shape", () => {
    // layoutForShape is what the map actually calls, and five of its seven
    // branches build the same forest. A guard in one is a guard in none.
    const looped = [nested("a", 1, "b"), nested("b", 2, "a"), nested("c", 3)];
    for (const shape of ["circle", "pyramid", "council", "flat", "steward", "network", "other"]) {
      const l = layoutForShape(shape, looped, []);
      expect(drawn(l), `shape ${shape} lost a circle`).toEqual(["a", "b", "c"]);
    }
  });

  it("leaves an acyclic map byte-identical, so the guard costs no pixels", () => {
    // Nothing above is allowed to have moved the ordinary picture. A real
    // nesting still nests and the canvas is unchanged.
    const clean = [nested("gcc", 1), nested("dev", 2, "gcc"), nested("care", 3, "gcc")];
    const l = layoutNestedMap(clean);
    expect(drawn(l)).toEqual(["care", "dev", "gcc"]);
    const byId = new Map(l.circles.map((c) => [c.id, c]));
    expect(byId.get("dev")!.depth).toBe(byId.get("gcc")!.depth + 1);
    // Each child sits inside its parent's disc.
    for (const kid of ["dev", "care"]) {
      const c = byId.get(kid)!;
      const p = byId.get("gcc")!;
      expect(Math.hypot(c.x - p.x, c.y - p.y) + c.r).toBeLessThanOrEqual(p.r + 1);
    }
  });
});

describe("wrapLabel", () => {
  it("wraps a long circle name to fit its circle", () => {
    // The layout gives this name a circle big enough to hold it.
    const r = radiusForLabel("Intergenerational Wisdom Council");
    const w = wrapLabel("Intergenerational Wisdom Council", r, 1);
    expect(w.lines.length).toBeGreaterThan(1);
    // Every line fits inside the CLEAR interior, not merely inside the circle.
    const widest = Math.max(...w.lines.map((l) => l.length * w.fontSize * 0.55));
    expect(widest).toBeLessThanOrEqual((r - 20 - 11) * 1.8 + 1);
  });

  it("keeps a short name on one line at full size", () => {
    const w = wrapLabel("Land", 90, 0);
    expect(w.lines).toEqual(["Land"]);
    expect(w.fontSize).toBe(17);
  });

  it("never exceeds three lines, clipping instead of covering the map", () => {
    const w = wrapLabel("A Very Long Council Name That Simply Will Not Fit Anywhere", 26, 2);
    expect(w.lines.length).toBeLessThanOrEqual(3);
  });

  it("shrinks the font for a tight circle rather than overflowing it", () => {
    const roomy = wrapLabel("Regenerative Agriculture", 120, 1);
    const tight = wrapLabel("Regenerative Agriculture", 34, 1);
    expect(tight.fontSize).toBeLessThan(roomy.fontSize);
  });

  it("survives an empty name", () => {
    expect(wrapLabel("", 50, 0).lines).toEqual([""]);
  });
});

describe("radiusForLabel", () => {
  it("gives a long-named circle room its name actually needs", () => {
    expect(radiusForLabel("Intergenerational Wisdom Council")).toBeGreaterThan(
      radiusForLabel("Land"),
    );
  });

  it("sizes every circle so its own name fits inside its seat ring", () => {
    for (const name of [
      "Intergenerational Wisdom Council",
      "Regenerative Agriculture & Permaculture Circle",
      "General Coordinating Circle",
      "Land",
    ]) {
      const r = radiusForLabel(name);
      const w = wrapLabel(name, r, 1);
      const widest = Math.max(...w.lines.map((l) => l.length * w.fontSize * 0.55));
      expect(widest).toBeLessThanOrEqual((r - 20 - 11) * 1.8 + 1);
      // And nothing had to be cut to get there.
      expect(w.lines.join(" ")).not.toContain("…");
    }
  });
});
