/**
 * WHERE A CIRCLE SITS, AS AN ORG DRAFT CARRIES IT (0286).
 *
 * `move_circle` (0208) carried one thing, the circle's parent: the drag on the
 * circles map nested one circle in another. Rye's choice of 2026-10-23 adds the
 * other two facts the map is drawn from, so the people who arrange the village
 * can set them the same way and the same governance answers for them:
 *
 *   order   the circle's place among its siblings (`circles.sort_order`), which
 *           is the order a member meets them clockwise round the ring;
 *   layer   the circle's governance layer (`circles.layer`, CIRCLE_LAYERS in
 *           shared/circleView.ts), which decides who holds the middle.
 *
 * Both are optional on the payload and an absent key changes nothing, so every
 * move a draft already holds reads, previews, publishes and reverts exactly as
 * it did. `layer: null` is a real value: it clears the layer.
 *
 * The payload is json, so carrying these needs no enum ALTER on the op column.
 */
import { CIRCLE_LAYERS, isCircleLayer, type CircleLayer } from "../../shared/circleView";

export interface Placement {
  order?: number;
  layer?: CircleLayer | null;
}

/** A circle's place among its siblings is a whole number from 0 to this. */
export const MAX_ORDER = 9999;

/** One arrangement publishes at most this many moves. */
export const MAX_ARRANGE_MOVES = 60;

const LAYER_LIST = CIRCLE_LAYERS.join(", ");

/** The order and layer a `move_circle` payload carries, or the sentence refusing them. */
export function placementOf(payload: unknown): { ok: true; placement: Placement } | { ok: false; problem: string } {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const placement: Placement = {};
  if (p.order !== undefined) {
    const n = Number(p.order);
    if (!Number.isInteger(n) || n < 0 || n > MAX_ORDER) {
      return { ok: false, problem: `A circle's place among its siblings is a whole number from 0 to ${MAX_ORDER}` };
    }
    placement.order = n;
  }
  if (p.layer !== undefined) {
    if (p.layer !== null && !isCircleLayer(p.layer)) {
      return { ok: false, problem: `A circle's governance layer is one of ${LAYER_LIST}, or none` };
    }
    placement.layer = p.layer;
  }
  return { ok: true, placement };
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * How a move reads in a preview: the words it always had when only the parent
 * moves, and the order and layer said plainly when the draft sets them. Names
 * circles, never a person.
 */
export function moveWords(
  name: string,
  parent: { changes: boolean; toId: string | null; toName: string | null },
  placement: Placement,
): string {
  const moveClause = parent.toId ? `move "${name}" inside "${parent.toName}"` : `move "${name}" to the top of the village`;
  if (placement.order === undefined && placement.layer === undefined) {
    return moveClause.charAt(0).toUpperCase() + moveClause.slice(1);
  }
  const parts: string[] = [];
  if (parent.changes) parts.push(moveClause);
  if (placement.order !== undefined) {
    parts.push(`${parts.length ? "give it" : `give "${name}"`} place ${placement.order + 1} among the circles beside it`);
  }
  if (placement.layer !== undefined) {
    const subject = parts.length ? "it" : `"${name}"`;
    parts.push(placement.layer ? `make ${subject} ${article(placement.layer)} ${placement.layer} circle` : `clear the governance layer of ${subject}`);
  }
  const line = parts.join(", and ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export interface ArrangeMove {
  circleId: string;
  parentCircleId: string | null;
  order?: number;
  layer?: CircleLayer | null;
}

/**
 * The body of an arrangement sent from the circles map: a list of moves, each
 * naming a circle and where it now sits. Shape only; whether each move fits the
 * village is the preview's to say, against the village as the draft leaves it.
 */
export function parseArrangement(body: unknown): { ok: true; moves: ArrangeMove[] } | { ok: false; problem: string } {
  const raw = (body && typeof body === "object" ? (body as Record<string, unknown>).moves : undefined) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, problem: "An arrangement names at least one circle and where it now sits" };
  if (raw.length > MAX_ARRANGE_MOVES) return { ok: false, problem: `One arrangement moves at most ${MAX_ARRANGE_MOVES} circles` };
  const moves: ArrangeMove[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const circleId = typeof r.circleId === "string" ? r.circleId.trim() : "";
    if (!circleId || circleId.length > 64) return { ok: false, problem: "Each move names its circle by id" };
    if (seen.has(circleId)) return { ok: false, problem: "An arrangement moves each circle once" };
    seen.add(circleId);
    if (r.parentCircleId !== null && typeof r.parentCircleId !== "string") {
      return { ok: false, problem: "Each move says where the circle now sits: a circle's id, or null for the top of the village" };
    }
    const placed = placementOf(r);
    if (!placed.ok) return { ok: false, problem: placed.problem };
    moves.push({ circleId, parentCircleId: r.parentCircleId ? String(r.parentCircleId) : null, ...placed.placement });
  }
  return { ok: true, moves };
}
