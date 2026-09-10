/**
 * THE WORDS ON A VOTE ROW: `ballot_votes.reason`, read one member at a time.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT A BALLOT-VOTES REPOSITORY ─────────────
 *
 * `ballot_votes` has seven production readers — `server/index.ts`,
 * `server/lib/ballots.ts`, `server/lib/delegation.ts`, `server/lib/orgChart.ts`,
 * `server/lib/nonHumanSeats.ts`, `server/lib/stewardship.ts` and
 * `server/routes/delegation.ts` — and four of those are either recorded in the
 * raw-SQL burn-down register or being burned down by a neighbouring lane in the
 * same wave this file was written in. Declaring a home for the whole table from
 * here would be a claim this lane cannot keep, and the file that lost the race
 * would become the table's second home, which is the harm the register exists
 * to prevent rather than a step toward fixing it.
 *
 * What this file can honestly hold is the one statement the landing path made:
 * the reason attached to a single member's vote. It is written down as its own
 * module rather than folded into a landing repo because that would put two
 * tables in one file, and one table per module is the property that makes
 * "who reads this table" answerable at all.
 *
 * ── WHY THE REASON IS READ ROW BY ROW AND NOT WITH THE TALLY ───────────────
 *
 * `votesFor` (server/lib/ballots.ts) already reads every vote on a ballot and
 * deliberately does not carry the reason: a tally does not need it, and every
 * surface that renders a tally would then be holding words a member wrote in
 * confidence to the engine. The landing path needs the reason for exactly one
 * class of voter — a seated steward whose no BLOCKS a token send — and so it
 * asks for exactly those rows, one at a time, after it already knows which
 * members they are. Nobody else's words are read at all.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Nothing here to invalidate, and nothing here should be cached: a reason is
 * editable up to the close, and the rule this read serves is a rule about what
 * the steward said, not about what they said an hour ago.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The reason one member wrote on one ballot, or null.
 *
 * NULL for "no such vote" and NULL for "a vote with no reason", which is one
 * answer on purpose: the rule above this read refuses a block whose reason does
 * not stand on its own, and a vote that is not there and a vote that said
 * nothing both fail that test in the same way and with the same sentence.
 */
export async function voteReasonOf(pool: Pool, ballotId: string, userId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT reason FROM ballot_votes WHERE ballot_id = ? AND user_id = ?",
    [ballotId, userId],
  );
  return rows[0]?.reason == null ? null : String(rows[0].reason);
}
