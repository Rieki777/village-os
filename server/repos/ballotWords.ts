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

/*
 * THREE MORE WAYS A BALLOT NAMES A MEMBER (round 4, finding 9), for the
 * erasure's "proposal-ballot-words-after-tombstone" step
 * (server/lib/ballotErasure.ts, forgetProposalBallotWordsOf). Each is found
 * by the member's id alone, so a tombstone whose name is long gone is found
 * the same way.
 *
 *   3. THEY PROPOSED IT. A game-mechanics proposal taken to the vote freezes
 *      "Proposed by <first name> on <date>; ..." into the ballot, whoever
 *      opened it, and `subject_ref` is the proposal's id. So the proposer is
 *      `mechanics_proposals.proposer_user_id`, never `opened_by`.
 *   4. THEY OPENED THE LAUNCH VOTE. Its document names whoever opened it.
 *   5. THEY ARE ON A LAUNCH VOTE'S STEWARD SLATE, one row each in
 *      `ballot_steward_slate`, one "- <first name>" line each in the document.
 *
 * Two plain reads, never a join, so the ballot tables and the proposal and
 * user tables never need to share a collation.
 */

/** The words of every ballot opened on a game-mechanics proposal this member made, of these subjects. */
export async function ballotWordsOfProposalsBy(pool: Pool, userId: string, subjects: readonly string[]): Promise<BallotWords[]> {
  if (!userId || !subjects.length) return [];
  const [props] = await pool.query<RowDataPacket[]>("SELECT id FROM mechanics_proposals WHERE proposer_user_id = ?", [userId]);
  const ids = props.map((r) => String(r.id));
  if (!ids.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, title, doc_markdown, outcome_note FROM ballots WHERE subject_type IN (?) AND subject_ref IN (?) ORDER BY id",
    [subjects, ids],
  );
  return rows.map(wordsOf);
}

/** The words of every ballot of this subject the member opened. */
export async function ballotWordsOpenedOf(pool: Pool, userId: string, subjectType: string): Promise<BallotWords[]> {
  if (!userId) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, title, doc_markdown, outcome_note FROM ballots WHERE opened_by = ? AND subject_type = ? ORDER BY id",
    [userId, subjectType],
  );
  return rows.map(wordsOf);
}

/** One person on a launch vote's steward slate, with the name and address their account carries now. */
export interface SlateSeat {
  ballotId: string;
  userId: string;
  /** Null when no account answers to the id. */
  name: string | null;
  email: string | null;
}

/** Every launch ballot whose slate holds this member: its words and its whole slate. */
export async function slatesHolding(pool: Pool, userId: string): Promise<Array<{ ballot: BallotWords; slate: SlateSeat[] }>> {
  if (!userId) return [];
  const [mine] = await pool.query<RowDataPacket[]>("SELECT ballot_id FROM ballot_steward_slate WHERE user_id = ?", [userId]);
  const ballotIds = Array.from(new Set(mine.map((r) => String(r.ballot_id))));
  if (!ballotIds.length) return [];
  const [ballots] = await pool.query<RowDataPacket[]>(
    "SELECT id, subject_type, title, doc_markdown, outcome_note FROM ballots WHERE id IN (?) ORDER BY id",
    [ballotIds],
  );
  const [seats] = await pool.query<RowDataPacket[]>("SELECT ballot_id, user_id FROM ballot_steward_slate WHERE ballot_id IN (?)", [ballotIds]);
  const userIds = Array.from(new Set(seats.map((r) => String(r.user_id))));
  const [users] = await pool.query<RowDataPacket[]>("SELECT id, name, email FROM users WHERE id IN (?)", [userIds]);
  const byId = new Map(users.map((u) => [String(u.id), u]));
  return ballots.map((b) => ({
    ballot: wordsOf(b),
    slate: seats
      .filter((s) => String(s.ballot_id) === String(b.id))
      .map((s) => {
        const u = byId.get(String(s.user_id));
        return { ballotId: String(s.ballot_id), userId: String(s.user_id), name: u ? String(u.name ?? "") : null, email: u ? String(u.email ?? "") : null };
      }),
  }));
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
