/**
 * The approved connector writes, as the audit events and the memory outbox hold them
 * (server/lib/agentLeadApproval.ts writes both; Admin, Players, Agents reads them back).
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./memberTasks";

/** The events' entity type for one approved write; its entity ref is the write's key. */
export const APPROVAL_EVENT_ENTITY = "agent_approval";

/** Whether the audit event for this write is already stored. */
export async function approvalEventExists(db: Queryable, writeKey: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM `health_events` WHERE `entity_type` = ? AND `entity_ref` = ? LIMIT 1",
    [APPROVAL_EVENT_ENTITY, writeKey],
  );
  return rows.length > 0;
}

export interface ApprovalEventRow {
  writeKey: string;
  text: string;
  at: string;
}

/** The latest approved writes, newest first. */
export async function recentApprovalEvents(db: Queryable, limit = 50): Promise<ApprovalEventRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `entity_ref`, `text`, `at` FROM `health_events` WHERE `entity_type` = ? ORDER BY `at` DESC, `id` DESC LIMIT ?",
    [APPROVAL_EVENT_ENTITY, Math.max(1, Math.min(200, limit))],
  );
  return rows.map((r) => ({
    writeKey: String(r.entity_ref ?? ""),
    text: String(r.text ?? ""),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}

export interface ApprovalOutboxRow {
  key: string;
  status: string;
  attempts: number;
  lastError: string | null;
  payload: unknown;
}

/** The memory outbox rows for these record keys (`approvalRecordKey`), by key. */
export async function approvalOutboxRows(db: Queryable, kind: string, keys: readonly string[]): Promise<Map<string, ApprovalOutboxRow>> {
  const out = new Map<string, ApprovalOutboxRow>();
  if (keys.length === 0) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `feedback_id`, `status`, `attempts`, `last_error`, `payload` FROM `member_task_outbox` WHERE `kind` = ? AND `feedback_id` IN (?)",
    [kind, keys],
  );
  for (const r of rows) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(String(r.payload));
    } catch {
      payload = null;
    }
    out.set(String(r.feedback_id), { key: String(r.feedback_id), status: String(r.status), attempts: Number(r.attempts), lastError: r.last_error ? String(r.last_error) : null, payload });
  }
  return out;
}
