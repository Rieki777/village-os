/**
 * Shared work chats: a quest or a task that two or more people are on gets one
 * conversation, and the people in it are exactly the people on the work.
 *
 * WHO IS ON THE WORK, read from the records that already say so:
 *
 *   quest  every member with a claim on it that was not declined (claimed,
 *          submitted, or consented). A declined claim is the quest handed back
 *          (drizzle/0196 says why), so it takes the member out of the chat too.
 *   task   a live-session action: the person holding it, and every member who
 *          sits in the seat holding it now (`liveHoldersOf`, the board's own
 *          rule). Read from the task's state row, or from the entry while its
 *          session is still open.
 *
 * Nobody else is in the chat. An admin is not, a circle is not (circles come
 * later), and a crew keeps its own thread (kind 'crew', server/routes/quests.ts).
 *
 * LAZY, RECONCILED ON EVERY READ. Nothing here hooks the places that change who
 * is on a quest or a task. Claims are written by the quest routes, the map's
 * promise door, the steward's consent and decline, the erasure, and seatings
 * move with the org chart and the season's terms. Hooking every one of those is
 * a list somebody will forget to extend. Instead the conversation is brought in
 * line with the record at the moment anybody looks at it: opening it from the
 * quest or the task, reading the thread, sending into it, and loading the inbox
 * (which reconciles the viewer's own work). So a declined claimant gets the 404
 * on their very next request, before any message reaches them, and a newcomer
 * finds the chat in their inbox the next time they open it.
 *
 * The conversation is created the first time the work has two people AND
 * someone on it looks. Under two people nothing is created; an existing chat
 * whose people drop to one keeps its history and its one member.
 *
 * ONE CHAT PER PIECE OF WORK, and the database enforces it. The row's
 * `direct_key` (NOT NULL, UNIQUE) is `w:<kind>:<id>`, so two people opening it
 * at once race on the index, and the loser reads back the winner's row the way
 * `openDirect` does.
 *
 * NOBODY OWNS IT. Every member is role 'member', because the membership is the
 * record's and not anybody's to edit: adding, removing, handing on and renaming
 * are refused by the routes for these threads, and so is leaving (the next read
 * would only put the member back). Muting is how a member quiets one.
 */
import type { Pool } from "mysql2/promise";
import { liveHoldersOf, liveSeatIdsFor } from "../../shared/sessionTasks";
import { conversationById, type Conversation } from "./messaging";
import { listOrgAssignments, type LapseContext } from "./orgChart";
import * as repo from "../repos/sharedWork";

export type WorkKind = "quest" | "task";
export const WORK_KINDS: readonly WorkKind[] = ["quest", "task"];

export function isWorkKind(v: unknown): v is WorkKind {
  return v === "quest" || v === "task";
}

/** The unique key a shared-work row carries in `direct_key`. */
export function workKeyFor(kind: WorkKind, id: string): string {
  return `w:${kind}:${String(id)}`;
}

/** True for a conversation that is a shared-work chat (and not a crew's thread). */
export function isWorkConversation(c: Pick<Conversation, "kind" | "contextType">): boolean {
  return c.kind === "group" && isWorkKind(c.contextType);
}

/** Titles are a label: a task's words are cut to fit the name column with room to spare. */
const TITLE_CHARS = 100;

export function workTitle(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1)}…` : flat;
}

export interface Work {
  kind: WorkKind;
  id: string;
  title: string;
  /** User ids, distinct, in a stable order. */
  people: string[];
}

export interface WorkDeps {
  getPool(): Pool;
  /** The season's reading of whose seat term still runs. Without it every seating counts. */
  lapseContext?: () => LapseContext;
  /** Present members only: an example identity, a tombstone or an unclaimed account is never put in a chat. */
  isAddressable(userId: string): Promise<boolean>;
}

// ── Who is on the work ───────────────────────────────────────────────────────

async function questWork(pool: Pool, questId: string): Promise<Work | null> {
  const quest = await repo.questRow(pool, questId);
  if (!quest) return null;
  return {
    kind: "quest",
    id: quest.id,
    title: workTitle(quest.title) || "Quest",
    people: await repo.questClaimants(pool, questId),
  };
}

async function taskWork(pool: Pool, entryId: string, deps: Pick<WorkDeps, "lapseContext">): Promise<Work | null> {
  const n = Number(entryId);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = await repo.taskRow(pool, n);
  if (!r || r.kind !== "action") return null;
  const people: string[] = [];
  if (r.ownerNo != null && r.ownerNo > 0) {
    const owner = await repo.liveSessionUserFor(pool, r.ownerNo);
    if (owner) people.push(owner);
  }
  if (r.ownerSeatId) {
    const seatings = await listOrgAssignments(pool, deps.lapseContext?.());
    for (const uid of liveHoldersOf(seatings, r.ownerSeatId)) if (!people.includes(uid)) people.push(uid);
  }
  return { kind: "task", id: r.id, title: workTitle(r.text) || "Task", people };
}

/** The work and the people on it, or null when there is no such quest or task. */
export async function workFor(kind: WorkKind, id: string, deps: Pick<WorkDeps, "getPool" | "lapseContext">): Promise<Work | null> {
  return kind === "quest" ? questWork(deps.getPool(), id) : taskWork(deps.getPool(), id, deps);
}

/**
 * The work this member is on now, for the inbox's reconcile. Quests they hold
 * a live claim on, and tasks they or their seats hold that are not let go.
 * Bounded: an inbox load never walks more than `cap` pieces of work.
 */
export async function workOf(userId: string, deps: Pick<WorkDeps, "getPool" | "lapseContext">, cap = 40): Promise<Array<{ kind: WorkKind; id: string }>> {
  const pool = deps.getPool();
  const out: Array<{ kind: WorkKind; id: string }> = [];
  for (const id of await repo.liveClaimedQuestIds(pool, userId, cap)) out.push({ kind: "quest", id });

  const no = await repo.liveSessionNoFor(pool, userId);
  const seatings = await listOrgAssignments(pool, deps.lapseContext?.());
  const seats = liveSeatIdsFor(seatings, userId);
  for (const id of await repo.heldTaskIds(pool, no, seats, cap)) out.push({ kind: "task", id });
  return out.slice(0, cap);
}

// ── The conversation ─────────────────────────────────────────────────────────

/** The chat for this work, if one was ever opened. */
export async function workConversation(pool: Pool, kind: WorkKind, id: string): Promise<Conversation | null> {
  const found = await repo.conversationIdByKey(pool, workKeyFor(kind, id));
  return found ? conversationById(pool, found) : null;
}

async function createWorkConversation(pool: Pool, work: Work, attemptsLeft = 2): Promise<Conversation> {
  const id = `cnv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await repo.insertWorkConversation(pool, {
      id,
      name: work.title,
      contextType: work.kind,
      contextId: work.id,
      createdBy: work.people[0],
      directKey: workKeyFor(work.kind, work.id),
    });
  } catch (e: any) {
    // Two people opened it at once. The unique key decided; read the winner back.
    if (e?.code === "ER_DUP_ENTRY" && attemptsLeft > 0) {
      const winner = await workConversation(pool, work.kind, work.id);
      if (winner) return winner;
      return createWorkConversation(pool, work, attemptsLeft - 1);
    }
    throw e;
  }
  const created = await conversationById(pool, id);
  if (!created) throw new Error("conversation vanished immediately after insert");
  return created;
}

export interface SyncResult {
  conversation: Conversation | null;
  added: string[];
  removed: string[];
}

/**
 * Bring the chat in line with the people on the work, creating it when the
 * work has two people and no chat yet. Idempotent: a second call with nothing
 * changed writes nothing.
 */
export async function syncWorkConversation(work: Work, deps: Pick<WorkDeps, "getPool" | "isAddressable">): Promise<SyncResult> {
  const pool = deps.getPool();
  const people: string[] = [];
  for (const uid of work.people) if (await deps.isAddressable(uid)) people.push(uid);

  let conversation = await workConversation(pool, work.kind, work.id);
  if (!conversation) {
    if (people.length < 2) return { conversation: null, added: [], removed: [] };
    conversation = await createWorkConversation(pool, { ...work, people });
  } else if (conversation.name !== work.title && work.title) {
    // The quest was renamed: the chat follows its name.
    await repo.renameConversation(pool, conversation.id, work.title);
    conversation = { ...conversation, name: work.title };
  }

  const current = new Set(await repo.liveMemberIds(pool, conversation.id));
  const wanted = new Set(people);
  const added: string[] = [];
  const removed: string[] = [];
  for (const uid of people) {
    if (current.has(uid)) continue;
    await repo.joinAsMember(pool, conversation.id, uid);
    added.push(uid);
  }
  for (const uid of Array.from(current)) {
    if (wanted.has(uid)) continue;
    await repo.markLeft(pool, conversation.id, uid);
    removed.push(uid);
  }
  return { conversation, added, removed };
}

/** Read the work and sync its chat in one step. Null work means no such quest or task. */
export async function syncWork(kind: WorkKind, id: string, deps: WorkDeps): Promise<{ work: Work | null } & SyncResult> {
  const work = await workFor(kind, id, deps);
  if (!work) {
    return { work: null, conversation: await workConversation(deps.getPool(), kind, id), added: [], removed: [] };
  }
  return { work, ...(await syncWorkConversation(work, deps)) };
}
