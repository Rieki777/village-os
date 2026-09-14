/**
 * `external_proposal_subjects`: who a vendor's record is about.
 *
 * ── WHY THIS TABLE IS ITS OWN FILE ─────────────────────────────────────────
 *
 * It is the attribution index, and it is the table an erasure has to clear
 * completely. A record naming three people has three rows here, which is what
 * lets all three find it in an export and what lets an erasure reach it from
 * any of them. The failure this shape exists to prevent is exactly the one an
 * unenumerable table produces: a reader nobody remembered reports success while
 * leaving an attribution standing.
 *
 * It sits beside `server/repos/externalProposals.ts` rather than inside it
 * because they are two tables with two different obligations. The proposals
 * table holds the CONTENT, and the erasure clears a quote off it. This one
 * holds the LINK, and the erasure deletes it. Folding both into one module
 * would make "did we clear everything about this person" a question about a
 * file rather than about a table, and the two answers are not the same.
 *
 * ── WHAT DELIBERATELY DID NOT MOVE ─────────────────────────────────────────
 *
 * THE LANDING INSERT. `landProposal` writes one row per subject on the
 * `PoolConnection` that holds the proposal's own INSERT, so the record and the
 * people it names commit together or not at all. A repo function taking a pool
 * would run outside that transaction on a different connection, and a
 * half-landed record is one nobody can find by the member it is about.
 *
 * THE RE-RESOLVE. `reresolveSubjects` JOINs this table against `subject_refs`
 * in one set-based statement, in both its counting and its applying form. It is
 * a two-table statement, and its whole safety property (`WHERE member_id IS
 * NULL`, so an attribution is only ever filled in and never cleared) reads as
 * one thing beside the paragraph that explains it.
 *
 * THE EXPORT JOIN. `proposalsAboutMember` reads `external_proposals` JOINed to
 * this table. It is named in both repo headers, so neither file reads as a
 * complete list of its table's readers when it is not.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Every read below goes to the database at the moment it is asked, on purpose:
 * a deleted attribution has to stop being found at once, and a cached "yes" is
 * the one answer an erasure cannot afford.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Every record that names this member, once each.
 *
 * DISTINCT because one record can name the same member from more than one
 * reference, and the caller counts what comes back as "records" and uses the
 * ids as an IN list. A duplicate would inflate the number an erasure report
 * prints without changing what the erasure did.
 */
export async function proposalIdsNaming(pool: Pool, memberId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT proposal_id FROM external_proposal_subjects WHERE member_id = ?",
    [memberId],
  );
  return rows.map((r) => String(r.proposal_id));
}

/**
 * Take a departing member out of every record that names them.
 *
 * By `member_id`, so it cannot leave one of a member's rows behind. Deleting
 * rather than blanking, because a kept row with an emptied column is still a
 * record that this member was named. Rows whose `member_id` is NULL are
 * untouched and always were: this village could never say who those were about.
 *
 * A DELETE matching nothing is not an error. A member no vendor ever named has
 * no attribution to clear, and the erasure that called this still ran.
 */
export async function deleteSubjectRowsForMember(pool: Pool, memberId: string): Promise<void> {
  await pool.query("DELETE FROM external_proposal_subjects WHERE member_id = ?", [memberId]);
}

/**
 * How many stored rows name somebody this village cannot resolve.
 *
 * Not a defect report, a visibility one. A vendor sends its own opaque
 * references and this village can only act on the ones it resolves, so an
 * erasure or an export is complete only with respect to what could be
 * attributed. A count of what could not is the difference between a promise
 * kept and a promise that looks kept.
 */
export async function unattributedSubjectCount(pool: Pool): Promise<number> {
  const [[r]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM external_proposal_subjects WHERE member_id IS NULL",
  );
  return Number(r?.n) || 0;
}
