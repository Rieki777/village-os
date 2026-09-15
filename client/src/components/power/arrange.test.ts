/**
 * Arrange mode's pure half: what a drop does to the picture, when it is
 * refused, the order publishing writes the moves in, and what comes off the
 * list when the published village changes under it.
 *
 * The case worth reading twice is the publish-order block. A set of drops can
 * be a good final shape and still pass through a loop if written in the order
 * they were made, and the server checks a draft one move at a time. A drop that
 * the map accepted would then be refused at Publish, which reads as the map
 * lying about what it allowed.
 */
import { describe, expect, it } from "vitest";
import { parentingRefusal } from "@shared/circleView";
import {
  addMove,
  describeMove,
  dropRefusal,
  publishOrder,
  settleAgainst,
  withMoves,
  type PendingMove,
} from "./arrange";

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

describe("a pending list when the published village changes under it", () => {
  it("hands back the same list when every move still fits, so nothing re-renders", () => {
    const moves: PendingMove[] = [{ circleId: "web", parentId: "care" }];
    const r = settleAgainst(village, moves);
    expect(r.kept).toBe(moves);
    expect(r.dropped).toEqual([]);
  });

  it("takes off a move the village already made true, without calling it refused", () => {
    // Somebody else, or an earlier publish, already put web inside care.
    const now = withMoves(village, [{ circleId: "web", parentId: "care" }]);
    const r = settleAgainst(now, [{ circleId: "web", parentId: "care" }]);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual([{ move: { circleId: "web", parentId: "care" }, words: null }]);
  });

  it("takes off a move that now closes a loop, in words, and keeps the rest in the order made", () => {
    // Pending, both sound when dropped: art to the top, dev inside care. Then
    // somebody puts care inside web, which sits inside dev, so dev inside care
    // is a loop in any order, while art to the top is untouched by it.
    const withArt = [...village, c("art", "gcc")];
    const now = withMoves(withArt, [{ circleId: "care", parentId: "web" }]);
    const made: PendingMove[] = [{ circleId: "art", parentId: null }, { circleId: "dev", parentId: "care" }];
    const r = settleAgainst(now, made);
    expect(r.kept).toEqual([{ circleId: "art", parentId: null }]);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].move).toEqual({ circleId: "dev", parentId: "care" });
    expect(r.dropped[0].words).toMatch(/^DEV moves inside CARE: .*already inside/);
  });

  it("keeps a move that only looked like a loop, because another move in the list undoes it", () => {
    // care inside web puts dev inside care in a loop, but care to the top is in
    // the same list, and publishing it first clears the way.
    const now = withMoves(village, [{ circleId: "care", parentId: "web" }]);
    const made: PendingMove[] = [{ circleId: "dev", parentId: "care" }, { circleId: "care", parentId: null }];
    const r = settleAgainst(now, made);
    expect(r.kept).toBe(made);
  });

  it("takes off a move whose circle has gone", () => {
    const now = village.filter((x) => x.id !== "web");
    const r = settleAgainst(now, [{ circleId: "web", parentId: "care" }, { circleId: "care", parentId: null }]);
    expect(r.kept).toEqual([{ circleId: "care", parentId: null }]);
    expect(r.dropped[0].words).toMatch(/no longer on the map/);
  });
});
