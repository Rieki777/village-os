/**
 * Agent accounts and what they did (0319; End of Moon addendum v6, B6 and B7).
 *
 *   users.is_agent   1 for an account a software agent holds: the Operations
 *                    agent and Sera's agent. NULL and 0 both mean a person.
 *   agent_actions    one row per admin or Sera action an agent took through
 *                    the connector, with what puts an undoable one back.
 *
 * The flag lives here, beside the members repository and not in its column
 * list, so the members code reads and writes exactly what it always has. Both
 * tables go in member erasure through `forgetAgentForMember`
 * (server/repos/memberAgent.ts).
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

/** Whether this account is held by a software agent. An unknown id is not an agent. */
export async function isAgentAccount(db: Db, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `is_agent` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  return Number(rows[0]?.is_agent ?? 0) === 1;
}

/** Mark an account as an agent's, or as a person's again. */
export async function setAgentAccount(db: Db, userId: string, isAgent: boolean): Promise<boolean> {
  // Callers that flip the flag also end the account's agent tokens (server/routes/agentAccounts.ts).
  const [res] = await db.query("UPDATE `users` SET `is_agent` = ? WHERE `id` = ?", [isAgent ? 1 : null, userId]);
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** Every agent account's id, for the Agent badge. */
export async function agentAccountIds(db: Db): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id` FROM `users` WHERE `is_agent` = 1");
  return rows.map((r) => String(r.id));
}

/** Of these ids, the ones agent accounts hold. */
export async function agentsAmong(db: Db, userIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Set();
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id` FROM `users` WHERE `is_agent` = 1 AND `id` IN (?)", [ids]);
  return new Set(rows.map((r) => String(r.id)));
}

// ── agent_actions ────────────────────────────────────────────────────────────

export type AgentActionState = "done" | "refused" | "asked" | "undone";

export interface AgentActionInput {
  tokenId: string;
  actorUserId: string;
  scope: string;
  tool: string;
  method?: string | null;
  path?: string | null;
  subjectUserId?: string | null;
  echoHash: string;
  state: AgentActionState;
  undo?: unknown;
}

export interface AgentActionRow {
  id: string;
  tokenId: string;
  actorUserId: string;
  scope: string;
  tool: string;
  method: string | null;
  path: string | null;
  subjectUserId: string | null;
  echoHash: string;
  state: AgentActionState;
  undo: unknown;
  createdAt: string;
  undoneAt: string | null;
  undoneByUserId: string | null;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

function toAction(r: RowDataPacket): AgentActionRow {
  let undo: unknown = null;
  if (typeof r.undo_json === "string" && r.undo_json) {
    try {
      undo = JSON.parse(r.undo_json);
    } catch {
      undo = null;
    }
  }
  return {
    id: String(r.id),
    tokenId: String(r.token_id),
    actorUserId: String(r.actor_user_id),
    scope: String(r.scope),
    tool: String(r.tool),
    method: r.method == null ? null : String(r.method),
    path: r.path == null ? null : String(r.path),
    subjectUserId: r.subject_user_id == null ? null : String(r.subject_user_id),
    echoHash: String(r.echo_hash),
    state: String(r.state) as AgentActionState,
    undo,
    createdAt: iso(r.created_at) ?? "",
    undoneAt: iso(r.undone_at),
    undoneByUserId: r.undone_by_user_id == null ? null : String(r.undone_by_user_id),
  };
}

/** Record one action. Returns its id. */
export async function recordAgentAction(db: Db, a: AgentActionInput): Promise<string> {
  const id = `aac-${randomBytes(8).toString("hex")}`;
  await db.query(
    "INSERT INTO `agent_actions` (`id`, `token_id`, `actor_user_id`, `scope`, `tool`, `method`, `path`, `subject_user_id`, `echo_hash`, `state`, `undo_json`) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      a.tokenId,
      a.actorUserId,
      a.scope.slice(0, 32),
      a.tool.slice(0, 64),
      a.method ? a.method.slice(0, 8) : null,
      a.path ? a.path.slice(0, 500) : null,
      a.subjectUserId ?? null,
      a.echoHash,
      a.state,
      a.undo === undefined || a.undo === null ? null : JSON.stringify(a.undo),
    ],
  );
  return id;
}

/** The newest actions first, optionally one scope's. */
export async function listAgentActions(db: Db, opts: { scope?: string; limit?: number } = {}): Promise<AgentActionRow[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)));
  const [rows] = opts.scope
    ? await db.query<RowDataPacket[]>("SELECT * FROM `agent_actions` WHERE `scope` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT ?", [opts.scope, limit])
    : await db.query<RowDataPacket[]>("SELECT * FROM `agent_actions` ORDER BY `created_at` DESC, `id` DESC LIMIT ?", [limit]);
  return rows.map(toAction);
}

export async function agentActionById(db: Db, id: string): Promise<AgentActionRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `agent_actions` WHERE `id` = ? LIMIT 1", [id]);
  return rows[0] ? toAction(rows[0]) : null;
}

/** Mark an action undone, once. False when it was already undone or is not undoable. */
export async function markAgentActionUndone(db: Db, id: string, byUserId: string): Promise<boolean> {
  const [res] = await db.query(
    "UPDATE `agent_actions` SET `state` = 'undone', `undone_at` = CURRENT_TIMESTAMP, `undone_by_user_id` = ? WHERE `id` = ? AND `state` = 'done' AND `undone_at` IS NULL",
    [byUserId, id],
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

/** How many roles this account holds now. An account is marked an agent's only while it holds none. */
export async function liveRoleCount(db: Db, userId: string): Promise<number> {
  // Both planes: the org chart's seatings, and the permission roles that carry powers.
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM `org_role_assignments` WHERE `user_id` = ? AND `ended_at` IS NULL) + (SELECT COUNT(*) FROM `role_holders` WHERE `user_id` = ?) AS n",
    [userId, userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Members' names by id, for the actions list. An id with no row is left out. */
export async function namesOf(db: Db, ids: readonly string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 500);
  if (!unique.length) return {};
  const [rows] = await db.query<RowDataPacket[]>("SELECT `id`, `name` FROM `users` WHERE `id` IN (?)", [unique]);
  return Object.fromEntries(rows.map((r) => [String(r.id), String(r.name ?? "")]));
}
