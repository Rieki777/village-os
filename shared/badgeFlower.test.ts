import { describe, expect, it } from "vitest";
import {
  GOLDEN_ANGLE,
  PETAL_MIN_SIZE,
  RING_BASE_R,
  RING_MAX,
  VIEW_R,
  capPetals,
  flowerLayout,
  petalPath,
  tipRadius,
} from "./badgeFlower";

const badges = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, kind: i % 2 ? "earned" : "granted" }));
const byIndex = <T extends { index: number }>(ps: T[]) => ps.slice().sort((a, b) => a.index - b.index);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

describe("flowerLayout", () => {
  it("draws nothing for no badges", () => {
    expect(flowerLayout([])).toEqual({ mode: "none", petals: [] });
  });

  it.each([1, 3, 5, 8, 13])("lays %i petals on one even ring, the first at twelve o'clock", (n) => {
    const { mode, petals } = flowerLayout(badges(n));
    expect(mode).toBe("ring");
    expect(petals).toHaveLength(n);
    expect(petals[0].angle).toBeCloseTo(-90, 5);
    for (let k = 0; k < n; k++) {
      expect(petals[k].angle).toBeCloseTo(-90 + (k * 360) / n, 1);
      expect(Math.hypot(petals[k].x, petals[k].y)).toBeCloseTo(RING_BASE_R, 1);
      expect(petals[k].length).toBe(petals[0].length);
      expect(petals[k].width).toBe(petals[0].width);
    }
  });

  it.each([3, 5, 13, 14, 21, 55, 100, 144])("keeps %i petals in balance round the centre", (n) => {
    const { petals } = flowerLayout(badges(n));
    const cx = petals.reduce((s, p) => s + p.x, 0) / n;
    const cy = petals.reduce((s, p) => s + p.y, 0) / n;
    // A ring balances exactly; the golden angle balances to within a few percent.
    expect(Math.hypot(cx, cy)).toBeLessThan(n <= RING_MAX ? 0.05 : 0.08 * RING_BASE_R);
  });

  it.each([14, 34, 100, 233])("turns %i petals by the golden angle, radius growing with the index", (n) => {
    const { mode, petals } = flowerLayout(badges(n));
    expect(mode).toBe("spiral");
    const ordered = byIndex(petals);
    for (let k = 1; k < n; k++) {
      const turn = norm(ordered[k].angle - ordered[k - 1].angle);
      expect(turn).toBeCloseTo(GOLDEN_ANGLE, 1);
      const r0 = Math.hypot(ordered[k - 1].x, ordered[k - 1].y);
      const r1 = Math.hypot(ordered[k].x, ordered[k].y);
      expect(r1).toBeGreaterThanOrEqual(r0 - 0.02);
    }
  });

  it("gives every spiral petal an equal share of the annulus (radius squared is linear in k)", () => {
    const ordered = byIndex(flowerLayout(badges(100)).petals);
    const r2 = ordered.map((p) => p.x * p.x + p.y * p.y);
    const step = r2[1] - r2[0];
    for (let k = 2; k < r2.length; k++) expect(r2[k] - r2[k - 1]).toBeCloseTo(step, -1);
  });

  it("draws the spiral outermost first, so inner petals overlap outer ones", () => {
    const { petals } = flowerLayout(badges(50));
    expect(petals[0].index).toBe(49);
    expect(petals[49].index).toBe(0);
  });

  it("never lets a petal grow as the count grows, and keeps it legible", () => {
    let prev = Infinity;
    for (let n = 1; n <= 300; n++) {
      const p = flowerLayout(badges(n)).petals[0];
      const size = p.length * p.width;
      expect(size).toBeLessThanOrEqual(prev + 1e-9);
      expect(p.width).toBeGreaterThanOrEqual(PETAL_MIN_SIZE * 0.99);
      prev = size;
    }
  });

  it("keeps every tip inside the viewBox at every count", () => {
    for (let n = 1; n <= 300; n++) {
      for (const p of flowerLayout(badges(n)).petals) {
        expect(Number.isFinite(p.x + p.y + p.angle + p.length + p.width)).toBe(true);
        expect(tipRadius(p)).toBeLessThanOrEqual(VIEW_R);
      }
    }
  });

  it("points every petal outward from the centre", () => {
    for (const n of [5, 100]) {
      for (const p of flowerLayout(badges(n)).petals) {
        expect(tipRadius(p)).toBeGreaterThan(Math.hypot(p.x, p.y));
      }
    }
  });

  it("carries each badge's kind on its petal, for a later arrangement by genre", () => {
    const items = badges(20);
    const { petals } = flowerLayout(items);
    for (const p of petals) expect(p.item).toBe(items[p.index]);
    expect(new Set(petals.map((p) => p.item.kind))).toEqual(new Set(["earned", "granted"]));
  });

  it("honours a lower ring limit", () => {
    expect(flowerLayout(badges(8), { ringMax: 5 }).mode).toBe("spiral");
    expect(flowerLayout(badges(5), { ringMax: 5 }).mode).toBe("ring");
  });

  it("is deterministic", () => {
    expect(flowerLayout(badges(77))).toEqual(flowerLayout(badges(77)));
  });
});

describe("petalPath", () => {
  it("is a closed shape from the base to the tip and back", () => {
    const d = petalPath(40, 20);
    expect(d.startsWith("M0 0")).toBe(true);
    expect(d).toContain(" 40 0Q");
    expect(d.endsWith("0 0Z")).toBe(true);
  });
});

describe("capPetals", () => {
  it("shows the first ones and counts the rest", () => {
    expect(capPetals([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capPetals([1, 2], 13)).toEqual({ shown: [1, 2], more: 0 });
    expect(capPetals([1, 2], -1)).toEqual({ shown: [], more: 2 });
  });
});
