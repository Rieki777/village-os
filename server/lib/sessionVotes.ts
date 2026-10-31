/**
 * The room votes its agenda (0290): the tallies and the order the vote
 * makes. The doors live in server/lib/liveSessions.ts (`voteOnItem`,
 * `setAgendaOrder`), inside the room's transaction; the contract is
 * shared/sessionVotes.ts.
 */
import type { PoolConnection } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import * as votes from "../repos/sessionVotes";
import { votedOrder, voteScore, type AgendaVote, type ItemVotes } from "../../shared/sessionVotes";
import type { ItemStatus } from "../../shared/sessions";

export interface VoteRec {
  itemId: number;
  no: number;
  vote: 1 | -1;
}

export const mapVote = (r: any): VoteRec => ({ itemId: Number(r.item_id), no: Number(r.member_no), vote: Number(r.vote) > 0 ? 1 : -1 });

/** Each item's tally, as one viewer reads it. */
export function talliesFor(rows: readonly VoteRec[], viewerNo: number | null): Map<number, ItemVotes> {
  const out = new Map<number, ItemVotes>();
  for (const r of rows) {
    const t = out.get(r.itemId) ?? { up: 0, down: 0, mine: 0 as AgendaVote };
    if (r.vote > 0) t.up += 1;
    else t.down += 1;
    if (viewerNo != null && r.no === viewerNo) t.mine = r.vote;
    out.set(r.itemId, t);
  }
  return out;
}

export const noVotes = (): ItemVotes => ({ up: 0, down: 0, mine: 0 });

/**
 * Number the agenda again by the vote, 1..n, writing only the positions that
 * move. Runs inside the room's transaction, on the rows as they are now.
 */
export async function sortByVotes(
  conn: PoolConnection,
  sessionId: number,
  items: readonly { id: number; status: ItemStatus; position: number }[],
): Promise<void> {
  const tally = talliesFor((await votes.voteRows(conn, sessionId)).map(mapVote), null);
  const order = votedOrder(items, (i) => voteScore(tally.get(i.id)));
  for (let i = 0; i < order.length; i += 1) {
    if (order[i].position !== i + 1) await repo.writeItemPosition(conn, order[i].id, i + 1);
  }
}
