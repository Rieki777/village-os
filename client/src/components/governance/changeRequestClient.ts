/**
 * The few calls the rest of the app makes to change requests (Rye,
 * 2026-11-06): find the member's gathering change requests, start one, and
 * add a change to one. The change request pages (client/src/pages/ChangeRequests.tsx)
 * make the rest of their calls themselves; this file stays small because the
 * Suggest control imports it into other pages' chunks.
 */
import { authToken } from "@/lib/gameApi";

export interface ChangeRequestSummary {
  id: string;
  title: string;
  state: "gathering" | "in_review" | "voting" | "closed";
  changes: number;
  author: string;
  yours: boolean;
  updatedAt: string;
}

export const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** The server's sentence for a refusal, or a plain fallback. */
export async function refusal(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return String(body?.message || body?.error || fallback);
}

export async function myGathering(): Promise<ChangeRequestSummary[]> {
  const res = await fetch("/api/change-requests", { headers: headers() });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return (Array.isArray(body?.mine) ? body.mine : []).filter((c: ChangeRequestSummary) => c.state === "gathering");
}

/** Adds one change, starting a change request first when `into` is null. Returns the change request, or a refusal. */
export async function addChange(input: {
  into: string | null;
  title: string;
  why: string;
  change: Record<string, unknown>;
}): Promise<{ ok: true; id: string; title: string; changes: number } | { ok: false; message: string }> {
  let id = input.into;
  if (!id) {
    const made = await fetch("/api/change-requests", { method: "POST", headers: headers(), body: JSON.stringify({ title: input.title, why: input.why }) });
    if (!made.ok) return { ok: false, message: await refusal(made, "That change request could not be started.") };
    id = String((await made.json()).id);
  }
  const current = await fetch(`/api/change-requests/${encodeURIComponent(id)}`, { headers: headers() });
  if (!current.ok) return { ok: false, message: await refusal(current, "That change request could not be read.") };
  const cr = await current.json();
  const added = await fetch(`/api/change-requests/${encodeURIComponent(id)}/changes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ change: input.change, revision: cr.revision }),
  });
  if (!added.ok) return { ok: false, message: await refusal(added, "That change could not be added.") };
  const after = await added.json();
  return { ok: true, id, title: String(after.title), changes: Array.isArray(after.changes) ? after.changes.length : 0 };
}
