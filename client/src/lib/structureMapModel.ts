/**
 * What the structure review's map draws, in each of its three views, from the
 * plan and the steward's decisions. Pure, so the picture and the list beside it
 * are read off the same model, and a test can check one without the other.
 *
 *   before   the live chart as it stands.
 *   after    the chart if this change publishes: retired structure gone, moved
 *            seats in their new circles, everything drawn plain.
 *   changes  the after picture with what changes marked: new in green, a seat
 *            that takes over a live seat in gold, and what retires or moves out
 *            drawn dashed where it stands today.
 */
import type { DecidedStructure, StructureDecisions, StructurePlan } from "@shared/structurePlan";

export type MapView = "before" | "after" | "changes";
export type MapStatus = "new" | "match" | "retire" | "moved" | "same";

export interface MapCircle {
  id: string;
  name: string;
  parentId: string | null;
  status: MapStatus;
}

export interface MapSeat {
  /** Unique in the drawing: a plan seat's key, `live:<id>`, or `moved:<id>`. */
  id: string;
  name: string;
  circleId: string | null;
  status: MapStatus;
  /** The row in the change list this seat jumps to, or null for a seat the batch does not touch. */
  rowKey: string | null;
}

export interface MapModel {
  circles: MapCircle[];
  seats: MapSeat[];
}

export function structureMapModel(
  plan: StructurePlan,
  decided: DecidedStructure,
  decisions: StructureDecisions,
  view: MapView,
): MapModel {
  const live = plan.live.circles.filter((c) => c.status !== "dormant");
  // Which batch seat takes each live seat over, or merely shares its name.
  const rowFor = new Map<string, string>();
  const takenBy = new Map<string, string>();
  for (const k of decided.keptSeats) {
    const s = plan.seats.find((x) => x.key === k.key);
    if (!s?.match) continue;
    rowFor.set(s.match.seatId, s.key);
    if (k.via === "update") takenBy.set(s.match.seatId, s.key);
  }

  if (view === "before") {
    return {
      circles: live.map((c) => ({ id: c.id, name: c.name, parentId: c.parentCircleId, status: "same" })),
      seats: plan.live.seats.map((s) => ({
        id: `live:${s.id}`, name: s.name, circleId: s.circleId, status: "same", rowKey: rowFor.get(s.id) ?? null,
      })),
    };
  }

  const marked = view === "changes";
  const retiring = decisions.retireOldChart === true;
  const retiredCircles = new Set(retiring ? decided.retire.circles.map((c) => c.id) : []);
  const retiredSeats = new Set(retiring ? decided.retire.seats.map((s) => s.id) : []);
  const out = new Set(decisions.exclude ?? []);

  const circles: MapCircle[] = [];
  for (const c of live) {
    if (retiredCircles.has(c.id) && !marked) continue;
    circles.push({ id: c.id, name: c.name, parentId: c.parentCircleId, status: retiredCircles.has(c.id) ? "retire" : "same" });
  }
  for (const c of plan.circles) {
    if (c.status !== "new" || c.problem || out.has(c.key)) continue;
    circles.push({ id: c.id, name: c.name, parentId: c.parentId, status: marked ? "new" : "same" });
  }

  const seats: MapSeat[] = [];
  for (const s of plan.live.seats) {
    const taker = takenBy.get(s.id);
    if (taker) {
      // It moves. In the changes view its old place is drawn dashed.
      if (marked) seats.push({ id: `moved:${s.id}`, name: s.name, circleId: s.circleId, status: "moved", rowKey: taker });
      continue;
    }
    if (retiredSeats.has(s.id)) {
      if (marked) seats.push({ id: `live:${s.id}`, name: s.name, circleId: s.circleId, status: "retire", rowKey: rowFor.get(s.id) ?? null });
      continue;
    }
    seats.push({ id: `live:${s.id}`, name: s.name, circleId: s.circleId, status: "same", rowKey: rowFor.get(s.id) ?? null });
  }
  for (const k of decided.keptSeats) {
    const s = plan.seats.find((x) => x.key === k.key);
    if (!s) continue;
    const circleId = s.circleId ?? s.match?.circleId ?? null;
    const status: MapStatus = !marked ? "same" : k.via === "update" ? "match" : "new";
    seats.push({ id: s.key, name: k.name, circleId, status, rowKey: s.key });
  }
  // A match still waiting for its call is drawn where it would go, in gold, so
  // the picture shows every seat the steward still has to settle.
  for (const s of plan.seats) {
    if (!s.match || out.has(s.key) || decisions.conflicts?.[s.key]) continue;
    seats.push({ id: s.key, name: s.name, circleId: s.circleId, status: marked ? "match" : "same", rowKey: s.key });
  }
  return { circles, seats };
}
