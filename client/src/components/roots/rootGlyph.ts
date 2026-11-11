/**
 * A SMALL ROOT, as geometry (the five archetypes as roots, 11 Nov 2026).
 *
 * Each archetype is drawn as its own little root system under a soil line,
 * with a seed of firefly light at the crown where the root meets the ground.
 * The shape is a branching rule applied at every scale (a fractal, the nature
 * kit's L-system idea at the size of a word), and it is SEEDED by the root's
 * key, so the Builder's root is the same root on every page and every render,
 * and a village's own sixth archetype gets a root of its own with no art.
 *
 * Pure maths, no React, so it is tested as numbers and ships nothing but
 * strings. Drawn in a 24 x 24 box; the component scales it.
 */

export interface RootGlyphDrawing {
  /** The soil line the root hangs from. */
  soil: string;
  /** The crown: where root meets ground, drawn as a seed of light. */
  crown: { x: number; y: number };
  /** The root strokes, thickest first. */
  strokes: Array<{ d: string; width: number }>;
}

const SIZE = 24;
const CROWN_Y = 6;

/** Park-Miller, the same generator the nature kit uses, kept local so this file imports nothing. */
function seeded(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A stable number from a key: the same key, the same root, everywhere. */
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 || 7;
}

const fx = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * The root for one key. Three generations: a taproot from the crown, two or
 * three side roots off it, and finer rootlets off those, each shorter and
 * thinner by the same ratio, bending gently as roots do.
 */
export function rootGlyph(key: string): RootGlyphDrawing {
  const rnd = seeded(seedOf(key));
  const crown = { x: SIZE / 2, y: CROWN_Y };
  const strokes: RootGlyphDrawing["strokes"] = [];

  const grow = (x: number, y: number, angle: number, len: number, depth: number, width: number) => {
    // Downward is +y. `angle` is measured from straight down, in radians.
    const ex = Math.max(1, Math.min(SIZE - 1, x + Math.sin(angle) * len));
    const ey = Math.max(CROWN_Y + 1, Math.min(SIZE - 1, y + Math.cos(angle) * len));
    const bend = (rnd() - 0.5) * len * 0.5;
    const cx = (x + ex) / 2 + Math.cos(angle) * bend;
    const cy = (y + ey) / 2 - Math.sin(angle) * bend * 0.3;
    strokes.push({ d: `M${fx(x)} ${fx(y)} Q${fx(cx)} ${fx(cy)} ${fx(ex)} ${fx(ey)}`, width });
    if (depth === 0) return;
    const kids = depth === 2 ? 2 + Math.floor(rnd() * 2) : 2;
    for (let k = 0; k < kids; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const spread = (0.45 + rnd() * 0.35) * side;
      // A side root leaves partway down its parent, the way roots do.
      const t = 0.45 + rnd() * 0.4;
      const sx = x + (ex - x) * t;
      const sy = y + (ey - y) * t;
      grow(sx, sy, angle + spread, len * (0.55 + rnd() * 0.12), depth - 1, width * 0.62);
    }
  };

  const lean = (rnd() - 0.5) * 0.35;
  grow(crown.x, crown.y, lean, 11 + rnd() * 4, 2, 1.6);

  // The soil: a gentle arc, a little wider than the root below it.
  const soil = `M3 ${fx(CROWN_Y + 0.4)} Q${fx(SIZE / 2)} ${fx(CROWN_Y - 1.2)} ${SIZE - 3} ${fx(CROWN_Y + 0.4)}`;
  return { soil, crown, strokes };
}
