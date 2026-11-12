/**
 * THE HEARTHS' GEOMETRY (Phase D, D2): pure shapes for the circles map's
 * living layer, drawn by HearthLens through PowerMap's `lenses` seam.
 *
 *  - `hearthThreads`: which circles a mycelial thread joins. A circle-to-circle
 *    relation the village declared, and each circle to its neighbours inside
 *    the same container, counted round the container clockwise. A thread
 *    carries no count and no order: it says these two are joined.
 *  - `threadPath`: one thread from edge to edge, a gentle quadratic with two
 *    short hyphae off it, seeded by the pair so it never changes between
 *    renders.
 *  - `hearthLights`: where a hearth's fireflies sit, on Vogel's golden-angle
 *    spiral inside the hearth (the sunflower's packing, the kit's
 *    `fireflySpots` rule), held to the kit's five to eight at most.
 *
 * Everything here takes numbers and gives numbers or path strings. Nothing
 * decides what a light means: shared/mapLight.ts does that.
 */
import { FIREFLIES_MAX, GOLDEN_ANGLE, fx, seeded } from "@/components/journey/nature/geometry";

export interface Disc {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface ThreadPair {
  a: string;
  b: string;
  /** Declared by the village (a relation) or by where the circles sit (siblings). */
  kind: "declared" | "kin";
}

/** A stable seed for a pair, the same whichever end is named first. */
export function pairSeed(a: string, b: string): number {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 || 1;
}

const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The threads to draw. `parentOf` says which container a circle sits in (null
 * for the village); `relations` are the village's declared circle links.
 * A pair appears once, declared winning over kin.
 */
export function hearthThreads(
  discs: readonly Disc[],
  parentOf: (id: string) => string | null,
  relations: ReadonlyArray<{ fromKind: string; fromId: string; toKind: string; toId: string }>,
): ThreadPair[] {
  const known = new Map(discs.map((d) => [d.id, d] as const));
  const out = new Map<string, ThreadPair>();

  for (const r of relations) {
    if (r.fromKind !== "circle" || r.toKind !== "circle" || r.fromId === r.toId) continue;
    if (!known.has(r.fromId) || !known.has(r.toId)) continue;
    out.set(keyOf(r.fromId, r.toId), { a: r.fromId, b: r.toId, kind: "declared" });
  }

  const groups = new Map<string, Disc[]>();
  for (const d of discs) {
    const p = parentOf(d.id) ?? "";
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(d);
  }
  for (const [, members] of Array.from(groups.entries())) {
    if (members.length < 2) continue;
    const cx = members.reduce((s, d) => s + d.x, 0) / members.length;
    const cy = members.reduce((s, d) => s + d.y, 0) / members.length;
    // Clockwise from twelve o'clock, so the ring reads the way the phone's keys count.
    const turn = (d: Disc) => (Math.atan2(d.x - cx, -(d.y - cy)) + Math.PI * 2) % (Math.PI * 2);
    const ring = members.slice().sort((p, q) => turn(p) - turn(q) || (p.id < q.id ? -1 : 1));
    const n = ring.length;
    // Two circles share one thread; three or more close their ring.
    const links = n === 2 ? 1 : n;
    for (let i = 0; i < links; i++) {
      const a = ring[i].id;
      const b = ring[(i + 1) % n].id;
      const k = keyOf(a, b);
      if (!out.has(k)) out.set(k, { a, b, kind: "kin" });
    }
  }
  return Array.from(out.values()).sort((p, q) => (keyOf(p.a, p.b) < keyOf(q.a, q.b) ? -1 : 1));
}

export interface ThreadDrawing {
  /** The thread itself, edge to edge. */
  main: string;
  /** Two short hyphae reaching off it. */
  hyphae: string[];
}

/**
 * One thread between two discs, leaving each at its edge. Null when the two
 * overlap, which has no gap for a thread to cross.
 */
export function threadPath(a: Disc, b: Disc, seed: number = pairSeed(a.id, b.id)): ThreadDrawing | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (!(dist > a.r + b.r)) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = a.x + ux * a.r;
  const sy = a.y + uy * a.r;
  const ex = b.x - ux * b.r;
  const ey = b.y - uy * b.r;
  const gap = dist - a.r - b.r;
  const rand = seeded(seed);
  // The sway: up to a fifth of the gap, to one side or the other.
  const sway = (rand() * 2 - 1) * gap * 0.2;
  const mx = (sx + ex) / 2 - uy * sway;
  const my = (sy + ey) / 2 + ux * sway;
  const main = `M${fx(sx)} ${fx(sy)} Q${fx(mx)} ${fx(my)} ${fx(ex)} ${fx(ey)}`;

  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * sx + 2 * u * t * mx + t * t * ex,
      y: u * u * sy + 2 * u * t * my + t * t * ey,
    };
  };
  const hyphae: string[] = [];
  for (const [t, side] of [[0.35, 1], [0.68, -1]] as const) {
    const p = at(t);
    const len = gap * (0.08 + rand() * 0.06);
    const lean = 0.5 + rand() * 0.4;
    // Off the thread to one side, leaning forward the way the thread runs.
    const hx = p.x + (-uy * side * (1 - lean) + ux * lean) * len;
    const hy = p.y + (ux * side * (1 - lean) + uy * lean) * len;
    hyphae.push(`M${fx(p.x)} ${fx(p.y)} L${fx(hx)} ${fx(hy)}`);
  }
  return { main, hyphae };
}

export interface LightSpot {
  x: number;
  y: number;
  /** Drift and pulse lengths in seconds, and a start offset, so no two move as one. */
  drift: number;
  pulse: number;
  delay: number;
}

/**
 * Where `n` fireflies sit at a hearth of radius `r` centred at (cx, cy):
 * Vogel's spiral, its outermost light at `reach` of the radius. Never more
 * than the kit's eight.
 */
export function hearthLights(cx: number, cy: number, r: number, n: number, reach = 0.62): LightSpot[] {
  const count = Math.max(0, Math.min(FIREFLIES_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
  if (count === 0) return [];
  const c = (r * reach) / Math.sqrt(count);
  const out: LightSpot[] = [];
  for (let i = 1; i <= count; i++) {
    const angle = i * GOLDEN_ANGLE;
    const radius = c * Math.sqrt(i);
    out.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      drift: 7 + ((i * 3) % 5),
      pulse: 2.8 + ((i * 7) % 4) * 0.45,
      delay: (i * 0.618) % 2.4,
    });
  }
  return out;
}
