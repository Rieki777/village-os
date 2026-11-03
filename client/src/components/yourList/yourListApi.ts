/**
 * The member's own list doors (server/routes/memberTasks.ts), one function each.
 * Every save waits for the server's answer before the card says it is saved.
 */
import { gameFetch } from "@/lib/gameApi";
import type { Horizon, ReasonCode, TaskSource, TaskStatus, Tier } from "@shared/memberTasks";
import type { FeedbackContext, ScreenReason } from "@shared/memberTaskFeedback";

export const LIST_URL = "/api/member-tasks/me";

export interface ListTask {
  id: string;
  title: string;
  privateDetail: string | null;
  tier: Tier;
  horizon: Horizon | null;
  dueOn: string | null;
  minutes: number | null;
  status: TaskStatus;
  pinned: boolean;
  memberPinned?: boolean;
  source: TaskSource;
  version: number;
  createdOn: string;
}

export interface RankedTask extends ListTask {
  horizonNow: Horizon;
  score: number;
  reasons: ReasonCode[];
  always: boolean;
  shown: boolean;
}

export type ListPayload =
  | { on: false }
  | { on: true; today: string; counts: Record<Horizon, number> & { hidden: number }; open: RankedTask[]; done: ListTask[]; removed: ListTask[] };

export type WriteResult = { ok: true; task: ListTask | null } | { ok: false; status: number; error: string; task?: ListTask | null };

async function write(path: string, method: string, body: unknown): Promise<WriteResult> {
  try {
    const res = await gameFetch(path, { method, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: String(data?.error ?? "That did not save. Try again."), task: data?.task ?? null };
    return { ok: true, task: data?.task ?? null };
  } catch {
    return { ok: false, status: 0, error: "That did not reach the village. Check your connection and try again." };
  }
}

export async function readList(): Promise<ListPayload | null> {
  try {
    const res = await gameFetch(LIST_URL);
    if (!res.ok) return null;
    return (await res.json()) as ListPayload;
  } catch {
    return null;
  }
}

export const addTask = (title: string, tier: Tier, extra: { dueOn?: string | null; source?: "self" | "journal"; privateDetail?: string | null } = {}) =>
  write(LIST_URL, "POST", { title, tier, ...extra });
export const markDone = (t: ListTask) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/done`, "POST", { version: t.version });
export interface Press {
  feedbackId: string;
  reason: ScreenReason;
  note: string | null;
  context: FeedbackContext;
}

/** One id per press, so a retried press is never counted twice. */
export function newFeedbackId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `fb-${c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`}`;
}

export const removeTask = (t: ListTask, press: Press) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/remove`, "POST", { version: t.version, ...press });
export const redirectTask = (t: ListTask, press: Press, to: { toUserId?: string; toRoleId?: string }) =>
  write(`${LIST_URL}/${encodeURIComponent(t.id)}/redirect`, "POST", { version: t.version, ...press, ...to });
export const pinTask = (t: ListTask, on: boolean) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/pin`, "POST", { on });
export const changeTier = (t: ListTask, tier: Tier, context: FeedbackContext) =>
  write(`${LIST_URL}/${encodeURIComponent(t.id)}`, "PATCH", { version: t.version, tier, feedbackId: newFeedbackId(), context });

export async function readTargets(): Promise<{ people: { id: string; name: string }[]; roles: { id: string; name: string }[] }> {
  try {
    const res = await gameFetch("/api/member-tasks/redirect-targets");
    if (!res.ok) return { people: [], roles: [] };
    return await res.json();
  } catch {
    return { people: [], roles: [] };
  }
}

export async function readFeedbackSwitch(): Promise<boolean | null> {
  try {
    const res = await gameFetch(`${LIST_URL}/feedback`);
    return res.ok ? Boolean((await res.json()).on) : null;
  } catch {
    return null;
  }
}

export async function saveFeedbackSwitch(on: boolean): Promise<boolean | null> {
  try {
    const res = await gameFetch(`${LIST_URL}/feedback`, { method: "PUT", body: JSON.stringify({ on }) });
    return res.ok ? Boolean((await res.json()).on) : null;
  } catch {
    return null;
  }
}
export const undoTask = (t: ListTask) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/undo`, "POST", { version: t.version });
