/**
 * EVERY COUNT THE CIRCLES PAGE SAYS, FROM ONE PLACE.
 *
 * The side panel, the legend and the circle peek each counted for themselves,
 * and they disagreed: the panel counted the practice examples a new village
 * starts with and the legend left them out, so one page could say two
 * different things about how many roles a village has. Every number now comes
 * from here, under one rule: count the village's own circles and roles, and
 * only while it has none of its own, count the examples it is looking at.
 *
 * "Open" means two things in this product and both are named here so neither
 * is mistaken for the other: an OPENING is one place a person could take
 * (places minus held), and an open ROLE is a role with at least one opening.
 */
import type { PowerCircle, PowerSeat } from "./types";

/** The village's own, or every example while it has nothing of its own yet. */
export function countable<T extends { isExample?: boolean }>(items: T[]): T[] {
  const own = items.filter((i) => !i.isExample);
  return own.length ? own : items;
}

export interface VillageCounts {
  circles: number;
  /** Circles doing the work today: status active (or no status, which is active). */
  atWork: number;
  forming: number;
  roles: number;
  /** Every place a person could hold, across every role. */
  places: number;
  held: number;
  /** Places nobody holds yet. */
  openings: number;
  /** Roles with at least one opening. */
  openRoles: number;
}

const isActive = (c: PowerCircle) => (c.status ?? "active") === "active";

export function villageCounts(data: { circles: PowerCircle[]; roles: PowerSeat[] }): VillageCounts {
  const circles = countable(data.circles);
  const roles = countable(data.roles);
  const places = roles.reduce((n, r) => n + Math.max(0, r.seats ?? 0), 0);
  const held = roles.reduce((n, r) => n + Math.max(0, r.holderCount ?? 0), 0);
  return {
    circles: circles.length,
    atWork: circles.filter(isActive).length,
    forming: circles.filter((c) => c.status === "forming").length,
    roles: roles.length,
    places,
    held,
    openings: Math.max(0, places - held),
    openRoles: roles.filter((r) => r.vacant).length,
  };
}

export interface CircleCounts {
  roles: number;
  places: number;
  held: number;
  openings: number;
  /** Circles directly inside this one. */
  inside: number;
}

/** One circle's own roles, never its children's. */
export function circleCounts(
  circleId: string,
  data: { circles: PowerCircle[]; roles: PowerSeat[] },
): CircleCounts {
  const roles = data.roles.filter((r) => r.circleId === circleId);
  const places = roles.reduce((n, r) => n + Math.max(0, r.seats ?? 0), 0);
  const held = roles.reduce((n, r) => n + Math.max(0, r.holderCount ?? 0), 0);
  return {
    roles: roles.length,
    places,
    held,
    openings: Math.max(0, places - held),
    inside: data.circles.filter((c) => c.parentCircleId === circleId).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The whole map in one line: "6 circles at work, 11 forming, 16 openings."
 * A part with nothing in it is left out rather than said as a zero, and a
 * village with every place held says so.
 */
export function headlineFor(c: VillageCounts): string {
  if (!c.circles) return "No circles yet.";
  const parts = [`${plural(c.atWork, "circle", "circles")} at work`];
  if (c.forming) parts.push(`${c.forming} forming`);
  if (c.openings) parts.push(plural(c.openings, "opening", "openings"));
  else if (c.places) parts.push("every role held");
  return `${parts.join(", ")}.`;
}
