/**
 * The draft machinery's SQL that can live outside server/lib/orgDrafts.ts.
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
 * ── THE DRAFT BODY, MOVED WHOLE ──────────────────────────────────────────
 *
 * This header used to keep the listing out: `listDrafts` reads both tables
 * together, and splitting that read in half would leave a caller assembling a
 * draft from two modules with nothing saying the halves agree. So it waited
 * until it could move whole, and `readDraftBodies` at the foot of this file is
 * that move: one function reads both tables under one filter. The mapping into
 * the `Draft` shape the routes serve stays in server/lib/orgDrafts.ts.
 *
 * ── AND ONE READ OF THE CHANGES, WHICH IS ERASURE'S AND STANDS ALONE ────
 *
 * `forgetMemberInDrafts` (server/lib/orgDrafts.ts) scans the changes that can
 * name a person and rewrites the ones that do. That is neither a draft body
 * nor a step in anybody's transaction: it runs as one named step of the
 * resumable erasure sweep, on the pool, selecting by op and writing by primary
 * key. So it meets the test the withdrawal statements meet, and its two
 * statements live here, while the JSON policy they serve stays beside the
 * code that decides those shapes.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

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

/** A draft change that can restate a person, exactly as stored. */
export interface PeopleChangeRow {
  id: string;
  op: string;
  payload: unknown;
  before_json: unknown;
}

/**
 * Every change that can name somebody: `seat_holder` carries them in
 * `payload`, and `end_holding` carries their whole assignment row in
 * `before_json`. Read for erasure only, on the pool, never inside a publish.
 */
export async function draftChangesNamingPeople(pool: Pool): Promise<PeopleChangeRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, op, payload, before_json FROM org_draft_changes WHERE op IN ('seat_holder', 'end_holding')",
  );
  return rows as unknown as PeopleChangeRow[];
}

/** Write one change's person-bearing JSON back, by primary key. */
export async function rewriteDraftChangePeople(
  pool: Pool,
  changeId: string,
  payload: string | null,
  beforeJson: string | null,
): Promise<void> {
  await pool.query<ResultSetHeader>(
    "UPDATE org_draft_changes SET payload = ?, before_json = ? WHERE id = ?",
    [payload, beforeJson, changeId],
  );
}

/*
 * WHERE EVERY CIRCLE SITS, for a draft preview that moves circles (0208).
 *
 * Read on the connection the caller passes. Inside a publish that is the
 * connection of the transaction itself, so the preview checks the very rows
 * the moves then change.
 */
export async function readCirclesForPreview(conn: Pool | PoolConnection): Promise<any[]> {
  const [rows]: any = await conn.query("SELECT id, name, parent_circle_id, is_example FROM circles");
  return rows as any[];
}

/*
 * THE CIRCLES COUNTER, LOCKED FIRST in every publish and every revert.
 *
 * A circle form save (replaceAll in server/repos/store-db.ts) takes this row
 * FOR UPDATE before it touches a circle, while a draft moving a circle took the
 * circle row first and this counter after. Those two orders deadlock together,
 * and one admin is shown a raw MySQL error. Taking the counter first gives both
 * writers one order: a form saved at the same moment waits for the publish,
 * and every read the publish makes after this sees what that save committed. A
 * draft with no move in it pays one small locking read.
 */
export async function lockCirclesCounter(conn: PoolConnection): Promise<void> {
  await conn.query("SELECT version FROM collection_versions WHERE collection = ? FOR UPDATE", ["circles"]);
}

/*
 * ── A DRAFT'S BODY: BOTH TABLES, UNDER ONE FILTER ────────────────────────
 *
 * The header kept the listing out of this module until it could move whole,
 * because two reads split across modules have nothing saying they agree. This
 * is it moving whole. The drafts are read first and the changes are read BY THE
 * IDS THAT CAME BACK, so every change returned belongs to a draft returned, even
 * when a draft changes state between the two statements. The mapping into the
 * `Draft` shape stays in server/lib/orgDrafts.ts, beside the type.
 *
 * Both filtered reads ride an index from 0056: `org_drafts_status_idx`
 * (status, created_at) and `org_draft_changes_draft_idx` (draft_id, sort_order).
 * Takes a connection as happily as a pool, because `publishDraft` reads its
 * draft inside its own transaction.
 */

/** Which drafts to read: one by id, every draft in one status, or (null) every draft. */
export type DraftBodyFilter = { id: string } | { status: string } | null;

/** Rows exactly as stored: drafts newest first, changes in their draft's order. */
export interface DraftBodyRows {
  drafts: any[];
  changes: any[];
}

export async function readDraftBodies(conn: Pool | PoolConnection, filter: DraftBodyFilter): Promise<DraftBodyRows> {
  if (filter === null) {
    const [drafts]: any = await conn.query("SELECT * FROM org_drafts ORDER BY created_at DESC");
    const [changes]: any = await conn.query("SELECT * FROM org_draft_changes ORDER BY sort_order, id");
    return { drafts: drafts as any[], changes: changes as any[] };
  }
  const [drafts]: any = "id" in filter
    ? await conn.query("SELECT * FROM org_drafts WHERE id = ?", [filter.id])
    : await conn.query("SELECT * FROM org_drafts WHERE status = ? ORDER BY created_at DESC", [filter.status]);
  const ids = (drafts as any[]).map((d) => String(d.id));
  if (!ids.length) return { drafts: [], changes: [] };
  const [changes]: any = await conn.query(
    "SELECT * FROM org_draft_changes WHERE draft_id IN (?) ORDER BY sort_order, id",
    [ids],
  );
  return { drafts: drafts as any[], changes: changes as any[] };
}
