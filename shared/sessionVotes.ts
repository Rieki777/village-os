/**
 * The room votes its agenda (0290). Rye, 2026-10-30: "In sessions this should
 * be a vote (where we can crowd vote ones up and down and together select the
 * priority)".
 *
 * ── WHO, AND WHAT ────────────────────────────────────────────────────────
 *
 * Everyone who joined an open session votes each WAITING agenda item up or
 * down, one vote per person per item. Voting the same way again, or sending
 * 0, takes the vote back; voting the other way changes it.
 *
 *   POST /api/sessions/:id/items/:itemId/vote   { vote: 1 | -1 | 0 } -> { ok }
 *
 * A vote is the person's own, the same as a consent answer: the facilitator
 * never casts one for somebody else (shared/sessionOnBehalf.ts).
 *
 * ── THE ORDER ────────────────────────────────────────────────────────────
 *
 * While the vote is open (`state.orderSet` false), the agenda's positions ARE
 * the vote: every vote, and every item added, numbers the agenda again by
 * score (ups less downs), highest first, ties keeping the order they had.
 * Items already talked about stay at the top in the order they ran, and items
 * taken off the agenda stay at the end. So every reader of `position`, the
 * room, the record and the next item, reads the room's choice.
 *
 * The facilitator sets the order once the room has voted:
 *
 *   POST /api/sessions/:id/agenda/order   { set: true | false } -> { ok }
 *
 * `set: true` closes the vote and keeps the order as it stands; the arrows
 * then move items by hand. `set: false` opens the vote again and sorts by the
 * score once more. The votes themselves stay as the record of how the room
 * chose.
 */

import type { SessionItem } from "./sessions";

export type AgendaVote = -1 | 0 | 1;

export function isAgendaVote(v: unknown): v is AgendaVote {
  return v === -1 || v === 0 || v === 1;
}

/** The room's tally on one item, as the viewer reads it. */
export interface ItemVotes {
  up: number;
  down: number;
  /** The viewer's own vote: 1, -1, or 0 for none. */
  mine: AgendaVote;
}

export const itemVotePath = (sessionId: number, itemId: number): string => `/api/sessions/${sessionId}/items/${itemId}/vote`;
export const agendaOrderPath = (sessionId: number): string => `/api/sessions/${sessionId}/agenda/order`;

export const voteScore = (v: Pick<ItemVotes, "up" | "down"> | null | undefined): number => (v ? v.up - v.down : 0);

const GROUP: Record<SessionItem["status"], number> = { active: 0, done: 0, waiting: 1, parked: 2 };

/**
 * The agenda as the vote orders it. Items talked about first, in their
 * order; then the waiting ones by score, highest first; then the parked
 * ones. Ties keep their position, then their id.
 */
export function votedOrder<T extends Pick<SessionItem, "id" | "status" | "position">>(items: readonly T[], score: (item: T) => number): T[] {
  return [...items].sort(
    (a, b) =>
      GROUP[a.status] - GROUP[b.status] ||
      (a.status === "waiting" ? score(b) - score(a) : 0) ||
      a.position - b.position ||
      a.id - b.id,
  );
}

/** What a vote does to the viewer's own vote: the same button again takes it back. */
export const nextVote = (mine: AgendaVote, pressed: 1 | -1): AgendaVote => (mine === pressed ? 0 : pressed);

export const VOTE_COPY = {
  voteUp: (title: string) => `Vote up: ${title}`,
  voteDown: (title: string) => `Vote down: ${title}`,
  tally: (up: number, down: number) => `${up} up, ${down} down`,
  open: "The room is voting. Vote items up or down and the agenda sorts itself by the score.",
  set: "The facilitator set the order. The vote is closed.",
  setOrder: "Set the order",
  reopen: "Open the vote again",
} as const;

export const VOTE_REFUSALS = {
  voteValue: "A vote is 1 (up), -1 (down) or 0 (take it back).",
  voteClosed: "The facilitator has set the order, so the vote is closed.",
  waitingOnly: "Only an item still waiting can be voted on.",
  setValue: "Say whether to set the order (true) or open the vote again (false).",
} as const;
