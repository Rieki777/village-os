/**
 * The quiet states' drawings as maths: the same on every render, inside their
 * boxes, and shaped the way their comments say (the stones lead to the door,
 * the crozier curls inward, the ring's places are equal).
 */
import { describe, expect, it } from "vitest";
import { crozierPath, offTrailScene, ringOfPlaces, restingBed } from "./quietGeometry";

const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("offTrailScene", () => {
  it("draws the same scene every time", () => {
    expect(offTrailScene()).toEqual(offTrailScene());
  });

  it("lays the stepping stones from the frayed tip toward the door, each closer to it", () => {
    const s = offTrailScene();
    const doorX = s.glow.cx;
    const gaps = s.stones.map((st) => Math.hypot(doorX - st.cx, s.glow.cy - st.cy));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(s.stones[0].cx).toBeGreaterThan(s.tip.x);
    // each stone is no larger than the one before: the path narrows toward home
    for (let i = 1; i < s.stones.length; i++) expect(s.stones[i].rx).toBeLessThanOrEqual(s.stones[i - 1].rx);
  });

  it("frays the root at its tip, and keeps every light inside the door's glow", () => {
    const s = offTrailScene();
    expect(s.frays.length).toBeGreaterThanOrEqual(2);
    for (const f of s.frays) expect(f.startsWith(`M${s.tip.x} ${s.tip.y}`)).toBe(true);
    for (const l of s.lights) {
      const k = ((l.x - s.glow.cx) / s.glow.rx) ** 2 + ((l.y - s.glow.cy) / s.glow.ry) ** 2;
      expect(k).toBeLessThan(1);
    }
  });

  it("keeps every drawn point inside the view box, which starts where the drawing does", () => {
    const s = offTrailScene();
    for (const d of [s.root, s.door, ...s.frays]) {
      const v = nums(d.replace(/A[^L]*/g, ""));
      for (let i = 0; i + 1 < v.length; i += 2) {
        expect(v[i]).toBeGreaterThanOrEqual(0);
        expect(v[i]).toBeLessThanOrEqual(s.width);
        expect(v[i + 1]).toBeGreaterThanOrEqual(s.top);
        expect(v[i + 1]).toBeLessThanOrEqual(s.height);
      }
    }
  });
});

describe("crozierPath", () => {
  it("rises from the soil and curls inward, each turn smaller by the golden ratio", () => {
    const d = crozierPath(40, 66, 26, 9);
    const v = nums(d);
    expect(v.slice(0, 2)).toEqual([40, 66]);
    // the curl's centre sits one radius right of the stem's top
    const cx = 49;
    const cy = 40;
    const pts: [number, number][] = [];
    for (let i = 2; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
    const radii = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThanOrEqual(radii[i - 1] + 0.02);
    expect(radii[radii.length - 1]).toBeLessThan(radii[0] / 4);
  });
});

describe("ringOfPlaces", () => {
  it("puts equal places round the circle, the first at the top", () => {
    const p = ringOfPlaces(8, 80, 60, 42);
    expect(p).toHaveLength(8);
    expect(p[0].x).toBeCloseTo(80);
    expect(p[0].y).toBeCloseTo(18);
    for (const q of p) expect(Math.hypot(q.x - 80, q.y - 60)).toBeCloseTo(42);
  });

  it("holds the count to a ring that reads as a ring", () => {
    expect(ringOfPlaces(1, 0, 0, 1)).toHaveLength(3);
    expect(ringOfPlaces(40, 0, 0, 1)).toHaveLength(12);
  });
});

describe("restingBed", () => {
  it("rests each seed just above the soil line, spaced evenly", () => {
    const { seeds } = restingBed(220, 60, 3);
    expect(seeds).toHaveLength(3);
    const gaps = seeds.slice(1).map((s, i) => s.x - seeds[i].x);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]);
    for (const s of seeds) expect(s.y).toBeLessThan(60);
  });
});
