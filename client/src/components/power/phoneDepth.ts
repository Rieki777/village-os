/**
 * HOW DEEP THE PHONE DRAWS, and why it cannot simply be "one level".
 *
 * A phone canvas is a 375px square. Seventeen circles and their children in
 * that square is a picture nobody can use, so the phone draws one level at a
 * time: the top level, and then whatever you step into. That rule was right
 * when this village had fifteen circles side by side at the top.
 *
 * THEN THE VILLAGE GREW A ROOT. Every circle was nested under the General
 * Coordinating Circle, which is what the org map was for, and the top level
 * became exactly one disc. The phone drew it, correctly, and a founder opening
 * the living map on a phone saw a single empty green circle with no way to know
 * that fifteen circles were one level below it. Measured on production on
 * 2026-09-19: one node drawn where `/api/org` carried seventeen circles.
 *
 * So the rule is not "one level down from the camera", it is "down to the first
 * level that shows more than one circle". A level holding a single disc answers
 * no question a reader has: it cannot be compared with anything, and stepping
 * into it is the only thing to do there, so the camera may as well have started
 * inside it.
 *
 * The descent stops at the deepest level that exists, so a village that really
 * is one circle still draws that circle.
 */

/** Just the fields this rule reads. `layout.circles` carries more. */
export interface DepthCircle {
  id: string;
  /** The village root is depth -1, so a top-level circle is 0. */
  depth?: number | null;
}

export function phoneDepthFor(circles: readonly DepthCircle[], focusId: string | null): number {
  const focusDepth = focusId ? circles.find((c) => c.id === focusId)?.depth : undefined;
  const start = (focusDepth ?? -1) + 1;
  if (!circles.length) return start;

  const levelOf = (c: DepthCircle) => c.depth ?? 0;
  const deepest = circles.reduce((m, c) => Math.max(m, levelOf(c)), 0);

  let depth = start;
  while (depth < deepest && circles.filter((c) => levelOf(c) === depth).length <= 1) depth += 1;
  return depth;
}
