/**
 * THE RECORD A LEAD-APPROVED WRITE LEAVES IN THE VILLAGE'S ORGANISATIONAL MEMORY.
 *
 * The lead, 11 Nov 2026: "ensure that agents are acting as people with their permission and agreement in Claude so
 * it's all recorded here in Claude and in Sera." Every write the connector makes under `agents.lead_approved_writes`
 * carries who approved it and their approval in their own words (shared/agentAdmin.ts, APPROVAL_FIELDS). The server
 * keeps one admin-only audit event per write and queues one of these for the memory service, through the outbox that
 * already carries a member's task feedback there (server/lib/memberTaskBridge.ts, `planSend`, kind
 * `decision_record`), retried with back-off by the `member-task-bridge` job.
 *
 * PRIVACY. The record says what changed (field NAMES, never values), which role, draft or variable it reached, who
 * approved it, their approval note with emails and phone numbers stripped, and when. It never carries a member id,
 * the member a seating names, or any value the write set. Pure: the payload is shaped here and nowhere else.
 */
import { stripContact } from "./memberTaskFeedback";

/** The outbox kind these records travel under. */
export const APPROVAL_RECORD_KIND = "decision_record" as const;

/** The outbox key for one write: unique with the kind, so a second queueing of the same write is a no-op. */
export const approvalRecordKey = (writeKey: string): string => `agent-approval-${writeKey}`.slice(0, 64);

/** What is queued, as stored in the outbox row. */
export interface ApprovalRecordPayload {
  record: "agent_approval";
  writeKey: string;
  /** e.g. "Changed a role card's words". */
  what: string;
  /** The role, draft or variable, by id or key. */
  target: string | null;
  method: string;
  /** Field names only. */
  changed: string[];
  approvedBy: string;
  approvalNote: string;
  /** ISO time the write was made. */
  at: string;
}

export function approvalRecordPayload(a: {
  writeKey: string;
  what: string;
  target: string | null;
  method: string;
  changed: readonly string[];
  approvedBy: string;
  approvalNote: string;
  at: Date;
}): ApprovalRecordPayload {
  return {
    record: "agent_approval",
    writeKey: a.writeKey,
    what: a.what.slice(0, 160),
    target: a.target ? a.target.slice(0, 120) : null,
    method: a.method.slice(0, 8),
    changed: a.changed.slice(0, 40).map((k) => String(k).slice(0, 80)),
    approvedBy: stripContact(a.approvedBy).slice(0, 120),
    approvalNote: stripContact(a.approvalNote),
    at: a.at.toISOString(),
  };
}

/** Read a stored payload back, or null when it is not one of these. */
export function readApprovalRecordPayload(raw: unknown): ApprovalRecordPayload | null {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!p || p.record !== "agent_approval" || typeof p.writeKey !== "string") return null;
  return {
    record: "agent_approval",
    writeKey: p.writeKey,
    what: String(p.what ?? ""),
    target: typeof p.target === "string" ? p.target : null,
    method: String(p.method ?? ""),
    changed: Array.isArray(p.changed) ? p.changed.map(String) : [],
    approvedBy: String(p.approvedBy ?? ""),
    approvalNote: String(p.approvalNote ?? ""),
    at: String(p.at ?? ""),
  };
}

/**
 * The memory service's `save_document` arguments for one record: a short Governance record kept whole, put forward
 * by the person who approved it. Left as a draft there; publishing in the memory is a person's act.
 */
export function approvalRecordDocument(p: ApprovalRecordPayload): { args: Record<string, unknown>; minimal: Record<string, unknown> } {
  const where = p.target ? ` (${p.target})` : "";
  const title = `Agent change approved: ${p.what}${where}`.slice(0, 200);
  const keyPoints = [
    `What: ${p.what}${where}`,
    p.changed.length ? `Fields: ${p.changed.join(", ")}` : null,
    `Approved by: ${p.approvedBy}`,
    `Approval: ${p.approvalNote}`,
    `When: ${p.at}`,
    `Made by: the village connector, acting as the person who connected it`,
    `Record: ${p.writeKey}`,
  ]
    .filter(Boolean)
    .join("\n");
  const args = {
    title,
    summary: `${p.what}${where}, made through the village connector with approval from ${p.approvedBy}.`,
    key_points: keyPoints,
    category: "Governance",
    asserted_by: p.approvedBy,
    source_date: p.at.slice(0, 10),
  };
  return { args, minimal: { title, key_points: keyPoints } };
}
