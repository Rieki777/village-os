/**
 * The radial map's layout (S20): a PURE function of the data — no DOM, no
 * randomness, no time. Determinism is the feature: a member's spatial memory
 * of "permaculture is at two o'clock" must survive every visit, so positions
 * depend only on sortOrder and index, never on render order or jitter.
 */
import { isCircleLayer, type CircleLayer } from "./circleView";

export interface LayoutCircle {
  id: string;
  order: number;
  memberCount: number;
  roles: Array<{ id: string; vacant: boolean }>;
  questCount: number;
}

export interface CirclePosition {
  id: string;
  x: number;
  y: number;
  r: number;
  angle: number;
  roles: Array<{ id: string; x: number; y: number; vacant: boolean }>;
  /** Quest satellites rendered; the rest collapse into a "+n more" chip. */
  questDots: Array<{ x: number; y: number }>;
  questOverflow: number;
}

export interface MapLayout {
  width: number;
  height: number;
  center: { x: number; y: number };
  circles: CirclePosition[];
}

export const CANVAS = 1000;
const ORBIT_RADIUS = 340;
const MIN_CIRCLE_R = 34;
const CIRCLE_R_K = 9;
const ROLE_ORBIT = 62;
const QUEST_ORBIT = 92;
export const QUEST_DISPLAY_CAP = 5;

// ── The nested layout (S70): circles INSIDE the village, sub-circles inside
// their parents, roles on each circle's inner edge — the sociocracy picture.
// Same discipline as layoutMap: pure, deterministic, jitter-free.

export interface NestedInput {
  id: string;
  parentId: string | null;
  order: number;
  memberCount: number;
  roles: Array<{ id: string; vacant: boolean }>;
  questCount: number;
  /** The circle's name. The layout sizes the circle to hold it. */
  name?: string;
  /**
   * active, forming or dormant. Only the nested picture reads it: a forming
   * circle with no roles and nothing inside it rides its container's band
   * instead of taking a place in the pack. Absent, nothing changes.
   */
  status?: string | null;
  /**
   * The circle's governance layer: link, lead, operating, advisory or council.
   * It decides which circle holds the middle of its container and the order
   * round the ring. Absent or unknown behaves as operating.
   */
  layer?: string | null;
}

/** Where a circle on a band sits: an arc of its container's band, angles in
 *  radians in screen space (y down, -PI/2 at twelve o'clock). */
export interface BandPlace {
  containerId: string | null;
  a0: number;
  a1: number;
  inner: number;
  outer: number;
}

export interface NestedCircle {
  id: string;
  x: number;
  y: number;
  r: number;
  depth: number;
  roles: Array<{ id: string; x: number; y: number; vacant: boolean }>;
  questDots: Array<{ x: number; y: number }>;
  questOverflow: number;
  /** Present when the circle rides its container's band. Its x, y and r are
   *  then the middle of its arc, so focus, search and the camera still work. */
  band?: BandPlace;
}

/** One container's band: the track the forming circles ride, open at the top
 *  by `crown` radians either side of twelve o'clock for the container's name. */
export interface NestedBand {
  containerId: string | null;
  x: number;
  y: number;
  inner: number;
  outer: number;
  crown: number;
  members: string[];
}

export interface NestedLayout {
  width: number;
  height: number;
  village: {
    x: number;
    y: number;
    r: number;
    /** Roles held at the village level (no circle): seats on the outer ring. */
    roles: Array<{ id: string; x: number; y: number; vacant: boolean }>;
  };
  circles: NestedCircle[];
  /** Present only when some container has a band. */
  bands?: NestedBand[];
}

const ROLE_DOT_R = 11;
const ROLE_RING_INSET = 20;
/** Rough advance width of one character as a fraction of font size. */
const CHAR_W = 0.55;
/** The size a circle name should be readable at; circles are sized to it. */
const LABEL_TARGET_FONT = 12;
const PACK_GAP = 14;
/** Clears the boundary seats and their stroke; nothing draws past this. */
const VILLAGE_PAD = ROLE_DOT_R + 12;
/** Only reached by a village with no circles yet, so it never looks broken. */
const MIN_CANVAS = 320;

/**
 * THE GOVERNANCE LAYER RANK. A link or lead circle holds the middle of its
 * container; everything else rings it in this order, then by sortOrder. The
 * middle used to go to whichever circle had the most rows, so a busy circle
 * read as the most important one in the village. The layer is data a village
 * sets, never a name written here.
 */
export const LAYER_RANK: Readonly<Record<CircleLayer, number>> = {
  link: 0,
  lead: 1,
  operating: 2,
  advisory: 3,
  council: 4,
};
const OPERATING_RANK = LAYER_RANK.operating;

/** The band forming circles ride: its width, the font its names are sized
 *  for, the room either end of a name, and the gap between two arcs. */
export const BAND_WIDTH = 38;
export const BAND_FONT = 11;
const BAND_NAME_PAD = 22;
const BAND_ARC_GAP = 6;
/** The village draws no name inside its ring; its band still leaves the top
 *  open for the word that says what the band is. */
const VILLAGE_BAND_CROWN = 0.35;

/**
 * The radius a circle needs to hold its NAME inside its seat ring.
 *
 * A circle was sized by member count and seat count only, so "Intergenerational
 * Wisdom Council" was asked to fit inside a 40-unit circle. It could not, and
 * the label either ran across its neighbours or had to be shrunk past reading.
 * Sizing the circle to its name instead means every label fits, and the pack
 * spaces the circles to match.
 *
 * A word cannot be broken, so the longest one sets the floor.
 */
export function radiusForLabel(name: string): number {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const longest = Math.max(...words.map((w) => w.length));
  const needed = longest * LABEL_TARGET_FONT * CHAR_W;
  // The chord across the clear interior is about 1.8r at the widest line.
  const innerR = needed / 1.8;
  return innerR + ROLE_RING_INSET + ROLE_DOT_R;
}

/**
 * THE CLEAR INTERIOR: how wide a name may run inside a circle without touching
 * the seats on its ring.
 *
 * This is the one definition of that width, and it exists because there were
 * two. `wrapLabel` wrapped to the clear interior and `radiusForLabel` sized
 * every circle by it, while `fitLabelToScreen` GREW a name for legibility
 * against the full radius, so a name fitted to a zoomed-out screen was wider
 * than the seat ring its circle had been sized to clear. Measured live on
 * 2026-09-23 at 1440x900: eleven names with a seat drawn through them, every
 * one of them a small circle's own centred name.
 *
 * `seatAngle` already said this in a comment, having tried moving the seats
 * instead: "a name fitted to a zoomed-out screen is wider than the seat ring
 * it was sized for". Moving the seats cleared none of them, because the seats
 * were never the thing that was wrong.
 */
export function clearChord(radius: number): number {
  return Math.max(24, (radius - ROLE_RING_INSET - ROLE_DOT_R) * 1.8);
}

/**
 * WHERE SEAT j OF n SITS ON ITS CIRCLE'S RING.
 *
 * Every ring used to start at twelve o'clock, which is where a circle that
 * holds others draws its NAME, just inside its rim: its first seat was drawn on
 * its name. Measured on a village nested under one coordinating circle
 * (2026-09-21): a seat sat in the middle of "General Coordinating Circle" and of
 * "Development Circle", the first two names a reader meets, on a desktop and on
 * a phone. Such a circle starts half a step round, which leaves the top to the
 * name. Every other circle keeps its seats where they were.
 *
 * Tried and dropped: turning a small circle's four seats onto the diagonals,
 * away from the ends of its centred name. Measured on the same village it moved
 * which seats touched the name and cleared none, because a name fitted to a
 * zoomed-out screen is wider than the seat ring it was sized for.
 */
export function seatAngle(j: number, n: number, holdsCircles: boolean): number {
  const step = (2 * Math.PI) / Math.max(1, n);
  return -Math.PI / 2 + step * j + (holdsCircles ? step / 2 : 0);
}

/** The radius a circle needs for its own contents: name, role ring, quests. */
function ownRadius(c: NestedInput): number {
  const base = MIN_CIRCLE_R + CIRCLE_R_K * Math.log(1 + c.memberCount);
  // The role ring must hold every dot without crowding: circumference from
  // dot count, radius from circumference.
  const ringR = (c.roles.length * ROLE_DOT_R * 2.6) / (2 * Math.PI);
  return Math.max(base, ringR + ROLE_RING_INSET + 6, radiusForLabel(c.name ?? ""));
}

interface PackedNode {
  input: NestedInput;
  r: number;
  /** Offset from the PARENT's center. */
  dx: number;
  dy: number;
  children: PackedNode[];
  /** This node's band, when some of its children ride one. */
  band?: { inner: number; outer: number; crown: number; arcs: Map<string, { a0: number; a1: number }> };
}

const rankOf = (n: PackedNode): number => (isCircleLayer(n.input.layer) ? LAYER_RANK[n.input.layer] : OPERATING_RANK);
const bySize = (a: PackedNode, b: PackedNode): number =>
  b.r - a.r || a.input.order - b.input.order || a.input.id.localeCompare(b.input.id);
const byLayer = (a: PackedNode, b: PackedNode): number =>
  rankOf(a) - rankOf(b) || a.input.order - b.input.order || a.input.id.localeCompare(b.input.id);

/**
 * Who holds the middle of a pack, and in what order the rest ring it.
 *
 * With no layer set anywhere in the pack this is the picture every village has
 * always had: the biggest in the middle, the rest by size. Once a village sets
 * layers, a link or lead circle takes the middle and the ring follows the
 * layers, then sortOrder, so the order a village gives its circles is the order
 * a member meets them, clockwise from twelve. A layered pack with no link or
 * lead circle still puts its biggest in the middle, which is the tightest pack.
 */
function middleAndRing(children: PackedNode[]): [PackedNode, PackedNode[]] {
  const layered = children.some((c) => !!c.input.layer);
  if (!layered) {
    const [biggest, ...rest] = [...children].sort(bySize);
    return [biggest, rest];
  }
  const ranked = [...children].sort(byLayer);
  const middle = rankOf(ranked[0]) < OPERATING_RANK ? ranked[0] : [...children].sort(bySize)[0];
  return [middle, ranked.filter((c) => c !== middle)];
}

/**
 * Pack children inside a parent: one sits at the center, the rest on one ring
 * around it, spaced by their own sizes. With the handful of circles a village
 * has, the ring reads organic and stays deterministic; a physics pack would
 * jitter with every data change. `middleAndRing` says which one is the middle.
 */
function packChildren(children: PackedNode[]): number {
  if (children.length === 0) return 0;
  const [biggest, rest] = middleAndRing(children);
  // TWO SIDE BY SIDE. One in the middle and the other orbiting it needs a
  // radius of r1 + r2 + gap + r2; side by side, r1 + r2 + half a gap. On the
  // live village that made a circle holding two small ones 280 across instead
  // of about 200, and once that circle left the middle it widened the whole
  // picture by a third. Same order as the ring would give them, left to right.
  if (rest.length === 1) {
    const [right] = rest;
    const outer = biggest.r + right.r + PACK_GAP / 2;
    biggest.dx = -(outer - biggest.r);
    biggest.dy = 0;
    right.dx = outer - right.r;
    right.dy = 0;
    return outer;
  }
  biggest.dx = 0;
  biggest.dy = 0;
  if (rest.length === 0) return biggest.r;

  // Ring radius: clear the center circle, and give the ring's circumference
  // room for every satellite's diameter plus breathing space.
  const maxSat = Math.max(...rest.map((c) => c.r));
  const byDistance = biggest.r + maxSat + PACK_GAP;
  const byCircumference = (rest.reduce((s, c) => s + 2 * c.r + PACK_GAP, 0)) / (2 * Math.PI) + maxSat * 0.2;
  const ringR = Math.max(byDistance, byCircumference);

  // Arc-proportional placement: each satellite gets arc length proportional
  // to its diameter, so a big circle never overlaps its small neighbour.
  const total = rest.reduce((s, c) => s + 2 * c.r + PACK_GAP, 0);
  let arc = 0;
  for (const c of rest) {
    const mid = arc + (2 * c.r + PACK_GAP) / 2;
    const angle = -Math.PI / 2 + (2 * Math.PI * mid) / total;
    c.dx = ringR * Math.cos(angle);
    c.dy = ringR * Math.sin(angle);
    arc += 2 * c.r + PACK_GAP;
  }
  return ringR + maxSat;
}

/** Build the containment forest, refusing any parent link that would close a
 *  loop. `parent_circle_id` is written by three routes and, once nesting is a
 *  drag, by members; a loop there used to make BOTH nodes unreachable, so
 *  `roots` came back empty and the map drew nothing at all. No error, no
 *  console line, just a blank square. A circle whose chain of parents comes
 *  back round to itself therefore stands at the top instead, which is what the
 *  comment here promised for a year while the code checked only self-parent.
 *  Every circle reaches `roots` exactly once, so nothing can vanish. */
function buildForest(sorted: NestedInput[], byId: Map<string, NestedInput>): PackedNode[] {
  const nodeFor = new Map<string, PackedNode>();
  for (const c of sorted) nodeFor.set(c.id, { input: c, r: 0, dx: 0, dy: 0, children: [] });

  /** The parent to actually use: null when unknown, self, or part of a loop. */
  const liveParent = (c: NestedInput): PackedNode | undefined => {
    const first = c.parentId;
    if (!first || first === c.id || !byId.has(first)) return undefined;
    // Walk up from the parent. Meeting anyone twice means the chain loops.
    const seen = new Set<string>([c.id]);
    let at: string | undefined = first;
    while (at) {
      if (seen.has(at)) return undefined;
      seen.add(at);
      const next: string | null | undefined = byId.get(at)?.parentId;
      at = next && next !== at && byId.has(next) ? next : undefined;
    }
    return nodeFor.get(first);
  };

  const roots: PackedNode[] = [];
  for (const c of sorted) {
    const node = nodeFor.get(c.id)!;
    const parent = liveParent(c);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// ── THE FORMING BAND ─────────────────────────────────────────────────────────
//
// A council a village has named and not yet started held a full circle of its
// own, the same weight as a circle doing the work today, told apart only by
// a fade. On the live village that was eight of the sixteen circles inside the
// coordinating circle: two thirds of the picture was future and read as
// present. Such a circle now rides a band just inside its container's role
// ring, an arc with its name on it, so the work of today holds the middle and
// what is still forming reads as a horizon.

/** A forming circle with no roles and nothing inside it: a name for later. */
function ridesBand(n: PackedNode): boolean {
  return n.input.status === "forming" && n.input.roles.length === 0 && n.children.length === 0;
}

/** The arc a name on the band needs, in canvas units. */
function bandArcLength(name: string | undefined): number {
  return String(name ?? "").trim().length * BAND_FONT * CHAR_W + BAND_NAME_PAD;
}

/** How far either side of twelve o'clock a container's band stays open, so
 *  the container's own name, drawn just inside its rim, never lands on it. */
function nameCrown(name: string | undefined, depth: number, outer: number): number {
  const half = (String(name ?? "").trim().length * labelBaseFont(depth) * CHAR_W) / 2 + 10;
  return Math.min(1.1, Math.max(0.3, Math.atan2(half, outer)));
}

/**
 * Size a band outside `contentR` and give each rider an arc, clockwise from
 * the crown's right edge, in proportion to its name. The band grows outward
 * until every name fits its arc. A wider band leaves a narrower crown, so the
 * room only ever grows across the passes and the last pass is the one that fits.
 */
function sizeBand(
  riders: PackedNode[],
  contentR: number,
  crownAt: (outer: number) => number,
): NonNullable<PackedNode["band"]> {
  const lengths = riders.map((n) => bandArcLength(n.input.name) + BAND_ARC_GAP);
  const need = lengths.reduce((s, l) => s + l, 0);
  let inner = contentR + PACK_GAP;
  let crown = crownAt(inner + BAND_WIDTH);
  for (let pass = 0; pass < 3; pass++) {
    inner = Math.max(inner, need / (2 * Math.PI - 2 * crown) - BAND_WIDTH / 2);
    crown = crownAt(inner + BAND_WIDTH);
  }
  inner = Math.max(inner, need / (2 * Math.PI - 2 * crown) - BAND_WIDTH / 2);

  const span = 2 * Math.PI - 2 * crown;
  const gap = (BAND_ARC_GAP / need) * span;
  const arcs = new Map<string, { a0: number; a1: number }>();
  let at = -Math.PI / 2 + crown;
  riders.forEach((n, i) => {
    const slice = (lengths[i] / need) * span;
    arcs.set(n.input.id, { a0: at + gap / 2, a1: at + slice - gap / 2 });
    at += slice;
  });
  return { inner, outer: inner + BAND_WIDTH, crown, arcs };
}

/** Nested layout: the village encloses its circles; sub-circles nest inside.
 *  Roles with no circle are the village's own seats and sit on its ring. */
export function layoutNestedMap(
  inputs: NestedInput[],
  villageRoles: Array<{ id: string; vacant: boolean }> = [],
): NestedLayout {
  const sorted = [...inputs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((c) => [c.id, c]));

  // An unknown or cyclic parent becomes a top-level circle rather than
  // vanishing. See buildForest: that sentence used to be a comment only.
  const roots = buildForest(sorted, byId);

  // Radii bottom-up: a parent must hold its packed children AND its own
  // role ring outside them, and its band, when some of them ride one.
  const sizeNode = (node: PackedNode, depth: number): void => {
    node.children.forEach((child) => sizeNode(child, depth + 1));
    const riders = node.children.filter(ridesBand);
    if (!riders.length) {
      const contentR = packChildren(node.children);
      node.r = Math.max(ownRadius(node.input), contentR + ROLE_RING_INSET + ROLE_DOT_R + 10);
      return;
    }
    const contentR = packChildren(node.children.filter((c) => !ridesBand(c)));
    node.band = sizeBand(riders, contentR, (outer) => nameCrown(node.input.name, depth, outer));
    node.r = Math.max(ownRadius(node.input), node.band.outer + ROLE_RING_INSET + ROLE_DOT_R + 10);
  };
  roots.forEach((root) => sizeNode(root, 0));

  // The village is the root that packs every top-level circle.
  const villageRiders = roots.filter(ridesBand);
  const villageBand = villageRiders.length
    ? sizeBand(villageRiders, packChildren(roots.filter((r) => !ridesBand(r))), () => VILLAGE_BAND_CROWN)
    : undefined;
  const villageContentR = villageBand ? villageBand.outer : packChildren(roots);
  const villageR = villageContentR + 30;
  // The canvas HUGS the village.
  //
  // This was `Math.max(CANVAS, …)` with CANVAS = 1000, so a village needing
  // a 340 radius still drew into a 1000-square viewBox: the picture occupied
  // under half the area and the rest was margin the browser then scaled down
  // to fit. The map looked tiny on a wide screen for no reason but padding.
  //
  // The pad clears the seats that ride ON the boundary ring, plus their
  // labels. The floor only matters for a village with nothing in it yet.
  const canvas = Math.max(MIN_CANVAS, Math.ceil((villageR + VILLAGE_PAD) * 2));
  const center = { x: canvas / 2, y: canvas / 2 };

  // Absolute positions, then the per-circle furniture.
  const out: NestedCircle[] = [];
  const place = (node: PackedNode, px: number, py: number, depth: number): void => {
    const x = px + node.dx;
    const y = py + node.dy;
    const c = node.input;
    const ringR = node.r - ROLE_RING_INSET;
    const roles = [...c.roles].sort((a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id));
    const rolePositions = roles.map((role, j) => {
      const ra = seatAngle(j, roles.length, node.children.length > 0);
      return { id: role.id, vacant: role.vacant, x: x + ringR * Math.cos(ra), y: y + ringR * Math.sin(ra) };
    });
    const shownQuests = Math.min(c.questCount, QUEST_DISPLAY_CAP);
    const questDots = Array.from({ length: shownQuests }, (_, j) => {
      // Along the bottom-inside arc, out of the role ring's way.
      const qa = Math.PI / 2 + ((j - (shownQuests - 1) / 2) * 0.28);
      return { x: x + (ringR - 18) * Math.cos(qa), y: y + (ringR - 18) * Math.sin(qa) };
    });
    out.push({
      id: c.id, x, y, r: node.r, depth,
      roles: rolePositions, questDots,
      questOverflow: Math.max(0, c.questCount - shownQuests),
    });
    placeChildren(node.children, node.band, c.id, x, y, depth + 1);
  };
  const bands: NestedBand[] = [];
  const placeChildren = (
    children: PackedNode[],
    band: PackedNode["band"],
    containerId: string | null,
    x: number,
    y: number,
    depth: number,
  ): void => {
    if (band) {
      bands.push({
        containerId, x, y, inner: band.inner, outer: band.outer, crown: band.crown,
        members: children.filter((c) => band.arcs.has(c.input.id)).map((c) => c.input.id),
      });
    }
    for (const child of children) {
      const arc = band?.arcs.get(child.input.id);
      if (!arc || !band) {
        place(child, x, y, depth);
        continue;
      }
      // A rider's position is the middle of its arc, so everything that finds
      // a circle by its centre (focus, search, the camera) finds it there.
      const mid = (band.inner + band.outer) / 2;
      const am = (arc.a0 + arc.a1) / 2;
      out.push({
        id: child.input.id,
        x: x + mid * Math.cos(am),
        y: y + mid * Math.sin(am),
        r: BAND_WIDTH / 2,
        depth,
        roles: [],
        questDots: [],
        questOverflow: child.input.questCount,
        band: { containerId, a0: arc.a0, a1: arc.a1, inner: band.inner, outer: band.outer },
      });
    }
  };
  placeChildren(roots, villageBand, null, center.x, center.y, 0);

  // Village-level seats ride the boundary ring itself, spread across the top
  // arc where no circle label competes, vacant last as everywhere else.
  const vRoles = [...villageRoles].sort(
    (a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id),
  );
  const arcSpan = Math.min(Math.PI * 0.9, vRoles.length * 0.24);
  const villageSeatDots = vRoles.map((role, j) => {
    const a = -Math.PI / 2 + (vRoles.length === 1 ? 0 : arcSpan * (j / (vRoles.length - 1) - 0.5));
    return { id: role.id, vacant: role.vacant, x: center.x + villageR * Math.cos(a), y: center.y + villageR * Math.sin(a) };
  });

  return {
    width: canvas,
    height: canvas,
    village: { x: center.x, y: center.y, r: villageR, roles: villageSeatDots },
    circles: out,
    // Only when there is one, so a village with no band keeps its exact bytes.
    ...(bands.length ? { bands } : {}),
  };
}

export interface WrappedLabel {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

const MAX_LABEL_LINES = 3;
/** Below this a label is not worth rendering, so the word gets cut instead. */
const MIN_FONT = 9;

/** The size a name starts from at each depth, before it is fitted. */
function labelBaseFont(depth: number): number {
  return depth === 0 ? 17 : depth === 1 ? 14 : 12;
}

/**
 * Fit a circle's name inside the circle.
 *
 * The map drew every name as one line at a fixed size, so a long name was
 * simply wider than the circle holding it and ran through its neighbours.
 * ("Intergenerational Wisdom Council" at 17px is about 290 units wide; the
 * circle holding it is often under 140 across.)
 *
 * Pure and deterministic, like the rest of this module: same name and radius
 * in, same lines out, so the picture never reflows between visits.
 */
export function wrapLabel(name: string, radius: number, depth: number): WrappedLabel {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const base = labelBaseFont(depth);
  // The usable chord is the CLEAR interior, inside the seat ring. Measuring
  // against the full radius let a label run out under its own seat dots.
  const usable = clearChord(radius);

  let fontSize = base;
  let lines: string[] = [];
  let maxChars = 3;
  // Shrink until the name fits in the line budget, down to a readable floor.
  //
  // The exit has to check LINE WIDTH as well as line count. A greedy wrapper
  // never splits a word, so "Intergenerational" simply became a line of its
  // own and overflowed the circle at whatever size the count happened to
  // allow. Counting lines alone let that through.
  for (; fontSize >= MIN_FONT; fontSize -= 1) {
    maxChars = Math.max(3, Math.floor(usable / (fontSize * CHAR_W)));
    lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length <= maxChars) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= MAX_LABEL_LINES && lines.every((l) => l.length <= maxChars)) break;
  }

  if (lines.length > MAX_LABEL_LINES) lines = lines.slice(0, MAX_LABEL_LINES);
  // At the floor a word can still be wider than its circle, so it is cut
  // rather than allowed to run across the neighbours.
  lines = lines.map((l) => (l.length > maxChars ? `${l.slice(0, Math.max(1, maxChars - 1))}…` : l));
  if (!lines.length) lines = [""];

  return { lines, fontSize, lineHeight: Math.round(fontSize * 1.15) };
}

/** Deterministic radial layout. Circles sit on one orbit, first at 12 o'clock. */
export function layoutMap(circles: LayoutCircle[]): MapLayout {
  const center = { x: CANVAS / 2, y: CANVAS / 2 };
  const sorted = [...circles].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const n = Math.max(1, sorted.length);

  const positioned = sorted.map((c, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const cx = center.x + ORBIT_RADIUS * Math.cos(angle);
    const cy = center.y + ORBIT_RADIUS * Math.sin(angle);
    const r = MIN_CIRCLE_R + CIRCLE_R_K * Math.log(1 + c.memberCount);

    // Roles orbit their circle evenly, vacant seats LAST so filled seats
    // cluster at the top of the arc.
    const roles = [...c.roles].sort((a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id));
    const rolePositions = roles.map((role, j) => {
      const ra = -Math.PI / 2 + (2 * Math.PI * j) / Math.max(1, roles.length);
      return { id: role.id, vacant: role.vacant, x: cx + ROLE_ORBIT * Math.cos(ra), y: cy + ROLE_ORBIT * Math.sin(ra) };
    });

    const shownQuests = Math.min(c.questCount, QUEST_DISPLAY_CAP);
    const questDots = Array.from({ length: shownQuests }, (_, j) => {
      const qa = -Math.PI / 2 + (2 * Math.PI * (j + 0.5)) / Math.max(1, shownQuests);
      return { x: cx + QUEST_ORBIT * Math.cos(qa), y: cy + QUEST_ORBIT * Math.sin(qa) };
    });

    return {
      id: c.id,
      x: cx,
      y: cy,
      r,
      angle,
      roles: rolePositions,
      questDots,
      questOverflow: Math.max(0, c.questCount - shownQuests),
    };
  });

  return { width: CANVAS, height: CANVAS, center, circles: positioned };
}

// ── The shape layouts (0083, R29): one input, one output type, six pictures ──
//
// `layoutForShape` is the power map's layout switch. Same discipline as
// everything above: pure, deterministic, jitter-free, and the `circle` branch
// IS `layoutNestedMap`, byte for byte, so today's picture cannot drift while
// the other shapes exist beside it. One output type (`NestedLayout`) so one
// renderer draws every shape and framer-motion can animate seats between
// them: same node ids, new positions, and the morph is the story.
//
// The `pad` argument is an outer margin for lenses that draw AROUND the
// village (lane L3's resources ring). pad = 0 returns the base layout object
// untouched, which is what keeps the byte-identity promise checkable.

/** The tree-and-size pass layoutNestedMap runs. The tree half was duplicated
 *  here for a while and drifted; both now call buildForest, so a cycle guard
 *  cannot be fixed in one and missed in the other. The SIZING half stays
 *  separate: layoutNestedMap's output is under byte-identity test. */
function sizedRoots(inputs: NestedInput[]): PackedNode[] {
  const sorted = [...inputs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const roots = buildForest(sorted, byId);
  const sizeNode = (node: PackedNode): void => {
    node.children.forEach(sizeNode);
    const contentR = packChildren(node.children);
    node.r = Math.max(ownRadius(node.input), contentR + ROLE_RING_INSET + ROLE_DOT_R + 10);
  };
  roots.forEach(sizeNode);
  return roots;
}

/** The per-circle furniture layoutNestedMap's `place` draws: seats on the
 *  inner ring, quest dots on the bottom arc. Same numbers, same sorting. */
function furnish(
  node: PackedNode,
  x: number,
  y: number,
  depth: number,
  out: NestedCircle[],
  /** Whether this circle holds others, for a shape that does not nest them inside it (the pyramid). */
  holdsCircles: boolean = node.children.length > 0,
): void {
  const c = node.input;
  const ringR = node.r - ROLE_RING_INSET;
  const roles = [...c.roles].sort((a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id));
  const rolePositions = roles.map((role, j) => {
    const ra = seatAngle(j, roles.length, holdsCircles);
    return { id: role.id, vacant: role.vacant, x: x + ringR * Math.cos(ra), y: y + ringR * Math.sin(ra) };
  });
  const shownQuests = Math.min(c.questCount, QUEST_DISPLAY_CAP);
  const questDots = Array.from({ length: shownQuests }, (_, j) => {
    const qa = Math.PI / 2 + ((j - (shownQuests - 1) / 2) * 0.28);
    return { x: x + (ringR - 18) * Math.cos(qa), y: y + (ringR - 18) * Math.sin(qa) };
  });
  out.push({
    id: c.id, x, y, r: node.r, depth,
    roles: rolePositions, questDots,
    questOverflow: Math.max(0, c.questCount - shownQuests),
  });
  node.children.forEach((child) => furnish(child, x + child.dx, y + child.dy, depth + 1, out));
}

/** Village seats spread across the top arc of the boundary, as today. */
function boundarySeats(
  villageRoles: Array<{ id: string; vacant: boolean }>,
  cx: number,
  cy: number,
  r: number,
): NestedLayout["village"]["roles"] {
  const vRoles = [...villageRoles].sort(
    (a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id),
  );
  const arcSpan = Math.min(Math.PI * 0.9, vRoles.length * 0.24);
  return vRoles.map((role, j) => {
    const a = -Math.PI / 2 + (vRoles.length === 1 ? 0 : arcSpan * (j / (vRoles.length - 1) - 0.5));
    return { id: role.id, vacant: role.vacant, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** Place sized top-level nodes on one ring, arc-proportionally, and furnish. */
function ringOfNodes(
  roots: PackedNode[],
  villageRoles: Array<{ id: string; vacant: boolean }>,
  opts: {
    /** Extra ring radius on top of what spacing needs, as a factor. */
    spread?: number;
    /** The ring the roots must clear from the centre outward. */
    clearR?: number;
    /** Equal angular slots instead of arc-proportional ones. */
    equalSlots?: boolean;
    /** Force every top-level node to this radius. */
    uniformR?: number;
    /** Where the village's own seats go. */
    seats: "top-arc" | "full-ring" | "centre-ring" | "centre-cluster";
  },
): NestedLayout {
  const spread = opts.spread ?? 1;
  const uniform = opts.uniformR;
  const rOf = (n: PackedNode) => uniform ?? n.r;
  const maxR = roots.length ? Math.max(...roots.map(rOf)) : 0;
  const total = roots.reduce((s, n) => s + 2 * rOf(n) + PACK_GAP, 0);
  const byCircumference = total / (2 * Math.PI) + maxR * 0.2;
  const byDistance = (opts.clearR ?? 0) + maxR + PACK_GAP;
  // One circle alone still needs to sit OFF centre when the centre is held
  // (council, steward), and exactly ON centre reads better when it is not.
  const ringR = roots.length <= 1 && !opts.clearR ? 0 : Math.max(byDistance, byCircumference) * spread;

  const villageR = ringR + maxR + 30;
  const canvas = Math.max(MIN_CANVAS, Math.ceil((villageR + VILLAGE_PAD) * 2));
  const cx = canvas / 2;
  const cy = canvas / 2;

  const out: NestedCircle[] = [];
  let arc = 0;
  roots.forEach((node, i) => {
    const slice = 2 * rOf(node) + PACK_GAP;
    const angle = opts.equalSlots
      ? -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, roots.length)
      : -Math.PI / 2 + (2 * Math.PI * (arc + slice / 2)) / Math.max(total, 1);
    arc += slice;
    const x = cx + ringR * Math.cos(angle);
    const y = cy + ringR * Math.sin(angle);
    furnish({ ...node, r: rOf(node) }, x, y, 0, out);
  });

  // The village's own seats, where the shape says they live.
  let seats: NestedLayout["village"]["roles"] = [];
  const sortedSeats = [...villageRoles].sort(
    (a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id),
  );
  if (opts.seats === "top-arc") {
    seats = boundarySeats(villageRoles, cx, cy, villageR);
  } else if (opts.seats === "full-ring") {
    seats = sortedSeats.map((role, j) => {
      const a = -Math.PI / 2 + (2 * Math.PI * j) / Math.max(1, sortedSeats.length);
      return { id: role.id, vacant: role.vacant, x: cx + villageR * Math.cos(a), y: cy + villageR * Math.sin(a) };
    });
  } else if (opts.seats === "centre-ring") {
    const innerR = opts.clearR ? opts.clearR - ROLE_DOT_R - 6 : 0;
    seats = sortedSeats.map((role, j) => {
      const a = -Math.PI / 2 + (2 * Math.PI * j) / Math.max(1, sortedSeats.length);
      return { id: role.id, vacant: role.vacant, x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a) };
    });
  } else {
    // centre-cluster: one seat exactly at the centre; a second and third in a
    // tight rosette around it. The steward's picture.
    const rosetteR = sortedSeats.length <= 1 ? 0 : ROLE_DOT_R * 2.2;
    seats = sortedSeats.map((role, j) => {
      const a = -Math.PI / 2 + (2 * Math.PI * j) / Math.max(1, sortedSeats.length);
      return {
        id: role.id,
        vacant: role.vacant,
        x: cx + rosetteR * Math.cos(a),
        y: cy + rosetteR * Math.sin(a),
      };
    });
  }

  return {
    width: canvas,
    height: canvas,
    village: { x: cx, y: cy, r: villageR, roles: seats },
    circles: out,
  };
}

/** Top-down tree: the head seat on top, layers report up (down the page). */
function layoutPyramid(
  inputs: NestedInput[],
  villageRoles: Array<{ id: string; vacant: boolean }>,
): NestedLayout {
  // Every circle is its OWN node here: a pyramid says hierarchy with rows,
  // so children sit in the row below their parent instead of nesting inside
  // it. The renderer draws the connecting lines from `parentId`.
  const sorted = [...inputs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((c) => [c.id, c]));
  // A parent here holds no circle INSIDE it, but the map still draws its name
  // at its top the way it does for one that does, so its seats clear it too.
  const parents = new Set(sorted.map((c) => c.parentId).filter((id): id is string => !!id && byId.has(id)));
  const rowOf = (c: NestedInput): number => {
    let depth = 0;
    let cur = c;
    const seen = new Set<string>([c.id]);
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId)!;
      depth += 1;
    }
    return depth;
  };
  const rows = new Map<number, NestedInput[]>();
  for (const c of sorted) {
    const row = rowOf(c);
    rows.set(row, [...(rows.get(row) ?? []), c]);
  }
  const rowKeys = Array.from(rows.keys()).sort((a, b) => a - b);

  const APEX_H = villageRoles.length ? 64 : 24;
  const ROW_GAP = 26;
  const nodesByRow = rowKeys.map((k) =>
    rows.get(k)!.map((c) => ({ input: c, r: ownRadius(c), dx: 0, dy: 0, children: [] as PackedNode[] })),
  );
  const rowWidth = (nodes: Array<{ r: number }>) =>
    nodes.reduce((s, n) => s + 2 * n.r + PACK_GAP, 0) + PACK_GAP;
  const width = Math.max(
    MIN_CANVAS,
    Math.ceil(
      Math.max(...(nodesByRow.length ? nodesByRow.map(rowWidth) : [0]), villageRoles.length * ROLE_DOT_R * 3 + 40) +
        PACK_GAP * 2,
    ),
  );

  const out: NestedCircle[] = [];
  let y = APEX_H;
  nodesByRow.forEach((nodes, rowIdx) => {
    const maxR = Math.max(...nodes.map((n) => n.r));
    y += maxR;
    let x = (width - rowWidth(nodes)) / 2 + PACK_GAP;
    for (const node of nodes) {
      const cxNode = x + PACK_GAP / 2 + node.r;
      furnish(node, cxNode, y, rowKeys[rowIdx], out, parents.has(node.input.id));
      x += 2 * node.r + PACK_GAP;
    }
    y += maxR + ROW_GAP;
  });
  const height = Math.max(MIN_CANVAS, Math.ceil(y - ROW_GAP + 24));

  // The head seats crown the apex, spread on a short horizontal line.
  const vRoles = [...villageRoles].sort(
    (a, b) => Number(a.vacant) - Number(b.vacant) || a.id.localeCompare(b.id),
  );
  const seatSpan = Math.min(width - 48, vRoles.length * ROLE_DOT_R * 3);
  const seats = vRoles.map((role, j) => ({
    id: role.id,
    vacant: role.vacant,
    x: width / 2 + (vRoles.length === 1 ? 0 : seatSpan * (j / (vRoles.length - 1) - 0.5)),
    y: APEX_H / 2,
  }));

  return {
    width,
    height,
    // The frame exists so every shape shares one type; the pyramid renderer
    // draws rows and connectors, not the enclosing ring.
    village: { x: width / 2, y: height / 2, r: Math.max(width, height) / 2, roles: seats },
    circles: out,
  };
}

export type PowerShape = "circle" | "pyramid" | "council" | "flat" | "steward" | "network" | "other";

/**
 * The power map's layout: one function, seven shapes, one output type.
 *
 *   circle   today's nested ring pack, byte for byte (layoutNestedMap).
 *   pyramid  a top-down tree, the head seat on top.
 *   council  the village's own seats as an inner ring, circles around.
 *   flat     one ring of equals: same radius, equal slots, seats all round.
 *   steward  the steward at the centre inside one enclosing line.
 *   network  nodes spread on a wide ring; relation chords are the renderer's.
 *   other    draws as circle; its own words live in the legend gloss.
 *
 * `pad` is an outer margin for lenses drawn around the village (L3's
 * resources ring): every coordinate shifts by it and the canvas grows by
 * twice it. pad = 0 hands back the base layout object untouched.
 */
export function layoutForShape(
  shape: PowerShape | string,
  inputs: NestedInput[],
  villageRoles: Array<{ id: string; vacant: boolean }> = [],
  pad = 0,
): NestedLayout {
  const base = (() => {
    switch (shape) {
      case "pyramid":
        return layoutPyramid(inputs, villageRoles);
      case "council": {
        const roots = sizedRoots(inputs);
        const councilR = Math.max(
          46,
          (villageRoles.length * ROLE_DOT_R * 2.6) / (2 * Math.PI) + ROLE_DOT_R + 22,
        );
        return ringOfNodes(roots, villageRoles, { clearR: councilR, seats: "centre-ring" });
      }
      case "flat": {
        const roots = sizedRoots(inputs);
        const uniformR = roots.length ? Math.max(...roots.map((n) => n.r)) : 0;
        return ringOfNodes(roots, villageRoles, { uniformR, equalSlots: true, seats: "full-ring" });
      }
      case "steward": {
        const roots = sizedRoots(inputs);
        const clearR = Math.max(52, ROLE_DOT_R * 2.2 + ROLE_DOT_R + 26);
        return ringOfNodes(roots, villageRoles, { clearR, seats: "centre-cluster" });
      }
      case "network": {
        const roots = sizedRoots(inputs);
        return ringOfNodes(roots, villageRoles, { spread: 1.45, seats: "top-arc" });
      }
      default:
        // circle, other, and any id the map has not learned to draw yet.
        return layoutNestedMap(inputs, villageRoles);
    }
  })();
  if (!pad) return base;
  return {
    width: base.width + 2 * pad,
    height: base.height + 2 * pad,
    village: {
      x: base.village.x + pad,
      y: base.village.y + pad,
      r: base.village.r,
      roles: base.village.roles.map((s) => ({ ...s, x: s.x + pad, y: s.y + pad })),
    },
    circles: base.circles.map((c) => ({
      ...c,
      x: c.x + pad,
      y: c.y + pad,
      roles: c.roles.map((s) => ({ ...s, x: s.x + pad, y: s.y + pad })),
      questDots: c.questDots.map((q) => ({ x: q.x + pad, y: q.y + pad })),
    })),
    ...(base.bands ? { bands: base.bands.map((b) => ({ ...b, x: b.x + pad, y: b.y + pad })) } : {}),
  };
}
