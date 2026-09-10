/**
 * `mechanics_proposals.veto_reason`: the proposer's copy of a steward's words,
 * and the two statements that take them away.
 *
 * ── ONE COLUMN, AND THAT IS THE WHOLE SCOPE ─────────────────────────────────
 *
 * `mechanics_proposals` is the governance loop's proposal table and it has
 * several owners that are nothing to do with the steward's seat:
 * `server/lib/changeset.ts` writes the change set onto it,
 * `server/lib/applyDue.ts` moves its status at the close,
 * `server/lib/governanceWindows.ts` joins it to ballots for the window
 * surface, and `server/repos/hypha.ts` reads it to bridge an agreement. None
 * of those moved here and none of them is this file's business. They are named
 * so that a reader who finds this file does not read it as the enumerable home
 * of the whole table, which it is not and does not claim to be.
 *
 * What it IS the enumerable home of is one column, and that column is a
 * promise about somebody's words.
 *
 * ── WHY A COLUMN GETS A FILE ────────────────────────────────────────────────
 *
 * A steward's veto reason is written once and stored THREE times.
 * `VETO_TEXT_COLUMNS` in `server/lib/stewardship.ts` names all three:
 * `ballot_vetoes.reason` (the act), `ballots.veto_reason` (the copy the
 * decision page reads) and this one, the copy that travels back to the
 * proposer with their proposal.
 *
 * The first build of the redaction knew about one of the three. A member was
 * told their words were gone and they went on rendering in two other places,
 * which is a promise kept on one page and broken on the next. Enumerability is
 * the only defence that survives the next person to touch this: three files, a
 * reader can open each, and "did the redaction get all of it" stops being a
 * question you answer by grepping and hoping. The other two homes are
 * `server/repos/ballotVetoes.ts` and `server/repos/stewardshipBallots.ts`.
 *
 * ── THE SUBQUERY IS A JOIN THAT COULD NOT BE SPLIT ──────────────────────────
 *
 * `blankProposalVetoReasonForBallot` names `ballots` inside a subquery, so it
 * is not, strictly, a one-table statement. It stays one statement anyway and
 * that is a decision rather than an oversight: splitting it into a SELECT for
 * the subject reference and then an UPDATE would put a gap between reading
 * which proposal a ballot is about and blanking its words, and a redaction
 * with a gap in it is a redaction that can half-happen. One statement, one
 * atom, and the second table appears only as a lookup and is never written.
 *
 * ── NO CACHE SITS ABOVE THIS COLUMN ─────────────────────────────────────────
 *
 * Nothing to invalidate, which the redaction path needs: blanked words have to
 * stop rendering at once and a cached copy of somebody's sentence is the one
 * answer this path cannot afford.
 */
import type { Pool, ResultSetHeader } from "mysql2/promise";

/**
 * Blank the proposal's copy of one steward's veto reason, for one ballot.
 *
 * Scoped by BOTH the steward and the ballot's subject, and both halves matter.
 * `vetoed_by` keeps one steward's redaction from erasing another steward's
 * words under a council, where several stewards can have written about the
 * same decision. The subquery keeps it to the proposal this ballot is actually
 * about, rather than to every proposal this member ever vetoed.
 *
 * `subject_ref` is the proposal id for the subjects that carry one. For a
 * ballot whose subject is something else the subquery yields a value that
 * matches no proposal, the UPDATE touches nothing, and that is the correct
 * outcome rather than an error: a decision with no proposal behind it has no
 * proposer's copy to blank.
 *
 * Reports nothing. An UPDATE matching no row is the ordinary case here.
 */
export async function blankProposalVetoReasonForBallot(
  pool: Pool,
  ballotId: string,
  stewardId: string,
): Promise<void> {
  await pool.query(
    "UPDATE mechanics_proposals SET veto_reason = '' WHERE vetoed_by = ? AND id IN " +
      "(SELECT subject_ref FROM ballots WHERE id = ?)",
    [stewardId, ballotId],
  );
}

/**
 * Blank every proposal copy of this member's veto reasons, and count them.
 *
 * The erasure sweep's third table. As on the ballots copy, the
 * `IS NOT NULL AND <> ''` half of the WHERE is what makes the count mean
 * something: without it the answer would include every proposal whose words
 * were already gone, and the report would print a number that never fell no
 * matter how many times the sweep ran.
 *
 * Not scoped to a ballot, because this sweep is about a person leaving rather
 * than about one decision being reconsidered.
 */
export async function blankProposalVetoReasonsBy(pool: Pool, userId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE mechanics_proposals SET veto_reason = '' WHERE vetoed_by = ? AND veto_reason IS NOT NULL AND veto_reason <> ''",
    [userId],
  );
  return Number(res?.affectedRows ?? 0);
}
