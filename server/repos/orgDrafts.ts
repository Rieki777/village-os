/**
 * The two `org_drafts` statements that stand on their own.
 *
 * ── WHY THIS MODULE IS SMALL, AND WHY THAT IS THE POINT ──────────────────
 *
 * `server/lib/orgDrafts.ts` is the draft machinery: preview, publish, revert.
 * Almost every statement in it is a step inside a transaction the caller owns,
 * on a `PoolConnection` that publish or revert opened and will commit or roll
 * back as one act. Lifting one of those out of the file would not move a
 * query, it would move a piece of a transaction, and a repo function that
 * takes a pool cannot be a step in somebody else's transaction at all.
 *
 * The withdrawal path is the exception, and it is the whole of what lives
 * here. Withdrawing an open draft is one UPDATE and, when that UPDATE matches
 * nothing, one SELECT to say which of the two reasons it was. Neither is
 * inside a transaction, neither holds a lock anybody else is waiting on, and
 * both are addressed by primary key. They move whole.
 *
 * ── WHY MOVING THEM IS WORTH DOING AT ALL ────────────────────────────────
 *
 * `org_drafts` is raw SQL with no cache above it, which is what lets a draft's
 * changes commit together with the org tables (the header of
 * `server/lib/orgDrafts.ts` explains that constraint). No cache does not mean
 * no readers: it means the only way to answer "who writes this table's status
 * column" is to read every file that might. This module is the beginning of
 * the one place that question has an answer.
 *
 * The status column is still read directly in two other places in
 * `server/lib/orgDrafts.ts`, guarding the edit paths (`setDraftVision` and
 * `addChange`). Those are the same read and they belong here too; they are not
 * moved in this change because a burn-down that also rewrites the edit guards
 * is two changes wearing one commit message.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
 *
 * No listing, no draft body, no changes. `listDrafts` reads both tables
 * together and maps them into the `Draft` shape the routes serve; splitting
 * that read in half would leave a caller assembling a draft from two modules
 * and nothing saying the halves agree. It stays where it is until it can move
 * whole.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * One column, and it is the only one either statement here needs.
 *
 * `status` is an enum('open','published','reverted','withdrawn') NOT NULL
 * since 0056, so a row that exists always has one. That is why `draftStatus`
 * can use null for "no such draft" without the two answers ever colliding.
 */
const COLUMNS = "status";

/**
 * Withdraw an OPEN draft, and answer whether a row actually moved.
 *
 * The `status = 'open'` half of the WHERE is the guard, not a filter: it is
 * what makes withdrawing twice a no-op rather than a second write, and what
 * stops a withdrawal reaching a published draft whose changes have been
 * applied to the org chart. Two requests arriving together therefore cannot
 * both come back true, because the second one matches no row.
 *
 * False means nothing was withdrawn and says nothing about why. The caller
 * asks `draftStatus` for that, which is the same order the raw statements ran
 * in: the cheap write first, the explanation only when it was needed.
 */
export async function withdrawDraftRow(pool: Pool, draftId: string): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE org_drafts SET status = 'withdrawn' WHERE id = ? AND status = 'open'",
    [draftId],
  );
  return Boolean(r?.affectedRows);
}

/**
 * What state one draft is in, or null when there is no such draft.
 *
 * Returned as the string the column holds rather than a union, because the
 * one caller puts it in a sentence a steward reads. A value this build's
 * `DraftStatus` union does not know about would then appear in that sentence
 * as itself, which is the honest outcome; narrowing it here would turn an
 * unexpected state into a type error miles from the row that holds it.
 */
export async function draftStatus(pool: Pool, draftId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM org_drafts WHERE id = ?`,
    [draftId],
  );
  const row = rows[0];
  return row ? String(row.status) : null;
}
