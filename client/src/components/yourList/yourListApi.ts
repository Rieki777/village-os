/**
 * The member's own list doors (server/routes/memberTasks.ts), one function each.
 * Every save waits for the server's answer before the card says it is saved.
 */
import { gameFetch } from "@/lib/gameApi";
import type { Horizon, ReasonCode, RemoveReason, TaskSource, TaskStatus, Tier } from "@shared/memberTasks";

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
  source: TaskSource;
  version: number;
  createdOn: string;
}

export interface RankedTask extends ListTask {
  horizonNow: Horizon;
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
export const removeTask = (t: ListTask, reason: RemoveReason) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/remove`, "POST", { version: t.version, reason });
export const undoTask = (t: ListTask) => write(`${LIST_URL}/${encodeURIComponent(t.id)}/undo`, "POST", { version: t.version });
