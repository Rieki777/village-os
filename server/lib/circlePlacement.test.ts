/**
 * Where a circle sits, as a draft carries it (0286): the order and layer a
 * `move_circle` may set, how such a move reads, and the arrangement the circles
 * map sends. Pure, so it runs without a database; the publish and revert are
 * proven against a real schema in draftMoveCircle.test.ts.
 */
import { describe, expect, it } from "vitest";
import { MAX_ARRANGE_MOVES, MAX_ORDER, moveWords, parseArrangement, placementOf } from "./circlePlacement";

describe("placementOf", () => {
  it("changes nothing a move does not carry", () => {
    expect(placementOf({ parentCircleId: "gcc" })).toEqual({ ok: true, placement: {} });
    expect(placementOf(null)).toEqual({ ok: true, placement: {} });
  });

  it("reads an order and a layer, and null as clearing the layer", () => {
    expect(placementOf({ order: 2, layer: "lead" })).toEqual({ ok: true, placement: { order: 2, layer: "lead" } });
    expect(placementOf({ layer: null })).toEqual({ ok: true, placement: { layer: null } });
  });

  it("refuses an order that is not a whole number in range, in words", () => {
    for (const order of [-1, 1.5, MAX_ORDER + 1, "first"]) {
      const r = placementOf({ order });
      expect(r.ok, String(order)).toBe(false);
      expect(!r.ok && r.problem).toContain("whole number");
    }
  });

  it("refuses a layer this build does not know, naming the ones it does", () => {
    const r = placementOf({ layer: "boss" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("link, lead, operating, advisory, council");
  });
});

describe("moveWords", () => {
  const into = { changes: true, toId: "gcc", toName: "General Circle" };
  const stays = { changes: false, toId: "gcc", toName: "General Circle" };

  it("reads a move that carries only its parent exactly as it always did", () => {
    expect(moveWords("Development Circle", into, {})).toBe('Move "Development Circle" inside "General Circle"');
    expect(moveWords("Web Guild", { changes: true, toId: null, toName: null }, {})).toBe('Move "Web Guild" to the top of the village');
    // Even when the parent does not change: these are the words a published draft already holds.
    expect(moveWords("Web Guild", stays, {})).toBe('Move "Web Guild" inside "General Circle"');
  });

  it("says the order and layer plainly, and the move only when the circle moves", () => {
    expect(moveWords("Leadership Circle", stays, { layer: "lead" })).toBe('Make "Leadership Circle" a lead circle');
    expect(moveWords("Outreach", stays, { order: 0 })).toBe('Give "Outreach" place 1 among the circles beside it');
    expect(moveWords("Outreach", into, { order: 2, layer: "advisory" })).toBe(
      'Move "Outreach" inside "General Circle", and give it place 3 among the circles beside it, and make it an advisory circle',
    );
    expect(moveWords("Outreach", stays, { layer: null })).toBe('Clear the governance layer of "Outreach"');
  });
});

describe("parseArrangement", () => {
  it("reads the moves the map sends", () => {
    expect(
      parseArrangement({ moves: [{ circleId: "lead", parentCircleId: "gcc", layer: "lead" }, { circleId: "dev", parentCircleId: null, order: 3 }] }),
    ).toEqual({
      ok: true,
      moves: [
        { circleId: "lead", parentCircleId: "gcc", layer: "lead" },
        { circleId: "dev", parentCircleId: null, order: 3 },
      ],
    });
  });

  it("refuses an empty arrangement, a circle named twice, and one past the limit", () => {
    expect(parseArrangement({ moves: [] }).ok).toBe(false);
    expect(parseArrangement({}).ok).toBe(false);
    expect(parseArrangement({ moves: [{ circleId: "a", parentCircleId: null }, { circleId: "a", parentCircleId: "b" }] }).ok).toBe(false);
    const many = Array.from({ length: MAX_ARRANGE_MOVES + 1 }, (_, i) => ({ circleId: `c${i}`, parentCircleId: null }));
    expect(parseArrangement({ moves: many }).ok).toBe(false);
  });

  it("refuses a move with no circle, a parent that is neither an id nor null, or a bad layer", () => {
    expect(parseArrangement({ moves: [{ parentCircleId: null }] }).ok).toBe(false);
    expect(parseArrangement({ moves: [{ circleId: "a", parentCircleId: 7 }] }).ok).toBe(false);
    expect(parseArrangement({ moves: [{ circleId: "a", parentCircleId: null, layer: "chief" }] }).ok).toBe(false);
  });
});
