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
 * PENDING MOVES LEAVE IT. The map never lets a person drop a circle where
 * publishing would refuse it, and two drops that close a loop between them are
 * refused at the second drop, while somebody is looking, and not at Publish.
 */
import { parentingRefusal, type CircleLink } from "@shared/circleView";

export interface PendingMove {
  circleId: string;
  /** The circle it now sits inside, or null for the top of the village. */
  parentId: string | null;
}

type Circle = CircleLink & { name?: string; isExample?: boolean };

/** The circles as the pending moves leave them. A circle's last move wins. */
export function withMoves<T extends Circle>(circles: T[], moves: PendingMove[]): T[] {
  if (!moves.length) return circles;
  const to = new Map(moves.map((m) => [m.circleId, m.parentId] as const));
  return circles.map((c) => (to.has(c.id) ? { ...c, parentCircleId: to.get(c.id) ?? null } : c));
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
  const rest = moves.filter((m) => m.circleId !== move.circleId);
  const liveParent = live.find((c) => c.id === move.circleId)?.parentCircleId ?? null;
  return liveParent === move.parentId ? rest : [...rest, move];
}

/**
 * The order to write the moves in, so publishing never passes through a loop.
 *
 * The server checks a draft's moves ONE AT A TIME, each against the picture the
 * ones before it left, because that is how they apply. A set of drops can be a
 * perfectly good final shape and still loop part way if written in the order
 * they were made: X goes inside Y while Y is still inside X, and only the next
 * move takes Y out. So each step here takes the first remaining move that is
 * valid against the picture so far. If none is, the rest go in as made and the
 * server's preview says why, which is honest and not something a drop can reach.
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

/** A move in the words the Arrange bar lists it in. */
export function describeMove(circles: Circle[], move: PendingMove): string {
  const name = (id: string) => circles.find((c) => c.id === id)?.name ?? id;
  return move.parentId
    ? `${name(move.circleId)} moves inside ${name(move.parentId)}`
    : `${name(move.circleId)} moves to the top of the village`;
}
