/**
 * THE NATURE KIT'S GEOMETRY. Pure maths, no React and no DOM, so every shape
 * the kit draws can be tested as numbers (game feel wave 2, 11 Nov 2026).
 *
 * Ported from the design lanes' mockups (lane 1's geo.js and lane 2's
 * templates) and made exact:
 *
 *   VOGEL'S MODEL (1979). A sunflower places seed n at angle n * 137.508
 *   degrees and radius c * sqrt(n). The golden angle is 2*pi*(1 - 1/phi), and
 *   because phi is the most irrational number no two seeds ever line up: the
 *   fireflies spread evenly at any count without a single hand-placed point.
 *
 *   THE SEED OF LIFE. Seven circles of radius r: one at the centre and six
 *   whose centres sit ON the first circle, sixty degrees apart. Every
 *   neighbouring pair meets as a vesica. It is drawn centre first, then the
 *   ring from the top, clockwise, one circle per step walked.
 *
 *   THE FLOWER OF LIFE (19). The same lattice one ring further out: six more
 *   centres at 2r on the same spokes, and six at r*sqrt(3) between them,
 *   ordered by angle so the outer ring also grows clockwise from the top.
 *   Every centre is a point of the triangular lattice of side r.
 *
 *   THE FERN. A bracketed Lindenmayer system with scale (Prusinkiewicz and
 *   Lindenmayer, "The Algorithmic Beauty of Plants", ch. 1 and 5): a frond
 *   is a stem with pairs of leaflets, and each leaflet is a smaller frond.
 *   The same rule at every scale is what makes it a fern.
 *
 *   THE VESICA PISCIS. Two circles of radius r whose centres are r apart. The
 *   lens where they overlap is r*sqrt(3) tall, the ratio the old builders
 *   called the measure of the fish.
 *
 *   THE ROOT. A seeded wandering thread with side hyphae that fork once more,
 *   the same rule at a smaller scale. Seeded, so it draws the same root on
 *   every render and in every test.
 */

export const PHI = (1 + Math.sqrt(5)) / 2;
/** 2*pi*(1 - 1/phi), about 137.508 degrees. */
export const GOLDEN_ANGLE = Math.PI * 2 * (1 - 1 / PHI);

/** Round to 2 decimals so path strings stay short and byte-stable. */
export const fx = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export interface Point {
  x: number;
  y: number;
}

/** Seed i (1-based) of Vogel's spiral: angle i * golden angle, radius c * sqrt(i). */
export function vogel(i: number, c = 1): Point & { angle: number; radius: number } {
  const angle = i * GOLDEN_ANGLE;
  const radius = c * Math.sqrt(i);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle, radius };
}

export const FIREFLIES_MIN = 5;
export const FIREFLIES_MAX = 8;

/** The brief's count: five to eight lights, whatever a caller asks for. */
export function clampFireflies(n: number): number {
  if (!Number.isFinite(n)) return FIREFLIES_MIN;
  return Math.max(FIREFLIES_MIN, Math.min(FIREFLIES_MAX, Math.round(n)));
}

export interface FireflySpot {
  /** Offset from the target's centre, as a fraction of the half-width (x) and half-height (y). */
  fx: number;
  fy: number;
  /** Seconds, varied by index so no two lights move together. */
  drift: number;
  pulse: number;
  delay: number;
}

/**
 * Fireflies around a target, by Vogel's model. The spiral's radius sqrt(i/n)
 * is lifted off the centre (`inner`) and stretched by `reach`, in units of the
 * act's own half-width and half-height, so with the defaults every light sits
 * just outside the act's edge (1.09 to 1.45): around it, never on its words.
 */
export function fireflySpots(count: number, inner = 0.75, reach = 1.45): FireflySpot[] {
  const n = clampFireflies(count);
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const { angle } = vogel(i);
    const rho = (inner + (1 - inner) * Math.sqrt(i / n)) * reach;
    return {
      fx: rho * Math.cos(angle),
      fy: rho * Math.sin(angle),
      drift: 8 + (i % 5),
      pulse: 2.8 + (i % 4) * 0.5,
      delay: -i * 0.37,
    };
  });
}

/** The Seed of Life's seven centres, centre first, then the ring clockwise from the top. */
export function seedOfLifeCentres(cx: number, cy: number, r: number): Point[] {
  const out: Point[] = [{ x: cx, y: cy }];
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** The Flower of Life's nineteen centres: the seed, then the outer ring by angle from the top. */
export function flowerOfLifeCentres(cx: number, cy: number, r: number): Point[] {
  const outer: Array<Point & { a: number }> = [];
  for (let k = 0; k < 6; k++) {
    const spoke = (k * Math.PI) / 3;
    const between = spoke + Math.PI / 6;
    outer.push({ a: spoke, x: cx + 2 * r * Math.sin(spoke), y: cy - 2 * r * Math.cos(spoke) });
    outer.push({ a: between, x: cx + Math.sqrt(3) * r * Math.sin(between), y: cy - Math.sqrt(3) * r * Math.cos(between) });
  }
  outer.sort((p, q) => p.a - q.a);
  return [...seedOfLifeCentres(cx, cy, r), ...outer.map(({ x, y }) => ({ x, y }))];
}

/** Where `total` steps sit: the seed's seven, or the flower's nineteen once a path is longer. */
export function lifeCentres(total: number, cx: number, cy: number, r: number): Point[] {
  const n = Math.max(1, Math.min(19, Math.floor(total)));
  return (n > 7 ? flowerOfLifeCentres(cx, cy, r) : seedOfLifeCentres(cx, cy, r)).slice(0, n);
}

/** The enclosing circle's radius: 2r round the seed, 3r round the flower. */
export function lifeBoundary(total: number, r: number): number {
  return total > 7 ? 3 * r : 2 * r;
}

export type CircleState = "closed" | "current" | "open";

/** One circle's state: closed once walked, the next one current, the rest open. */
export function circleState(i: number, walked: number, current?: number): CircleState {
  if (i < walked) return "closed";
  return i === (current ?? walked) ? "current" : "open";
}

/**
 * The bloom's petals: one vesica-shaped petal per spoke of the seed, its tip
 * on the enclosing circle. A petal is the lens two neighbouring circles make,
 * so the bloom is the seed's own geometry opening, never an added shape.
 */
export function petalPath(cx: number, cy: number, R: number): string {
  // A lens from the centre to (cx, cy - R): two arcs of radius R through both ends.
  return `M ${fx(cx)} ${fx(cy)} A ${fx(R)} ${fx(R)} 0 0 1 ${fx(cx)} ${fx(cy - R)} A ${fx(R)} ${fx(R)} 0 0 1 ${fx(cx)} ${fx(cy)} Z`;
}

/* ---------------- The fern: an L-system ---------------- */

/**
 * A fern frond as a bracketed L-system with scale (the frond of lane 1's
 * geo.js, written as a grammar). X is a frond: a stem segment, a pair of
 * leaflets that are each a smaller frond, then the stem goes on a little
 * shorter and a little bent, four times, and ends in a frond again. So every
 * leaflet is the whole fern in small, and the tip curls like a fiddlehead.
 *
 *   F  forward one step        + -  turn by the leaflet angle
 *   [ ]  save, restore         &  this branch's steps shrink to a leaflet's
 *   >  the stem's next step shrinks   )  the stem bends a few degrees
 */
export const FERN_AXIOM = "X";
export const FERN_RULES: Readonly<Record<string, string>> = { X: "F[+&X][-&X]>)F[+&X][-&X]>)F[+&X][-&X]>)F[+&X][-&X]>)FX" };
export const FERN_ANGLE_DEG = 58;
/** How the step changes: `&` into a leaflet, `>` along the stem. `)` bends by `bend` degrees. */
export const FERN_SCALE = { leaflet: 0.4, stem: 0.84, bend: 5, minStep: 0.05 } as const;

/** Rewrite the axiom n times. */
export function lsystem(axiom: string, rules: Readonly<Record<string, string>>, n: number): string {
  let s = axiom;
  for (let k = 0; k < n; k++) {
    let next = "";
    for (const c of s) next += rules[c] ?? c;
    s = next;
  }
  return s;
}

export interface Stroke {
  /** Bracket depth: 0 is the stem, each [ one branch further out. */
  depth: number;
  points: Point[];
}

export interface TurtleScale {
  /** `&` multiplies the step by this. */
  leaflet: number;
  /** `>` multiplies the step by this. */
  stem: number;
  /** `)` turns by this many degrees. */
  bend: number;
  /** Steps shorter than this are not drawn: a leaflet too small to see costs nothing. */
  minStep: number;
}

const NO_SCALE: TurtleScale = { leaflet: 1, stem: 1, bend: 0, minStep: 0 };

/**
 * Walk the string with a turtle. F draws one step forward; + and - turn;
 * [ and ] save and restore; & and > shrink the step; ) bends. Consecutive F
 * in the same heading extend one line, so a frond becomes a few hundred
 * strokes, and a leaflet below `minStep` is skipped whole.
 */
export function turtle(program: string, angleDeg: number, lean = 0, scale: TurtleScale = NO_SCALE): Stroke[] {
  const turn = (angleDeg * Math.PI) / 180;
  const bend = (scale.bend * Math.PI) / 180;
  let x = 0;
  let y = 0;
  let step = 1;
  let heading = -Math.PI / 2 + lean;
  const stack: Array<{ x: number; y: number; heading: number; step: number }> = [];
  const strokes: Stroke[] = [];
  let open: Stroke | null = null;
  let openHeading = NaN;
  let skip = 0;
  for (const c of program) {
    if (skip > 0) {
      // The skipped branch was already closed when the skip began; its own ] only ends the skip.
      if (c === "[") skip++;
      else if (c === "]") skip--;
      continue;
    }
    if (c === "F") {
      const nx = x + step * Math.cos(heading);
      const ny = y + step * Math.sin(heading);
      if (open && openHeading === heading) open.points[open.points.length - 1] = { x: nx, y: ny };
      else if (open) open.points.push({ x: nx, y: ny });
      else {
        open = { depth: stack.length, points: [{ x, y }, { x: nx, y: ny }] };
        strokes.push(open);
      }
      openHeading = heading;
      x = nx;
      y = ny;
    } else if (c === "+") heading += turn;
    else if (c === "-") heading -= turn;
    else if (c === ")") heading += bend;
    else if (c === ">") step *= scale.stem;
    else if (c === "&") {
      step *= scale.leaflet;
      // Too small to see: skip the rest of this branch up to its closing bracket.
      if (step < scale.minStep) {
        skip = 1;
        const s = stack.pop();
        if (s) ({ x, y, heading, step } = s);
        open = null;
      }
    } else if (c === "[") {
      stack.push({ x, y, heading, step });
      open = null;
    } else if (c === "]") {
      const s = stack.pop();
      if (s) ({ x, y, heading, step } = s);
      open = null;
    }
  }
  return strokes;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(strokes: readonly Stroke[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, maxX, maxY };
}

export interface FernDrawing {
  /** One path per bracket depth, stem first, each fitted into a 100 x 100 box. */
  layers: Array<{ depth: number; d: string }>;
  strokes: number;
  /** Where the stem starts, in the fitted box: the point the frond unfurls from. */
  base: Point;
}

/**
 * The fern, computed and fitted into a 100 x 100 viewBox with a margin.
 * Grouping by depth keeps the DOM to a handful of paths and lets the frond
 * draw stem first, then each order of leaflet.
 */
export function fern(iterations = 3, lean = 0.12, mirror = false): FernDrawing {
  const strokes = turtle(lsystem(FERN_AXIOM, FERN_RULES, iterations), FERN_ANGLE_DEG, lean, FERN_SCALE);
  const b = boundsOf(strokes);
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const scale = 92 / Math.max(w, h);
  const ox = 50 - ((b.minX + b.maxX) / 2) * scale;
  const oy = 96 - b.maxY * scale;
  const map = (p: Point): Point => {
    const X = p.x * scale + ox;
    return { x: mirror ? 100 - X : X, y: p.y * scale + oy };
  };
  const byDepth = new Map<number, string[]>();
  for (const s of strokes) {
    const pts = s.points.map(map);
    const d = `M${fx(pts[0].x)} ${fx(pts[0].y)}` + pts.slice(1).map((p) => `L${fx(p.x)} ${fx(p.y)}`).join("");
    const list = byDepth.get(s.depth) ?? [];
    list.push(d);
    byDepth.set(s.depth, list);
  }
  const layers = Array.from(byDepth.entries()).sort((a, b2) => a[0] - b2[0]).map(([depth, ds]) => ({ depth, d: ds.join("") }));
  return { layers, strokes: strokes.length, base: map({ x: 0, y: 0 }) };
}

/* ---------------- The vesica ---------------- */

export interface VesicaShape {
  left: Point;
  right: Point;
  r: number;
  /** The lens's height, r * sqrt(3) when the centres are r apart. */
  lensHeight: number;
  /** The lens as one path, empty when the circles do not overlap. */
  lens: string;
}

/** Two circles of radius r with centres `gap` apart, met at `gap = r`. */
export function vesica(cx: number, cy: number, r: number, gap = r): VesicaShape {
  const left = { x: cx - gap / 2, y: cy };
  const right = { x: cx + gap / 2, y: cy };
  if (gap >= 2 * r || gap <= 0) return { left, right, r, lensHeight: 0, lens: "" };
  const half = Math.sqrt(r * r - (gap / 2) * (gap / 2));
  const top = `${fx(cx)} ${fx(cy - half)}`;
  const bottom = `${fx(cx)} ${fx(cy + half)}`;
  return {
    left,
    right,
    r,
    lensHeight: 2 * half,
    lens: `M ${top} A ${fx(r)} ${fx(r)} 0 0 1 ${bottom} A ${fx(r)} ${fx(r)} 0 0 1 ${top} Z`,
  };
}

/* ---------------- The root ---------------- */

/** A small seeded generator (Park-Miller), so a root is the same root on every render. */
export function seeded(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface RootDrawing {
  /** The main thread, left to right across the strip. */
  main: string;
  /** Side hyphae, each forking once more. */
  hyphae: string[];
}

/**
 * A slim mycelial root across a `width` x `height` strip: one wandering thread
 * at `baseline` (0 top, 1 bottom), with `branches` side hyphae reaching up
 * (and down, when the thread runs along the middle), each forking once at a
 * smaller scale.
 */
export function rootStrip(width: number, height: number, branches = 6, seed = 7, baseline = 0.5): RootDrawing {
  const rnd = seeded(seed);
  const mid = height * baseline;
  // The thread wanders within the room it has, so a low root never leaves the strip.
  const wobble = height * Math.min(0.22, 1 - baseline, baseline) * 0.9;
  const n = 6;
  const pts: Point[] = Array.from({ length: n + 1 }, (_, k) => ({
    x: (width * k) / n,
    y: mid + (k === 0 || k === n ? 0 : (rnd() - 0.5) * 2 * wobble),
  }));
  let main = `M${fx(pts[0].x)} ${fx(pts[0].y)}`;
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1];
    const q = pts[k];
    const mx = (p.x + q.x) / 2;
    main += ` C${fx(mx)} ${fx(p.y)} ${fx(mx)} ${fx(q.y)} ${fx(q.x)} ${fx(q.y)}`;
  }
  const hyphae: string[] = [];
  const reach = height * 0.42;
  for (let b = 0; b < branches; b++) {
    const t = (b + 0.5 + (rnd() - 0.5) * 0.6) / branches;
    const x = width * t;
    const seg = Math.min(n - 1, Math.floor(t * n));
    const local = t * n - seg;
    const y = pts[seg].y + (pts[seg + 1].y - pts[seg].y) * (3 * local * local - 2 * local * local * local);
    // A root near the bottom reaches up only; one along the middle reaches both ways.
    const up = baseline > 0.6 || b % 2 === 0 ? -1 : 1;
    const len = Math.min(reach * (0.6 + rnd() * 0.4), (up < 0 ? baseline : 1 - baseline) * height * 0.85);
    const ex = x + len * (0.8 + rnd() * 0.6);
    const ey = y + up * len;
    hyphae.push(`M${fx(x)} ${fx(y)} Q${fx(x + len * 0.5)} ${fx(y + up * len * 0.1)} ${fx(ex)} ${fx(ey)}`);
    const fl = len * 0.5;
    hyphae.push(`M${fx(ex)} ${fx(ey)} q${fx(fl * 0.4)} ${fx(-up * fl * 0.1)} ${fx(fl)} ${fx(-up * fl * 0.35)}`);
  }
  return { main, hyphae };
}
