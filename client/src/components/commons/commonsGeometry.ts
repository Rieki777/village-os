/**
 * THE COMMONS AS GEOMETRY (Phase D, decision 2): where each of the season's
 * goals sits, and how its moss grows. Pure maths, so the drawing is the same
 * on every render and on every screen.
 *
 * Up to seven goals sit on the Seed of Life's lattice, centre first and then
 * the ring clockwise from the top, the way the nature kit grows a seed. More
 * than seven sit on Vogel's golden-angle spiral (the sunflower's packing),
 * each goal one equal circle, so every goal is drawn and none is left out.
 * The Flower of Life is kept for a live gathering and is never used here.
 *
 * Moss is the village's shared work spreading inside a goal's circle: the
 * same golden-angle packing, filled to the share it is given. A goal the
 * village has reached is all moss with a small flower at its heart; a goal
 * not reached yet holds one seed. Nothing here knows a person.
 */
import { GOLDEN_ANGLE, seedOfLifeCentres, type Point } from "@/components/journey/nature/geometry";

/** The drawing's box: 0..100 on both axes, centred on 50. */
export const VIEW = 100;
const CX = 50;
const CY = 50;
/** The outermost edge any circle reaches, inside the box with room for a stroke. */
const EDGE = 46;
/** Goals the Seed of Life's lattice holds. */
export const SEED_GOALS = 7;
/** The densest moss a whole circle holds, in dots. */
export const MOSS_FULL = 64;

export interface GoalCircle extends Point {
  r: number;
}

export interface CommonsLayout {
  circles: GoalCircle[];
  /** The enclosing circle round them all. */
  boundary: number;
  shape: "none" | "seed" | "spiral";
}

/** Where `n` goals sit in the box. */
export function commonsLayout(n: number): CommonsLayout {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return { circles: [], boundary: 0, shape: "none" };
  if (count <= SEED_GOALS) {
    // The seed's boundary is 2r, so r = EDGE / 2 keeps the ring inside the box.
    const r = count === 1 ? EDGE * 0.7 : EDGE / 2;
    const centres = seedOfLifeCentres(CX, CY, r).slice(0, count);
    return { circles: centres.map((p) => ({ ...p, r })), boundary: count === 1 ? r : 2 * r, shape: "seed" };
  }
  // Vogel: point i sits at radius c * sqrt(i + 0.5). The outermost centre plus a circle's
  // radius must stay inside EDGE, and a circle is a little wider than the spacing so
  // neighbours overlap the way the seed's circles do.
  const spread = 1.05;
  const c = EDGE / (Math.sqrt(count - 0.5) + spread);
  const r = c * spread;
  const circles = Array.from({ length: count }, (_, i) => {
    const radius = c * Math.sqrt(i + 0.5);
    const a = -Math.PI / 2 + i * GOLDEN_ANGLE;
    return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a), r };
  });
  return { circles, boundary: EDGE, shape: "spiral" };
}

export interface MossDot extends Point {
  /** The dot's radius, a little varied so the moss reads as living. */
  size: number;
  /** One in nine catches the light. */
  lit: boolean;
  /** Its place in the growth, 0 first to 1 last, for the one-time spread. */
  order: number;
}

/**
 * The moss inside one circle, filled to `share` (0 nothing, 1 the whole
 * circle). Dots are packed on the golden angle from the centre outward, so
 * moss always spreads from the heart of the goal to its edge.
 */
export function mossDots(circle: GoalCircle, share: number): MossDot[] {
  const s = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  const n = Math.round(MOSS_FULL * s);
  const out: MossDot[] = [];
  for (let i = 1; i <= n; i++) {
    const rr = circle.r * 0.94 * Math.sqrt(i / MOSS_FULL);
    const a = i * GOLDEN_ANGLE;
    out.push({
      x: circle.x + rr * Math.cos(a),
      y: circle.y + rr * Math.sin(a),
      size: (circle.r / 23) * (0.75 + ((i * 7) % 5) * 0.16),
      lit: i % 9 === 0,
      order: n > 1 ? (i - 1) / (n - 1) : 0,
    });
  }
  return out;
}

/** How far moss has spread in a goal: all of it once the village reached it, none before. */
export function mossShare(goal: { done: boolean }): number {
  return goal.done ? 1 : 0;
}

/** The six petals of the small flower at a reached goal's heart, as rotations. */
export const PETALS = [0, 60, 120, 180, 240, 300] as const;
