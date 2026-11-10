/**
 * THE HISTORY OF ONE ROLE'S DRAFTS, for the role editor (role journey, PR-B).
 *
 * Every save in the editor is a human org draft with one `update_seat` change,
 * published at once (server/lib/roleEdit.ts). The role's history is therefore
 * the published and reverted drafts that touched it, read back with the
 * payload, the values captured before the publish, and the person's first name.
 * Read-only: nothing here writes.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface RoleDraftRow {
  draftId: string;
  title: string;
  status: "published" | "reverted";
  sourceKind: string;
  op: string;
  publishedAt: Date | null;
  revertedAt: Date | null;
  publishedBy: string | null;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
}

const asObject = (v: unknown): Record<string, unknown> | null => {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
};

/** The newest drafts that changed a role and went live, newest first. A reverted draft stays: it happened. */
export async function roleDraftRows(pool: Pool, roleId: string, limit = 30): Promise<RoleDraftRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT d.id AS draft_id, d.title, d.status, d.source_kind, d.published_at, d.reverted_at, d.published_by, c.op, c.payload, c.before_json " +
      "FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      "WHERE c.org_role_id = ? AND d.status IN ('published','reverted') AND c.op IN ('update_seat','create_seat') " +
      "ORDER BY d.published_at DESC, d.id DESC LIMIT ?",
    [roleId, Math.max(1, Math.min(100, limit))],
  );
  return rows.map((r) => ({
    draftId: String(r.draft_id),
    title: String(r.title ?? ""),
    status: r.status === "reverted" ? "reverted" : "published",
    sourceKind: String(r.source_kind ?? "human"),
    op: String(r.op),
    publishedAt: r.published_at ?? null,
    revertedAt: r.reverted_at ?? null,
    publishedBy: r.published_by ? String(r.published_by) : null,
    payload: asObject(r.payload) ?? {},
    before: asObject(r.before_json),
  }));
}

/** The id of the newest live draft that touched a role, of any kind: the only one a revert may undo. */
export async function newestPublishedDraftFor(pool: Pool, roleId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT d.id AS draft_id FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      "WHERE c.org_role_id = ? AND d.status = 'published' ORDER BY d.published_at DESC, d.id DESC LIMIT 1",
    [roleId],
  );
  return rows[0] ? String(rows[0].draft_id) : null;
}

/** Whether a published draft touched this role, as an edit or a creation. */
export async function draftTouchedRole(pool: Pool, draftId: string, roleId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 AS x FROM org_draft_changes WHERE draft_id = ? AND org_role_id = ? LIMIT 1",
    [draftId, roleId],
  );
  return rows.length > 0;
}

/** Members' first names by id, for the history's "who". */
export async function firstNames(pool: Pool, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `id`, `name` FROM `users` WHERE `id` IN (?)", [unique]);
  for (const r of rows) out.set(String(r.id), String(r.name ?? "").trim().split(/\s+/)[0] ?? "");
  return out;
}
