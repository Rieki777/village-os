/**
 * The commons as geometry: every goal is drawn, inside the box, and moss
 * grows only where it is given a share. A reached goal is all moss; a goal
 * not reached holds none.
 */
import { describe, expect, it } from "vitest";
import { MOSS_FULL, SEED_GOALS, commonsLayout, mossDots, mossShare } from "./commonsGeometry";

const inside = (n: number) => commonsLayout(n).circles.every((c) => c.x - c.r >= 0 && c.x + c.r <= 100 && c.y - c.r >= 0 && c.y + c.r <= 100);

describe("where the goals sit", () => {
  it("draws nothing for no goals", () => {
    expect(commonsLayout(0)).toEqual({ circles: [], boundary: 0, shape: "none" });
  });

  it("puts up to seven goals on the Seed of Life, centre first, then the ring from the top", () => {
    for (let n = 1; n <= SEED_GOALS; n++) {
      const l = commonsLayout(n);
      expect(l.shape).toBe("seed");
      expect(l.circles).toHaveLength(n);
      expect(inside(n)).toBe(true);
    }
    const seven = commonsLayout(7).circles;
    expect(seven[0]).toMatchObject({ x: 50, y: 50 });
    expect(seven[1].x).toBeCloseTo(50);
    expect(seven[1].y).toBeLessThan(50);
  });

  it("draws every goal past seven on the golden-angle spiral, all inside the box", () => {
    for (const n of [8, 12, 19, 30]) {
      const l = commonsLayout(n);
      expect(l.shape).toBe("spiral");
      expect(l.circles).toHaveLength(n);
      expect(inside(n)).toBe(true);
    }
  });
});

describe("the moss", () => {
  const circle = { x: 50, y: 50, r: 23 };

  it("fills a reached goal to its edge and never past it", () => {
    const dots = mossDots(circle, mossShare({ done: true }));
    expect(dots).toHaveLength(MOSS_FULL);
    for (const d of dots) expect(Math.hypot(d.x - 50, d.y - 50)).toBeLessThanOrEqual(23);
    expect(dots[0].order).toBe(0);
    expect(dots[dots.length - 1].order).toBe(1);
  });

  it("grows nothing in a goal not reached yet", () => {
    expect(mossShare({ done: false })).toBe(0);
    expect(mossDots(circle, 0)).toEqual([]);
  });

  it("holds any share to 0..1", () => {
    expect(mossDots(circle, 4)).toHaveLength(MOSS_FULL);
    expect(mossDots(circle, -1)).toHaveLength(0);
    expect(mossDots(circle, Number.NaN)).toHaveLength(0);
    expect(mossDots(circle, 0.5)).toHaveLength(MOSS_FULL / 2);
  });

  it("is the same moss on every render", () => {
    expect(mossDots(circle, 1)).toEqual(mossDots(circle, 1));
  });
});
