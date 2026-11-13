/**
 * GRATITUDE THREADS: the arithmetic under the wall, kept apart from React so
 * every rule it holds can be tested as a rule.
 *
 * A thanks is a thread between two people. The page draws three things from
 * the same wall payload: the threads as cards (newest first), a vesica where a
 * pair thanked each other both ways, and the web this moon (faces on a ring,
 * threads between pairs).
 *
 * ── WHAT THIS FILE REFUSES TO COMPUTE ────────────────────────────────────
 *
 * The lead's ruling for Phase C (decision 4): threads never show a count and
 * never order people by how many thanks they have. So nothing here returns a
 * number about a person. There is no "threads per person", no weight on a
 * thread for how many times a pair thanked each other, and the ring is ordered
 * by NAME, which carries no claim about anybody. A pair who thanked each other
 * five times draws the same single thread as a pair who did once.
 *
 * The amount on a `WallEntry` is never read here. It stays on the payload for
 * the ledger's sake and the page never draws it.
 */
import type { WallEntry, WallPerson } from "@shared/gratitudeVoices";

export interface Point {
  x: number;
  y: number;
}

/**
 * Who a side of a thanks is, as a stable key.
 *
 * The handle when there is one, because that is what addresses a person here.
 * A deleted account keeps only its recorded name, so it falls back to that.
 * Two different people with no handle and the same name share a key, which
 * only ever merges two tombstones on the drawing.
 */
export function personKey(p: WallPerson): string {
  return p.handle ? `@${p.handle.toLowerCase()}` : `name:${(p.name || "").trim().toLowerCase()}`;
}

/** One key for a pair, the same whichever of the two sent. */
export function pairKey(a: WallPerson, b: WallPerson): string {
  const [x, y] = [personKey(a), personKey(b)].sort();
  return `${x}|${y}`;
}

const time = (e: WallEntry): number => {
  const t = Date.parse(e.at);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The newest thanks first.
 *
 * The server already sends them newest first, and this does not trust that:
 * the order is the one promise the lead made about the wall, so the page holds
 * it itself. Stable, so two thanks with the same moment keep the server's
 * order, and a row with no readable date sinks to the end without moving the
 * others.
 */
export function newestFirst(entries: readonly WallEntry[]): WallEntry[] {
  return entries
    .map((e, i) => ({ e, i, t: time(e) }))
    .sort((a, b) => (b.t === a.t ? a.i - b.i : b.t - a.t))
    .map((x) => x.e);
}

/**
 * Pairs who thanked each other both ways, as pair keys.
 *
 * A thanks that went both ways draws a vesica: two circles meeting, each still
 * whole. It is a fact about the PAIR and says nothing about how often.
 */
export function bothWays(entries: readonly WallEntry[]): Set<string> {
  const directed = new Set(entries.map((e) => `${personKey(e.from)}>${personKey(e.to)}`));
  const out = new Set<string>();
  for (const e of entries) {
    if (directed.has(`${personKey(e.to)}>${personKey(e.from)}`)) out.add(pairKey(e.from, e.to));
  }
  return out;
}

/** The thanks from `since` onward (this moon, when given the moon's start). */
export function sinceMoment(entries: readonly WallEntry[], since: string | null | undefined): WallEntry[] {
  const start = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(start)) return [];
  return entries.filter((e) => time(e) >= start);
}

/** How a name sorts on the ring: case and accents set aside, so "Ána" sits with "Ana". */
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * The faces on the ring, in alphabetical order by name.
 *
 * Alphabetical, and nothing else. A ring ordered by activity would put the
 * busiest person at the top of the drawing, which is a leaderboard drawn as a
 * circle. Ties on the name fall back to the key so the order is total and the
 * drawing does not shuffle between renders.
 */
export function ringPeople(entries: readonly WallEntry[]): WallPerson[] {
  const byKey = new Map<string, WallPerson>();
  for (const e of entries) {
    for (const p of [e.from, e.to]) {
      const k = personKey(p);
      if (!byKey.has(k)) byKey.set(k, p);
    }
  }
  return Array.from(byKey.entries())
    .sort(([ka, a], [kb, b]) => collator.compare(a.name || "", b.name || "") || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, p]) => p);
}

export interface Thread {
  key: string;
  a: WallPerson;
  b: WallPerson;
  /** Both ways: each of the two thanked the other. */
  mutual: boolean;
}

/**
 * One thread per pair, however many thanks passed between them.
 *
 * In the order the pairs first appear in `entries` (the page passes them
 * newest first), which is a fact about time and none about a person.
 */
export function webThreads(entries: readonly WallEntry[]): Thread[] {
  const mutual = bothWays(entries);
  const seen = new Map<string, Thread>();
  for (const e of entries) {
    if (personKey(e.from) === personKey(e.to)) continue;
    const key = pairKey(e.from, e.to);
    if (!seen.has(key)) seen.set(key, { key, a: e.from, b: e.to, mutual: mutual.has(key) });
  }
  return Array.from(seen.values());
}

/**
 * Places on a ring of `n`, the first at the top, going clockwise.
 */
export function ringPlaces(n: number, cx: number, cy: number, r: number): Point[] {
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

/**
 * A thread between two faces: a curve that bows toward the middle of the
 * ring, the way a strand of mycelium sags between two roots. `bend` is how
 * far the control point moves from the chord's midpoint toward the centre,
 * as a share of that distance.
 */
export function threadPath(a: Point, b: Point, centre: Point, bend = 0.45): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx + (centre.x - mx) * bend;
  const cy = my + (centre.y - my) * bend;
  return `M${f(a.x)} ${f(a.y)} Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`;
}

/** The first letter a face shows when it has no portrait. */
export function initialOf(p: WallPerson): string {
  return (p.name || "?").trim().charAt(0).toUpperCase() || "?";
}

/** A first name for the ring's labels, where the width is a face's. */
export function firstNameOf(p: WallPerson): string {
  return (p.name || "").trim().split(/\s+/)[0] ?? "";
}
