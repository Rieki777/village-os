/**
 * Arrange mode's pure half: what a drop does to the picture, when it is
 * refused, and the order publishing writes the moves in.
 *
 * The case worth reading twice is the last describe block. A set of drops can
 * be a good final shape and still pass through a loop if written in the order
 * they were made, and the server checks a draft one move at a time. A drop that
 * the map accepted would then be refused at Publish, which reads as the map
 * lying about what it allowed.
 */
import { describe, expect, it } from "vitest";
import { parentingRefusal } from "@shared/circleView";
import { addMove, describeMove, dropRefusal, publishOrder, withMoves, type PendingMove } from "./arrange";

const c = (id: string, parentCircleId: string | null = null, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  parentCircleId,
  ...extra,
});

const village = [c("gcc"), c("dev", "gcc"), c("web", "dev"), c("care", "gcc"), c("demo", null, { isExample: true })];
const parentOf = (circles: Array<{ id: string; parentCircleId?: string | null }>, id: string) =>
  circles.find((x) => x.id === id)?.parentCircleId ?? null;

describe("the picture the pending moves leave", () => {
  it("draws each moved circle where it was dropped, the last drop winning", () => {
    const moves: PendingMove[] = [{ circleId: "web", parentId: "care" }, { circleId: "web", parentId: null }];
    expect(parentOf(withMoves(village, moves), "web")).toBeNull();
  });

  it("hands back the same circles when nothing has moved, so nothing redraws", () => {
    expect(withMoves(village, [])).toBe(village);
  });
});

describe("a drop the map refuses, in words", () => {
  it("refuses the drop that closes a loop with an earlier pending drop", () => {
    // gcc inside care is fine on the live map. With care already dropped inside
    // web, which sits inside dev inside gcc, it closes a loop.
    const moves: PendingMove[] = [{ circleId: "care", parentId: "web" }];
    expect(dropRefusal(village, [], "gcc", "care")).toMatch(/already inside/);
    expect(dropRefusal(village, moves, "gcc", "care")).toMatch(/already inside/);
  });

  it("refuses to move a standing example, and refuses one as the parent", () => {
    expect(dropRefusal(village, [], "demo", "gcc")).toMatch(/standing example/);
    expect(dropRefusal(village, [], "care", "demo")).toMatch(/standing example/);
  });

  it("lets an ordinary drop land, and a drop to the top of the village", () => {
    expect(dropRefusal(village, [], "web", "care")).toBeNull();
    expect(dropRefusal(village, [], "web", null)).toBeNull();
  });

  it("does not refuse a circle dropped back where it already sits", () => {
    expect(dropRefusal(village, [], "web", "dev")).toBeNull();
  });
});

describe("recording a drop", () => {
  it("drops the move entirely when a circle goes back where it lives", () => {
    const moved = addMove(village, [], { circleId: "web", parentId: "care" });
    expect(moved).toHaveLength(1);
    // Back to dev, where it lives on the published map: no change to publish.
    expect(addMove(village, moved, { circleId: "web", parentId: "dev" })).toEqual([]);
  });

  it("replaces an earlier move of the same circle instead of stacking two", () => {
    const once = addMove(village, [], { circleId: "web", parentId: "care" });
    expect(addMove(village, once, { circleId: "web", parentId: null })).toEqual([{ circleId: "web", parentId: null }]);
  });

  it("says each move in words", () => {
    expect(describeMove(village, { circleId: "web", parentId: "care" })).toBe("WEB moves inside CARE");
    expect(describeMove(village, { circleId: "web", parentId: null })).toBe("WEB moves to the top of the village");
  });
});

/** Apply moves one at a time the way the server does, refusing on the first loop. */
function appliesCleanly(live: typeof village, moves: PendingMove[]): boolean {
  let picture = live;
  for (const m of moves) {
    if (parentingRefusal(picture, m.circleId, m.parentId)) return false;
    picture = withMoves(picture, [m]);
  }
  return true;
}

describe("the order publishing writes the moves in", () => {
  it("swaps two circles without passing through a loop", () => {
    // Live: web inside dev. Final: dev inside web, web inside gcc. Written in
    // the order made, dev goes inside web while web is still inside dev.
    const made: PendingMove[] = [{ circleId: "dev", parentId: "web" }, { circleId: "web", parentId: "gcc" }];
    expect(appliesCleanly(village, made), "the order the drops were made in loops").toBe(false);
    const ordered = publishOrder(village, made);
    expect(appliesCleanly(village, ordered)).toBe(true);
    expect(ordered.map((m) => m.circleId)).toEqual(["web", "dev"]);
  });

  it("moves an ancestor out first when a circle drops beneath it", () => {
    // Live: gcc > dev > web. Final: dev at the top, gcc inside web. Putting gcc
    // inside web first would loop through dev.
    const made: PendingMove[] = [{ circleId: "gcc", parentId: "web" }, { circleId: "dev", parentId: null }];
    const ordered = publishOrder(village, made);
    expect(appliesCleanly(village, ordered)).toBe(true);
    expect(ordered[0]).toEqual({ circleId: "dev", parentId: null });
  });

  it("keeps the order made when it is already clean", () => {
    const made: PendingMove[] = [{ circleId: "web", parentId: "care" }, { circleId: "care", parentId: null }];
    expect(publishOrder(village, made)).toEqual(made);
  });
});
