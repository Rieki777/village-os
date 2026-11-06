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
  createdAt: string;
  updatedAt: string;
  /** The changes of the current revision, in order. */
  changes: StoredChange[];
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
  /** Moves a gathering change request to revision+1. False when it was not at `expected` or not gathering. */
  revise(id: string, expected: number, next: Revision): Promise<boolean>;
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
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    changes,
  };
}

const COLUMNS =
  "id, author_user_id, author_kind, title, why, state, revision, relation, relates_to, proposal_id, closed_reason, created_at, updated_at";

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
        const [r] = await conn.query<any>(
          `UPDATE change_requests SET ${sets.join(", ")} WHERE id = ? AND revision = ? AND state = 'gathering'`,
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
