/**
 * WHERE EVERY NAME ON THE MAP GOES, so no name is drawn into another.
 *
 * A name that cannot reach the legibility floor inside its own circle is drawn
 * ABOVE the disc instead (`fitLabelToScreen`'s `outside`). A circle that HOLDS
 * others draws its own name just inside its top edge. Put those two rules
 * together and a promoted name lands on the name of a circle near it.
 *
 * Measured live on 2026-09-23, real name-against-name overlaps at nine window
 * sizes: two pairs at 1024x768, 1280x720 and 1440x700; one from 1440x800 to
 * 1440x1000; none at 1440x1200 and above. Every collision had a CONTAINER's
 * name on one side, and which children joined depended on the window: the
 * smaller the window, the smaller the map, the more names are promoted. So
 * this is the shape of the rule rather than two unlucky names.
 *
 * The first attempt asked only where the PARENT's name was, and the
 * measurement said what a narrow rule is worth: the collision count did not
 * drop, the partners changed. A promoted name that flipped below its disc
 * landed on the name of a container that happened to be underneath. So the
 * rule reads the whole picture: every name already on the map is something to
 * avoid, whoever holds it.
 *
 * Moving is chosen over dropping the name, because a circle with no name at
 * all is worse than one named underneath, and over shrinking it, because the
 * size it has is already the floor. A name only ever moves to a place clear of
 * EVERYTHING, and by the smallest step that gets there, so no move can trade
 * one collision for another or carry a name away from its circle.
 */
import { wrapLabel, type NestedBand, type NestedCircle } from "@shared/mapLayout";
import { CHAR_W, fitLabelToScreen } from "./labelFit";

export interface LabelBox {
  /** Centre of the text, horizontally. */
  x: number;
  top: number;
  bottom: number;
  halfWidth: number;
}

export interface CirclePlacement {
  /** The circle's centre and radius, in world units. */
  y: number;
  r: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/** How far inside its top edge a circle that holds others draws its name. */
export const CONTAINER_LABEL_INSET = 24;

/** How wide a wrapped label runs, by the same estimate `wrapLabel` wraps to. */
export function labelHalfWidth(lines: string[], fontSize: number): number {
  const widest = Math.max(0, ...lines.map((l) => l.length));
  return (widest * fontSize * CHAR_W) / 2;
}

/** The box a name occupies when drawn with its first line's baseline at `top`. */
export function boxAt(top: number, x: number, label: CirclePlacement): LabelBox {
  const lines = Math.max(1, label.lines.length);
  return {
    x,
    // A baseline sits under its glyphs, so the box starts about one cap height above it.
    top: top - label.fontSize * 0.8,
    bottom: top + (lines - 1) * label.lineHeight + label.fontSize * 0.25,
    halfWidth: labelHalfWidth(label.lines, label.fontSize),
  };
}

export function overlaps(a: LabelBox, b: LabelBox, gap = 0): boolean {
  const apart = Math.abs(a.x - b.x) >= a.halfWidth + b.halfWidth + gap;
  const clear = a.bottom + gap <= b.top || b.bottom + gap <= a.top;
  return !apart && !clear;
}

/** Where a name that holds no room inside its circle is drawn: above it. */
export function aboveTop(circle: CirclePlacement): number {
  return circle.y - circle.r - 6 - (circle.lines.length - 1) * circle.lineHeight;
}

/** And below it, when above is taken. */
export function belowTop(circle: CirclePlacement): number {
  return circle.y + circle.r + 6 + circle.fontSize * 0.8;
}

/**
 * A circle that holds others names itself just inside its top edge.
 *
 * The inset is at least the name's own cap height and a little more, measured
 * from where the edge is at the name's ends. A name is
 * sized for the SCREEN, so on a phone it is large in world units, and a fixed
 * 24 put its glyphs above the edge and into the season words that ride outside
 * the village (live at 390x844, 2026-10-30: "General Coordinating Circle"
 * under "Season of Foundations"). On a wide window the 24 still decides.
 */
export function containerTop(circle: CirclePlacement): number {
  // Where the edge is at the ends of the name, which at the top of a circle sit
  // lower than its middle: a wide name is held in by its corners.
  const hw = Math.min(labelHalfWidth(circle.lines, circle.fontSize), circle.r * 0.9);
  const sag = circle.r - Math.sqrt(circle.r * circle.r - hw * hw);
  return circle.y - circle.r + Math.max(CONTAINER_LABEL_INSET, sag + circle.fontSize * 0.8 + 8);
}

/**
 * A holder's name, kept inside by its corners, and never pushed down onto a
 * circle it holds: the corner rule moves a long name a long way, and a child
 * near the top would be under it. Then the plain inset decides, as before.
 */
function heldTop(c: PlanInput, shape: CirclePlacement, circles: PlanInput[]): number {
  const want = containerTop(shape);
  const plain = shape.y - shape.r + Math.max(CONTAINER_LABEL_INSET, shape.fontSize * 0.8 + 8);
  if (want <= plain) return want;
  const box = boxAt(want, c.x, shape);
  const inside = circles.filter((o) => o !== c && Math.hypot(o.x - c.x, o.y - c.y) + o.r <= c.r + EPS);
  return inside.some((d) => meetsDisc(box, d)) ? plain : want;
}

/** A circle that holds none names itself across its middle. */
export function centredTop(circle: CirclePlacement, forming: boolean): number {
  return circle.y - ((circle.lines.length - 1) * circle.lineHeight) / 2 + (forming ? -6 : 0);
}

/** A circle's disc, in world units. */
export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** Whether a name's box reaches into a disc. */
export function meetsDisc(box: LabelBox, d: Disc): boolean {
  const nx = Math.max(box.x - box.halfWidth, Math.min(d.x, box.x + box.halfWidth));
  const ny = Math.max(box.top, Math.min(d.y, box.bottom));
  return (nx - d.x) ** 2 + (ny - d.y) ** 2 < d.r * d.r;
}

/** How far a promoted name may travel from its circle, in line heights. */
const MAX_SHIFT_LINES = 2.5;

/** Floating point: a box that clears by a hair still clears. */
const EPS = 0.01;

/**
 * The baseline for a promoted name: beside its circle if it can be, and
 * otherwise the SMALLEST move that clears what is in the way.
 *
 * The candidates are the two natural places, plus, for every name already
 * drawn, the two baselines that would sit this name exactly clear of it. The
 * nearest candidate that is clear of EVERYTHING wins, so a name moves as
 * little as the picture allows and never into a second collision.
 *
 * Two and a half lines is the limit. A name that has travelled further than
 * that no longer reads as belonging to its circle, so it goes back above and
 * the crowding is a layout problem rather than a label one. Every move is
 * measured against the frame as well: see the clipping count in the scan.
 */
export function promotedLabelTop(
  circle: CirclePlacement,
  x: number,
  others: LabelBox[],
  /** Other circles' discs the name must keep off; the ones holding this circle are left out by the caller. */
  discs: Disc[] = [],
): { top: number; below: boolean; dx: number } {
  const above = aboveTop(circle);
  const below = belowTop(circle);
  // A gap of a quarter line, so "clear" means visibly clear rather than
  // touching by a pixel of the estimate.
  const gap = circle.lineHeight * 0.25;
  const lines = Math.max(1, circle.lines.length);
  // How far the box reaches from its first baseline, each way.
  const reachUp = circle.fontSize * 0.8;
  const reachDown = (lines - 1) * circle.lineHeight + circle.fontSize * 0.25;
  const clear = (top: number, atX = x) => {
    const box = boxAt(top, atX, circle);
    return !others.some((o) => overlaps(box, o, gap)) && !discs.some((d) => meetsDisc(box, d));
  };
  const travel = (top: number) => Math.min(Math.abs(top - above), Math.abs(top - below));
  const limit = circle.lineHeight * MAX_SHIFT_LINES;

  const candidates = [above, below];
  for (const o of others) {
    candidates.push(o.top - gap - reachDown - EPS, o.bottom + gap + reachUp + EPS);
  }
  // Clear of a disc: the baselines that sit the box just above or below the
  // disc's widest point across the box's width.
  const halfWidth = labelHalfWidth(circle.lines, circle.fontSize);
  for (const d of discs) {
    const dx = Math.max(0, Math.abs(d.x - x) - halfWidth);
    if (dx >= d.r) continue;
    const reach = Math.sqrt(d.r * d.r - dx * dx);
    candidates.push(d.y - reach - reachDown - EPS, d.y + reach + reachUp + EPS);
  }
  const best = candidates
    .filter((t) => travel(t) <= limit)
    // Stable, so the two natural places win any tie with a shifted one.
    .sort((a, b) => travel(a) - travel(b))
    .find((t) => clear(t));
  if (best !== undefined) return { top: best, below: best >= below, dx: 0 };
  /*
   * BESIDE IT, WHEN ABOVE AND BELOW ARE BOTH TAKEN (live 2026-10-30). With no
   * layer set the biggest circle takes the middle, and a ring circle between
   * it and the forming band had a band above and a disc below: no up-or-down
   * move was clear, and the name went back onto one of them. The name sits
   * level with its circle's middle, on whichever side is clear, left first.
   */
  const middle = circle.y - ((lines - 1) * circle.lineHeight) / 2 + circle.fontSize * 0.3;
  for (const side of [-1, 1]) {
    const dx = side * (circle.r + 6 + halfWidth);
    if (clear(middle, x + dx)) return { top: middle, below: false, dx };
  }
  return { top: above, below: false, dx: 0 };
}

/** One circle, as the plan needs to see it. */
export interface PlanInput {
  id: string;
  x: number;
  y: number;
  r: number;
  depth: number;
  name: string;
  /** Whether its name is drawn at all. A name nobody sees is in nobody's way. */
  shown: boolean;
  hasChildren: boolean;
  forming: boolean;
}

export interface PlacedLabel {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** The name did not fit inside its own circle and was promoted. */
  outside: boolean;
  /** Baseline of the first line. */
  top: number;
  /** A promoted name that went under its disc rather than over it. */
  below: boolean;
  /** How far a promoted name sits to the side of its circle's centre: beside it when above and below are both taken. */
  dx: number;
}

/**
 * THE FORMING BAND AS SOMETHING A NAME MUST NOT LAND ON (2026-10-23).
 *
 * A name promoted above a circle at the top of a pack reached into the band
 * the forming circles ride, and one name was drawn across another's arc.
 * Measured on the live village at 1440x1000: "Leadership Circle" over
 * "Permaculture". The band is covered by squares a band wide, centred along
 * its middle, so a diagonal arc never blocks the open ground inside it the
 * way one bounding box of the whole arc would.
 */
export function bandObstacles(bands: NestedBand[], riders: NestedCircle[]): LabelBox[] {
  const boxes: LabelBox[] = [];
  for (const band of bands) {
    const width = band.outer - band.inner;
    const mid = (band.inner + band.outer) / 2;
    const step = width / mid;
    for (const r of riders) {
      if (!r.band || r.band.containerId !== band.containerId) continue;
      for (let a = r.band.a0; a <= r.band.a1 + step / 2; a += step) {
        const at = Math.min(a, r.band.a1);
        const x = band.x + mid * Math.cos(at);
        const y = band.y + mid * Math.sin(at);
        boxes.push({ x, top: y - width / 2, bottom: y + width / 2, halfWidth: width / 2 });
      }
    }
  }
  return boxes;
}

/**
 * Where every name goes, in one pass over the drawn circles.
 *
 * Fixed names (centred in a circle, or just inside a container's top edge) go
 * where their circle is: their circle decides, and nothing moves them. Promoted
 * names start above their disc and then, in layout order, each one that lands
 * on another name takes the nearest clear place. Each move is entered in the
 * picture before the next name is asked, so two promoted names cannot resolve
 * onto each other, and a move only ever removes a collision.
 */
export function buildLabelPlan(
  circles: PlanInput[],
  pxPerWorld: number,
  /** Ground a promoted name must also keep off, beyond the other names: the forming band. */
  obstacles: LabelBox[] = [],
): Map<string, PlacedLabel> {
  const placed = circles.map((c) => {
    const wrapped = wrapLabel(c.name, c.r, c.depth);
    const fit = fitLabelToScreen(wrapped, c.r, pxPerWorld);
    // A forming circle's name carries its "forming" pill a line below, so the
    // ground it needs is one line taller (live 1280x800, 2026-10-30: a pill on
    // the name of the circle beside it).
    const shape: CirclePlacement = {
      y: c.y,
      r: c.r,
      lines: c.forming && fit.outside ? [...wrapped.lines, "forming"] : wrapped.lines,
      fontSize: fit.fontSize,
      lineHeight: fit.lineHeight,
    };
    const top = fit.outside ? aboveTop(shape) : c.hasChildren ? heldTop(c, shape, circles) : centredTop(shape, c.forming);
    const label: PlacedLabel = {
      lines: wrapped.lines,
      fontSize: fit.fontSize,
      lineHeight: fit.lineHeight,
      outside: fit.outside,
      top,
      below: false,
      dx: 0,
    };
    return { input: c, shape, label, box: boxAt(top, c.x, shape) };
  });

  const drawn = placed.filter((p) => p.input.shown);
  for (const entry of drawn) {
    if (!entry.label.outside) continue;
    const others = [...drawn.filter((o) => o !== entry).map((o) => o.box), ...obstacles];
    // Every disc on the map except the ones that hold this circle: a promoted
    // name lives on its container's ground, so it stays off its siblings (live
    // 2026-10-30: "Leadership Circle" drawn into Development's disc) and off
    // its own disc, which a shifted place could otherwise slide onto.
    const me = entry.input;
    const discs = circles.filter((c) => c === me || Math.hypot(c.x - me.x, c.y - me.y) + me.r > c.r + EPS);
    const at = promotedLabelTop(entry.shape, entry.input.x, others, discs);
    entry.label.top = at.top;
    entry.label.below = at.below;
    entry.label.dx = at.dx;
    entry.box = boxAt(at.top, entry.input.x + at.dx, entry.shape);
  }

  return new Map(placed.map((p) => [p.input.id, p.label]));
}
