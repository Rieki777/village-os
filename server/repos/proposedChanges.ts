/**
 * The proposed-changes store (0379): batches and the changes in them.
 *
 *   proposed_change_batches   a titled group reviewed together
 *   proposed_changes          one change: what was proposed, the person's draft, what was accepted, and the lesson
 *
 * Nothing here moves anything live. The routes in server/routes/proposedChanges.ts
 * accept a change through its own route and then record the outcome here.
 * Erased with the member (`forgetAgentForMember`, server/repos/memberAgent.ts).
 */
import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ProposalKind, ProposalStatus } from "../../shared/proposedChanges";

export interface StoredBatch {
  id: string;
  title: string;
  proposedBy: string;
  proposedByKind: "agent" | "person";
  createdAt: string;
}

export interface StoredChange {
  id: string;
  batchId: string;
  position: number;
  kind: ProposalKind;
  target: Record<string, unknown>;
  targetLabel: string;
  routeMethod: string;
  routePath: string;
  summary: string;
  body: Record<string, unknown>;
  draft: Record<string, unknown> | null;
  draftBy: string | null;
  draftAt: string | null;
  status: ProposalStatus;
  proposedBy: string;
  proposedByKind: "agent" | "person";
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  accepted: Record<string, unknown> | null;
  lessons: unknown[] | null;
  approvedBy: string | null;
  approvalNote: string | null;
  error: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

function toChange(r: RowDataPacket): StoredChange {
  return {
    id: String(r.id),
    batchId: String(r.batch_id),
    position: Number(r.position ?? 0),
    kind: String(r.kind) as ProposalKind,
    target: json(r.target_json, {}),
    targetLabel: String(r.target_label ?? ""),
    routeMethod: String(r.route_method),
    routePath: String(r.route_path),
    summary: String(r.summary ?? ""),
    body: json(r.body_json, {}),
    draft: json(r.draft_json, null),
    draftBy: r.draft_by === null ? null : String(r.draft_by),
    draftAt: iso(r.draft_at),
    status: String(r.status) as ProposalStatus,
    proposedBy: String(r.proposed_by),
    proposedByKind: r.proposed_by_kind === "person" ? "person" : "agent",
    createdAt: iso(r.created_at) ?? "",
    decidedBy: r.decided_by === null ? null : String(r.decided_by),
    decidedAt: iso(r.decided_at),
    accepted: json(r.accepted_json, null),
    lessons: json(r.lessons_json, null),
    approvedBy: r.approved_by === null ? null : String(r.approved_by),
    approvalNote: r.approval_note === null ? null : String(r.approval_note),
    error: r.error_text === null ? null : String(r.error_text),
  };
}

const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("hex")}`;

export async function batchById(pool: Pool, id: string): Promise<StoredBatch | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `proposed_change_batches` WHERE `id` = ?", [id]);
  const r = rows[0];
  return r ? { id: String(r.id), title: String(r.title), proposedBy: String(r.proposed_by), proposedByKind: r.proposed_by_kind === "person" ? "person" : "agent", createdAt: iso(r.created_at) ?? "" } : null;
}

export async function addBatch(pool: Pool, b: { title: string; proposedBy: string; proposedByKind: "agent" | "person" }): Promise<string> {
  const id = newId("pcb");
  await pool.query("INSERT INTO `proposed_change_batches` (`id`, `title`, `proposed_by`, `proposed_by_kind`) VALUES (?,?,?,?)", [id, b.title.slice(0, 200), b.proposedBy, b.proposedByKind]);
  return id;
}

export async function nextPosition(pool: Pool, batchId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COALESCE(MAX(`position`), -1) + 1 AS n FROM `proposed_changes` WHERE `batch_id` = ?", [batchId]);
  return Number(rows[0]?.n ?? 0);
}

export async function addChange(
  pool: Pool,
  c: { batchId: string; position: number; kind: ProposalKind; target: Record<string, unknown>; targetLabel: string; routeMethod: string; routePath: string; summary: string; body: Record<string, unknown>; proposedBy: string; proposedByKind: "agent" | "person" },
): Promise<string> {
  const id = newId("pc");
  await pool.query(
    "INSERT INTO `proposed_changes` (`id`, `batch_id`, `position`, `kind`, `target_json`, `target_label`, `route_method`, `route_path`, `summary`, `body_json`, `proposed_by`, `proposed_by_kind`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, c.batchId, c.position, c.kind, JSON.stringify(c.target), c.targetLabel.slice(0, 200), c.routeMethod, c.routePath.slice(0, 400), c.summary.slice(0, 400), JSON.stringify(c.body), c.proposedBy, c.proposedByKind],
  );
  return id;
}

export async function changeById(pool: Pool, id: string): Promise<StoredChange | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `proposed_changes` WHERE `id` = ?", [id]);
  return rows[0] ? toChange(rows[0]) : null;
}

/** What waits (proposed or failed), oldest batch first, in each batch's own order. */
export async function listOpen(pool: Pool): Promise<{ batches: StoredBatch[]; changes: StoredChange[] }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `proposed_changes` WHERE `status` IN ('proposed','failed') ORDER BY `created_at`, `batch_id`, `position` LIMIT 500",
  );
  const changes = rows.map(toChange);
  const ids = Array.from(new Set(changes.map((c) => c.batchId)));
  if (!ids.length) return { batches: [], changes };
  const [b] = await pool.query<RowDataPacket[]>(`SELECT * FROM \`proposed_change_batches\` WHERE \`id\` IN (${ids.map(() => "?").join(",")}) ORDER BY \`created_at\``, ids);
  return {
    batches: b.map((r) => ({ id: String(r.id), title: String(r.title), proposedBy: String(r.proposed_by), proposedByKind: r.proposed_by_kind === "person" ? "person" : "agent", createdAt: iso(r.created_at) ?? "" })),
    changes,
  };
}

/** How many wait, for the count on Admin. */
export async function openCount(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM `proposed_changes` WHERE `status` IN ('proposed','failed')");
  return Number(rows[0]?.n ?? 0);
}

/** Recently decided, newest first, for the page's record and for the lessons. */
export async function listDecided(pool: Pool, limit: number, onlyAccepted = false): Promise<StoredChange[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM \`proposed_changes\` WHERE \`status\` IN (${onlyAccepted ? "'accepted'" : "'accepted','discarded'"}) AND \`decided_at\` IS NOT NULL ORDER BY \`decided_at\` DESC LIMIT ?`,
    [Math.max(1, Math.min(500, limit))],
  );
  return rows.map(toChange);
}

export async function saveDraft(pool: Pool, id: string, draft: Record<string, unknown> | null, by: string): Promise<boolean> {
  const [r] = await pool.query<any>(
    "UPDATE `proposed_changes` SET `draft_json` = ?, `draft_by` = ?, `draft_at` = CURRENT_TIMESTAMP(3) WHERE `id` = ? AND `status` IN ('proposed','failed')",
    [draft === null ? null : JSON.stringify(draft), by, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

export async function markAccepted(pool: Pool, id: string, a: { by: string; accepted: Record<string, unknown>; lessons: unknown[]; approvedBy: string; approvalNote: string }): Promise<boolean> {
  const [r] = await pool.query<any>(
    "UPDATE `proposed_changes` SET `status` = 'accepted', `decided_by` = ?, `decided_at` = CURRENT_TIMESTAMP(3), `accepted_json` = ?, `lessons_json` = ?, `approved_by` = ?, `approval_note` = ?, `error_text` = NULL WHERE `id` = ? AND `status` IN ('proposed','failed')",
    [a.by, JSON.stringify(a.accepted), JSON.stringify(a.lessons), a.approvedBy.slice(0, 120), a.approvalNote.slice(0, 400), id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

export async function markFailed(pool: Pool, id: string, by: string, error: string): Promise<void> {
  await pool.query(
    "UPDATE `proposed_changes` SET `status` = 'failed', `decided_by` = ?, `decided_at` = CURRENT_TIMESTAMP(3), `error_text` = ? WHERE `id` = ? AND `status` IN ('proposed','failed')",
    [by, error.slice(0, 1000), id],
  );
}

export async function markDiscarded(pool: Pool, id: string, by: string): Promise<boolean> {
  const [r] = await pool.query<any>(
    "UPDATE `proposed_changes` SET `status` = 'discarded', `decided_by` = ?, `decided_at` = CURRENT_TIMESTAMP(3) WHERE `id` = ? AND `status` IN ('proposed','failed')",
    [by, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Member erasure: what they proposed goes; their name comes off what they decided. */
export async function forgetProposedChanges(pool: Pool, userId: string): Promise<void> {
  await pool.query("DELETE FROM `proposed_changes` WHERE `proposed_by` = ?", [userId]);
  await pool.query("DELETE FROM `proposed_change_batches` WHERE `proposed_by` = ?", [userId]);
  await pool.query("UPDATE `proposed_changes` SET `decided_by` = NULL, `approved_by` = NULL WHERE `decided_by` = ?", [userId]);
  await pool.query("UPDATE `proposed_changes` SET `draft_by` = NULL WHERE `draft_by` = ?", [userId]);
}
