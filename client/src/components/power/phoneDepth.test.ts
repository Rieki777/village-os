/**
 * The defect this pins, measured on production on 2026-09-19.
 *
 * `/api/org` carried seventeen circles, sixteen of them with a parent, and the
 * living map on a 390px phone drew ONE node: the General Coordinating Circle,
 * filling the screen, with nothing inside it and nothing saying that fifteen
 * circles sat one level below. The same page with `?focus=general-circle` drew
 * fifteen. So the data was right, the layout was right, and the camera was
 * wrong: the phone drew "the top level", and nesting the village under one root
 * had made the top level a single disc.
 *
 * The first case below is that village. The second is the village as it was
 * BEFORE the nesting, which must keep drawing exactly as it did.
 */
import { describe, expect, it } from "vitest";
import { phoneDepthFor, type DepthCircle } from "./phoneDepth";

/** `n` circles at one depth, named so a failure says which level it was. */
const level = (depth: number, n: number, prefix = "c"): DepthCircle[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${depth}-${i}`, depth }));

describe("how deep the phone draws", () => {
  it("descends past a top level that holds one circle, which is the live shape", () => {
    const nested = [{ id: "general-circle", depth: 0 }, ...level(1, 15)];
    expect(phoneDepthFor(nested, null)).toBe(1);
  });

  it("leaves a flat village alone, which is the shape before the nesting", () => {
    expect(phoneDepthFor(level(0, 15), null)).toBe(0);
  });

  it("descends through a chain of single circles until something can be compared", () => {
    const chain = [
      { id: "root", depth: 0 },
      { id: "only-child", depth: 1 },
      ...level(2, 4, "g"),
    ];
    expect(phoneDepthFor(chain, null)).toBe(2);
  });

  it("stops at the deepest level that exists, so one lone circle still draws", () => {
    expect(phoneDepthFor([{ id: "alone", depth: 0 }], null)).toBe(0);
    expect(phoneDepthFor([{ id: "root", depth: 0 }, { id: "kid", depth: 1 }], null)).toBe(1);
  });

  it("draws the children of whatever the camera is inside", () => {
    const tree = [{ id: "general-circle", depth: 0 }, ...level(1, 15)];
    // Standing inside the root: its children, which is the level below it.
    expect(phoneDepthFor(tree, "general-circle")).toBe(1);
  });

  it("descends from a focus whose own level is a single circle too", () => {
    const tree = [
      { id: "root", depth: 0 },
      { id: "dev", depth: 1 },
      ...level(2, 1, "sub"),
      ...level(3, 5, "leaf"),
    ];
    // Inside `dev`: its one child answers nothing, so the grandchildren draw.
    expect(phoneDepthFor(tree, "dev")).toBe(3);
  });

  it("treats a missing depth as the top level rather than throwing", () => {
    const odd = [{ id: "a" }, { id: "b" }] as DepthCircle[];
    expect(phoneDepthFor(odd, null)).toBe(0);
  });

  it("answers for an empty village and for a focus that is not there", () => {
    expect(phoneDepthFor([], null)).toBe(0);
    expect(phoneDepthFor(level(0, 3), "no-such-circle")).toBe(0);
  });
});
