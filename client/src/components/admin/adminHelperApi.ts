/**
 * The Admin helper's three calls (server/routes/adminHelper.ts).
 *
 * Status and ask go to the helper's own routes. Apply goes to the dial's OWN
 * route, `PUT /api/admin/variables/:key`, exactly as the Game Mechanics tab
 * calls it, so a change the guide proposed meets every guard a change typed
 * by hand meets. Nothing here knows or carries the Anthropic key: the browser
 * only ever learns whether the helper is on.
 */
import type { HelperAnswer, HelperProposal, HelperStatus, HelperTab } from "@shared/adminHelper";
import type { NavGroup } from "./adminNavGroups";
import { whatIsThis } from "./adminWords";
import { API_BASE, authHeaders, refusal } from "./adminApi";

export interface HelperLine {
  role: "user" | "assistant";
  content: string;
}

export async function fetchHelperStatus(password: string, signal?: AbortSignal): Promise<HelperStatus> {
  const r = await fetch(`${API_BASE}/admin/helper`, { headers: authHeaders(password), signal });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(refusal(d, "The helper could not be reached."));
  const off = d?.off === "switch" || d?.off === "key" ? d.off : null;
  return { on: d?.on === true, guide: typeof d?.guide === "string" ? d.guide : "", off: d?.on === true ? null : off ?? "key" };
}

/** The pages this admin can open, as the nav shows them, for the guide's map of Admin. */
export function tabsFromGroups(groups: readonly NavGroup[]): HelperTab[] {
  return groups.flatMap((g) => g.items.map((i) => ({ key: i.key, label: i.label, group: g.title, help: whatIsThis(i.key).help })));
}

export type AskOutcome = { ok: true; answer: HelperAnswer } | { ok: false; off: "switch" | "key" | null; error: string };

export async function askHelper(
  password: string,
  input: { messages: HelperLine[]; tabs: HelperTab[]; tab: string },
): Promise<AskOutcome> {
  try {
    const r = await fetch(`${API_BASE}/admin/helper/ask`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 503 && d?.error === "helper-off") return { ok: false, off: d?.off === "switch" ? "switch" : "key", error: "" };
    if (!r.ok) return { ok: false, off: null, error: refusal(d, "The helper could not answer just now. Try again in a moment.") };
    return { ok: true, answer: d as HelperAnswer };
  } catch {
    return { ok: false, off: null, error: "The helper could not be reached. Check your connection and try again." };
  }
}

/** Apply one proposed change through the dial's own admin route. */
export async function applyProposal(password: string, p: HelperProposal): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${API_BASE}/admin/variables/${encodeURIComponent(p.key)}`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ value: p.to }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: refusal(d, "That change was not saved.") };
    return { ok: true, message: typeof d?.message === "string" && d.message ? d.message : "" };
  } catch {
    return { ok: false, error: "That change was not saved. Check your connection and try again." };
  }
}
