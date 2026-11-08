/**
 * A QUORUM RE-RUN, WRITTEN WHOLE IN ONE TRANSACTION (0334).
 *
 * The quorum fallback (shared/quorumFallback.ts) asks a ballot that missed
 * quorum again, once, on a NEW linked ballot. This file is the one place that
 * writes the pair, so "the first ballot closed as asked again" and "the re-run
 * is open" commit together or not at all. A crash between the two would leave
 * a subject that says it is being voted on with no ballot open on it.
 *
 * What the re-run is, row by row:
 *
 *   ballots             the first ballot's frozen snapshot, copied: subject,
 *                       title, document, method, weight mode and token, unity,
 *                       total weight, electorate count, opener, timing, the
 *                       purpose line and the frozen seat term. Three things
 *                       differ: `quorum_pct` (half, rounded up), the window
 *                       (as long as the first, from now), and `rerun_of`.
 *                       `quorum_fallback` stays 1, which is what tells the
 *                       close that a second miss is decided by the votes cast.
 *   ballot_electorate   the SAME frozen roll and weights. The snapshot law
 *                       froze who was asked when the question first opened,
 *                       and asking again is not a new question.
 *   ballot_votes        NOT copied. A re-run is a fresh ask, and a vote cast
 *                       on the first ballot stays on the first ballot's record.
 *
 * And the subject payloads a closer reads BY BALLOT ID, which would otherwise
 * be stranded on the first ballot when the re-run's close settles the subject:
 *
 *   role_declarations     (0120) copied to the re-run's id.
 *   gps_change_proposals  (0219) copied to the re-run's id.
 *   mechanics_proposals   `ballot_id` moved to the re-run, guarded on the
 *                         first ballot's id, so the proposal points at the
 *                         ballot that will decide it.
 *
 * The Birthing's `ballot_steward_slate` is not here because the Birthing is
 * never re-run (`QUORUM_FALLBACK_EXEMPT`).
 *
 * No cache sits above these tables, which is the ballots.ts posture.
 */
import type { Pool } from "mysql2/promise";

export interface QuorumRerunInput {
  firstId: string;
  rerunId: string;
  /** The first ballot's subject key, which the re-run holds while open. */
  openKey: string;
  /** The outcome note the first ballot closes with. */
  outcomeNote: string;
  closedBy: string;
  rerunQuorumPct: number;
  opensAt: Date;
  closesAt: Date;
}

/**
 * Close the first ballot as `no_quorum_rerun` and open its re-run.
 *
 * Returns false, having written nothing, when the guarded close found the
 * first ballot no longer open: somebody else closed it first, exactly as
 * `closeBallot`'s own guarded UPDATE reports.
 */
export async function closeAndOpenQuorumRerun(pool: Pool, input: QuorumRerunInput): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [closed] = await conn.query<any>(
      "UPDATE ballots SET status='no_quorum_rerun', outcome_note=?, closed_by=?, closed_at=NOW(), " +
        "open_key=CONCAT(open_key, ':', id) WHERE id=? AND status='open'",
      [input.outcomeNote, input.closedBy, input.firstId],
    );
    if (Number(closed.affectedRows) === 0) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, " +
        "weight_mode, weight_token, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, " +
        "opens_at, closes_at, timing, purpose_alignment, seat_term_ends_at, seat_term_season_id, " +
        "seat_term_follows_season, rerun_of, quorum_fallback, status) " +
        "SELECT ?, subject_type, subject_ref, ?, title, doc_markdown, method, " +
        "weight_mode, weight_token, unity_pct, ?, total_weight, electorate_count, opened_by, " +
        "?, ?, timing, purpose_alignment, seat_term_ends_at, seat_term_season_id, " +
        "seat_term_follows_season, id, 1, 'open' FROM ballots WHERE id = ?",
      [input.rerunId, input.openKey, input.rerunQuorumPct, input.opensAt, input.closesAt, input.firstId],
    );
    await conn.query(
      "INSERT INTO ballot_electorate (ballot_id, user_id, weight) " +
        "SELECT ?, user_id, weight FROM ballot_electorate WHERE ballot_id = ?",
      [input.rerunId, input.firstId],
    );
    await conn.query(
      "INSERT INTO role_declarations (ballot_id, role_id, name, purpose) " +
        "SELECT ?, role_id, name, purpose FROM role_declarations WHERE ballot_id = ?",
      [input.rerunId, input.firstId],
    );
    await conn.query(
      "INSERT INTO gps_change_proposals (ballot_id, statement, proposed_by) " +
        "SELECT ?, statement, proposed_by FROM gps_change_proposals WHERE ballot_id = ?",
      [input.rerunId, input.firstId],
    );
    await conn.query(
      "UPDATE mechanics_proposals SET ballot_id = ? WHERE ballot_id = ?",
      [input.rerunId, input.firstId],
    );
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
