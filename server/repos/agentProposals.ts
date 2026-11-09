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
  resolvedBy: string | null;
  resolvedAt: string | null;
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
    resolvedBy: r.resolved_by === null || r.resolved_by === undefined ? null : String(r.resolved_by),
    resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : iso(r.resolved_at),
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
export async function resolveProposal(db: Db, id: string, status: "taken" | "dismissed" | "sent", by: string): Promise<boolean> {
  const [res] = await db.query("UPDATE `agent_proposals` SET `status` = ?, `resolved_by` = ?, `resolved_at` = CURRENT_TIMESTAMP(3) WHERE `id` = ? AND `status` = 'waiting'", [status, by, id]);
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** A person's edit of a waiting letter. False when it is no longer waiting. */
export async function editWaitingLetter(db: Db, id: string, title: string, body: string): Promise<boolean> {
  const [res] = await db.query("UPDATE `agent_proposals` SET `title` = ?, `body` = ? WHERE `id` = ? AND `kind` = 'letter' AND `status` = 'waiting'", [title.slice(0, 200), body, id]);
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** Every waiting letter, oldest first, for the screen where a person reads and sends them. */
export async function listAllWaitingLetters(db: Db, limit = 100): Promise<StoredProposal[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `agent_proposals` WHERE `kind` = 'letter' AND `status` = 'waiting' ORDER BY `created_at` ASC LIMIT ?", [Math.min(Math.max(limit, 1), 200)]);
  return rows.map(toProposal);
}

// ── The approval inbox (role journey L13, part A) ────────────────────────────

/** Lapse every unletter proposal that waited past its seven days. Returns how many lapsed. */
export async function expireOld(db: Db, olderThanMs: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const [res] = await db.query(
    "UPDATE `agent_proposals` SET `status` = 'expired', `resolved_at` = CURRENT_TIMESTAMP(3) WHERE `kind` <> 'letter' AND `status` = 'waiting' AND `created_at` < ?",
    [cutoff],
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0);
}

/** Waiting proposals other than letters, oldest first. */
export async function listInboxWaiting(db: Db, limit = 100): Promise<StoredProposal[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `agent_proposals` WHERE `kind` <> 'letter' AND `status` = 'waiting' ORDER BY `created_at` ASC LIMIT ?", [Math.min(Math.max(limit, 1), 200)]);
  return rows.map(toProposal);
}

/** Decisions from the last 30 days, newest first, for the record under the inbox. */
export async function listInboxDecided(db: Db, limit = 50): Promise<StoredProposal[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM `agent_proposals` WHERE `kind` <> 'letter' AND `status` <> 'waiting' AND COALESCE(`resolved_at`, `created_at`) > DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY COALESCE(`resolved_at`, `created_at`) DESC LIMIT ?",
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(toProposal);
}

/** Record a decision on a waiting (or, for a revert, an approved) proposal, rewriting its body with the decision in it. */
export async function decideProposal(db: Db, id: string, from: ProposalState, to: ProposalState, by: string, body: string): Promise<boolean> {
  const [res] = await db.query(
    "UPDATE `agent_proposals` SET `status` = ?, `resolved_by` = ?, `resolved_at` = CURRENT_TIMESTAMP(3), `body` = ? WHERE `id` = ? AND `status` = ?",
    [to, by, body, id, from],
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}
