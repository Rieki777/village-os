/**
 * THE SLATE A LAUNCH PROPOSAL NAMES, and the answer each named person gives.
 *
 * `ballot_steward_slate` (0220) is one row per member a `village_launch`
 * proposal puts forward for the inaugural steward's seat. Rye chose this shape
 * over the alternative on 2026-09-24: "whoever is clicking the 'launch
 * village' button then selects from a list of members in the proposal to carry
 * the steward role so then it's there in the proposal to be voted on."
 *
 * ── THE ANSWER LIVES IN TWO PLACES AND THAT IS ONE FACT, NOT TWO ───────────
 *
 * A nominee's YES is `ballot_votes.stands_for_steward` (0218), which this file
 * writes and `standingForStewardOn` in server/repos/stewardshipBallots.ts
 * reads. Accepting is part of answering the ballot, and the vote row already
 * freezes at the close.
 *
 * A nominee's NO is `declined_at` on the slate row, and it cannot live
 * anywhere else. `stands_for_steward` is `NOT NULL DEFAULT 0`, so a zero
 * cannot tell a refusal from a silence, and Rye asked for the declines to be
 * shown. A decline must also be sayable by somebody who has not voted, and
 * `ballot_votes.choice` is NOT NULL, so there is no row to carry it yet.
 *
 * The two never disagree, because `answerNomination` below is the only writer
 * of either and writes both in the same call. The seating then refuses anybody
 * carrying a decline whatever the flag says, which is the fail-safe direction.
 *
 * ── WHY THE FLAG'S WRITE IS HERE RATHER THAN BESIDE ITS READ ───────────────
 *
 * `server/repos/stewardshipBallots.ts` owns the READ of that column and says
 * in its own header that the column is the ballots lane's to write, naming
 * `castVote` as the writer. That is still true of the vote path. Answering a
 * nomination is a second door onto the same column, and it belongs to the
 * SLATE: it is only ever reached by somebody the slate names, it is written in
 * the same breath as `declined_at`, and splitting the pair across two files is
 * how two halves of one answer drift apart. A pointer is left in that file so
 * a reader who finds the read learns there are two writers.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Nothing to invalidate. Every read goes to the database when it is asked,
 * which the ballot page needs: a decline has to stop reading as a silence the
 * moment it is given.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface SlateRow {
  userId: string;
  /** The member who chose the slate. One person chooses it; the page says so. */
  proposedBy: string;
  /** Null until they answer no. A value is the refusal, and when it was given. */
  declinedAt: Date | null;
  /** True when `ballot_votes.stands_for_steward` is set for this member. */
  accepted: boolean;
}

/**
 * Write the slate, INSIDE the transaction that opens the ballot.
 *
 * A `PoolConnection` and never a pool, because this is handed to `openBallot`'s
 * `onOpen` hook and has to commit or roll back with the ballot row and the
 * frozen roll. A slate written afterwards would leave a window in which the
 * launch vote exists carrying no stewards, and a member voting inside that
 * window would be answering a different proposal from the one the next member
 * reads. The same hook is how a `role_seat` ballot freezes its term.
 *
 * An EMPTY list is a legal slate and writes nothing: a launch that names
 * nobody seats nobody, which is a state `seatCatalystsAsStewards` already
 * handles and `nobodyStood` already has words for.
 *
 * Ids are written in the order given and read back sorted, so two runs over
 * the same slate produce the same page.
 */
export async function insertSlate(
  conn: PoolConnection,
  ballotId: string,
  userIds: readonly string[],
  proposedBy: string,
): Promise<void> {
  for (const userId of userIds) {
    await conn.query(
      "INSERT INTO ballot_steward_slate (ballot_id, user_id, proposed_by) VALUES (?,?,?)",
      [ballotId, userId, proposedBy],
    );
  }
}

/**
 * The slate on one ballot, with each person's answer, ordered by user id.
 *
 * ONE STATEMENT AND NOT TWO, joined to the vote row, because the two halves of
 * an answer read separately can be read at two different instants: a member
 * accepting between the two queries would come back neither accepted nor
 * silent. `LEFT JOIN`, because a nominee who has not voted has no vote row and
 * is still on the slate.
 *
 * Ordered by user id rather than by name: names are looked up by the caller
 * and a name can change, while the order a village reads its slate in should
 * not move between two page loads.
 */
export async function slateFor(pool: Pool, ballotId: string): Promise<SlateRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT s.user_id, s.proposed_by, s.declined_at, v.stands_for_steward FROM ballot_steward_slate s " +
      "LEFT JOIN ballot_votes v ON v.ballot_id = s.ballot_id AND v.user_id = s.user_id " +
      "WHERE s.ballot_id = ? ORDER BY s.user_id",
    [ballotId],
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    proposedBy: String(r.proposed_by),
    declinedAt: r.declined_at === null || r.declined_at === undefined ? null : new Date(String(r.declined_at)),
    accepted: Number(r.stands_for_steward ?? 0) === 1,
  }));
}

/**
 * Everyone on the slate who has neither accepted nor declined.
 *
 * Derived from `slateFor` rather than given its own SELECT, so "waiting" can
 * never mean something different from what the page renders.
 */
export function awaitingAnswer(slate: readonly SlateRow[]): SlateRow[] {
  return slate.filter((s) => !s.accepted && s.declinedAt === null);
}

/**
 * Record one nominee's answer, BOTH halves of it, in one call.
 *
 * `accept` true clears the decline and sets the flag; `accept` false sets the
 * decline and clears the flag. Neither half is ever written on its own, which
 * is what stops the pair drifting: there is one door and it always writes two
 * statements.
 *
 * ── SETTING THE FLAG UPDATES A VOTE ROW THAT MAY NOT EXIST ─────────────────
 *
 * And that is not a failure, it is the whole reason this returns the resulting
 * ROW rather than a boolean. `ballot_votes.choice` is NOT NULL, so a nominee
 * who has not voted has no row to carry a yes, and the UPDATE matches nothing.
 * They are then back at `waiting`, which is the truth: their acceptance rides
 * on their vote (`standsForSteward`, which 0218 built and 0220 re-means), and
 * what accepting early actually achieved was withdrawing a decline.
 *
 * A CALLER THAT ASSUMED THE ANSWER IT ASKED FOR WOULD SAY "accepted" to
 * somebody whose acceptance was not stored anywhere, which is the worst
 * available outcome: they stop looking, the close reads nothing, and the seat
 * stands empty with a screen that said otherwise. So the row is re-read and
 * the caller is told what is actually recorded.
 *
 * Returns null when this ballot's slate does not name this member, so the
 * route can refuse in words rather than silently writing nothing. That refusal
 * is the same rule the seating enforces at the close, asked early: a member
 * the proposal did not name has no nomination to answer.
 */
export async function answerNomination(
  pool: Pool,
  ballotId: string,
  userId: string,
  accept: boolean,
  now: Date = new Date(),
): Promise<SlateRow | null> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballot_steward_slate SET declined_at = ? WHERE ballot_id = ? AND user_id = ?",
    [accept ? null : now, ballotId, userId],
  );
  if (Number(res?.affectedRows ?? 0) === 0) {
    /*
     * `affectedRows` is zero for "no such row" AND for "the row already held
     * this value", so it cannot answer the question on its own. Ask the table.
     */
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM ballot_steward_slate WHERE ballot_id = ? AND user_id = ?",
      [ballotId, userId],
    );
    if (rows.length === 0) return null;
  }
  await pool.query("UPDATE ballot_votes SET stands_for_steward = ? WHERE ballot_id = ? AND user_id = ?", [
    accept ? 1 : 0,
    ballotId,
    userId,
  ]);
  return (await slateFor(pool, ballotId)).find((s) => s.userId === userId) ?? null;
}
