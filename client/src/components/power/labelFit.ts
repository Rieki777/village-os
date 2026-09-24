/**
 * HOW BIG A CIRCLE'S NAME DRAWS, IN THE SPACE LEGIBILITY LIVES IN.
 *
 * `wrapLabel` (shared/mapLayout.ts) sizes a label in WORLD units and floors
 * it at 9. World units are not pixels: the SVG scales the whole picture to
 * fit its box, so the size a reader actually gets is `worldFont x scale`.
 *
 * Measured on the live page at a 1280x720 viewport, that scale was 0.51 and
 * a "forming" caption rendered SIX PIXELS tall. The layout was not wrong and
 * the wrap was not wrong. The label simply inherited whatever scale the
 * camera happened to be at, and nothing in the chain had an opinion about
 * the reader.
 *
 * This module is that opinion, and it is pure so it can be tested without a
 * browser (this repo's client tests are logic; there is no jsdom).
 */

import { clearChord } from "@shared/mapLayout";

/** The smallest a name may render, in SCREEN pixels. */
export const MIN_LABEL_PX = 12.5;

/** Advance width per character as a fraction of font size. Matches the
 *  CHAR_W that `wrapLabel` wraps against, so the two agree about width. */
export const CHAR_W = 0.55;

export interface Wrappedish {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

export interface FittedLabel {
  fontSize: number;
  lineHeight: number;
  /** True when the name could not clear the floor inside its own circle and
   *  has been moved above the disc, where no chord constrains it. */
  outside: boolean;
}

/**
 * @param label     what `wrapLabel` returned, in world units
 * @param radius    the circle's world radius
 * @param pxPerWorld screen pixels per world unit, at the camera's current
 *                   width. Zero before the first measurement lands.
 */
export function fitLabelToScreen(label: Wrappedish, radius: number, pxPerWorld: number): FittedLabel {
  const asIs = { fontSize: label.fontSize, lineHeight: label.lineHeight, outside: false };
  // Nothing to convert against yet. Draw what the layout asked for; the
  // ResizeObserver settles it on the next frame.
  if (!(pxPerWorld > 0)) return asIs;

  const onScreen = label.fontSize * pxPerWorld;
  if (onScreen >= MIN_LABEL_PX) return asIs;

  /*
   * How much bigger it needs to be, against how much bigger it MAY be.
   *
   * THE CHORD IS THE CLEAR INTERIOR, INSIDE THE SEAT RING, and it used to be
   * `radius * 1.7`, the whole disc. The layout sizes every circle to hold its
   * name inside the ring (`radiusForLabel`) and `wrapLabel` wraps to that same
   * interior, so growing against the full radius was this one step disagreeing
   * with the two either side of it. Measured live at 1440x900: eleven names
   * with a seat drawn through them, and two after this line changed.
   *
   * A name that cannot reach the floor inside the ring is promoted above the
   * disc, where no chord constrains it and `labelPlacement` finds it a clear
   * place. That path already existed; this is what sends the right names down
   * it. Rye chose this over hiding a small circle's seats (which costs the
   * reader the seat states) and over growing seated circles (measured: a
   * bigger map, a camera pulled further back, more names promoted anyway, and
   * a crossing gained on the phone).
   */
  const want = MIN_LABEL_PX / onScreen;
  const widestChars = Math.max(1, ...label.lines.map((l) => l.length));
  const chord = Math.max(1, clearChord(radius));
  const allowed = chord / (widestChars * label.fontSize * CHAR_W);
  const grown = label.fontSize * Math.max(1, Math.min(want, allowed));

  // Grown as far as the circle allows and still unreadable. This name does
  // not fit this circle at this zoom, so it goes above the disc at the size
  // it actually needs, and the caller gives it a halo to survive the
  // crossing.
  if (grown * pxPerWorld < MIN_LABEL_PX - 0.25) {
    const needed = MIN_LABEL_PX / pxPerWorld;
    return { fontSize: needed, lineHeight: Math.round(needed * 1.15), outside: true };
  }
  return { fontSize: grown, lineHeight: Math.max(1, Math.round(grown * 1.15)), outside: false };
}

/**
 * The caption under a name ("forming") on the same screen floor.
 * It was the worst offender live: a hard floor of 9 WORLD units.
 */
export function captionSize(labelFontSize: number, pxPerWorld: number): number {
  return Math.max(labelFontSize - 4, pxPerWorld > 0 ? (MIN_LABEL_PX - 1.5) / pxPerWorld : 9);
}
