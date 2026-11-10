/**
 * HOW MANY VOTES ONE MEMBER HAS OPEN ON ONE SUBJECT TYPE, read off `ballots`.
 *
 * The village agreement route (server/routes/governanceAgreements.ts) holds a
 * member to one open agreement vote at a time (D9 of the canvas follow-up,
 * 2026-11-09), the bell rule the advisory route already keeps: a vote rings
 * the whole frozen roll when it opens and again when it closes, so somebody
 * with a list of agreements would spend the village's whole attention before
 * it answered the first one.
 *
 * Every agreement is its own subject (`subject_type` 'agreement',
 * `subject_ref` the agreement id, `open_key` 'agreement:<id>'), so the count
 * is by type and opener, never by open key. A withdrawn or closed ballot has
 * left 'open' and frees its opener at once.
 *
 * IT LIVES IN `server/repos/` BECAUSE THE STATEMENT DOES: raw SQL outside this
 * directory is counted by scripts/sql-burndown.mjs.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Open ballots of `subjectType` that `userId` opened. */
export async function openBallotCountBy(pool: Pool, subjectType: string, userId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = ? AND status = 'open' AND opened_by = ?",
    [subjectType, userId],
  );
  return Number(rows[0]?.n ?? 0);
}
