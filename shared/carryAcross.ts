/**
 * CARRY PEOPLE ACROSS: the step after a new structure is published, read as a
 * plan.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * A structure change publishes its new circles and seats BESIDE the old
 * chart, and nobody is moved by it: holder names never come from the outside
 * service, so the people sitting in the old seats are still sitting there.
 * The old chart's retire list (2026-09-15) set the order: nothing retires
 * until every current holder has a fresh seating in their new seat, retiring
 * never unseats anybody, and circles go from the bottom up. This file turns
 * the published draft and the live chart into that work list.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────
 *
 * The NEW chart is what the published draft made or moved: every
 * `create_seat`, every `update_seat`, every `create_circle`, plus the live
 * circles those seats sit in and the circles above them. Everything else that
 * is live is the OLD chart.
 *
 * A seat the review MOVED (`update_seat`, "takes over a live seat") kept its
 * id, so its people moved with it. They need nothing and are counted as
 * `kept`, never offered as a row.
 *
 * Every other live seating on an old seat is a row, with a suggestion that
 * is only ever a suggestion: a new seat of the same name, else the one new
 * seat whose name is most like it, else none. Two seats equally alike is
 * none, because a tie is a guess. The page marks a suggestion as one and a
 * person confirms it with a click.
 *
 * ── WHAT RETIRES ─────────────────────────────────────────────────────────
 *
 * An old seat nobody sits in. One somebody still holds is listed as still
 * held and never rested. An old circle retires once nothing is left in it: no
 * seat that stays, no circle inside it that stays. Worked from the leaves up,
 * so a circle always comes after the circles inside it.
 *
 * Pure: no pool, no clock.
 */
import type { DraftChangeLike } from "./structureDraft";

export interface CarrySeat {
  id: string;
  name: string;
  circleId: string | null;
  active: boolean;
  isExample: boolean;
}

export interface CarryCircle {
  id: string;
  name: string;
  parentCircleId: string | null;
  status: string;
  isExample: boolean;
}

/** One live seating, with the person already named as the page shows them. */
export interface CarrySeating {
  id: string;
  orgRoleId: string;
  /** A first name, never a full one. */
  person: string;
  isExample: boolean;
}

export type SuggestionWhy = "same-name" | "similar-name";

export interface CarryOption {
  id: string;
  name: string;
  circleId: string | null;
  circleName: string | null;
}

export interface CarryRow {
  seatingId: string;
  person: string;
  oldSeatId: string;
  oldSeatName: string;
  oldCircleId: string | null;
  oldCircleName: string | null;
  suggestion: { seatId: string; seatName: string; why: SuggestionWhy } | null;
}

export interface CarryRetire {
  /** Old seats nobody sits in. Rested by the retire draft. */
  seats: Array<{ id: string; name: string; circleId: string | null }>;
  /** Old circles left empty, bottom up. Rested by the retire draft. */
  circles: Array<{ id: string; name: string }>;
  /** Old seats somebody still holds. Never rested. */
  stillHeld: Array<{ id: string; name: string; circleId: string | null; holders: number }>;
}

export interface CarryPlan {
  /** The new chart's seats, the choices a person can be carried into. */
  newSeats: CarryOption[];
  /** Every live seating on an old seat. */
  rows: CarryRow[];
  /** People whose seat the review moved. They kept it and need nothing. */
  kept: Array<{ seatingId: string; person: string; seatId: string; seatName: string }>;
  retire: CarryRetire;
}

const nameKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Words that say what kind of seat it is and nothing about what it does. */
const GENERIC = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "with",
  "lead", "leader", "steward", "circle", "council", "seat", "role", "team", "member", "manager", "coordinator", "head",
]);

/** The words of a seat name that carry its meaning, lowercased, plural s dropped. */
export function meaningWords(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || GENERIC.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** How alike two seat names are, 0 to 1: shared meaning words over all of them. */
export function nameLikeness(a: string, b: string): number {
  const wa = meaningWords(a);
  const wb = meaningWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of Array.from(wa)) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

/**
 * The new seat to suggest for one old seat, or null.
 *
 * Same name first. Then the single most alike name, and only when one seat
 * is ahead of every other: a tie is a guess, and a guess is never made here.
 */
export function suggestSeat(oldName: string, options: readonly CarryOption[]): CarryRow["suggestion"] {
  const same = options.filter((o) => nameKey(o.name) === nameKey(oldName));
  if (same.length === 1) return { seatId: same[0].id, seatName: same[0].name, why: "same-name" };
  if (same.length > 1) return null;
  let best: CarryOption | null = null;
  let bestScore = 0;
  let tied = false;
  for (const o of options) {
    const score = nameLikeness(oldName, o.name);
    if (score <= 0) continue;
    if (score > bestScore) {
      best = o;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return { seatId: best.id, seatName: best.name, why: "similar-name" };
}

/** The work list for one published structure change. */
export function planCarry(input: {
  /** The published draft's changes. */
  changes: readonly DraftChangeLike[];
  seats: readonly CarrySeat[];
  circles: readonly CarryCircle[];
  seatings: readonly CarrySeating[];
}): CarryPlan {
  const seats = input.seats.filter((s) => !s.isExample && s.active);
  const circles = input.circles.filter((c) => !c.isExample);
  const circleById = new Map(circles.map((c) => [c.id, c]));
  const seatings = input.seatings.filter((a) => !a.isExample);

  const made = new Set(input.changes.filter((c) => c.op === "create_seat").map((c) => c.orgRoleId));
  const moved = new Set(input.changes.filter((c) => c.op === "update_seat").map((c) => c.orgRoleId));
  const madeCircles = new Set(
    input.changes
      .filter((c) => c.op === "create_circle")
      .map((c) => (c.orgRoleId.startsWith("circle:") ? c.orgRoleId.slice("circle:".length) : c.orgRoleId)),
  );

  const isNew = (id: string) => made.has(id) || moved.has(id);
  const newSeatRows = seats.filter((s) => isNew(s.id));
  const oldSeats = seats.filter((s) => !isNew(s.id));

  const newSeats: CarryOption[] = newSeatRows
    .map((s) => ({ id: s.id, name: s.name, circleId: s.circleId, circleName: s.circleId ? circleById.get(s.circleId)?.name ?? null : null }))
    .sort((a, b) => (a.circleName ?? "").localeCompare(b.circleName ?? "") || a.name.localeCompare(b.name));

  // The new chart's circles: what it made, where its seats sit, and every circle above those.
  const newCircles = new Set<string>(madeCircles);
  for (const s of newSeatRows) if (s.circleId) newCircles.add(s.circleId);
  for (const id of Array.from(newCircles)) {
    let at = circleById.get(id)?.parentCircleId ?? null;
    let guard = circles.length + 1;
    while (at && guard-- > 0 && !newCircles.has(at)) {
      newCircles.add(at);
      at = circleById.get(at)?.parentCircleId ?? null;
    }
  }

  const seatById = new Map(seats.map((s) => [s.id, s]));
  const rows: CarryRow[] = [];
  const kept: CarryPlan["kept"] = [];
  const heldBy = new Map<string, number>();
  for (const a of seatings) {
    const seat = seatById.get(a.orgRoleId);
    if (!seat) continue;
    if (isNew(seat.id)) {
      if (moved.has(seat.id)) kept.push({ seatingId: a.id, person: a.person, seatId: seat.id, seatName: seat.name });
      continue;
    }
    heldBy.set(seat.id, (heldBy.get(seat.id) ?? 0) + 1);
    rows.push({
      seatingId: a.id,
      person: a.person,
      oldSeatId: seat.id,
      oldSeatName: seat.name,
      oldCircleId: seat.circleId,
      oldCircleName: seat.circleId ? circleById.get(seat.circleId)?.name ?? null : null,
      suggestion: suggestSeat(seat.name, newSeats),
    });
  }
  rows.sort(
    (a, b) =>
      (a.oldCircleName ?? "").localeCompare(b.oldCircleName ?? "") ||
      a.oldSeatName.localeCompare(b.oldSeatName) ||
      a.person.localeCompare(b.person),
  );

  // ── What retires ──
  const retireSeats: CarryRetire["seats"] = [];
  const stillHeld: CarryRetire["stillHeld"] = [];
  const staysIn = new Map<string, number>();
  const bump = (id: string | null) => {
    if (id) staysIn.set(id, (staysIn.get(id) ?? 0) + 1);
  };
  for (const s of newSeatRows) bump(s.circleId);
  for (const s of oldSeats) {
    const n = heldBy.get(s.id) ?? 0;
    if (n > 0) {
      stillHeld.push({ id: s.id, name: s.name, circleId: s.circleId, holders: n });
      bump(s.circleId);
    } else {
      retireSeats.push({ id: s.id, name: s.name, circleId: s.circleId });
    }
  }

  const live = circles.filter((c) => c.status !== "dormant");
  const retired = new Set<string>();
  const order: CarryRetire["circles"] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of live) {
      if (retired.has(c.id) || newCircles.has(c.id) || (staysIn.get(c.id) ?? 0) > 0) continue;
      if (live.some((k) => k.parentCircleId === c.id && !retired.has(k.id))) continue;
      retired.add(c.id);
      order.push({ id: c.id, name: c.name });
      changed = true;
    }
  }

  return { newSeats, rows, kept, retire: { seats: retireSeats, circles: order, stillHeld } };
}

/** The retire draft's changes, seats first and then circles bottom up, each stamped as a steward's own choice. */
export function retireChanges(
  retire: CarryRetire,
  actor: string,
  carriedAfter: string,
): Array<{ op: "rest_seat" | "rest_circle"; orgRoleId: string; payload: Record<string, unknown> }> {
  const payload = { chosenBy: actor, retiring: "old-chart", carriedAfter };
  return [
    ...retire.seats.map((s) => ({ op: "rest_seat" as const, orgRoleId: s.id, payload: { ...payload } })),
    ...retire.circles.map((c) => ({ op: "rest_circle" as const, orgRoleId: `circle:${c.id}`, payload: { ...payload } })),
  ];
}
