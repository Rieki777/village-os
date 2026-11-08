/**
 * THE SUGGESTION STORE (ROLE_POWERS_DESIGN.md §4.5): `assistant_drafts` rows of
 * kind `admin_edit`. No migration: the drafts table already carries every
 * field a suggestion needs.
 *
 *   payload        the control, the power, the version, the base and the edit
 *                  (`AdminEditPayload`, shared/draftKinds.ts)
 *   rationale      the suggester's own words for why, may be empty
 *   proposed_by    the suggester
 *   status         proposed    waiting for a holder, or for the suggester to raise it
 *                  superseded  a village ballot is deciding it (`created_ref` is the ballot)
 *                  accepted    applied, by a holder or by a carried vote
 *                  rejected    declined by a holder with a reason, or voted down
 *   decided_by     the reviewer, or `village:<ballot id>`
 *   decided_note   the decline's reason, or "suggested by X, accepted by Y"
 *
 * Every status change is a guarded UPDATE on the status it expects, so two
 * reviewers pressing at once cannot both win, and a lost race answers false.
 *
 * The assistant's own queue (server/lib/drafts.ts) leaves this kind out.
 */
import { randomUUID } from "crypto";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { AdminEditPayload } from "../../shared/draftKinds";

export type SuggestionStatus = "proposed" | "accepted" | "rejected" | "superseded";

export interface SuggestionRow {
  id: string;
  edit: AdminEditPayload;
  why: string;
  suggestedBy: string;
  suggestedAt: Date;
  status: SuggestionStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  /** The ballot deciding it, while superseded. */
  ballotId: string | null;
}

/** What the lifecycle needs from storage. The route tests hand in a memory copy. */
export interface SuggestionStore {
  create(input: { edit: AdminEditPayload; why: string; suggestedBy: string }): Promise<SuggestionRow>;
  byId(id: string): Promise<SuggestionRow | null>;
  /** Every suggestion with this status, newest first, at most 200. */
  withStatus(status: SuggestionStatus): Promise<SuggestionRow[]>;
  /** One member's own suggestions, newest first, at most 100. */
  bySuggester(userId: string): Promise<SuggestionRow[]>;
  /** Move from one status to another. False when somebody else moved it first. */
  move(
    id: string,
    from: SuggestionStatus,
    to: SuggestionStatus,
    fields: { decidedBy?: string | null; note?: string | null; ballotId?: string | null },
  ): Promise<boolean>;
}

const KIND = "admin_edit";

function parse<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toRow(r: RowDataPacket): SuggestionRow {
  return {
    id: String(r.id),
    edit: parse<AdminEditPayload>(r.payload, {} as AdminEditPayload),
    why: String(r.rationale ?? ""),
    suggestedBy: String(r.proposed_by),
    suggestedAt: new Date(r.proposed_at),
    status: String(r.status) as SuggestionStatus,
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: r.decided_at ? new Date(r.decided_at) : null,
    note: r.decided_note ? String(r.decided_note) : null,
    ballotId: r.created_ref ? String(r.created_ref) : null,
  };
}

export function suggestionStore(pool: () => Pool): SuggestionStore {
  const byId = async (id: string): Promise<SuggestionRow | null> => {
    const [rows] = await pool().query<RowDataPacket[]>("SELECT * FROM assistant_drafts WHERE id = ? AND kind = ? LIMIT 1", [id, KIND]);
    return rows[0] ? toRow(rows[0]) : null;
  };
  return {
    byId,
    async create(input) {
      const id = `sugg-${randomUUID().slice(0, 12)}`;
      await pool().query(
        "INSERT INTO assistant_drafts (id, batch_id, kind, payload, rationale, cites, proposed_by, capability_ceiling, escalations) " +
          "VALUES (?,?,?,?,?,?,?,?,?)",
        [id, id, KIND, JSON.stringify(input.edit), input.why.slice(0, 2000), "[]", input.suggestedBy, "[]", null],
      );
      const row = await byId(id);
      if (!row) throw new Error("the suggestion did not save");
      return row;
    },
    async withStatus(status) {
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT * FROM assistant_drafts WHERE kind = ? AND status = ? ORDER BY proposed_at DESC, id DESC LIMIT 200",
        [KIND, status],
      );
      return rows.map(toRow);
    },
    async bySuggester(userId) {
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT * FROM assistant_drafts WHERE kind = ? AND proposed_by = ? ORDER BY proposed_at DESC, id DESC LIMIT 100",
        [KIND, userId],
      );
      return rows.map(toRow);
    },
    async move(id, from, to, fields) {
      const [r] = await pool().query<ResultSetHeader>(
        "UPDATE assistant_drafts SET status = ?, decided_by = ?, decided_at = " + (to === "proposed" ? "NULL" : "NOW()") +
          ", decided_note = ?, created_ref = ? WHERE id = ? AND kind = ? AND status = ?",
        [to, fields.decidedBy ?? null, fields.note ?? null, fields.ballotId ?? null, id, KIND, from],
      );
      return r.affectedRows === 1;
    },
  };
}
