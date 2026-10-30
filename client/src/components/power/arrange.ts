/**
 * ARRANGE MODE, AS PURE FUNCTIONS: the moves a person has made on the map and
 * not yet published, and what the map draws because of them.
 *
 * Nothing here talks to the server. Moves live in the page until Publish,
 * which writes them as ONE org draft of `move_circle` changes (0208). So the
 * decide gate on the publish route governs a drag exactly the way it governs
 * any other reorganisation, and a drag is revertable like one.
 *
 * Every refusal comes from the SAME rules the server applies
 * (`parentingRefusal`, shared/circleView.ts), run against the picture AS THE
 * PENDING MOVES LEAVE IT. Two drops that close a loop between them are refused
 * at the second drop, while somebody is looking, and not at Publish.
 *
 * The published village can still change under a list that was sound when it
 * was made: an Undo, another admin, a publish that already made a move true.
 * `settleAgainst` takes those moves off again, so the list the bar offers to
 * publish is always one that publishes.
 */
import { parentingRefusal, type CircleLayer, type CircleLink } from "@shared/circleView";

export interface PendingMove {
  circleId: string;
  /** The circle it now sits inside, or null for the top of the village. */
  parentId: string | null;
  /** Its place among its siblings (0286), when the move sets one. */
  order?: number;
  /** Its governance layer (0286), when the move sets one; null clears it. */
  layer?: CircleLayer | null;
}

type Circle = CircleLink & { name?: string; isExample?: boolean; order?: number; layer?: string | null };

/** The circles as the pending moves leave them. A circle's last move wins. */
export function withMoves<T extends Circle>(circles: T[], moves: PendingMove[]): T[] {
  if (!moves.length) return circles;
  const to = new Map(moves.map((m) => [m.circleId, m] as const));
  return circles.map((c) => {
    const m = to.get(c.id);
    if (!m) return c;
    return {
      ...c,
      parentCircleId: m.parentId ?? null,
      ...(m.order !== undefined ? { order: m.order } : {}),
      ...(m.layer !== undefined ? { layer: m.layer } : {}),
    };
  });
}

/** Whether the published circle already sits exactly as this move would leave it. */
function alreadyTrue(live: Circle[], m: PendingMove): boolean {
  const c = live.find((x) => x.id === m.circleId);
  if (!c) return false;
  return (
    (c.parentCircleId ?? null) === m.parentId &&
    (m.order === undefined || (c.order ?? 0) === m.order) &&
    (m.layer === undefined || (c.layer ?? null) === m.layer)
  );
}

/**
 * THE RING, IN THE ORDER A READER MEETS IT (0286). Putting circles in a new
 * order writes a place for each (10, 20, 30, so a later insert has room), and
 * gives a sibling with no layer the plain one, `operating`. A pack with no layer
 * set anywhere rings by size, so without that the order you chose would not
 * show. The middle is untouched: an operating circle never takes it.
 */
export function orderMoves(picture: Circle[], parentId: string | null, sequence: string[]): PendingMove[] {
  return sequence.map((id, i) => {
    const c = picture.find((x) => x.id === id);
    return {
      circleId: id,
      parentId,
      order: (i + 1) * 10,
      ...(c && !c.layer ? { layer: "operating" as CircleLayer } : {}),
    };
  });
}

/**
 * THE MIDDLE (0286): this circle becomes its container's lead, and a sibling
 * that held the middle as link or lead goes back to operating, so one circle
 * holds it and the reader can tell which.
 */
export function middleMoves(picture: Circle[], circleId: string): PendingMove[] {
  const moving = picture.find((c) => c.id === circleId);
  if (!moving) return [];
  const parentId = moving.parentCircleId ?? null;
  const out: PendingMove[] = [{ circleId, parentId, layer: "lead" }];
  for (const c of picture) {
    if (c.id === circleId || (c.parentCircleId ?? null) !== parentId) continue;
    if (c.layer === "lead" || c.layer === "link") out.push({ circleId: c.id, parentId, layer: "operating" });
  }
  return out;
}

/** One sibling earlier (-1) or later (+1) round the ring, as `orderMoves` writes it. */
export function nudgeMoves(picture: Circle[], circleId: string, step: -1 | 1): PendingMove[] {
  const moving = picture.find((c) => c.id === circleId);
  if (!moving) return [];
  const parentId = moving.parentCircleId ?? null;
  const rank: Record<string, number> = { link: 0, lead: 1, operating: 2, advisory: 3, council: 4 };
  const r = (c: Circle) => rank[c.layer ?? ""] ?? 2;
  const ring = picture
    .filter((c) => (c.parentCircleId ?? null) === parentId && !(c.layer === "lead" || c.layer === "link"))
    .sort((a, b) => r(a) - r(b) || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((c) => c.id);
  const at = ring.indexOf(circleId);
  const to = at + step;
  if (at === -1 || to < 0 || to >= ring.length) return [];
  [ring[at], ring[to]] = [ring[to], ring[at]];
  return orderMoves(picture, parentId, ring);
}

/** Why dropping `circleId` into `parentId` is refused, in words, or null when it may land. */
export function dropRefusal(
  circles: Circle[],
  moves: PendingMove[],
  circleId: string,
  parentId: string | null,
): string | null {
  const picture = withMoves(circles, moves);
  const moving = picture.find((c) => c.id === circleId);
  if (!moving) return "That circle is no longer on the map.";
  if (moving.isExample) return "A standing example is not moved. Publish your own circles and it is removed.";
  // Dropped back where it already sits: nothing to refuse, and nothing to record.
  if ((moving.parentCircleId ?? null) === parentId) return null;
  return parentingRefusal(picture, circleId, parentId)?.message ?? null;
}

/**
 * Record a drop.
 *
 * A circle dropped back where it LIVES on the published map is no move at all,
 * so it leaves the list instead of adding a change that does nothing. That keeps
 * the Publish count honest: "3 moves" means three things will change.
 */
export function addMove(live: Circle[], moves: PendingMove[], move: PendingMove): PendingMove[] {
  const before = moves.find((m) => m.circleId === move.circleId);
  const rest = moves.filter((m) => m.circleId !== move.circleId);
  // A later move on the same circle keeps what the earlier one set and it did not.
  const merged: PendingMove = {
    circleId: move.circleId,
    parentId: move.parentId,
    ...(move.order !== undefined ? { order: move.order } : before?.order !== undefined ? { order: before.order } : {}),
    ...(move.layer !== undefined ? { layer: move.layer } : before?.layer !== undefined ? { layer: before.layer } : {}),
  };
  return alreadyTrue(live, merged) ? rest : [...rest, merged];
}

/**
 * The order to write the moves in, so publishing never passes through a loop.
 *
 * The server checks a draft's moves ONE AT A TIME, each against the picture the
 * ones before it left, because that is how they apply. A set of drops can be a
 * perfectly good final shape and still loop part way if written in the order
 * they were made: X goes inside Y while Y is still inside X, and only the next
 * move takes Y out. So each step here takes the first remaining move that is
 * valid against the picture so far. If none is, the rest go in as made, and
 * `settleAgainst` is what keeps such a list from ever reaching Publish.
 */
export function publishOrder(live: Circle[], moves: PendingMove[]): PendingMove[] {
  const ordered: PendingMove[] = [];
  let picture = live;
  const left = [...moves];
  while (left.length) {
    const i = left.findIndex((m) => !parentingRefusal(picture, m.circleId, m.parentId));
    if (i === -1) return [...ordered, ...left];
    const [next] = left.splice(i, 1);
    ordered.push(next);
    picture = withMoves(picture, [next]);
  }
  return ordered;
}

/**
 * The moves that still fit the published village, in the order they were made,
 * and the ones that no longer do.
 *
 * Each move is checked in publish order against the picture the kept moves
 * before it leave, the way the server applies a draft. A move the village has
 * already made true comes off without words; a move that is now refused comes
 * off with the refusal. When nothing comes off, the SAME array comes back, so a
 * caller holding it in state does not re-render for nothing.
 */
export function settleAgainst(
  live: Circle[],
  moves: PendingMove[],
): { kept: PendingMove[]; dropped: Array<{ move: PendingMove; words: string | null }> } {
  const keep = new Set<PendingMove>();
  const dropped: Array<{ move: PendingMove; words: string | null }> = [];
  const applied: PendingMove[] = [];
  for (const m of publishOrder(live, moves)) {
    if (alreadyTrue(live, m)) {
      dropped.push({ move: m, words: null });
      continue;
    }
    const refused = dropRefusal(live, applied, m.circleId, m.parentId);
    if (refused) {
      dropped.push({ move: m, words: `${describeMove(live, m)}: ${refused}` });
      continue;
    }
    applied.push(m);
    keep.add(m);
  }
  if (!dropped.length) return { kept: moves, dropped };
  return { kept: moves.filter((m) => keep.has(m)), dropped };
}

/** A move in the words the Arrange bar lists it in. */
export function describeMove(circles: Circle[], move: PendingMove): string {
  const name = (id: string) => circles.find((c) => c.id === id)?.name ?? id;
  const live = circles.find((c) => c.id === move.circleId);
  const moves = (live?.parentCircleId ?? null) !== move.parentId || (move.order === undefined && move.layer === undefined);
  const parts: string[] = [];
  if (moves) parts.push(move.parentId ? `moves inside ${name(move.parentId)}` : "moves to the top of the village");
  if (move.layer === "lead" || move.layer === "link") parts.push("takes the middle");
  else if (move.layer !== undefined && move.order === undefined) parts.push(move.layer ? `becomes ${move.layer}` : "loses its layer");
  if (move.order !== undefined) parts.push(`takes place ${move.order / 10} in the ring`);
  return `${name(move.circleId)} ${parts.join(", and ")}`;
}
