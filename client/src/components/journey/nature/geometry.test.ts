/**
 * THE NATURE KIT'S GEOMETRY, AS NUMBERS. Every shape the kit draws is held
 * to the maths it claims: the golden angle, the seed's and the flower's
 * lattice, the L-system fern, the vesica's lens and the seeded root.
 */
import { describe, expect, it } from "vitest";
import {
  GOLDEN_ANGLE,
  PHI,
  boundsOf,
  circleState,
  clampFireflies,
  fern,
  fireflySpots,
  flowerOfLifeCentres,
  lifeBoundary,
  lifeCentres,
  lsystem,
  FERN_AXIOM,
  FERN_RULES,
  rootStrip,
  seedOfLifeCentres,
  seeded,
  turtle,
  vesica,
  vogel,
} from "./geometry";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("Vogel's golden-angle model", () => {
  it("turns by the golden angle, about 137.508 degrees", () => {
    expect((GOLDEN_ANGLE * 180) / Math.PI).toBeCloseTo(137.5078, 3);
    expect(PHI * PHI).toBeCloseTo(PHI + 1, 12);
  });

  it("places seed i at radius c * sqrt(i)", () => {
    for (const i of [1, 2, 5, 8]) {
      const p = vogel(i, 3);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(3 * Math.sqrt(i), 9);
      expect(p.angle).toBeCloseTo(i * GOLDEN_ANGLE, 12);
    }
  });

  it("holds the fireflies to five to eight", () => {
    expect(clampFireflies(2)).toBe(5);
    expect(clampFireflies(6)).toBe(6);
    expect(clampFireflies(40)).toBe(8);
    expect(clampFireflies(Number.NaN)).toBe(5);
    expect(fireflySpots(12)).toHaveLength(8);
  });

  it("puts every light outside the act by default", () => {
    for (const s of fireflySpots(8)) expect(Math.hypot(s.fx, s.fy)).toBeGreaterThan(1);
  });

  it("rings the act within the spread it is given", () => {
    const spots = fireflySpots(8, 0.62, 1.18);
    for (const s of spots) {
      const rho = Math.hypot(s.fx, s.fy);
      expect(rho).toBeGreaterThanOrEqual(0.62 * 1.18 - 1e-9);
      expect(rho).toBeLessThanOrEqual(1.18 + 1e-9);
    }
    // No two lights drift and pulse in step.
    expect(new Set(spots.map((s) => `${s.drift}/${s.pulse}/${s.delay}`)).size).toBe(spots.length);
  });
});

describe("the Seed and the Flower of Life", () => {
  it("puts six centres on the first circle, sixty degrees apart, from the top", () => {
    const c = seedOfLifeCentres(50, 50, 20);
    expect(c).toHaveLength(7);
    expect(c[0]).toEqual({ x: 50, y: 50 });
    expect(c[1].x).toBeCloseTo(50, 9);
    expect(c[1].y).toBeCloseTo(30, 9);
    for (let k = 1; k <= 6; k++) {
      expect(dist(c[k], c[0])).toBeCloseTo(20, 9);
      const next = c[(k % 6) + 1];
      // Neighbours on the ring are one radius apart: every pair meets as a vesica.
      expect(dist(c[k], next)).toBeCloseTo(20, 9);
    }
    // Clockwise from the top: the second ring centre is to the right.
    expect(c[2].x).toBeGreaterThan(50);
  });

  it("continues into nineteen circles on the same lattice", () => {
    const f = flowerOfLifeCentres(0, 0, 10);
    expect(f).toHaveLength(19);
    const radii = f.slice(7).map((p) => Math.hypot(p.x, p.y));
    expect(radii.filter((d) => Math.abs(d - 20) < 1e-9)).toHaveLength(6);
    expect(radii.filter((d) => Math.abs(d - 10 * Math.sqrt(3)) < 1e-9)).toHaveLength(6);
    // Every centre is a lattice point: each has a neighbour exactly one radius away.
    for (const p of f) expect(f.some((q) => q !== p && Math.abs(dist(p, q) - 10) < 1e-9)).toBe(true);
    // The outer ring also grows clockwise from the top.
    expect(f[7].x).toBeCloseTo(0, 9);
    expect(f[7].y).toBeCloseTo(-20, 9);
    expect(f[8].x).toBeGreaterThan(0);
  });

  it("draws the seed up to seven and the flower past it", () => {
    expect(lifeCentres(5, 0, 0, 1)).toHaveLength(5);
    expect(lifeCentres(7, 0, 0, 1)).toHaveLength(7);
    expect(lifeCentres(12, 0, 0, 1)).toHaveLength(12);
    expect(lifeCentres(40, 0, 0, 1)).toHaveLength(19);
    expect(lifeBoundary(7, 10)).toBe(20);
    expect(lifeBoundary(8, 10)).toBe(30);
  });

  it("names each circle's state", () => {
    expect(circleState(0, 2)).toBe("closed");
    expect(circleState(2, 2)).toBe("current");
    expect(circleState(3, 2)).toBe("open");
    expect(circleState(4, 2, 4)).toBe("current");
    expect(circleState(2, 2, 4)).toBe("open");
  });
});

describe("the L-system fern", () => {
  it("rewrites by the rule: every leaflet is the frond again", () => {
    expect(lsystem(FERN_AXIOM, FERN_RULES, 1)).toBe(FERN_RULES.X);
    expect(lsystem("F", FERN_RULES, 3)).toBe("F");
    const once = lsystem(FERN_AXIOM, FERN_RULES, 1);
    // Four pairs of leaflets and the tip: nine smaller fronds.
    expect([...once].filter((c) => c === "X")).toHaveLength(9);
    expect([...once].filter((c) => c === "&")).toHaveLength(8);
    const s = lsystem(FERN_AXIOM, FERN_RULES, 3);
    let depth = 0;
    for (const c of s) {
      depth += c === "[" ? 1 : c === "]" ? -1 : 0;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("walks a turtle: F forward, + and - turn, brackets return", () => {
    const strokes = turtle("FF[+F]F", 90);
    // The two F before the bracket share a heading and merge into one stroke.
    expect(strokes[0].points).toHaveLength(2);
    expect(strokes[0].points[1].y).toBeCloseTo(-2, 9);
    expect(strokes[1].depth).toBe(1);
    // After the bracket the turtle is back on the stem, heading up again.
    const last = strokes[2];
    expect(last.points[0].y).toBeCloseTo(-2, 9);
    expect(last.points[1].y).toBeCloseTo(-3, 9);
  });

  it("shrinks a leaflet, shortens the stem and skips what is too small to see", () => {
    const scale = { leaflet: 0.5, stem: 0.5, bend: 90, minStep: 0.3 };
    // & halves the branch's step; the bracket gives the stem its own step back.
    const a = turtle("[&F]F", 0, 0, scale);
    expect(a[0].points[1].y).toBeCloseTo(-0.5, 9);
    expect(a[1].points[1].y).toBeCloseTo(-1, 9);
    // > shortens the stem's next step; ) bends it.
    const b = turtle("F>)F", 0, 0, scale);
    expect(b[0].points[2].x).toBeCloseTo(0.5, 9);
    // Two & in one branch fall under minStep: that whole branch, nested brackets and all, is skipped,
    // and the turtle carries on from where the branch began.
    const c = turtle("F[&&F[F]F]F", 0, 0, scale);
    expect(c).toHaveLength(2);
    expect(c[1].points[0].y).toBeCloseTo(-1, 9);
    expect(c[1].points[1].y).toBeCloseTo(-2, 9);
  });

  it("fits the frond inside its box, stem first", () => {
    const d = fern(3);
    expect(d.layers[0].depth).toBe(0);
    expect(d.layers.map((l) => l.depth)).toEqual([...d.layers.map((l) => l.depth)].sort((a, b) => a - b));
    const nums = d.layers.flatMap((l) => l.d.match(/-?\d+(\.\d+)?/g)!.map(Number));
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(100);
    expect(d.base.y).toBeCloseTo(96, 6);
    // One more generation is more leaflets.
    expect(fern(4).strokes).toBeGreaterThan(d.strokes);
    // The pruning keeps a full fern light enough for the DOM.
    expect(fern(4).strokes).toBeLessThan(1500);
    // Mirroring flips it about the middle.
    expect(fern(3, 0.12, true).base.x).toBeCloseTo(100 - d.base.x, 6);
  });

  it("keeps bounds honest", () => {
    expect(boundsOf([{ depth: 0, points: [{ x: -1, y: 2 }, { x: 3, y: -4 }] }])).toEqual({ minX: -1, minY: -4, maxX: 3, maxY: 2 });
  });
});

describe("the vesica piscis", () => {
  it("is r * sqrt(3) tall when the centres are one radius apart", () => {
    const v = vesica(60, 30, 20);
    expect(v.lensHeight).toBeCloseTo(20 * Math.sqrt(3), 9);
    expect(dist(v.left, v.right)).toBe(20);
    expect(v.lens.startsWith("M 60 ")).toBe(true);
  });

  it("has no lens when the circles only touch", () => {
    expect(vesica(0, 0, 10, 20).lens).toBe("");
    expect(vesica(0, 0, 10, 20).lensHeight).toBe(0);
  });
});

describe("the root", () => {
  it("is the same root every time for the same seed", () => {
    expect(rootStrip(400, 40, 5, 11)).toEqual(rootStrip(400, 40, 5, 11));
    expect(rootStrip(400, 40, 5, 12).main).not.toBe(rootStrip(400, 40, 5, 11).main);
  });

  it("crosses the strip and puts out two hyphae per branch", () => {
    const r = rootStrip(1200, 40, 14);
    expect(r.main.startsWith("M0 20")).toBe(true);
    expect(r.main.endsWith("1200 20")).toBe(true);
    expect(r.hyphae).toHaveLength(28);
  });

  it("keeps a low root inside its strip, reaching up", () => {
    const r = rootStrip(1400, 56, 16, 11, 0.84);
    expect(r.main.startsWith(`M0 ${Math.round(56 * 0.84 * 100) / 100}`)).toBe(true);
    // The thread: every number in its path is an absolute x y pair.
    const nums = r.main.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let k = 1; k < nums.length; k += 2) {
      expect(nums[k]).toBeGreaterThanOrEqual(0);
      expect(nums[k]).toBeLessThanOrEqual(56);
    }
    // Each hypha starts on the thread and ends above it, inside the strip.
    for (const h of r.hyphae.filter((_, i) => i % 2 === 0)) {
      const n = h.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(n[5]).toBeLessThan(n[1]);
      expect(n[5]).toBeGreaterThanOrEqual(0);
    }
  });

  it("draws from a generator in [0, 1)", () => {
    const rnd = seeded(3);
    for (let k = 0; k < 200; k++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
