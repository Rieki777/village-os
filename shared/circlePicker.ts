/**
 * HOW A LIST OF CIRCLES IS PICKED FROM, ONE ANSWER FOR EVERY PICKER.
 *
 * Operating circles come first. Circles still forming sit below in their own
 * quiet group and stay selectable. Dormant circles are left out. Which circle
 * is the anchor comes from the village's own rows: a circle an admin marked
 * (`isAnchor`, 0372), else the circle that coordinates the others when the
 * structure shows one (shared/coordinatingCircle.ts). No circle is named here.
 *
 * Status is `circles.status`: active (operating), forming, dormant.
 */
import { coordinatingCircle } from "./coordinatingCircle";

export interface PickableCircle {
  id: string;
  name: string;
  status?: string | null;
  isAnchor?: boolean | null;
  parentCircleId?: string | null;
  isExample?: boolean | null;
}

export type CircleStanding = "operating" | "forming" | "hidden";

export function circleStanding(status: string | null | undefined): CircleStanding {
  const s = String(status ?? "active").toLowerCase();
  if (s === "forming") return "forming";
  if (s === "dormant" || s === "dissolved" || s === "archived") return "hidden";
  return "operating";
}

/** The anchor circle's id, or null when the village has none. Marked wins over derived. */
export function anchorCircleId(circles: readonly PickableCircle[] | null | undefined): string | null {
  const own = (circles ?? []).filter((c) => c && !c.isExample);
  const marked = own.find((c) => c.isAnchor === true);
  if (marked) return String(marked.id);
  return coordinatingCircle(own)?.id ?? null;
}

export const ANCHOR_MARK = "⚓";

/** Rows ready to draw, with the anchor flag resolved from data. */
export function withAnchor<T extends PickableCircle>(circles: readonly T[]): (T & { anchor: boolean })[] {
  const a = anchorCircleId(circles);
  return circles.map((c) => ({ ...c, anchor: a !== null && String(c.id) === a }));
}

export interface CircleGroups<T> {
  operating: T[];
  forming: T[];
}

/** Operating first (anchor leading), then forming; dormant and examples dropped. Each group by name. */
export function groupCircles<T extends PickableCircle & { anchor?: boolean }>(circles: readonly T[]): CircleGroups<T> {
  const rows = circles.filter((c) => c && !c.isExample && circleStanding(c.status) !== "hidden");
  const byName = (x: T, y: T) => (y.anchor ? 1 : 0) - (x.anchor ? 1 : 0) || String(x.name).localeCompare(String(y.name));
  return {
    operating: rows.filter((c) => circleStanding(c.status) === "operating").sort(byName),
    forming: rows.filter((c) => circleStanding(c.status) === "forming").sort(byName),
  };
}

/** A default is offered only when exactly one circle is operating. */
export function soleOperatingId<T extends PickableCircle>(circles: readonly T[]): string | null {
  const g = groupCircles(circles);
  return g.operating.length === 1 ? String(g.operating[0].id) : null;
}

/** A search box earns its place above this many circles. */
export const SEARCH_ABOVE = 8;

export function matchCircles<T extends PickableCircle>(circles: readonly T[], q: string): T[] {
  const w = q.trim().toLowerCase();
  return w ? circles.filter((c) => String(c.name).toLowerCase().includes(w)) : [...circles];
}

/** A circle as a picker receives it: the row, with the anchor already resolved by the server. */
export type PickerCircle = PickableCircle & { anchor?: boolean };
