/**
 * What the connector proposes for a person to act on (role journey L13, tier B).
 *
 *   agent_proposals   a seating proposal or a drafted letter, waiting
 *
 * A role change is an org draft (server/lib/orgDrafts.ts) and lives there. A
 * row here changes nothing live: a person reads it and does the act in the app.
 * Erased with the member (`forgetAgentForMember`, server/repos/memberAgent.ts).
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { ProposalKind, ProposalState } from "../../shared/agentProposals";

type Db = Pool | PoolConnection;

export interface StoredProposal {
  id: string;
  kind: ProposalKind;
  status: ProposalState;
  proposedBy: string;
  roleId: string | null;
  subjectUserId: string | null;
  applicationRef: string | null;
  effectiveFrom: string | null;
  title: string;
  body: string | null;
  createdAt: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));

function toProposal(r: RowDataPacket): StoredProposal {
  return {
    id: String(r.id),
    kind: String(r.kind) as ProposalKind,
    status: String(r.status) as ProposalState,
    proposedBy: String(r.proposed_by),
    roleId: r.role_id === null ? null : String(r.role_id),
    subjectUserId: r.subject_user_id === null ? null : String(r.subject_user_id),
    applicationRef: r.application_ref === null ? null : String(r.application_ref),
    effectiveFrom: r.effective_from === null ? null : String(r.effective_from),
    title: String(r.title ?? ""),
    body: r.body === null || r.body === undefined ? null : String(r.body),
    createdAt: iso(r.created_at),
  };
}

export async function addProposal(
  db: Db,
  p: { kind: ProposalKind; proposedBy: string; roleId?: string | null; subjectUserId?: string | null; applicationRef?: string | null; effectiveFrom?: string | null; title: string; body?: string | null },
): Promise<string> {
  const id = `prop_${randomBytes(9).toString("hex")}`;
  await db.query(
    "INSERT INTO `agent_proposals` (`id`, `kind`, `proposed_by`, `role_id`, `subject_user_id`, `application_ref`, `effective_from`, `title`, `body`) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, p.kind, p.proposedBy, p.roleId ?? null, p.subjectUserId ?? null, p.applicationRef ?? null, p.effectiveFrom ?? null, p.title.slice(0, 200), p.body ?? null],
  );
  return id;
}

/** How many waiting proposals one proposer has of a kind, for the volume cap. */
export async function waitingCount(db: Db, proposedBy: string, kind: ProposalKind): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM `agent_proposals` WHERE `proposed_by` = ? AND `kind` = ? AND `status` = 'waiting'", [proposedBy, kind]);
  return Number(rows[0]?.n ?? 0);
}

/** Whether the same seating is already waiting, so a retry does not stack a second one. */
export async function seatingAlreadyWaiting(db: Db, roleId: string, memberId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM `agent_proposals` WHERE `kind` = 'seating' AND `status` = 'waiting' AND `role_id` = ? AND `subject_user_id` = ? LIMIT 1", [roleId, memberId]);
  return rows.length > 0;
}

export async function listWaiting(db: Db, kind: ProposalKind, opts: { proposedBy?: string; limit?: number } = {}): Promise<StoredProposal[]> {
  const args: unknown[] = [kind];
  let where = "`kind` = ? AND `status` = 'waiting'";
  if (opts.proposedBy) {
    where += " AND `proposed_by` = ?";
    args.push(opts.proposedBy);
  }
  args.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`agent_proposals\` WHERE ${where} ORDER BY \`created_at\` DESC LIMIT ?`, args);
  return rows.map(toProposal);
}

export async function proposalById(db: Db, id: string): Promise<StoredProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `agent_proposals` WHERE `id` = ? LIMIT 1", [id]);
  return rows[0] ? toProposal(rows[0]) : null;
}

/** Close a waiting proposal. False when it was not waiting. */
export async function resolveProposal(db: Db, id: string, status: "taken" | "dismissed", by: string): Promise<boolean> {
  const [res] = await db.query("UPDATE `agent_proposals` SET `status` = ?, `resolved_by` = ?, `resolved_at` = CURRENT_TIMESTAMP(3) WHERE `id` = ? AND `status` = 'waiting'", [status, by, id]);
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** A role that is not a standing example, by id. */
export async function liveRoleById(db: Db, id: string): Promise<{ id: string; name: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id`, `name` FROM `org_roles` WHERE `id` = ? AND `is_example` = 0 LIMIT 1", [id]);
  return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
}

/**
 * The interviews waiting on a holder, from the interview queue (role journey L5). Throws the database's own error when the
 * queue is not in this village yet, so the route can say so in words. Ref, role and timing only.
 */
export async function conversationsWaitingOn(db: Db, userId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT i.`id`, i.`application_ref`, i.`position`, i.`minutes`, i.`is_final`, i.`state`, i.`opened_at`, i.`booked_at`, r.`name` AS role_name " +
      "FROM `application_interviews` i " +
      "JOIN `org_role_assignments` a ON a.`org_role_id` = i.`interviewer_role_id` AND a.`user_id` = ? AND a.`ended_at` IS NULL AND a.`holder_kind` = 'member' " +
      "LEFT JOIN `org_roles` r ON r.`id` = i.`interviewer_role_id` " +
      "WHERE i.`state` IN ('open', 'booked') AND NOT EXISTS (SELECT 1 FROM `application_recusals` x WHERE x.`application_ref` = i.`application_ref` AND x.`user_id` = ?) " +
      "ORDER BY i.`opened_at` ASC LIMIT 50",
    [userId, userId],
  );
  return rows;
}
