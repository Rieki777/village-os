/**
 * A PAINTED FRAME ON A PORTRAIT, READ OFF THE PIXELS.
 *
 * Generated character art often arrives painted on a paper card: a cream or
 * white margin around the picture, sometimes a photograph of that card on a
 * dark table. Inside one of our rounded frames the margin reads as a second,
 * white frame (lead, 11 Nov: "remove the white borders on any of the
 * character images").
 *
 * The stock drawings were cropped at the source, and `roleSheet.test.ts`
 * holds every file in `server/assets/avatars` to this measure so a framed one
 * cannot come back. Art that lives in a village's uploads volume (a member's
 * own portrait, a role's header picture) never passes through this repository,
 * so the page measures it as it loads (`client/src/components/FramelessImg.tsx`)
 * and crops only a picture this function calls framed. Everything else is
 * drawn untouched, so good art is never zoomed.
 *
 * Pure and dependency-free: the browser hands it canvas pixels, the test
 * hands it sharp's raw buffer.
 */

/** How much to cut from each side, as fractions of the picture's width (left, right) or height (top, bottom). */
export interface FrameCut {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A line belongs to the frame when at least this share of it is paper (or, before the paper, backdrop). */
const LINE_SHARE = 0.6;
/** A band deeper than this is a pale or dark picture, never a margin. */
const MAX_BAND = 0.25;
/** Past the last paper line, a feathered or rounded paper edge still shows; cut this much more. */
const EXTRA = 0.025;

const isPaper = (r: number, g: number, b: number) => {
  const lo = Math.min(r, g, b);
  return lo >= 200 && Math.max(r, g, b) - lo < 50;
};
const isBackdrop = (r: number, g: number, b: number) => Math.max(r, g, b) < 45;

/** How deep the paper band runs in from each side, as a fraction of the picture, or null for a side with none. */
export interface FrameBands {
  left: number | null;
  top: number | null;
  right: number | null;
  bottom: number | null;
}

/**
 * The paper band along each side, read from the edge inwards: any lines of dark
 * backdrop first (a photographed card), then the paper. A side counts only when
 * it has paper within the outer quarter.
 */
export function frameBands(px: ArrayLike<number>, width: number, height: number, channels = 4): FrameBands {
  if (width < 8 || height < 8) return { left: null, top: null, right: null, bottom: null };
  const at = (x: number, y: number) => (y * width + x) * channels;
  const share = (n: number, idx: (i: number) => number, test: (r: number, g: number, b: number) => boolean) => {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const o = idx(i);
      if (test(px[o], px[o + 1], px[o + 2])) hits++;
    }
    return hits / n;
  };
  const side = (lines: number, length: number, idx: (k: number, i: number) => number): number | null => {
    const limit = Math.floor(lines * MAX_BAND);
    let k = 0;
    while (k < limit && share(length, (i) => idx(k, i), isBackdrop) >= LINE_SHARE) k++;
    const paperFrom = k;
    while (k < lines && share(length, (i) => idx(k, i), (r, g, b) => isPaper(r, g, b) || isBackdrop(r, g, b)) >= LINE_SHARE) k++;
    if (k === paperFrom || k > limit) return null;
    return k / lines;
  };
  return {
    top: side(height, width, (k, i) => at(i, k)),
    bottom: side(height, width, (k, i) => at(i, height - 1 - k)),
    left: side(width, height, (k, i) => at(k, i)),
    right: side(width, height, (k, i) => at(width - 1 - k, i)),
  };
}

/**
 * The frame on a picture, or null when it has none.
 *
 * A picture counts as framed only when ALL FOUR sides carry a band. That is
 * the test that keeps a photograph against a pale wall, a dark vignette or a
 * misty sky drawn as it is: a frame goes all the way round, and those do not.
 */
export function findFrame(px: ArrayLike<number>, width: number, height: number, channels = 4): FrameCut | null {
  const { top, bottom, left, right } = frameBands(px, width, height, channels);
  if (top === null || bottom === null || left === null || right === null) return null;
  return { left: left + EXTRA, top: top + EXTRA, right: right + EXTRA, bottom: bottom + EXTRA };
}
