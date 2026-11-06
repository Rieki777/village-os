/**
 * The privacy connection to the knowledge library: a second, full-scope token
 * (SABERRA_PRIVACY_TOKEN, an environment variable) used only for the two
 * privacy acts a steward asks for by hand: hard-deleting a person's tasks in
 * the library, and asking it to forget a person's feedback on erasure.
 *
 * The routine sync token is never used for these, and this token is never used
 * for anything else. Without it the answer is one plain sentence. Neither
 * token's value is ever logged, returned or written anywhere.
 *
 * Export seam: the library has no export tool yet. `libraryExportFor` answers
 * "not offered" today; when a tool is offered it is called here and its answer
 * joins our own copy in the steward's file.
 */
import { listTools, openSession, callToolJson, type ClientOptions } from "./saberraClient";
import { preflight } from "./saberraSync";

export const PRIVACY_ENV = "SABERRA_PRIVACY_TOKEN";
export const NEEDS_FULL_SCOPE = "This needs a full-scope connection to Sera. Set SABERRA_PRIVACY_TOKEN on the server; the routine sync key cannot do it.";
export const HARD_DELETE_TOOL = "hard_delete_person_tasks";
/** The tool name the library is expected to use for an export, once it has one. */
export const EXPORT_TOOLS = ["export_person_tasks", "export_owner_tasks"];

export function privacyTokenSet(): boolean {
  return !!(process.env[PRIVACY_ENV] ?? "").trim();
}

/** The address from the module, the token from the privacy variable. Null when either is missing. */
export function privacyClient(): ClientOptions | null {
  const token = (process.env[PRIVACY_ENV] ?? "").trim();
  if (!token) return null;
  const pre = preflight();
  if (!pre.ok) return null;
  return { ...pre.client, token };
}

export type PrivacyCall = { ok: true; value: unknown } | { ok: false; error: string; needsFullScope?: boolean };

export async function callPrivacyTool(tool: string, args: Record<string, unknown>): Promise<PrivacyCall> {
  const client = privacyClient();
  if (!client) return { ok: false, needsFullScope: true, error: NEEDS_FULL_SCOPE };
  const session = await openSession(client);
  if (!session) return { ok: false, error: "Sera did not open a session for the privacy connection." };
  const listing = await listTools(client, session);
  if (!listing.ok || !listing.tools.some((t) => t.name === tool)) {
    return { ok: false, needsFullScope: true, error: `Sera does not offer ${tool} to this connection. ${NEEDS_FULL_SCOPE}` };
  }
  const r = await callToolJson(client, session, tool, args);
  if (!r.ok) return { ok: false, needsFullScope: r.why === "refused", error: r.why === "refused" ? NEEDS_FULL_SCOPE : "Sera did not answer that call." };
  return { ok: true, value: r.value };
}

/** Pure: the count and ids out of a hard-delete answer, whatever it named them. */
export function readHardDelete(value: unknown): { count: number; ids: string[]; archived: boolean } {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const raw = Array.isArray(v.task_ids) ? v.task_ids : Array.isArray(v.ids) ? v.ids : Array.isArray(v.tasks) ? v.tasks : [];
  const ids = raw.map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).id ?? "") : String(x))).filter(Boolean);
  const count = Number.isFinite(Number(v.count)) ? Number(v.count) : ids.length;
  return { count, ids, archived: v.archived === true || v.confirmed === true || v.dry_run === false };
}

/** The library's export of a person's tasks, when it offers one. Today: not offered. */
export async function libraryExportFor(ownerId: string): Promise<{ offered: false; note: string } | { offered: true; value: unknown }> {
  const client = privacyClient();
  if (!client) return { offered: false, note: "Sera's own export needs the full-scope connection, and Sera has no export tool yet." };
  const session = await openSession(client);
  if (!session) return { offered: false, note: "Sera did not open a session." };
  const listing = await listTools(client, session);
  const tool = listing.ok ? EXPORT_TOOLS.find((t) => listing.tools.some((x) => x.name === t)) : undefined;
  if (!tool) return { offered: false, note: "Sera has no export tool yet. This file is the village's own copy." };
  const r = await callToolJson(client, session, tool, { owner_id: ownerId });
  return r.ok ? { offered: true, value: r.value } : { offered: false, note: "Sera's export did not answer." };
}
