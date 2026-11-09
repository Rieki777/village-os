/**
 * THE APPROVAL INBOX: what the connector files, and how a person decides it
 * (role journey L13, part A).
 *
 * FILING builds the exact call a thing's own admin route takes, from a fixed
 * template per kind, so a proposal can never name an arbitrary route. A filing
 * that names money, secrets, erasure, invites or power is refused at the door
 * (`neverProposable`). Nothing is written to the thing itself.
 *
 * DECIDING runs that stored call AS THE APPROVER, over the loopback with the
 * approver's own session, so the route's gates answer for the approver and a
 * person without the power is told no by the route. This file holds no
 * permission of its own.
 */
import type { Pool } from "mysql2/promise";
import { changeSummary } from "../../shared/mapScene";
import { isTermMode } from "../../shared/openProposalTerm";
import { isLifecycle } from "../../shared/moduleSwitch";
import { INBOX_WORDS, TERM_WORDS, neverProposable, plain, type InboxBody, type InboxCall } from "../../shared/approvalInbox";
import { getDraft as getMapDraft, publishedVersion } from "./mapScene";

/** What filing reads from the village. Passed in, so the village's own state stays in server/index.ts. */
export interface FilingDeps {
  pool: Pool;
  variable: (key: string) => { key: string; label: string; value: string } | null;
  module: (id: string) => { id: string; name: string; core: boolean; lifecycle: string; sellsToken: boolean } | null;
  openTerm: () => Promise<string>;
  content: (section: string) => unknown;
  contentVersion: (section: unknown) => string;
  pageProblem: (section: string, body: unknown) => string | null;
}

export type Filing = { ok: true; kind: "setting" | "listing" | "page_copy" | "map_publish"; title: string; body: InboxBody; roleId?: string | null } | { ok: false; error: string };

const MAX_JSON = 30_000;
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const fits = (b: InboxBody) => JSON.stringify(b).length <= MAX_JSON;
const refuse = (subject: string): Filing | null => {
  const never = neverProposable(subject);
  return never ? { ok: false, error: never.words } : null;
};

// ── Filing ───────────────────────────────────────────────────────────────────

export async function fileSetting(deps: FilingDeps, args: Record<string, unknown>): Promise<Filing> {
  const target = args.target;
  if (target === "variable") {
    const key = clip(args.key, 120);
    const def = deps.variable(key);
    if (!def) return { ok: false, error: "There is no village setting by that key." };
    const refused = refuse(`${def.key} ${def.label}`);
    if (refused) return refused;
    const value = clip(args.value, 300);
    if (value === def.value) return { ok: false, error: "That is the value it already has." };
    const call: InboxCall = { method: "PUT", path: `/api/admin/variables/${encodeURIComponent(def.key)}`, body: { value } };
    const revert: InboxCall = { method: "PUT", path: call.path, body: { value: def.value } };
    return { ok: true, kind: "setting", title: `Set ${def.label} to ${plain(value, 60)}`, body: { words: { what: def.label, before: plain(def.value), after: plain(value) }, call, revert } };
  }
  if (target === "module") {
    const id = clip(args.id, 80);
    const def = deps.module(id);
    if (!def || def.core) return { ok: false, error: "There is no module by that id that can be switched." };
    const refused = refuse(`${def.id} ${def.name}`) ?? (def.sellsToken ? { ok: false as const, error: "Money is always a person's act. A module that sells tokens cannot be switched by a proposal." } : null);
    if (refused) return refused;
    const lifecycle = clip(args.lifecycle, 12);
    if (!isLifecycle(lifecycle)) return { ok: false, error: "lifecycle is off, preview, members or public." };
    if (lifecycle === def.lifecycle) return { ok: false, error: "That is the state it is already in." };
    const call: InboxCall = { method: "PUT", path: `/api/admin/modules/${encodeURIComponent(def.id)}/lifecycle`, body: { lifecycle, examples: false } };
    const revert: InboxCall = { method: "PUT", path: call.path, body: { lifecycle: def.lifecycle, examples: false } };
    return { ok: true, kind: "setting", title: `Set ${def.name} to ${lifecycle}`, body: { words: { what: `${def.name} module`, before: def.lifecycle, after: lifecycle }, call, revert } };
  }
  if (target === "open_proposals_term") {
    const term = args.term;
    if (!isTermMode(term)) return { ok: false, error: "term is season or moon." };
    const was = await deps.openTerm();
    if (was === term) return { ok: false, error: "That is the term it already has." };
    const call: InboxCall = { method: "PUT", path: "/api/admin/open-proposals/settings", body: { term } };
    const revert: InboxCall = { method: "PUT", path: call.path, body: { term: was } };
    return { ok: true, kind: "setting", title: `Public proposals for ${TERM_WORDS[term] ?? term}`, body: { words: { what: "What public proposals are for", before: TERM_WORDS[was] ?? was, after: TERM_WORDS[term] ?? term }, call, revert } };
  }
  return { ok: false, error: "target is variable, module or open_proposals_term." };
}

async function hasListing(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT `listed` FROM `org_roles` LIMIT 1");
    return true;
  } catch (e) {
    if ((e as { errno?: number })?.errno === 1054) return false;
    throw e;
  }
}

export async function fileListing(deps: FilingDeps, args: Record<string, unknown>): Promise<Filing> {
  if (!(await hasListing(deps.pool))) return { ok: false, error: INBOX_WORDS.listingNotHere };
  const [roles] = await deps.pool.query<any[]>("SELECT `id`, `name`, `listed` FROM `org_roles` WHERE `is_example` = 0");
  const byId = new Map(roles.map((r) => [String(r.id), r]));
  if (Array.isArray(args.only)) {
    const ids = args.only.map((x) => clip(x, 64)).filter(Boolean).slice(0, 200);
    if (!ids.length) return { ok: false, error: "Name at least one role to list. Listing none would empty every list." };
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) return { ok: false, error: `Those roles are not here: ${unknown.slice(0, 5).join(", ")}` };
    const nowListed = roles.filter((r) => r.listed === null || Number(r.listed) === 1).length;
    const names = ids.map((id) => String(byId.get(id).name));
    const call: InboxCall = { method: "POST", path: "/api/admin/org/listing/only", body: { ids } };
    const revert: InboxCall = { method: "POST", path: "/api/admin/org/listing/undo", body: {} };
    return { ok: true, kind: "listing", title: `List only ${ids.length === 1 ? names[0] : `${ids.length} roles`}`, body: { words: { what: "Which roles are listed", before: `${nowListed} roles listed`, after: `Only ${plain(names.join(", "), 300)} listed. Every other role is unlisted.` }, call, revert } };
  }
  const roleId = clip(args.roleId, 64);
  const role = byId.get(roleId);
  if (!role) return { ok: false, error: "There is no role by that id. Read the chart with get_roles." };
  if (typeof args.listed !== "boolean") return { ok: false, error: "Say listed: true or false, or send only: [role ids]." };
  const was = role.listed === null || Number(role.listed) === 1;
  if (was === args.listed) return { ok: false, error: `${String(role.name)} is already ${was ? "listed" : "unlisted"}.` };
  const path = `/api/admin/org/roles/${encodeURIComponent(roleId)}`;
  return {
    ok: true,
    kind: "listing",
    roleId,
    title: `${args.listed ? "List" : "Unlist"} ${String(role.name)}`,
    body: { words: { what: `${String(role.name)} in the lists`, before: was ? "Listed" : "Not listed", after: args.listed ? "Listed" : "Not listed" }, call: { method: "PUT", path, body: { listed: args.listed } }, revert: { method: "PUT", path, body: { listed: was } } },
  };
}

export async function filePageCopy(deps: FilingDeps, args: Record<string, unknown>): Promise<Filing> {
  const section = clip(args.section, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(section)) return { ok: false, error: "Name the Pages content block: section." };
  const refused = refuse(section);
  if (refused) return refused;
  const content = args.content;
  if (content === undefined || content === null || typeof content !== "object") return { ok: false, error: "content is the block as it is saved in Admin Pages (an object or a list)." };
  const problem = deps.pageProblem(section, content);
  if (problem) return { ok: false, error: problem };
  const current = deps.content(section);
  if (current === undefined) return { ok: false, error: "There is no page content block by that name." };
  const path = `/api/admin/content/${encodeURIComponent(section)}`;
  const body: InboxBody = {
    words: { what: `Page words: ${section}`, before: plain(current, 700), after: plain(content, 700) },
    call: { method: "PUT", path, body: content, headers: { "x-content-was": deps.contentVersion(current) } },
    revert: { method: "PUT", path, body: current },
  };
  if (!fits(body)) return { ok: false, error: INBOX_WORDS.tooLong };
  return { ok: true, kind: "page_copy", title: `Change the words on ${section}`, body };
}

/** Publishing the current map draft: the scene itself is read when a person approves, so it is the draft as it stands then. */
export async function fileMapPublish(deps: FilingDeps, proposerId: string, args: Record<string, unknown>): Promise<Filing> {
  const draft = await getMapDraft(deps.pool, proposerId);
  if (!draft) return { ok: false, error: INBOX_WORDS.mapNothing };
  let lines: string[] = [];
  try {
    lines = changeSummary(JSON.parse(draft.scene), 12).map((c) => c.text);
  } catch {
    lines = [];
  }
  const live = await publishedVersion(deps.pool);
  return {
    ok: true,
    kind: "map_publish",
    title: "Publish the map draft",
    body: {
      words: { what: "The live map", before: `Version ${live}`, after: lines.length ? lines.join("; ") : "The draft's changes" },
      call: null,
      revert: null,
      facts: { draftOwnerId: proposerId, baseVersion: draft.baseVersion, note: clip(args.note, 500) || null },
    },
  };
}

// ── Deciding ─────────────────────────────────────────────────────────────────

export interface RouteRunner {
  (call: InboxCall): Promise<{ status: number; body: unknown }>;
}

const failureWords = (a: { status: number; body: unknown }): string => {
  const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
  return typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : `The route answered ${a.status}.`;
};

/**
 * Run an approval: the stored call through `run`, which is the approver's own session. A map publish reads the proposer's draft now.
 * Returns the route's refusal in words, and changes nothing when the route refuses.
 */
export async function runApproval(pool: Pool, body: InboxBody, kind: string, run: RouteRunner): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  let call = body.call;
  if (kind === "map_publish") {
    const owner = String(body.facts?.draftOwnerId ?? "");
    const draft = owner ? await getMapDraft(pool, owner) : null;
    if (!draft) return { ok: false, error: INBOX_WORDS.mapNothing };
    call = { method: "POST", path: "/api/map/publish", body: { scene: draft.scene, baseVersion: draft.baseVersion, note: body.facts?.note ?? null } };
  }
  if (!call) return { ok: false, error: "There is nothing to run for this proposal." };
  const a = await run(call);
  return a.status < 300 ? { ok: true, result: `The route answered ${a.status}.` } : { ok: false, error: failureWords(a) };
}

export async function runRevert(body: InboxBody, run: RouteRunner): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!body.revert) return { ok: false, error: INBOX_WORDS.noRevert };
  const a = await run(body.revert);
  return a.status < 300 ? { ok: true } : { ok: false, error: failureWords(a) };
}
