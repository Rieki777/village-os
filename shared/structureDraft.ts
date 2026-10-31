/**
 * THE DRAFT A STRUCTURE REVIEW MADE, read back as a plan.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * On 2026-10-20 a founder settled three duplicate seats, pressed "Accept into
 * a draft", and the review page re-rendered as an EMPTY batch: every proposal it
 * read was now accepted, and what was still waiting in the batch (the circles
 * the source had archived) changes no structure. The draft existed and was
 * open, and nothing on any screen said where it was or what to do next.
 *
 * So once a batch is accepted, the page shows the draft it made. The steward's
 * decisions are not stored anywhere, but the draft's changes are, and they are
 * the decisions applied: a `create_circle` is a new circle, a `create_seat` a
 * new seat (a renamed second seat already carries its typed name), an
 * `update_seat` a live seat moved, and a `rest_*` change means the old chart
 * retires. `planFromDraft` turns those back into a `StructurePlan` plus the
 * decisions that reproduce them, so the same map and the same counts the review
 * drew are drawn for the draft, by the same functions.
 *
 * Pure: no pool, no clock.
 */
import type {
  ConflictChoice,
  PlanCircle,
  PlanLiveCircle,
  PlanLiveSeat,
  PlanSeat,
  StructureDecisions,
  StructurePlan,
} from "./structurePlan";

/** One change of a draft, in the shape the review reads. */
export interface DraftChangeLike {
  op: string;
  orgRoleId: string;
  payload: unknown;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** What a draft carries, counted the way a steward reads it. */
export interface DraftCounts {
  circles: number;
  seats: number;
  moves: number;
  retiring: number;
  /** Every line in the draft, the number its preview counts. */
  changes: number;
}

export function countDraft(changes: readonly DraftChangeLike[]): DraftCounts {
  const n = (op: string) => changes.filter((c) => c.op === op).length;
  return {
    circles: n("create_circle"),
    seats: n("create_seat"),
    moves: n("update_seat"),
    retiring: n("rest_seat") + n("rest_circle"),
    changes: changes.length,
  };
}

/**
 * A draft's changes as a plan, against the live chart it would change.
 *
 * Every key is stable and made from the change itself, so the map's rows and
 * the list's rows answer to the same key. A moved seat whose live seat is gone
 * is drawn as a new seat with its own name, since there is nothing left to move.
 */
export function planFromDraft(
  draftId: string,
  changes: readonly DraftChangeLike[],
  liveCircles: readonly PlanLiveCircle[],
  liveSeats: readonly PlanLiveSeat[],
): { plan: StructurePlan; decisions: StructureDecisions } {
  const seatsLive = liveSeats.filter((s) => !s.isExample && s.active);
  const circles: PlanCircle[] = [];
  const seats: PlanSeat[] = [];
  const conflicts: Record<string, ConflictChoice> = {};
  let retire = false;

  const seat = (key: string, index: number, id: string, payload: Record<string, unknown>, match: PlanSeat["match"]): PlanSeat => ({
    key,
    proposalId: draftId,
    index,
    id,
    name: text(payload.name) ?? match?.name ?? "",
    aim: text(payload.aim),
    circleId: text(payload.circleId) ?? match?.circleId ?? null,
    circleProblem: null,
    payload,
    match,
    problem: null,
    sourceStatus: null,
    sourceStatusLabel: null,
    otherCircles: [],
    circleUnresolvedAtSource: false,
    sourcePay: null,
    sent: {},
  });

  changes.forEach((c, index) => {
    const payload = obj(c.payload);
    if (c.op === "create_circle") {
      const id = c.orgRoleId.startsWith("circle:") ? c.orgRoleId.slice("circle:".length) : c.orgRoleId;
      circles.push({
        key: `circle:${id}`,
        proposalId: draftId,
        name: text(payload.name) ?? id,
        id,
        status: "new",
        parentId: text(payload.parentCircleId),
        purpose: text(payload.purpose),
        problem: null,
        sourceStatus: null,
        sourceStatusLabel: null,
        sent: {},
      });
    } else if (c.op === "create_seat") {
      seats.push(seat(`seat:${c.orgRoleId}`, index, c.orgRoleId, payload, null));
    } else if (c.op === "update_seat") {
      const live = seatsLive.find((s) => s.id === c.orgRoleId);
      const key = `move:${c.orgRoleId}`;
      if (!live) {
        seats.push(seat(key, index, c.orgRoleId, payload, null));
        return;
      }
      seats.push(seat(key, index, c.orgRoleId, payload, { seatId: live.id, name: live.name, circleId: live.circleId, holders: live.holders }));
      conflicts[key] = { choice: "update" };
    } else if (c.op === "rest_seat" || c.op === "rest_circle") {
      retire = true;
    }
  });

  return {
    plan: {
      circles,
      seats,
      live: { circles: liveCircles.filter((c) => !c.isExample), seats: seatsLive },
      notes: [],
      archived: [],
    },
    decisions: { exclude: [], conflicts, retireOldChart: retire },
  };
}

/**
 * The time a batch arrived, as its NEWEST record says.
 *
 * Pressing sync again moves an unchanged waiting record into the new batch and
 * keeps the time it first landed, so the oldest record of a batch re-synced on
 * the 20th still says the 9th. The header used the first row, which is the
 * oldest. The newest is the time this batch was last read.
 */
export function newestArrival(times: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const t of times) {
    if (!t) continue;
    const at = Date.parse(t);
    if (Number.isNaN(at)) {
      if (best === null) best = t;
      continue;
    }
    if (at > bestAt) {
      bestAt = at;
      best = t;
    }
  }
  return best;
}

/**
 * What a batch still holds once its draft is made, in one sentence, or null
 * when nothing is left. Named so nobody wonders where the rest went.
 */
export function stayedBehind(plan: StructurePlan | null, waiting: number, source: string): string | null {
  if (!waiting) return null;
  const inChange = new Set([...(plan?.circles ?? []).map((c) => c.proposalId), ...(plan?.seats ?? []).map((s) => s.proposalId)]);
  const archived = new Set((plan?.archived ?? []).map((a) => a.proposalId).filter((id) => !inChange.has(id))).size;
  const notes = plan?.notes.length ?? 0;
  const deciding = Math.max(0, waiting - archived - notes);
  const lead = waiting === 1 ? `1 proposal from ${source} stays in the queue` : `${waiting} proposals from ${source} stay in the queue`;
  if (archived === waiting) return `${lead}: archived in ${source}.`;
  const parts = [
    archived ? `${archived} archived in ${source}` : null,
    notes ? (notes === 1 ? "1 note that changes no structure" : `${notes} notes that change no structure`) : null,
    deciding ? `${deciding} still waiting for a decision` : null,
  ].filter((p): p is string => !!p);
  return `${lead}: ${parts.join(", ")}.`;
}
