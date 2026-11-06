/**
 * Dragging the orientation (0286): the middle, the order round the ring, and
 * the layer, as pending moves, and the drop targets the lens draws for them.
 * Rye, 2026-10-23: org designers and the founder and steward roles "drag and
 * drop the orientation and update it".
 */
import { describe, expect, it } from "vitest";
import { layoutNestedMap } from "@shared/mapLayout";
import { addMove, describeMove, middleMoves, nudgeMoves, orderMoves, settleAgainst, withMoves, type PendingMove } from "./arrange";
import { arrangeSlots } from "./ArrangeLens";

const c = (id: string, parentCircleId: string | null, extra: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), parentCircleId, order: 0, layer: null as string | null, ...extra,
});

const village = [
  c("gcc", null),
  c("lead", "gcc", { order: 1 }),
  c("dev", "gcc", { order: 5 }),
  c("out", "gcc", { order: 3 }),
  c("care", "gcc", { order: 4 }),
];

describe("the middle", () => {
  it("makes a circle the lead of its container", () => {
    expect(middleMoves(village, "lead")).toEqual([{ circleId: "lead", parentId: "gcc", layer: "lead" }]);
  });

  it("sends the circle that held the middle back to operating, so one circle holds it", () => {
    const held = village.map((x) => (x.id === "dev" ? { ...x, layer: "lead" } : x));
    expect(middleMoves(held, "lead")).toEqual([
      { circleId: "lead", parentId: "gcc", layer: "lead" },
      { circleId: "dev", parentId: "gcc", layer: "operating" },
    ]);
  });
});

describe("the order round the ring", () => {
  it("writes places with room between them, and the plain layer where there was none", () => {
    expect(orderMoves(village, "gcc", ["care", "out"])).toEqual([
      { circleId: "care", parentId: "gcc", order: 10, layer: "operating" },
      { circleId: "out", parentId: "gcc", order: 20, layer: "operating" },
    ]);
  });

  it("leaves a sibling's own layer alone", () => {
    const advisory = village.map((x) => (x.id === "care" ? { ...x, layer: "advisory" } : x));
    expect(orderMoves(advisory, "gcc", ["care"])).toEqual([{ circleId: "care", parentId: "gcc", order: 10 }]);
  });

  it("moves a circle one place earlier or later, never off either end", () => {
    // Ring by order: lead (1), out (3), care (4), dev (5).
    const later = nudgeMoves(village, "out", 1);
    expect(later.map((m) => m.circleId)).toEqual(["lead", "care", "out", "dev"]);
    expect(nudgeMoves(village, "lead", -1)).toEqual([]);
    expect(nudgeMoves(village, "dev", 1)).toEqual([]);
  });

  it("keeps the lead out of the ring it holds the middle of", () => {
    const held = village.map((x) => (x.id === "lead" ? { ...x, layer: "lead" } : x));
    expect(nudgeMoves(held, "care", -1).map((m) => m.circleId)).toEqual(["care", "out", "dev"]);
  });
});

describe("pending moves that set order and layer", () => {
  it("draws them in the picture", () => {
    const after = withMoves(village, [{ circleId: "out", parentId: "gcc", order: 10, layer: "lead" }]);
    expect(after.find((x) => x.id === "out")).toMatchObject({ order: 10, layer: "lead" });
  });

  it("merges a later move on the same circle with what the earlier one set", () => {
    const one = addMove(village, [], { circleId: "out", parentId: "gcc", order: 20 });
    const two = addMove(village, one, { circleId: "out", parentId: "gcc", layer: "lead" });
    expect(two).toEqual([{ circleId: "out", parentId: "gcc", order: 20, layer: "lead" }]);
  });

  it("drops a move the published village already matches", () => {
    expect(addMove(village, [], { circleId: "out", parentId: "gcc", order: 3 })).toEqual([]);
    const settled = settleAgainst(
      village.map((x) => (x.id === "out" ? { ...x, layer: "lead" } : x)),
      [{ circleId: "out", parentId: "gcc", layer: "lead" } as PendingMove],
    );
    expect(settled.kept).toEqual([]);
  });

  it("says what changes in words", () => {
    expect(describeMove(village, { circleId: "lead", parentId: "gcc", layer: "lead" })).toBe("LEAD takes the middle");
    expect(describeMove(village, { circleId: "out", parentId: "gcc", order: 20 })).toBe("OUT takes place 2 in the ring");
    expect(describeMove(village, { circleId: "out", parentId: null })).toBe("OUT moves to the top of the village");
  });
});

describe("the drop targets the lens draws", () => {
  const layout = layoutNestedMap(
    village.map((x) => ({ id: x.id, parentId: x.parentCircleId, order: x.order, memberCount: 1, questCount: 0, name: x.name, roles: [{ id: `${x.id}-r`, vacant: true }] })),
  );

  it("offers the middle, and a place between each two neighbours round the ring", () => {
    const slots = arrangeSlots(layout, village, "out");
    expect(slots.filter((s) => s.kind === "middle")).toHaveLength(1);
    // Three others on the ring around whoever holds the middle, so three gaps; or four when nobody does.
    const order = slots.filter((s) => s.kind === "order");
    expect(order.length).toBeGreaterThanOrEqual(2);
    for (const s of order) {
      const ids = s.key.split("|")[2].split(",");
      expect(ids).toContain("out");
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("offers no middle to the circle that already holds it", () => {
    const centre = layout.circles.find((p) => p.id !== "gcc" && Math.hypot(p.x - layout.circles[0].x, p.y - layout.circles[0].y) < 1)!;
    expect(arrangeSlots(layout, village, centre.id).some((s) => s.kind === "middle")).toBe(false);
  });

  it("offers nothing for a standing example", () => {
    const withExample = village.map((x) => (x.id === "out" ? { ...x, isExample: true } : x));
    expect(arrangeSlots(layout, withExample, "out")).toEqual([]);
  });
});
