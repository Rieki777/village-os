/**
 * The feedback bridge between a member's list and the knowledge library
 * (PR E). Three jobs:
 *
 *   recordAction   a press on the card becomes one feedback row (idempotent on
 *                  its feedback_id) and, for a task the library sent, the
 *                  outbox rows that tell the library about it.
 *   drainOutbox    sends what is owed, retrying with back-off. Reason codes,
 *                  redirect target and context go from day one. NOTES wait in
 *                  the outbox as `held` until a steward releases them, and have
 *                  emails and phone numbers stripped before they are queued.
 *   syncLinked     reads each linked member's changed and removed tasks and
 *                  lands them through the same plan as the import, so a
 *                  tombstone is never brought back.
 *
 * The service's tools may not match what was agreed field for field, so every
 * call is shaped against the input schema the service itself lists: fields it
 * does not declare are dropped and logged, and a refusal is retried once with
 * the bare minimum before it is queued for a later try.
 *
 * Only tasks the library sent (source `sera`, with an external id, for a
 * member linked to a library person) are ever told to it. A member's own
 * tasks, and any journal words, never cross.
 */
import { boolVar } from "./variables";
import type { Pool } from "mysql2/promise";
import { callToolJson, listTools, openSession, type ClientOptions, type ToolInfo } from "./saberraClient";
import { preflight } from "./saberraSync";
import { effectiveLifecycle } from "./modules";
import {
  libraryCode, reviewOf, stripContact, type FeedbackAction, type FeedbackInput,
} from "../../shared/memberTaskFeedback";
import { itemsOf, planImport } from "../../shared/memberTaskImport";
import { heldFromLibrary, runImport } from "../repos/memberTaskImport";
import type { MemberTaskRow } from "../repos/memberTasks";
import {
  closeLibraryTask, setSyncRecord, dueOutbox, importPhrase, recentRemovalSent, enqueue, libraryOwnerOf, markLinkSynced, markOutboxDropped, syncableLinks, feedbackOn, insertFeedback, markOutboxFailed, markOutboxSent, notesRelease, sweepOldFeedback, type OutboxRow,
} from "../repos/memberTaskFeedback";

export { libraryOwnerOf };

export interface ActionInput {
  userId: string;
  task: MemberTaskRow;
  action: FeedbackAction;
  feedback: FeedbackInput;
  redirectToUserId?: string | null;
  /** On a duplicate: the library's id of the task that stays. */
  mergedIntoExternalId?: string | null;
  redirectToRoleId?: string | null;
}

/** Store the press, and queue what the library is owed. True when it was a new press. */
export async function recordAction(pool: Pool, a: ActionInput): Promise<boolean> {
  const toPerson = !!a.redirectToUserId;
  const fresh = await insertFeedback(pool, {
    feedbackId: a.feedback.feedbackId,
    userId: a.userId,
    taskId: a.task.id,
    action: a.action,
    reason: a.feedback.reason,
    code: libraryCode(a.action, a.feedback.reason),
    note: a.feedback.note ? stripContact(a.feedback.note) : null,
    context: a.feedback.context,
    redirectToUserId: a.redirectToUserId ?? null,
    redirectToRoleId: a.redirectToRoleId ?? null,
    review: reviewOf(a.action, a.feedback.reason, toPerson),
  });
  if (!fresh) return false;
  if (a.task.source !== "sera" || !a.task.externalId) return true;
  if (!(await feedbackOn(pool, a.userId))) return true;
  const owner = await libraryOwnerOf(pool, a.userId);
  if (!owner) return true;

  const code = libraryCode(a.action, a.feedback.reason);
  const redirectOwner = a.redirectToUserId ? await libraryOwnerOf(pool, a.redirectToUserId) : null;
  const c = a.feedback.context;
  await enqueue(pool, a.userId, a.feedback.feedbackId, "feedback", {
    task_id: a.task.externalId,
    owner_id: owner,
    reason_code: code ?? "not_a_task",
    action: a.action,
    feedback_id: a.feedback.feedbackId,
    ...(redirectOwner ? { reassign_to_owner_id: redirectOwner, redirect_target: { type: "person", owner_id: redirectOwner } } : {}),
    ...(!redirectOwner && a.redirectToRoleId ? { redirect_target: { type: "role" } } : {}),
    shown_in: c.shownIn, rank_score: c.rankScore, days_on_list: c.daysOnList, surface: c.surface,
    ...(a.action === "priority_changed" ? { new_priority: a.task.tier } : {}),
    ...(code === "duplicate" && a.mergedIntoExternalId && a.mergedIntoExternalId !== a.task.externalId ? { merged_into_task_id: a.mergedIntoExternalId } : {}),
    context: { shown_in: c.shownIn, rank_score: c.rankScore, days_on_list: c.daysOnList, surface: c.surface, screen_reason: a.feedback.reason },
  });
  if (a.action === "remove" || a.action === "redirect") {
    await enqueue(pool, a.userId, a.feedback.feedbackId, "suppress", { task_id: a.task.externalId, owner_id: owner, feedback_id: a.feedback.feedbackId });
  }
  if (a.feedback.note) {
    const held = (await notesRelease(pool)) !== "released";
    await enqueue(pool, a.userId, a.feedback.feedbackId, "note", {
      task_id: a.task.externalId, owner_id: owner, feedback_id: noteFeedbackId(a.feedback.feedbackId), reason_code: code ?? "not_a_task", note: stripContact(a.feedback.note),
    }, held);
  }
  return true;
}

// ── Sending ───────────────────────────────────────────────────────────────

const SUPPRESS_TOOLS = ["suppress_task", "dismiss_task", "mark_task_dismissed", "suppress_voice_task"];

/** The properties a tool declares, or null when it declares none (send as is). */
export function declaredFields(tool: ToolInfo | undefined): Set<string> | null {
  const props = (tool?.inputSchema as { properties?: Record<string, unknown> } | null)?.properties;
  return props && typeof props === "object" ? new Set(Object.keys(props)) : null;
}

/** The args the tool will take: undeclared fields dropped, and named so a steward can see it. */
export function shapeArgs(args: Record<string, unknown>, fields: Set<string> | null): { args: Record<string, unknown>; dropped: string[] } {
  if (!fields) return { args, dropped: [] };
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(args)) (fields.has(k) ? (out[k] = v) : dropped.push(k));
  return { args: out, dropped };
}

type Sent = { ok: true; note?: string } | { ok: false; error: string; drop?: boolean };

/** A released note is its own feedback on the library's side, so its id never collides with the press it explains. */
export const noteFeedbackId = (feedbackId: string) => `${feedbackId}-note`;

/** Keep only tasks whose evidence holds the phrase (a task with no evidence field is the service's call, kept). */
export function filterByPhrase(items: unknown[], phrase: string): unknown[] {
  if (!phrase) return items;
  return items.filter((t) => !t || typeof t !== "object" || !("evidence" in t) || String((t as Record<string, unknown>).evidence ?? "").includes(phrase));
}

export type SendPlan = { tool: string; args: Record<string, unknown>; minimal: Record<string, unknown> } | { tool: null; error: string; drop?: boolean };

/** Which tool an outbox row goes to, and with what. Pure, so it is tested without a service. */
export function planSend(tools: Map<string, ToolInfo>, row: Pick<OutboxRow, "kind" | "payload">): SendPlan {
  const p = row.payload;
  let tool: string | null = null;
  let args: Record<string, unknown> = {};
  let minimal: Record<string, unknown> = {};
  if (row.kind === "feedback") {
    tool = "submit_task_feedback";
    args = p;
    minimal = { task_id: p.task_id, reason_code: p.reason_code, feedback_id: p.feedback_id };
  } else if (row.kind === "undo") {
    tool = "retract_task_feedback";
    args = { feedback_id: p.feedback_id };
    minimal = args;
  } else if (row.kind === "note") {
    // The service has not added a note field yet: when it does not declare one, the note waits.
    const fields = declaredFields(tools.get("submit_task_feedback"));
    if (fields && !fields.has("note")) return { tool: null, error: "the service does not take a note yet; held for a later try" };
    tool = "submit_task_feedback";
    args = p;
    minimal = { task_id: p.task_id, reason_code: p.reason_code, note: p.note };
  } else if (row.kind === "suppress") {
    tool = SUPPRESS_TOOLS.find((t) => tools.has(t)) ?? null;
    if (!tool) return { tool: null, drop: true, error: "no suppress tool offered; the feedback carries the removal and our tombstone holds" };
    args = { task_id: p.task_id, owner_id: p.owner_id };
    minimal = { task_id: p.task_id };
  } else if (row.kind === "forget_person") {
    tool = tools.has("delete_feedback_for_person") ? "delete_feedback_for_person" : "delete_owner_feedback";
    args = p;
    minimal = { owner_id: p.owner_id };
  }
  if (!tool || !tools.has(tool)) return { tool: null, error: `the service does not offer ${tool ?? row.kind} yet` };
  return { tool, args, minimal };
}

async function sendOne(client: ClientOptions, session: string, tools: Map<string, ToolInfo>, row: OutboxRow): Promise<Sent> {
  const plan = planSend(tools, row);
  if (plan.tool === null) return { ok: false, error: plan.error, drop: plan.drop };
  const { tool, args, minimal } = plan;
  const shaped = shapeArgs(args, declaredFields(tools.get(tool)));
  let r = await callToolJson(client, session, tool, shaped.args);
  if (!r.ok && r.why === "vendor-error") r = await callToolJson(client, session, tool, shapeArgs(minimal, declaredFields(tools.get(tool))).args);
  if (!r.ok) return { ok: false, error: `${r.why}: ${r.detail}` };
  return { ok: true, note: shaped.dropped.length ? `dropped ${shaped.dropped.join(", ")}` : undefined };
}

export function bridgeOn(): boolean {
  return effectiveLifecycle("saberra") !== "off";
}

/** Send what is due. Answers one line for the job log. */
export async function drainOutbox(pool: Pool): Promise<string> {
  await sweepOldFeedback(pool).catch(() => 0);
  if (!bridgeOn()) return "library module off; nothing sent";
  const rows = await dueOutbox(pool, 50);
  if (!rows.length) return "nothing due";
  const pre = preflight();
  if (!pre.ok) return `not connected: ${pre.gap}`;
  const session = await openSession(pre.client);
  if (!session) return "no session";
  const listing = await listTools(pre.client, session);
  const tools = new Map<string, ToolInfo>((listing.ok ? listing.tools : []).map((t) => [t.name, t]));
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const out = await sendOne(pre.client, session, tools, row);
    if (out.ok) {
      await markOutboxSent(pool, row.id);
      sent += 1;
      if (out.note) console.warn(`[member-task-bridge] ${row.kind} ${row.id}: ${out.note}`);
    } else if (out.drop) {
      await markOutboxDropped(pool, row.id, out.error);
    } else {
      await markOutboxFailed(pool, row.id, row.attempts, out.error);
      failed += 1;
    }
  }
  return `sent ${sent}, will retry ${failed}`;
}

// ── Reading changes ───────────────────────────────────────────────────────

const MAX_PAGES = 20;

/** Short waits before re-reading removed_since after a fresh write (test hook below). */
export let RETRY_WAITS_MS = [2_000, 5_000];
export function setRetryWaitsForTest(w: number[]): void {
  RETRY_WAITS_MS = w;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ids the service says were closed or removed, from whichever field it uses. */
export function removedIdsOf(page: unknown): string[] {
  if (!page || typeof page !== "object") return [];
  const o = page as Record<string, unknown>;
  for (const k of ["removed_ids", "closed_ids", "removed", "deleted_ids"]) {
    const v = o[k];
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).id ?? (x as Record<string, unknown>).task_id ?? "") : String(x))).filter(Boolean);
  }
  return [];
}

/**
 * One linked member's changes since their last read. New tasks land, untouched
 * ones refresh, tasks the service closed are marked done on an untouched row,
 * and nothing the member removed or finished ever comes back.
 */
/** Every library task for one owner whose evidence holds the phrase, all pages. */
export async function pullLibrary(
  client: ClientOptions, session: string, tools: Map<string, ToolInfo>, owner: string, phrase: string, since: string | null,
): Promise<{ ok: true; items: unknown[]; removed: string[] } | { ok: false; error: string }> {
  const fields = declaredFields(tools.get("list_voice_tasks"));
  const items: unknown[] = [];
  const removed: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const ask = shapeArgs({
      owner_id: owner, page_size: 100,
      ...(phrase ? { evidence_contains: phrase } : {}),
      ...(cursor ? { cursor } : {}),
      ...(since ? { changed_since: since, removed_since: since } : {}),
    }, fields).args;
    const r = await callToolJson(client, session, "list_voice_tasks", ask);
    if (!r.ok) return { ok: false, error: `${r.why}: ${r.detail}` };
    // Belt and braces: if the filter was not applied, hold to the phrase here.
    items.push(...filterByPhrase(itemsOf(r.value), phrase));
    removed.push(...removedIdsOf(r.value));
    const v = (r.value ?? {}) as Record<string, unknown>;
    cursor = v.has_more === false ? null : typeof v.next_cursor === "string" && v.next_cursor ? v.next_cursor : null;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  return { ok: true, items, removed };
}

/** Pull for the steward import: a session of its own. */
export async function pullForImport(owner: string, phrase: string): Promise<{ ok: true; items: unknown[] } | { ok: false; error: string }> {
  if (!bridgeOn()) return { ok: false, error: "The library module is off." };
  const pre = preflight();
  if (!pre.ok) return { ok: false, error: `Not connected: ${pre.gap}` };
  const session = await openSession(pre.client);
  if (!session) return { ok: false, error: "The library did not open a session." };
  const listing = await listTools(pre.client, session);
  const tools = new Map<string, ToolInfo>((listing.ok ? listing.tools : []).map((t) => [t.name, t]));
  if (!tools.has("list_voice_tasks")) return { ok: false, error: "The library does not offer list_voice_tasks." };
  const r = await pullLibrary(pre.client, session, tools, owner, phrase, null);
  return r.ok ? { ok: true, items: r.items } : r;
}

export async function syncMember(
  pool: Pool, client: ClientOptions, session: string, tools: Map<string, ToolInfo>, link: { owner: string; userId: string; since: string | null }, today: string,
): Promise<{ created: number; updated: number; closed: number; error?: string }> {
  const startedAt = new Date();
  const phrase = await importPhrase(pool);
  let pulled = await pullLibrary(client, session, tools, link.owner, phrase, link.since);
  if (!pulled.ok) return { created: 0, updated: 0, closed: 0, error: pulled.error };
  // The library's store is eventually consistent: right after a removal it may not report it yet.
  // Retry a couple of times with a short backoff; past that, the next scheduled sync picks it up.
  if (link.since && !pulled.removed.length && (await recentRemovalSent(pool, link.userId).catch(() => false))) {
    for (const wait of RETRY_WAITS_MS) {
      await sleep(wait);
      const again = await pullLibrary(client, session, tools, link.owner, phrase, link.since);
      if (!again.ok) break;
      pulled = again;
      if (again.removed.length) break;
    }
  }
  const { items, removed } = pulled;
  const plan = planImport(items, link.owner, await heldFromLibrary(pool, link.userId));
  const res = await runImport(pool, link.userId, link.owner, plan, today, null);
  let closed = 0;
  for (const id of removed) {
    closed += await closeLibraryTask(pool, link.userId, id);
  }
  await markLinkSynced(pool, link.owner, startedAt);
  return { created: res.created, updated: res.updated, closed };
}

export async function syncLinked(pool: Pool, today: string): Promise<{ status: string; members: number; created: number; updated: number; closed: number; errors: string[] }> {
  const r = await syncLinkedOnce(pool, today);
  // The board's sync health reads this: when it ran, whether it worked, how many members failed. No service words.
  await setSyncRecord(pool, JSON.stringify({ at: new Date().toISOString(), ok: r.status === "ok" && r.errors.length === 0, s: r.status.slice(0, 40), m: r.members, e: r.errors.length })).catch(() => {});
  return r;
}

async function syncLinkedOnce(pool: Pool, today: string): Promise<{ status: string; members: number; created: number; updated: number; closed: number; errors: string[] }> {
  const out = { status: "ok", members: 0, created: 0, updated: 0, closed: 0, errors: [] as string[] };
  if (!bridgeOn()) return { ...out, status: "library module off" };
  const pre = preflight();
  if (!pre.ok) return { ...out, status: `not connected: ${pre.gap}` };
  const session = await openSession(pre.client);
  if (!session) return { ...out, status: "no session" };
  const listing = await listTools(pre.client, session);
  const tools = new Map<string, ToolInfo>((listing.ok ? listing.tools : []).map((t) => [t.name, t]));
  if (!tools.has("list_voice_tasks")) return { ...out, status: "the service does not offer list_voice_tasks" };
  for (const l of await syncableLinks(pool, boolVar("memberTasks.listDefault"))) {
    const r = await syncMember(pool, pre.client, session, tools, l, today);
    out.members += 1;
    out.created += r.created;
    out.updated += r.updated;
    out.closed += r.closed;
    if (r.error) out.errors.push(r.error);
  }
  return out;
}
