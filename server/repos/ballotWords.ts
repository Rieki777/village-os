/**
 * THE WORDS OF THE BALLOTS THAT NAME A MEMBER, for the erasure sweep
 * (server/lib/erasure.ts, "ballot-words-after-tombstone", and the notices
 * steps through server/repos/noticesNaming.ts). The reads and the writes; the
 * rewriting itself is server/lib/ballotErasure.ts.
 *
 * TWO WAYS A BALLOT NAMES A MEMBER (round 2, finding 6).
 *
 *   1. IT IS ABOUT THEM. A vote to seat a member in a role, or to take a role
 *      back from them, freezes `subject_ref` as `<userId>@<roleId>` and puts
 *      their first name in the title, the document, the roll's notices and the
 *      public pulse (server/index.ts role-unseats, server/routes/powerHands.ts
 *      openSeatVote). `subject_ref` is what the decision lands on, so it stays;
 *      the words around it are what go.
 *   2. THEY OPENED IT. Every door that opens a ballot ends its document with
 *      "Asked by <first name> on <date>." `opened_by` is the account, which
 *      the tombstone already reads as a departed member.
 *
 * The user id is matched exactly on the part of `subject_ref` before the
 * first `@`, so a member whose id begins with another's is never matched.
 * Both doors refuse an `@` inside a member's id (user ids are generated and
 * carry none), and the hand door refuses one in a role id too.
 *
 * Every write is a constant or a value read off the row it writes, keyed by
 * the ballot's id, and never touches what was decided: the subject, the
 * method, the electorate, the votes, the status and the dates.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** The ballot subjects whose `subject_ref` is `<userId>@<roleId>`. */
export const SUBJECTS_ABOUT_A_MEMBER: readonly string[] = ["role_seat", "role_unseat"];

export interface BallotWords {
  id: string;
  subjectType: string;
  title: string;
  docMarkdown: string;
  outcomeNote: string | null;
}

const wordsOf = (r: RowDataPacket): BallotWords => ({
  id: String(r.id),
  subjectType: String(r.subject_type),
  title: String(r.title ?? ""),
  docMarkdown: String(r.doc_markdown ?? ""),
  outcomeNote: r.outcome_note == null ? null : String(r.outcome_note),
});

/** Every ballot about this member, open or closed, by id. */
export async function ballotIdsAbout(pool: Pool, userId: string): Promise<string[]> {
  if (!userId) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE subject_type IN (?) AND SUBSTRING_INDEX(subject_ref, '@', 1) = ? ORDER BY id",
    [SUBJECTS_ABOUT_A_MEMBER, userId],
  );
  return rows.map((r) => String(r.id));
}

/** The words of every ballot about this member. */
export async function ballotWordsAbout(pool: Pool, userId: string): Promise<BallotWords[]> {
  if (!userId) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, title, doc_markdown, outcome_note FROM ballots " +
      "WHERE subject_type IN (?) AND SUBSTRING_INDEX(subject_ref, '@', 1) = ? ORDER BY id",
    [SUBJECTS_ABOUT_A_MEMBER, userId],
  );
  return rows.map(wordsOf);
}

/** The words of every ballot this member opened. */
export async function ballotWordsOpenedBy(pool: Pool, userId: string): Promise<BallotWords[]> {
  if (!userId) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, title, doc_markdown, outcome_note FROM ballots WHERE opened_by = ? ORDER BY id",
    [userId],
  );
  return rows.map(wordsOf);
}

/** Write a ballot's words back, and nothing else on the row. True when the row changed. */
export async function rewriteBallotWords(
  pool: Pool,
  id: string,
  words: { title: string; docMarkdown: string; outcomeNote: string | null },
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET title = ?, doc_markdown = ?, outcome_note = ? WHERE id = ?",
    [words.title.slice(0, 200), words.docMarkdown, words.outcomeNote, id],
  );
  return Number(res.changedRows ?? res.affectedRows ?? 0) > 0;
}

/**
 * The PUBLIC pulse lines about these ballots go: the opening line ("The
 * village is deciding whether <first name> keeps the role") and every close
 * line, which repeats the title. The same treatment the erasure's
 * "public-health-events" step gives a public line the member wrote, and the
 * admin audience's lines stay, as that step keeps them.
 */
export async function forgetPublicLinesOn(pool: Pool, ballotIds: readonly string[]): Promise<number> {
  const ids = Array.from(new Set(ballotIds.filter(Boolean)));
  if (!ids.length) return 0;
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM health_events WHERE audience = 'public' AND entity_type = 'ballot' AND entity_ref IN (?)",
    [ids],
  );
  return Number(res.affectedRows ?? 0);
}
