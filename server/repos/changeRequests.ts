/**
 * CHANGE REQUESTS: THE STORE (migration 0330; spec
 * village-os-ops/internal/spec/change-requests/).
 *
 * A change request's changes are kept per revision and never overwritten: a
 * revision writes a new set of rows and the earlier rows stay as the record of
 * what it said then. Every edit is a guarded UPDATE on the revision the editor
 * read, so of two tabs editing at once exactly one wins and the other is told.
 *
 * The routes take a `ChangeRequestStore`, so their tests run on an in-memory
 * twin of this one (server/routes/changeRequests.test.ts) and this file is
 * proven against MySQL on its own (server/repos/changeRequests.test.ts).
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export type ChangeRequestState = "gathering" | "in_review" | "voting" | "closed";
export type ChangeRequestRelation = "undoes" | "renews" | "overrides" | "split_from" | "copied_from";

export interface StoredChange {
  position: number;
  /** The change in the shape a change set already takes. */
  item: Record<string, unknown>;
  /** The setting it touches (`changeKeyOf`). */
  changeKey: string;
  /** What the setting read when the change was added. */
  beforeValue: string | null;
  addedBy: string | null;
}

export interface ChangeRequestRow {
  id: string;
  authorUserId: string | null;
  authorKind: "member" | "agent";
  title: string;
  why: string;
  state: ChangeRequestState;
  revision: number;
  relation: ChangeRequestRelation | null;
  relatesTo: string | null;
  proposalId: string | null;
  closedReason: string | null;
  /** When the review clock last started, or null before review. */
  reviewOpenedAt: string | null;
  /** The review length the village had when review opened (R20). */
  reviewDaysAtOpen: number | null;
  createdAt: string;
  updatedAt: string;
  /** The changes of the current revision, in order. */
  changes: StoredChange[];
}

export type ReviewNoteKind = "question" | "concern" | "objection" | "edit" | "consent" | "answer" | "system";

export interface ReviewNote {
  id: string;
  changeRequestId: string;
  revision: number;
  kind: ReviewNoteKind;
  authorUserId: string | null;
  position: number | null;
  body: string;
  proposedItem: Record<string, unknown> | null;
  answersNoteId: string | null;
  outcome: "open" | "taken_in" | "turned_down" | "answered";
  createdAt: string;
}

export interface NewNote {
  id: string;
  changeRequestId: string;
  revision: number;
  kind: ReviewNoteKind;
  authorUserId: string | null;
  position?: number | null;
  body: string;
  proposedItem?: Record<string, unknown> | null;
  answersNoteId?: string | null;
}

export interface NewChangeRequest {
  id: string;
  authorUserId: string;
  title: string;
  why: string;
  relation?: ChangeRequestRelation | null;
  relatesTo?: string | null;
  changes?: StoredChange[];
}

export interface Revision {
  title?: string;
  why?: string;
  /** The whole new list of changes. Absent keeps the current list. */
  changes?: StoredChange[];
}

export interface ChangeRequestStore {
  create(input: NewChangeRequest): Promise<void>;
  byId(id: string): Promise<ChangeRequestRow | null>;
  /** The author's own, newest first, every state. */
  byAuthor(userId: string): Promise<ChangeRequestRow[]>;
  /** Everyone's in review or in a vote, newest first. */
  open(): Promise<ChangeRequestRow[]>;
  countGathering(userId: string): Promise<number>;
  /**
   * Moves a change request that is gathering or in review to revision+1.
   * In review, a revision that changes the changes or the why restarts the
   * review clock (R3). False when it was not at `expected` or past review.
   */
  revise(id: string, expected: number, next: Revision): Promise<boolean>;
  /** Gathering to in review, starting the clock. False when it was not at `expected` or not gathering. */
  openReview(id: string, expected: number, reviewDays: number): Promise<boolean>;
  /** Review notes, oldest first. */
  notesOf(id: string): Promise<ReviewNote[]>;
  /** Adds a note, only while the change request is in review (R2). False otherwise. */
  addNote(note: NewNote): Promise<boolean>;
  /** Moves a note out of `open`. False when it was not open. */
  settleNote(noteId: string, outcome: "taken_in" | "turned_down" | "answered"): Promise<boolean>;
  /** How many change requests this member opened for review since an instant. */
  openedForReviewSince(userId: string, since: Date): Promise<number>;
  /** Deletes a gathering change request. False when it was not at `expected` or not gathering. */
  remove(id: string, expected: number): Promise<boolean>;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

function rowOf(r: RowDataPacket, changes: StoredChange[]): ChangeRequestRow {
  return {
    id: String(r.id),
    authorUserId: r.author_user_id ?? null,
    authorKind: r.author_kind === "agent" ? "agent" : "member",
    title: String(r.title),
    why: String(r.why),
    state: r.state as ChangeRequestState,
    revision: Number(r.revision),
    relation: (r.relation ?? null) as ChangeRequestRelation | null,
    relatesTo: r.relates_to ?? null,
    proposalId: r.proposal_id ?? null,
    closedReason: r.closed_reason ?? null,
    reviewOpenedAt: r.review_opened_at ? iso(r.review_opened_at) : null,
    reviewDaysAtOpen: r.review_days_at_open == null ? null : Number(r.review_days_at_open),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    changes,
  };
}

const COLUMNS =
  "id, author_user_id, author_kind, title, why, state, revision, relation, relates_to, proposal_id, closed_reason, review_opened_at, review_days_at_open, created_at, updated_at";

export function changeRequestStore(pool: () => Pool): ChangeRequestStore {
  async function changesOf(ids: { id: string; revision: number }[]): Promise<Map<string, StoredChange[]>> {
    const out = new Map<string, StoredChange[]>();
    if (ids.length === 0) return out;
    const where = ids.map(() => "(change_request_id = ? AND revision = ?)").join(" OR ");
    const [rows] = await pool().query<RowDataPacket[]>(
      `SELECT change_request_id, position, item, change_key, before_value, added_by FROM change_request_items WHERE ${where} ORDER BY position`,
      ids.flatMap((x) => [x.id, x.revision]),
    );
    for (const r of rows) {
      const list = out.get(String(r.change_request_id)) ?? [];
      list.push({ position: Number(r.position), item: json(r.item), changeKey: String(r.change_key), beforeValue: r.before_value ?? null, addedBy: r.added_by ?? null });
      out.set(String(r.change_request_id), list);
    }
    return out;
  }

  async function withChanges(rows: RowDataPacket[]): Promise<ChangeRequestRow[]> {
    const changes = await changesOf(rows.map((r) => ({ id: String(r.id), revision: Number(r.revision) })));
    return rows.map((r) => rowOf(r, changes.get(String(r.id)) ?? []));
  }

  async function writeChanges(conn: { query: Pool["query"] }, id: string, revision: number, changes: StoredChange[]): Promise<void> {
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      await conn.query(
        "INSERT INTO change_request_items (change_request_id, revision, position, item, change_key, before_value, added_by) VALUES (?,?,?,?,?,?,?)",
        [id, revision, i, JSON.stringify(c.item), c.changeKey, c.beforeValue, c.addedBy],
      );
    }
  }

  return {
    async create(input) {
      const conn = await pool().getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "INSERT INTO change_requests (id, author_user_id, author_kind, title, why, state, revision, relation, relates_to) VALUES (?,?,'member',?,?,'gathering',1,?,?)",
          [input.id, input.authorUserId, input.title, input.why, input.relation ?? null, input.relatesTo ?? null],
        );
        await writeChanges(conn, input.id, 1, input.changes ?? []);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async byId(id) {
      const [rows] = await pool().query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM change_requests WHERE id = ?`, [id]);
      return rows.length ? (await withChanges(rows))[0] : null;
    },

    async byAuthor(userId) {
      const [rows] = await pool().query<RowDataPacket[]>(
        `SELECT ${COLUMNS} FROM change_requests WHERE author_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100`,
        [userId],
      );
      return withChanges(rows);
    },

    async open() {
      const [rows] = await pool().query<RowDataPacket[]>(
        `SELECT ${COLUMNS} FROM change_requests WHERE state IN ('in_review','voting') ORDER BY updated_at DESC, id DESC LIMIT 200`,
      );
      return withChanges(rows);
    },

    async countGathering(userId) {
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM change_requests WHERE author_user_id = ? AND state = 'gathering'",
        [userId],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async revise(id, expected, next) {
      const conn = await pool().getConnection();
      try {
        await conn.beginTransaction();
        const sets: string[] = ["revision = revision + 1"];
        const params: unknown[] = [];
        if (next.title !== undefined) { sets.push("title = ?"); params.push(next.title); }
        if (next.why !== undefined) { sets.push("why = ?"); params.push(next.why); }
        // R3: in review, a new change list or a new why starts the clock again.
        if (next.changes !== undefined || next.why !== undefined) {
          sets.push("review_opened_at = CASE WHEN state = 'in_review' THEN CURRENT_TIMESTAMP ELSE review_opened_at END");
        }
        const [r] = await conn.query<any>(
          `UPDATE change_requests SET ${sets.join(", ")} WHERE id = ? AND revision = ? AND state IN ('gathering','in_review')`,
          [...params, id, expected],
        );
        if (Number(r.affectedRows) === 0) {
          await conn.rollback();
          return false;
        }
        let changes = next.changes;
        if (!changes) {
          const kept = await changesOf([{ id, revision: expected }]);
          changes = kept.get(id) ?? [];
        }
        await writeChanges(conn, id, expected + 1, changes);
        await conn.commit();
        return true;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async openReview(id, expected, reviewDays) {
      const [r] = await pool().query<any>(
        "UPDATE change_requests SET state = 'in_review', review_opened_at = CURRENT_TIMESTAMP, review_days_at_open = ? WHERE id = ? AND revision = ? AND state = 'gathering'",
        [reviewDays, id, expected],
      );
      return Number(r.affectedRows) === 1;
    },

    async notesOf(id) {
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT id, change_request_id, revision, kind, author_user_id, position, body, proposed_item, answers_note_id, outcome, created_at FROM change_request_notes WHERE change_request_id = ? ORDER BY created_at, id",
        [id],
      );
      return rows.map((r) => ({
        id: String(r.id),
        changeRequestId: String(r.change_request_id),
        revision: Number(r.revision),
        kind: r.kind,
        authorUserId: r.author_user_id ?? null,
        position: r.position == null ? null : Number(r.position),
        body: String(r.body ?? ""),
        proposedItem: r.proposed_item == null ? null : json(r.proposed_item),
        answersNoteId: r.answers_note_id ?? null,
        outcome: r.outcome,
        createdAt: iso(r.created_at),
      }));
    },

    async addNote(n) {
      // Guarded on the state in the same statement, so a note cannot slip in
      // after the change request has gone to the vote (R2).
      const [r] = await pool().query<any>(
        "INSERT INTO change_request_notes (id, change_request_id, revision, kind, author_user_id, position, body, proposed_item, answers_note_id) " +
          "SELECT ?,?,?,?,?,?,?,?,? FROM change_requests WHERE id = ? AND state = 'in_review'",
        [n.id, n.changeRequestId, n.revision, n.kind, n.authorUserId, n.position ?? null, n.body, n.proposedItem ? JSON.stringify(n.proposedItem) : null, n.answersNoteId ?? null, n.changeRequestId],
      );
      return Number(r.affectedRows) === 1;
    },

    async settleNote(noteId, outcome) {
      const [r] = await pool().query<any>("UPDATE change_request_notes SET outcome = ? WHERE id = ? AND outcome = 'open'", [outcome, noteId]);
      return Number(r.affectedRows) === 1;
    },

    async openedForReviewSince(userId, since) {
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM change_request_notes n JOIN change_requests c ON c.id = n.change_request_id " +
          "WHERE c.author_user_id = ? AND n.kind = 'system' AND n.body = 'opened for review' AND n.created_at > ?",
        [userId, since],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async remove(id, expected) {
      const [r] = await pool().query<any>(
        "DELETE FROM change_requests WHERE id = ? AND revision = ? AND state = 'gathering'",
        [id, expected],
      );
      if (Number(r.affectedRows) === 0) return false;
      await pool().query("DELETE FROM change_request_items WHERE change_request_id = ?", [id]);
      return true;
    },
  };
}
