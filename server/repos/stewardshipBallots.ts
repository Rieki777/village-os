/**
 * The four `ballots` statements the stewardship lane makes.
 *
 * ── THIS FILE IS NOT THE WHOLE OF THE BALLOTS TABLE, AND SAYS SO ────────────
 *
 * `ballots` is the governance loop's central table and it has several readers
 * that are nothing to do with the steward's seat: `server/lib/applyDue.ts`
 * closes and lands them, `server/lib/moonDigest.ts` counts them for the moon
 * report, `server/lib/governanceWindows.ts` joins them to proposals for the
 * window surface, and `server/lib/ballots.ts` owns the tally. None of those
 * moved here, and a reader who found this file and believed it exhaustive
 * would be worse off than one who grepped. So they are named, the way
 * `server/repos/seatHoldings.ts` names the other three readers of the seating
 * table it does not own.
 *
 * What this file IS is the enumerable home of the statements
 * `server/lib/stewardship.ts` makes against that table, which are four and
 * are unrelated to closing anything. The fourth, `carriedUnseatingsOf`, finds
 * the votes that took a member's seat back, so a veto can say whether its
 * steward was being voted out when they cast it.
 *
 * ── TWO OF THE THREE ARE HALF OF A PROMISE ABOUT SOMEBODY'S WORDS ───────────
 *
 * `ballots.veto_reason` is the SECOND of the three columns that hold a
 * steward's veto reason. `VETO_TEXT_COLUMNS` in `server/lib/stewardship.ts`
 * names all three, and the first build of the redaction reached only one of
 * them, so the words went on rendering unchanged on the decision page after
 * the member had been told they were gone. The other two homes are
 * `server/repos/ballotVetoes.ts` (the act itself) and
 * `server/repos/proposalVetoReasons.ts` (the proposer's copy). Blanking one
 * and leaving two is a promise kept on one page and broken on the next, and
 * three files that can each be opened is what makes "did we get all of it"
 * answerable.
 *
 * A FOURTH column holds the same words on a different table and is NOT this
 * lane's to write: `ballot_votes.reason`, where a steward's blocking no is
 * typed. It is copied into the two `veto_reason` columns at the close, so
 * redacting the act reaches the copies; the vote row itself is the ballots
 * lane's own sweep.
 *
 * ── THE THIRD IS A CENSUS, AND WHY IT IS DERIVED RATHER THAN LISTED ─────────
 *
 * `subjectTypesOnBallots` answers "which kinds of decision has this village
 * actually held a vote on", which the stewardship read renders as the
 * per-subject veto map. It is derived from the table rather than from a list
 * typed into the lib because which subject types EXECUTE is the close
 * dispatcher's own table, and a second copy of it in the steward's file would
 * be the two-copies-of-one-rule trap. The caller unions it with the subjects
 * the setting names by hand, so a village that narrowed its map to a kind it
 * has never voted on still sees that kind on the page.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ──────────────────────────────────────────
 *
 * Nothing to invalidate. Every read below goes to the database when it is
 * asked, which the redaction path needs: blanked words have to stop rendering
 * at once.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * The subject types this village has actually voted on.
 *
 * Unordered on purpose, and the caller sorts. The statement carries no ORDER
 * BY because the answer goes into a Set the moment it arrives — it is unioned
 * with the hand-named subjects from the setting and sorted after that, so an
 * ordering promised here would be thrown away one line later and would read as
 * a guarantee the caller does not keep.
 *
 * Every distinct value comes back, including any this build's subject union
 * does not know about. A row written by an older build or a fork is a kind
 * this village really did vote on, and dropping it from the map would hide a
 * decision type from the one page that says what a steward may stop.
 */
export async function subjectTypesOnBallots(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT DISTINCT subject_type FROM ballots");
  return rows.map((r) => String(r.subject_type));
}

/**
 * Blank the ballot's copy of one steward's veto reason.
 *
 * Scoped by BOTH the ballot and the steward, and the second half is
 * load-bearing rather than defensive. Under a Steward Council a ballot can
 * carry vetoes from several stewards, and `ballots.veto_reason` holds the copy
 * stamped by the veto that actually stopped the landing. Blanking by ballot id
 * alone would let one steward's redaction erase another steward's words from
 * the decision page, which is the opposite of what a redaction is for: it
 * would take away a sentence its author never asked to withdraw.
 *
 * An UPDATE matching no row is not an error and reports nothing. A decision
 * that was never stopped has no copy to blank, and the redaction that called
 * this still ran.
 */
export async function blankBallotVetoReason(pool: Pool, ballotId: string, stewardId: string): Promise<void> {
  await pool.query("UPDATE ballots SET veto_reason = '' WHERE id = ? AND vetoed_by = ?", [ballotId, stewardId]);
}

export interface CarriedUnseating {
  ballotId: string;
  roleId: string;
  closedAt: Date | null;
  landsAt: Date | null;
}

/**
 * Every carried vote to take a seat back from one member, on any role.
 *
 * `role_unseat` freezes `subject_ref` as `userId@roleId`, so the member half is
 * matched exactly with `SUBSTRING_INDEX` and never with LIKE, which would read
 * an underscore in an id as a wildcard. Which of these were still waiting to
 * land at a given moment is the caller's question (`beingVotedOutAt` in
 * server/lib/stewardship.ts); the statement only finds them.
 */
export async function carriedUnseatingsOf(pool: Pool, userId: string): Promise<CarriedUnseating[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_ref, closed_at, lands_at FROM ballots " +
      "WHERE subject_type = 'role_unseat' AND status = 'passed' AND SUBSTRING_INDEX(subject_ref, '@', 1) = ?",
    [userId],
  );
  const instant = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return rows.map((r) => {
    const ref = String(r.subject_ref);
    return {
      ballotId: String(r.id),
      roleId: ref.slice(ref.indexOf("@") + 1),
      closedAt: instant(r.closed_at),
      landsAt: instant(r.lands_at),
    };
  });
}

/**
 * Blank every ballot copy of this member's veto reasons, and count them.
 *
 * The erasure sweep's second table. The `IS NOT NULL AND <> ''` half of the
 * WHERE is what makes the COUNT mean something: without it the answer would be
 * every ballot this member ever stopped, including the ones whose words were
 * already gone, and the erasure report would print a number that never fell no
 * matter how many times it ran.
 *
 * `vetoed_by` and not the act's id, because this sweep is about a person and
 * not about one decision.
 */
export async function blankBallotVetoReasonsBy(pool: Pool, userId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET veto_reason = '' WHERE vetoed_by = ? AND veto_reason IS NOT NULL AND veto_reason <> ''",
    [userId],
  );
  return Number(res?.affectedRows ?? 0);
}
