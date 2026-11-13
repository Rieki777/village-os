/**
 * THE QUIET STATES' DRAWINGS, as pure geometry (Phase B, lane B3).
 *
 * A quiet state is a page with nothing to show yet: a loader, an empty list,
 * the 404. Each one stands in the night world with one drawing, one sentence
 * and one door (docs/DESIGN_RULE.md, "Fields, empty and loading states").
 * This file is the shapes and nothing else, so each can be tested as maths
 * and drawn the same on every render: no randomness, no clock, no data about
 * a person. Nothing here counts or ranks anyone; an empty ring of faces is
 * a ring with no names on it.
 *
 * The structure under the drawings is the kit's own (components/journey/
 * nature/geometry.ts): the golden ratio for the crozier's curl, Vogel's
 * golden angle for the door's lights.
 */
import { GOLDEN_ANGLE, PHI, fx, type Point } from "@/components/journey/nature/geometry";

/** A path through points, each rounded so a drawing never changes between renders. */
export function polyline(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fx(p.x)} ${fx(p.y)}`).join(" ");
}

/**
 * A fern's crozier (the fiddlehead): a stem rising from the ground that curls
 * into a golden spiral, its radius shrinking by phi every quarter turn, the
 * way a frond waits before it unfurls. `x, base` is where the stem meets the
 * soil, `height` how tall it stands, `r` the curl's outer radius.
 */
export function crozierPath(x: number, base: number, height: number, r: number, turns = 2.25): string {
  const top = base - height;
  // The spiral's centre sits one radius to the right of the stem's top, so the
  // stem flows into the curl heading up and the curl turns inward clockwise.
  const cx = x + r;
  const cy = top;
  const pts: Point[] = [{ x, y: base }];
  const steps = Math.round(turns * 24);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2;
    const rr = r * Math.pow(PHI, -t / (Math.PI / 2));
    // Start at the stem (angle pi, the left of the centre) and turn clockwise on screen.
    const a = Math.PI + t;
    pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
  }
  return polyline(pts);
}

/**
 * An empty ring of faces: `n` places around a circle, the first at the top,
 * in order. The places are equal on purpose; none is first in any other sense.
 */
export function ringOfPlaces(n: number, cx: number, cy: number, r: number): Point[] {
  const count = Math.max(3, Math.min(12, Math.round(n)));
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** A bed of resting soil: a gentle mound line and `count` seeds resting along it. */
export function restingBed(width: number, baseline: number, count = 3): { soil: string; seeds: Point[] } {
  const n = Math.max(1, Math.min(5, Math.round(count)));
  const lift = 12;
  const soil = `M${fx(width * 0.04)} ${fx(baseline)} Q${fx(width / 2)} ${fx(baseline - lift)} ${fx(width * 0.96)} ${fx(baseline)}`;
  const seeds = Array.from({ length: n }, (_, i) => {
    const x = width * (0.04 + (0.92 * (i + 1)) / (n + 1));
    // The quadratic's height at this x, so each seed rests on the soil line.
    const t = (x - width * 0.04) / (width * 0.92);
    const y = baseline - 2 * t * (1 - t) * lift;
    return { x, y: y - 3 };
  });
  return { soil, seeds };
}

export interface Stone {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface OffTrailScene {
  width: number;
  height: number;
  /** The first row anything is drawn on: the view box starts here, so no empty sky sits above the trail. */
  top: number;
  /** The ground, a filled band along the bottom. */
  ground: string;
  /** The ground's edge, drawn as a line. */
  groundEdge: string;
  /** The root that wandered off the trail. */
  root: string;
  /** Where the root ends, frayed. */
  tip: Point;
  /** The frayed ends: short hyphae reaching out of the tip. */
  frays: string[];
  /** Stepping stones from the frayed tip toward the door, each a little smaller. */
  stones: Stone[];
  /** The door: an arch standing on the ground. */
  door: string;
  /** Soft light around the door. */
  glow: Stone;
  /** A few still points of light at the door, on Vogel's golden angle. */
  lights: (Point & { r: number })[];
}

/**
 * THE 404: a root that wandered off the trail and frays at its end, a short
 * path of stepping stones from there, and a lit door home. The page's one act
 * is that door; the drawing only shows the way to it.
 */
export function offTrailScene(): OffTrailScene {
  const width = 520;
  const height = 300;
  const root = "M20 120 C70 110 110 140 150 128 S200 100 220 112";
  const tip = { x: 220, y: 112 };
  // Three short frayed ends, fanned at fixed angles so the drawing is the same every time.
  const frays = [-0.55, -0.1, 0.4].map((a, i) => {
    const len = 16 - i * 3;
    const mid = { x: tip.x + (len / 2) * Math.cos(a), y: tip.y + (len / 2) * Math.sin(a) + (i - 1) * 2 };
    const end = { x: tip.x + len * Math.cos(a + 0.25), y: tip.y + len * Math.sin(a + 0.25) };
    return `M${fx(tip.x)} ${fx(tip.y)} Q${fx(mid.x)} ${fx(mid.y)} ${fx(end.x)} ${fx(end.y)}`;
  });
  const door = { x: 450, sill: 238, half: 26, top: 182 };
  const stones: Stone[] = [
    { cx: 238, cy: 170, rx: 15, ry: 6 },
    { cx: 284, cy: 196, rx: 14, ry: 6 },
    { cx: 334, cy: 214, rx: 13, ry: 6 },
    { cx: 386, cy: 226, rx: 12, ry: 5.5 },
  ];
  const lights = Array.from({ length: 9 }, (_, k) => {
    const i = k + 1;
    const a = i * GOLDEN_ANGLE;
    const rr = 7 * Math.sqrt(i);
    return { x: door.x + rr * Math.cos(a) * 1.4, y: 172 + rr * Math.sin(a), r: i > 5 ? 1.3 : 2 };
  });
  return {
    width,
    height,
    top: 80,
    ground: "M0 262 C120 240 240 276 520 250 L520 300 L0 300 Z",
    groundEdge: "M0 262 C120 240 240 276 520 250",
    root,
    tip,
    frays,
    stones,
    door: `M${door.x - door.half} ${door.sill} L${door.x - door.half} ${door.top} A${door.half} ${door.half} 0 0 1 ${door.x + door.half} ${door.top} L${door.x + door.half} ${door.sill} Z`,
    glow: { cx: door.x, cy: 200, rx: 60, ry: 70 },
    lights,
  };
}
