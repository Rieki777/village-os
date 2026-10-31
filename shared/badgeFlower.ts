/**
 * THE BADGE FLOWER: where each petal sits round a member's portrait.
 *
 * Rye's ask (call with Rick, 2026-10-30): the badges a member holds sit on the
 * edge of the profile picture as petals, so the portrait reads as a flower, and
 * the arrangement stays in balance at every count. Three badges are a
 * three-petal flower, five a five-petal one, and a hundred look like a
 * sunflower.
 *
 * Pure geometry, no DOM and no React, so it is tested here and drawn anywhere.
 * Every length is in VIEWBOX UNITS of a square box centred on the portrait,
 * running from -VIEW_R to VIEW_R. The portrait's own edge sits at
 * PORTRAIT_R, which is the XP ring's outer edge in ProfileHero's 260 box.
 *
 * ── TWO REGIMES, AND WHY THE SWITCH IS AT THIRTEEN ──────────────────────────
 *
 * Up to RING_MAX petals, ONE EVEN RING: petal k at start + k * 360°/n, so the
 * gaps are all equal and six o'clock, where the stage chip sits, is always a
 * gap (an odd ring starts at twelve, an even one half a step round). That is
 * exactly the symmetry a small count should have, and a phyllotaxis spiral of
 * five points is lopsided, because the golden angle only balances in the long
 * run.
 *
 * Past RING_MAX, a ring of thin slivers stops reading as petals, so the petals
 * move to VOGEL'S MODEL squeezed into an annulus round the face: petal k turns
 * by the golden angle (about 137.5°) and its radius grows with the square root
 * of k, which gives every petal an equal share of the annulus's AREA. The plain
 * Vogel disc would start at the centre and cover the face, so the square root
 * runs from the inner radius to the outer one instead of from zero. Thirteen
 * is a Fibonacci number and sits in the 8 to 13 band Rye suggested.
 *
 * ── PETALS SHRINK AS THE COUNT GROWS ─────────────────────────────────────────
 *
 * In the ring a petal's width is a share of the circumference and its length
 * eases down from PETAL_MAX_LEN. In the spiral a petal's size is the square
 * root of its share of the annulus, clamped so a hundred and forty-four still
 * read as petals and fourteen do not swell past the ring's own.
 *
 * ── THE SEAM FOR SACRED GEOMETRY (Rick, later) ──────────────────────────────
 *
 * Every petal carries its whole item, `kind` included, so a later arrangement
 * that groups genres into their own figures can be a third regime here, keyed
 * off kind, without the drawing code changing. Nothing reads kind for layout
 * today.
 */

/** Half the viewBox: petals never reach past this. */
export const VIEW_R = 180;
/** The portrait's edge, the XP ring's outer edge included. */
export const PORTRAIT_R = 130;
/** Where a ring petal's base sits, tucked under the portrait's edge. */
export const RING_BASE_R = 112;
/** One even ring up to this many petals, the spiral beyond it. */
export const RING_MAX = 13;
/** The largest petal, for one to three badges. */
export const PETAL_MAX_LEN = 64;
/** The smallest a petal gets, however many there are. */
export const PETAL_MIN_SIZE = 7;
/** The golden angle, 360° * (2 - phi), in degrees. */
export const GOLDEN_ANGLE = 180 * (3 - Math.sqrt(5));

/** The spiral's annulus: petal bases run between these two radii. */
const SPIRAL_IN = 118;
const SPIRAL_OUT = 150;
/** The widest spiral petal: smaller than the last ring petal, so fourteen never outgrow thirteen. */
const SPIRAL_MAX_W = 22;

export interface Petal<T> {
  /** The badge this petal is, kind and all. */
  item: T;
  /** Its rank in the list it came from, 0 first. */
  index: number;
  /** The petal's BASE, in viewBox units from the centre. */
  x: number;
  y: number;
  /** Which way it points, in degrees clockwise from three o'clock (SVG's frame). */
  angle: number;
  length: number;
  width: number;
}

export interface FlowerLayout<T> {
  mode: "none" | "ring" | "spiral";
  /** In DRAW ORDER: outermost first, so inner petals overlap outer ones. */
  petals: Petal<T>[];
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Where k of n sits, and its size, before it is attached to an item. */
function place(k: number, n: number, ringMax: number): Omit<Petal<never>, "item" | "index"> {
  if (n <= ringMax) {
    // An odd ring stands a petal at twelve o'clock and leaves a gap at six; an
    // even ring turns half a step, so six o'clock is a gap there too. The stage
    // chip sits at six, and a petal hidden behind it reads as a missing one.
    const start = n % 2 ? -90 : -90 + 180 / n;
    const angle = start + (k * 360) / n;
    // 64 at one to three petals, easing to 50 at the ring's limit.
    const length = PETAL_MAX_LEN - Math.max(0, n - 3) * 1.4;
    const share = (2 * Math.PI * RING_BASE_R) / n;
    const width = Math.min(length * 0.95, share);
    const rad = (angle * Math.PI) / 180;
    return { x: RING_BASE_R * Math.cos(rad), y: RING_BASE_R * Math.sin(rad), angle, length, width };
  }
  const area = (Math.PI * (SPIRAL_OUT ** 2 - SPIRAL_IN ** 2)) / n;
  const width = Math.max(PETAL_MIN_SIZE, Math.min(SPIRAL_MAX_W, Math.sqrt(area) * 1.15));
  const length = width * 1.6;
  // The outermost base pulls in by the petal's own length, so no tip leaves the box.
  const out = Math.min(SPIRAL_OUT, VIEW_R - 2 - length);
  const r = Math.sqrt(SPIRAL_IN ** 2 + ((k + 0.5) / n) * (out ** 2 - SPIRAL_IN ** 2));
  const angle = (((-90 + k * GOLDEN_ANGLE) % 360) + 360) % 360;
  const rad = (angle * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad), angle, length, width };
}

/**
 * Lay the petals out for these items, in the order given. The caller decides
 * the order (featured first is what the badge door already returns).
 */
export function flowerLayout<T>(items: readonly T[], opts: { ringMax?: number } = {}): FlowerLayout<T> {
  const n = items.length;
  if (n === 0) return { mode: "none", petals: [] };
  const ringMax = Math.max(1, Math.floor(opts.ringMax ?? RING_MAX));
  const petals = items.map((item, index) => {
    const p = place(index, n, ringMax);
    return {
      item,
      index,
      x: round(p.x),
      y: round(p.y),
      angle: round(p.angle),
      length: round(p.length),
      width: round(p.width),
    };
  });
  if (n <= ringMax) return { mode: "ring", petals };
  // The spiral's radius grows with the index, so reversing it draws outermost first.
  return { mode: "spiral", petals: petals.slice().reverse() };
}

/**
 * How far a petal's tip reaches from the centre. The tests hold every layout
 * inside VIEW_R with this.
 */
export function tipRadius(p: Pick<Petal<unknown>, "x" | "y" | "angle" | "length">): number {
  const rad = (p.angle * Math.PI) / 180;
  return Math.hypot(p.x + p.length * Math.cos(rad), p.y + p.length * Math.sin(rad));
}

/**
 * One petal as an SVG path, drawn pointing along +x from its base at the
 * origin: two quadratic curves meeting at the tip, the widest point a third of
 * the way out. Place it with `translate(x y) rotate(angle)`.
 */
export function petalPath(length: number, width: number): string {
  const l = round(length);
  const w = round(width * 0.66);
  const mid = round(length * 0.38);
  return `M0 0Q${mid} ${-w} ${l} 0Q${mid} ${w} 0 0Z`;
}

/**
 * The petals that fit, and how many did not. A phone portrait shows fewer
 * petals than a desktop one and says how many more there are.
 */
export function capPetals<T>(items: readonly T[], cap: number): { shown: T[]; more: number } {
  const c = Math.max(0, Math.floor(cap));
  return { shown: items.slice(0, c), more: Math.max(0, items.length - c) };
}
