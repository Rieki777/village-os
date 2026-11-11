/**
 * THE SERVER HALF OF THE LEAD-APPROVED WRITES (shared/agentAdmin.ts, LEAD_APPROVED_WRITES).
 *
 * The lead's ruling of 10 and 11 November 2026, binding: "I want you to extend agent powers to be able to make
 * these changes - they're text changes and I'm still approving them here." And on seating: "they should be
 * seated already and this is again one of those powers our connector should have. Especially when I'm giving the
 * approval in chat here - this is the 'human decides' when I give the comment or approval in a prompt here."
 *
 * Two things live here, and the decision itself does not: `leadApprovedBodyProblem` in shared/agentAdmin.ts is
 * pure and decides. This file only reads the facts it needs and leaves the record.
 *
 *   `readLeadSeatFacts`  what a seat carries: every capability on its linked power groups, and whether one of
 *                        them opens the admin panel. Read fresh at both calls of the two-call write.
 *   `recordLeadApproval` for EVERY lead-approved write: one admin-audience event naming who approved it and
 *                        quoting the approval, one record queued for the organisational memory, and for a seating
 *                        one notice to every admin and founder, all keyed on the spent confirm token so a retry is
 *                        a no-op.
 *   `recentApprovedWrites` the events read back with the memory outbox's status, for Admin, Players, Agents.
 */
import type { Pool } from "mysql2/promise";
import { leadApprovalSubject, type LeadApprovalSubject, type LeadApprovedKind, type LeadSeatFacts } from "../../shared/agentAdmin";
import { APPROVAL_RECORD_KIND, approvalRecordKey, approvalRecordPayload, readApprovalRecordPayload, type ApprovalRecordPayload } from "../../shared/agentApprovalRecord";
import { enqueue, type OutboxKind } from "../repos/memberTaskFeedback";
import { APPROVAL_EVENT_ENTITY, approvalEventExists, approvalOutboxRows, recentApprovalEvents } from "../repos/agentApprovals";
import { listSeatGroupLinks, liveSeatingHeader, seatHeader } from "../repos/seatPowerGroups";
import { recordEvent } from "./events";

/** A power group as the roles plane holds it, the two fields read here. */
export interface PowerGroupFacts {
  id: string;
  capabilities?: unknown;
  grantsAdmin?: unknown;
}

/** The seat a seating names (by role id) or an unseating names (by seating id), with what it carries. */
export async function readLeadSeatFacts(
  pool: Pool,
  groups: () => readonly PowerGroupFacts[],
  target: { roleId: string } | { seatingId: string },
): Promise<LeadSeatFacts> {
  const none: LeadSeatFacts = { found: false, isExample: false, capabilities: [], grantsAdmin: false };
  let roleId: string;
  let seating: Awaited<ReturnType<typeof liveSeatingHeader>> = null;
  if ("seatingId" in target) {
    seating = await liveSeatingHeader(pool, target.seatingId);
    if (!seating) return none;
    roleId = seating.orgRoleId;
  } else {
    roleId = target.roleId;
  }
  const seat = await seatHeader(pool, roleId);
  if (!seat) return none;
  const linked = (await listSeatGroupLinks(pool)).filter((l) => l.orgRoleId === seat.id).map((l) => l.roleId);
  const byId = new Map(groups().map((g) => [String(g.id), g]));
  const capabilities = new Set<string>();
  let grantsAdmin = false;
  for (const id of linked) {
    const g = byId.get(id);
    // A link to a group that cannot be read is treated as carrying the most, which is the safe direction.
    if (!g) {
      grantsAdmin = true;
      continue;
    }
    for (const c of Array.isArray(g.capabilities) ? g.capabilities : []) capabilities.add(String(c));
    if (g.grantsAdmin === true) grantsAdmin = true;
  }
  return {
    found: true,
    roleId: seat.id,
    isExample: seat.isExample || !!seating?.isExample,
    capabilities: Array.from(capabilities),
    grantsAdmin,
    ...(seating ? { seatingIsAgent: seating.isAgent, seatingUserId: seating.userId } : {}),
  };
}

export interface LeadApprovalRecord {
  kind: LeadApprovedKind;
  roleId: string | null;
  path: string;
  method?: string;
  /** What changed, said without member data (shared/agentAdmin.ts, `leadApprovalSubject`). */
  subject?: LeadApprovalSubject;
  approvedBy: string;
  approvalNote: string;
  /** The plain sentence the connector's caller wrote for the person (admin_request's `summary`). */
  summary?: string;
  /** One key per write: derived from the spent confirm token. */
  writeKey: string;
}

/** The outbox writer, a seam so a test can make the memory side fail. */
export type QueueRecord = (key: string, payload: ApprovalRecordPayload) => Promise<void>;

/** The default: the outbox the member-task bridge drains to the memory service, every 15 minutes, with back-off. */
export const queueToMemory = (pool: Pool): QueueRecord => (key, payload) =>
  enqueue(pool, null, key, APPROVAL_RECORD_KIND as OutboxKind, payload as unknown as Record<string, unknown>);

/**
 * The record one approved write leaves, once per write however often it is called:
 *
 *   1. one admin-audience audit event (entity `agent_approval`, ref = the write's key), naming the agent as the
 *      actor, who approved it and their approval quoted. Skipped when that key's event is already stored.
 *   2. for a seating or unseating, one notice to every admin and founder, on a stable key.
 *   3. one record queued for the village's organisational memory (shared/agentApprovalRecord.ts), INSERT IGNORE on
 *      the same key. Queue-and-forget: a failure is logged and never undoes or refuses the write, and the outbox's
 *      own job retries a queued record until the memory confirms it holds it.
 */
export async function recordLeadApproval(
  deps: {
    pool: Pool;
    agentUserId: string;
    tokenPrefix: string;
    notifyAdmins: (type: string, title: string, dedupeKey: string, link?: string) => Promise<void>;
    queue?: QueueRecord;
    now?: () => Date;
  },
  a: LeadApprovalRecord,
): Promise<void> {
  const subject = a.subject ?? leadApprovalSubject(a.kind, a.path, {}, a.roleId);
  const where = subject.target ? ` (${subject.target})` : "";
  if (!(await approvalEventExists(deps.pool, a.writeKey))) {
    // The approval can name people, so the line is admin-audience, and it names the agent as the actor.
    await recordEvent(deps.pool, {
      kind: "audit",
      text: `connector (${deps.tokenPrefix}...): ${subject.what}${where}, with approval from ${a.approvedBy}: "${a.approvalNote.slice(0, 1000)}"${a.summary ? `. Summary given: "${a.summary.slice(0, 400)}"` : ""}`,
      actorUserId: deps.agentUserId,
      actorKind: "agent",
      entityType: APPROVAL_EVENT_ENTITY,
      entityRef: a.writeKey,
      audience: "admin",
    });
  }
  if (a.kind === "seat" || a.kind === "unseat") {
    const act = a.kind === "seat" ? "seated a person" : "ended a seating";
    await deps.notifyAdmins(
      "governance",
      `Our agent ${act} in ${a.roleId ?? "a role"}, approved by ${a.approvedBy.slice(0, 80)}`,
      `agent-lead-${a.kind}:${a.writeKey}`,
      "/admin",
    );
  }
  const payload = approvalRecordPayload({
    writeKey: a.writeKey,
    what: subject.what,
    target: subject.target,
    method: a.method ?? "",
    changed: subject.changed,
    approvedBy: a.approvedBy,
    approvalNote: a.approvalNote,
    summary: a.summary,
    at: (deps.now ?? (() => new Date()))(),
  });
  try {
    await (deps.queue ?? queueToMemory(deps.pool))(approvalRecordKey(a.writeKey), payload);
  } catch (err) {
    console.error("[agent-approval] could not queue the memory record (the write and its audit event stand)", err);
  }
}

/** One approved write as Admin, Players, Agents lists it. */
export interface ApprovedWriteItem {
  writeKey: string;
  at: string;
  what: string;
  target: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  /** The event's own line, for a write whose memory record is gone or was never queued. */
  text: string;
  /** Where the memory record is: sent (the memory confirmed it), waiting, failed (retrying), held, dropped, or none queued. */
  memory: "sent" | "waiting" | "failed" | "held" | "dropped" | "none";
  memoryError: string | null;
}

/** The recent approved writes, read from the audit events, with what the memory outbox says about each. */
export async function recentApprovedWrites(pool: Pool, limit = 50): Promise<ApprovedWriteItem[]> {
  const events = await recentApprovalEvents(pool, limit);
  const rows = await approvalOutboxRows(pool, APPROVAL_RECORD_KIND, events.map((e) => approvalRecordKey(e.writeKey)));
  return events.map((e) => {
    const row = rows.get(approvalRecordKey(e.writeKey)) ?? null;
    const p = row ? readApprovalRecordPayload(row.payload) : null;
    const memory: ApprovedWriteItem["memory"] = !row
      ? "none"
      : row.status === "sent"
        ? "sent"
        : row.status === "queued"
          ? "waiting"
          : row.status === "failed" || row.status === "held" || row.status === "dropped"
            ? row.status
            : "waiting";
    return {
      writeKey: e.writeKey,
      at: e.at,
      what: p?.what ?? "",
      target: p?.target ?? null,
      approvedBy: p?.approvedBy ?? null,
      approvalNote: p?.approvalNote ?? null,
      text: e.text,
      memory,
      memoryError: row?.lastError ?? null,
    };
  });
}
