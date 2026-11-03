/**
 * SERA'S AGENT ACCOUNT: UNDOABLE ACTIONS ONLY (End of Moon addendum v6, B7).
 *
 * Sera's agents act in the village directly through one connector scope,
 * `sera.undoable`, and only through a closed list of tools. Each has an undo,
 * each writes an `agent_actions` row carrying what puts it back, and each is
 * listed for stewards with an Undo button:
 *
 *   link_sera_person   a `sera_person_links` row with `how = 'sera'`. Never
 *                      replaces a link that exists, never links one owner to
 *                      two members or one member to two owners.
 *   suggest_task       a task on a member's board for them to keep or remove.
 *   set_board_access   a member's task board on or off.
 *
 * NEVER, THROUGH THIS SCOPE: emailing or notifying a member (a sent message
 * cannot be unsent; nothing here calls notify or the post office), money,
 * pay routes, approvals or invoices, closing or deleting a member's task,
 * erasure, settings, powers, capabilities or secrets. There is no tool for
 * any of them, and the scope opens no other tool.
 *
 * UNDO. `undoSeraAction` works for 30 days. It puts back exactly what the
 * action wrote, and only while nobody has touched it since: a suggestion the
 * member kept or edited, a link a steward rewrote, a board switch someone
 * pressed again, each refuses with the reason. An undo writes its own row.
 *
 * Unlike the member and admin tools, these do not run a holder's own route:
 * Sera's agent holds no admin and acts on members, so the closed list above
 * IS the permission, and server/lib/seraAgent.test.ts holds every line of it.
 */
import type { Pool } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { parseTaskInput } from "../../shared/memberTasks";
import { recordEvent } from "./events";
import { echoHash } from "./agentTokens";
import { agentActionById, markAgentActionUndone, recordAgentAction } from "../repos/agentAccounts";
import { boardAccessRow, deleteSeraLink, deleteUntouchedSuggestion, insertSeraLink, memberHasSeraLink, restoreBoardAccess, seraLinkOfOwner } from "../repos/seraAgentActions";
import { insertTask, listIsOn, setListOn } from "../repos/memberTasks";
import { memberExists } from "../repos/memberTaskImport";

export const SERA_SCOPE = "sera.undoable";
export const SERA_TOOLS = ["link_sera_person", "suggest_task", "set_board_access"] as const;
export type SeraTool = (typeof SERA_TOOLS)[number];
export const UNDO_DAYS = 30;

export interface SeraActor {
  /** The Sera agent account. */
  userId: string;
  tokenId: string;
  tokenPrefix: string;
}

export interface SeraDeps {
  /** `memberTasks.listDefault`, read by the caller. */
  listDefault: boolean;
  /** Today in the village, YYYY-MM-DD. */
  today: string;
}

export type SeraOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

type Undo =
  | { kind: "link"; seraOwnerId: string; userId: string }
  | { kind: "suggest"; userId: string; taskId: string; batch: string }
  | { kind: "board"; userId: string; wrote: { on: boolean; setBy: string }; before: { on: boolean; setBy: string | null } | null };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function record(pool: Pool, actor: SeraActor, tool: string, subjectUserId: string | null, echo: unknown, undo: Undo | null, state: "done" | "refused" | "undone" = "done"): Promise<string> {
  const id = await recordAgentAction(pool, {
    tokenId: actor.tokenId,
    actorUserId: actor.userId,
    scope: SERA_SCOPE,
    tool,
    subjectUserId,
    echoHash: echoHash(echo),
    state: state === "undone" ? "done" : state,
    undo,
  });
  await recordEvent(pool, {
    kind: "agent_sera",
    text: `${tool} through Sera's agent (${actor.tokenPrefix}...): ${state}`,
    actorUserId: actor.userId,
    actorKind: "agent",
    entityType: "agent_action",
    entityRef: id,
    audience: "admin",
  });
  return id;
}

/** Run one Sera tool. Never notifies anyone. */
export async function runSeraTool(pool: Pool, actor: SeraActor, tool: SeraTool, args: Record<string, unknown>, deps: SeraDeps): Promise<SeraOutcome> {
  const userId = str(args.userId, 64);
  if (!userId) return { ok: false, error: "Name the member: userId." };
  if (userId === actor.userId) return { ok: false, error: "Sera's agent never acts on its own account." };
  if (!(await memberExists(pool, userId))) return { ok: false, error: "There is no member with that id." };

  if (tool === "link_sera_person") {
    const seraOwnerId = str(args.seraOwnerId, 128);
    if (!seraOwnerId) return { ok: false, error: "Name the Sera owner: seraOwnerId." };
    const existing = await seraLinkOfOwner(pool, seraOwnerId);
    if (existing) {
      await record(pool, actor, tool, userId, { seraOwnerId, userId }, null, "refused");
      return { ok: false, error: existing.userId === userId ? "That link already stands." : "That Sera owner is already linked to another member. A steward decides that one." };
    }
    if (await memberHasSeraLink(pool, userId)) {
      await record(pool, actor, tool, userId, { seraOwnerId, userId }, null, "refused");
      return { ok: false, error: "That member is already linked to a Sera owner. A steward decides that one." };
    }
    if (!(await insertSeraLink(pool, seraOwnerId, userId))) return { ok: false, error: "Another link landed first. Nothing was written." };
    const actionId = await record(pool, actor, tool, userId, { seraOwnerId, userId }, { kind: "link", seraOwnerId, userId });
    return { ok: true, result: { written: true, actionId, seraOwnerId, userId } };
  }

  if (tool === "suggest_task") {
    if (!(await listIsOn(pool, userId, deps.listDefault))) return { ok: false, error: "That member's task board is off." };
    const parsed = parseTaskInput({ title: args.title, tier: args.tier ?? "not_yet", horizon: args.horizon ?? null, dueOn: args.dueOn ?? null, minutes: args.minutes ?? null });
    if (!parsed.ok) return { ok: false, error: parsed.problem };
    const batch = `sera-agent:${randomBytes(8).toString("hex")}`;
    // No private detail from an agent: that field is the member's own words.
    const taskId = await insertTask(pool, userId, { ...parsed.value, privateDetail: null, source: "assistant", importBatch: batch, createdOn: deps.today }, actor.userId);
    const actionId = await record(pool, actor, tool, userId, { userId, title: parsed.value.title }, { kind: "suggest", userId, taskId, batch });
    return { ok: true, result: { written: true, actionId, taskId, title: parsed.value.title } };
  }

  if (tool === "set_board_access") {
    if (typeof args.on !== "boolean") return { ok: false, error: "Say on: true or on: false." };
    const before = await boardAccessRow(pool, userId);
    await setListOn(pool, userId, args.on, actor.userId);
    const actionId = await record(pool, actor, tool, userId, { userId, on: args.on }, { kind: "board", userId, wrote: { on: args.on, setBy: actor.userId }, before });
    return { ok: true, result: { written: true, actionId, userId, on: args.on } };
  }

  return { ok: false, error: "There is no such Sera tool." };
}

export type UndoOutcome = { ok: true } | { ok: false; status: 404 | 409 | 410; error: string };

/**
 * Put one Sera action back. `onlyActor` limits it to the agent's own actions
 * (the connector); a steward passes null.
 */
export async function undoSeraAction(pool: Pool, actionId: string, byUserId: string, onlyActor: string | null, now = new Date()): Promise<UndoOutcome> {
  const a = await agentActionById(pool, actionId);
  if (!a || a.scope !== SERA_SCOPE || (onlyActor && a.actorUserId !== onlyActor)) return { ok: false, status: 404, error: "There is no such Sera action." };
  if (a.state === "undone" || a.undoneAt) return { ok: false, status: 409, error: "That action was already undone." };
  if (a.state !== "done" || !a.undo) return { ok: false, status: 409, error: "That action wrote nothing, so there is nothing to put back." };
  if (now.getTime() - new Date(a.createdAt).getTime() > UNDO_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, status: 410, error: `Sera's actions can be undone for ${UNDO_DAYS} days, and this one is older.` };
  }
  const u = a.undo as Undo;
  let put = false;
  let touched = "";
  if (u.kind === "link") {
    put = await deleteSeraLink(pool, u.seraOwnerId, u.userId);
    touched = "The link has changed since: a steward rewrote it or removed it.";
  } else if (u.kind === "suggest") {
    put = await deleteUntouchedSuggestion(pool, u.userId, u.taskId, u.batch);
    touched = "The member has kept, edited or closed that suggestion, so it is theirs now.";
  } else if (u.kind === "board") {
    put = await restoreBoardAccess(pool, u.userId, u.wrote, u.before);
    touched = "Someone has switched that board since.";
  }
  if (!put) return { ok: false, status: 409, error: touched || "That action cannot be put back." };
  await markAgentActionUndone(pool, actionId, byUserId);
  await recordAgentAction(pool, {
    tokenId: a.tokenId,
    actorUserId: byUserId,
    scope: SERA_SCOPE,
    tool: "undo_sera_action",
    subjectUserId: a.subjectUserId,
    echoHash: echoHash({ undid: actionId }),
    state: "done",
    undo: null,
  });
  await recordEvent(pool, {
    kind: "agent_sera",
    text: `undid ${a.tool} by Sera's agent`,
    actorUserId: byUserId,
    entityType: "agent_action",
    entityRef: actionId,
    audience: "admin",
  });
  return { ok: true };
}
