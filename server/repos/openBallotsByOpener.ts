/**
 * `ballots`, read for one question: how many votes of one kind does this
 * member have open right now?
 *
 * A vote rings the whole frozen roll when it opens and again when it is
 * closing, and every one of them must reach quorum, so a door that lets one
 * member open any number of them at once can spend a village's attention
 * before it has answered the first. The advisory route answers that with "one
 * at a time, per member" (server/index.ts, POST /api/governance/advisory), and
 * the agreements route (server/routes/governanceAgreements.ts) gives a written
 * agreement the same rule, because until Wave 4 an agreement went to the
 * village through exactly that advisory door (audit of Wave 4, 2026-10-01).
 *
 * One statement against one table, and no policy: the caller decides what an
 * open vote means for the member asking.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** How many ballots on `subjectType` this member opened that are still open. */
export async function countOpenBallotsBy(pool: Pool, subjectType: string, openedBy: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = ? AND status = 'open' AND opened_by = ?",
    [subjectType, openedBy],
  );
  return Number(rows[0]?.n ?? 0);
}
