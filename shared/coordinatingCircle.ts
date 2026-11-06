/**
 * The circle that coordinates the others, when a village has one.
 *
 * WHY THIS EXISTS. /circles and /roles said every circle "is double-linked to
 * the General Coordinating Circle", typed into the page, so every village read
 * the name of one village's top circle whether it had such a circle or not. A
 * new village's circles are flat (server/seeds/circles-seed.json names no
 * parent), and a village that nests its circles calls the top one what it
 * likes.
 *
 * So the name comes from the village's own rows. A village coordinates through
 * one circle when exactly one of its own circles sits at the top and at least
 * one other circle sits under it. Example circles are the platform's, never
 * the village's structure, so they are left out. A parent id that names no
 * circle in the list counts as the top, the way the map draws it.
 *
 * Anything else (flat circles, several tops, a top with nothing under it)
 * has no coordinating circle, and the pages say so without naming one.
 */
export interface CircleLinkRow {
  id: string;
  name?: string | null;
  parentCircleId?: string | null;
  isExample?: boolean | null;
}

export function coordinatingCircle<T extends CircleLinkRow>(circles: readonly T[] | null | undefined): T | null {
  const own = (circles ?? []).filter((c) => c && !c.isExample && String(c.id ?? "") !== "");
  const ids = new Set(own.map((c) => String(c.id)));
  const isTop = (c: T) => !c.parentCircleId || !ids.has(String(c.parentCircleId));
  const tops = own.filter(isTop);
  if (tops.length !== 1) return null;
  const top = tops[0];
  if (!String(top.name ?? "").trim()) return null;
  return own.some((c) => String(c.parentCircleId ?? "") === String(top.id)) ? top : null;
}
