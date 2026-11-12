/**
 * PROPOSED CHANGES: the pure half (the lead, 11 Nov 2026).
 *
 *   "Let's do a better workflow for the connector writing where I can edit
 *   within the editor and it's showing me the text so I can tweak it before it
 *   goes live and you're learning from my tweaks." Then: "I want to be able to
 *   bulk accept once I make my edits and have ALL edits in one page." And:
 *   "improve the powers of the connector to cover those remaining elements so
 *   that the connector truly can help with suggestions on all settings."
 *
 * An agent PROPOSES a change; nothing live moves. A person opens
 * /admin/proposals, reads every proposal beside what is live now, edits the
 * text in place, and accepts a selection. Accepting runs each change through
 * the target's OWN route as that person (server/routes/proposedChanges.ts), so
 * the one capability gate and the route's validator answer for them. The
 * difference between what was proposed and what was accepted is kept as a
 * plain record agents read before they draft the next one.
 *
 * WHAT CAN BE PROPOSED. Every setting a village admin can change, by default.
 * The kinds below with their own validator cover the common settings; any other
 * admin write route is the `setting` kind, accepted through that route as it
 * stands. So a new Admin setting is proposable the day it ships, without a
 * line here. What is never proposable is a short closed list of categories
 * (`NEVER_PROPOSED`), refused at proposal time with a plain reason.
 *
 * Pure: no database, no Express. The server half is server/lib/proposedChanges.ts.
 */
import { ALWAYS_A_PERSON } from "./agentAdmin";

export const PROPOSAL_KINDS = [
  "role_card",
  "page_content",
  "faq_add",
  "faq_edit",
  "faq_remove",
  "variable",
  "module_lifecycle",
  "module_config",
  "role_listing",
  "season_goals",
  "onboarding_path",
  "setting",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_STATUSES = ["proposed", "accepted", "discarded", "failed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type WriteMethod = "PUT" | "POST" | "PATCH" | "DELETE";

/** What each kind names, in plain words, for the connector's description and a refusal. */
export const KIND_WORDS: Record<ProposalKind, string> = {
  role_card: "A role card: words, listing details, pay on offer, characters and the founding sections. target {roleId}; body any of {words, parameters, pay, archetypes, sections}.",
  page_content: "A page's words. target {section}, such as page-home; body the fields to change, merged onto the page as it stands.",
  faq_add: "A new FAQ. target {pathway}; body {question, answer}.",
  faq_edit: "An FAQ reworded. target {pathway, id}; body {question, answer}.",
  faq_remove: "An FAQ taken down. target {pathway, id}; body {}.",
  variable: "A village variable from the variables list. target {key}; body {value}.",
  module_lifecycle: "A module turned off, preview, members or public. target {id}; body {lifecycle}.",
  module_config: "A module's own settings. target {id}; body the settings to change, merged onto the module's settings.",
  role_listing: "Which roles are listed: list only these. target {}; body {ids}.",
  season_goals: "A season's goals. target {seasonId}; body {goals: [{text, done?}]}.",
  onboarding_path: "The village's onboarding path document. target {}; body {doc}.",
  setting: "Any other admin setting, through its own route. target {method, path, readPath?}; body the route's own body.",
};

/** The route a kind's change runs through, as a pattern, for the record and the never rules. */
export function routePatternFor(kind: Exclude<ProposalKind, "setting">): { method: WriteMethod; path: string } {
  switch (kind) {
    case "role_card":
      return { method: "POST", path: "/api/org/role-edit/:roleId" };
    case "page_content":
      return { method: "PUT", path: "/api/admin/content/:section" };
    case "faq_add":
      return { method: "POST", path: "/api/admin/faqs/:pathway" };
    case "faq_edit":
      return { method: "PUT", path: "/api/admin/faqs/:pathway" };
    case "faq_remove":
      return { method: "DELETE", path: "/api/admin/faqs/:pathway/:id" };
    case "variable":
      return { method: "PUT", path: "/api/admin/variables/:key" };
    case "module_lifecycle":
      return { method: "PUT", path: "/api/admin/modules/:id/lifecycle" };
    case "module_config":
      return { method: "PUT", path: "/api/admin/modules/:id/config" };
    case "role_listing":
      return { method: "POST", path: "/api/admin/org/listing/only" };
    case "season_goals":
      return { method: "PUT", path: "/api/admin/seasons" };
    case "onboarding_path":
      return { method: "PUT", path: "/api/admin/onboarding-path" };
  }
}

/** The pattern with the target's values put in. */
export function fillPattern(pattern: string, target: Record<string, unknown>): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_m, k: string) => encodeURIComponent(String(target[k] ?? "")));
}

// ── Where a `setting` may point ─────────────────────────────────────────────

/** The prefixes Admin writes settings under. A `setting` names a route under one of these. */
export const SETTING_PREFIXES = ["/api/admin/", "/api/org/role-edit/", "/api/org/circles/", "/api/moon-review/rhythm", "/api/governance/role-discover/mapping"] as const;

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** A plain concrete path under a settings prefix, or a sentence saying why not. */
export function settingPathProblem(path: unknown): string | null {
  const p = typeof path === "string" ? path : "";
  if (!p || p.length > 400 || /[?#%]/.test(p)) return "Name the route as a plain path, such as /api/admin/brand, with no query string.";
  const parts = p.slice(1).split("/");
  if (!p.startsWith("/") || parts.some((x) => x === "" || x === "." || x === ".." || !SEGMENT.test(x))) {
    return "Name the route as a plain path, such as /api/admin/brand, with no query string.";
  }
  if (!SETTING_PREFIXES.some((pre) => p === pre.replace(/\/$/, "") || p.startsWith(pre))) {
    return "A proposed setting names an admin route, under /api/admin/, a role card's editor, a circle card, the moon rhythm or the roles quiz mapping.";
  }
  return null;
}

// ── Never proposable ────────────────────────────────────────────────────────

export type NeverKey = "secrets" | "erasure" | "agents" | "powers" | "money" | "seating" | "sending" | "members" | "legal";

export interface NeverRule {
  key: NeverKey;
  words: string;
  /** Read against the route (method and path; for a known kind, its pattern) and the proposed body. */
  test: (method: string, path: string, body: Record<string, unknown>) => boolean;
}

const rule = (key: string) => ALWAYS_A_PERSON.find((r) => r.key === key)!;

/** A page section or an FAQ pathway names words, never a power: blank that one segment before the powers rule reads it. */
const WORDS_SEGMENT = /^(\/api\/admin\/(?:content|faqs)\/)[^/]+((?:\/[^/]+)?)$/i;
const withoutWords = (p: string) => p.replace(WORDS_SEGMENT, "$1_$2");

/** A seating's focus and note: the one write on a seating that changes no holder. */
const isSeatNote = (m: string, p: string, body: Record<string, unknown>) =>
  m === "PATCH" && /^\/api\/admin\/org\/seatings\/[^/]+$/.test(p) && Object.keys(body).every((k) => k === "focus" || k === "note");

export const NEVER_PROPOSED: readonly NeverRule[] = [
  {
    key: "secrets",
    words: "Secrets, integration keys, passwords and sign-in are always a person's act, and are never proposed.",
    test: (m, p) => rule("secrets").test(m, p) || rule("accounts").test(m, p) || /password|oauth|webhook|sessions?(\/|$)|tokens?(\/|$)/i.test(p),
  },
  {
    key: "erasure",
    words: "Erasing or anonymising a member is always a person's act, and is never proposed.",
    test: (m, p) => rule("erasure").test(m, p) || /hard-?delete|purge/i.test(p),
  },
  {
    key: "agents",
    words: "The agent accounts, their tokens and the proposals themselves are always a person's act, and are never proposed.",
    test: (m, p) => rule("agents").test(m, p) || /\/api\/admin\/proposals(\/|$)/i.test(p),
  },
  {
    key: "powers",
    words: "Capability grants, power handover, the break-glass and badges that grant powers are always a person's act, and are never proposed.",
    test: (_m, p) => /capabilit|badge|power|break-?glass|override|handover|veto|admin-access|permission|\/promote|\/role$/i.test(withoutWords(p)),
  },
  {
    key: "money",
    words: "Moving value (payments, payouts, invoices, the ledger, the treasury, minting and settlement) is always a person's act, and is never proposed.",
    test: (_m, p) =>
      /payout|payment|payer|pay-?route|\/pay(\/|$)|invoice|ledger|treasury|mint|settle|refund|cash|wallet|exchange|purchase|token-jobs|\/api\/admin\/tokens|approv|\/comps?(\/|$)|crowdpool|stripe|\/moon-review\/(?!rhythm$)/i.test(withoutWords(p)),
  },
  {
    key: "seating",
    words: "Seating or unseating a person is always a person's act, and is never proposed.",
    test: (m, p, b) => !isSeatNote(m, p, b) && /holders?(\/|$)|seatings?(\/|$)|seat-?claims?|unseat|\/seat(\/|$)|adopt/i.test(p),
  },
  {
    key: "sending",
    words: "Sending letters or email is always a person's act, and is never proposed.",
    test: (_m, p) => /letters?(\/|$)|\/send(\/|$|-)|send-|broadcast|campaign|invit|test-?email|\/email\/test|announce/i.test(withoutWords(p)),
  },
  {
    key: "members",
    words: "A member's own record (their account, application or request to join) is changed by a person, never through a proposal.",
    test: (m, p) => m !== "GET" && (rule("personal").test(m, p) || rule("members").test(m, p)),
  },
  {
    key: "legal",
    words: "Accepting a caution card is the reader's own act, and is never proposed.",
    test: (_m, p, b) => /\/modules\/[^/]+\/config$/.test(p) && ["legalAck", "creditSaleAck"].some((k) => k in b),
  },
];

/** The first category this change falls under, or null when it may be proposed. */
export function neverProposed(method: string, path: string, body: unknown): { key: NeverKey; words: string } | null {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const m = String(method ?? "").toUpperCase();
  for (const r of NEVER_PROPOSED) if (r.test(m, path, b)) return { key: r.key, words: r.words };
  return null;
}

/** Variables an agent never proposes: their value is sealed, or it governs the agents themselves. */
export function variableNever(def: { key: string; withheld?: true; movedToSecret?: string } | null | undefined): { key: NeverKey; words: string } | null {
  if (!def) return null;
  if (def.withheld || def.movedToSecret) return { key: "secrets", words: NEVER_PROPOSED[0].words };
  if (/^agents\./.test(def.key)) return { key: "agents", words: NEVER_PROPOSED[2].words };
  return null;
}

// ── One proposal, read ──────────────────────────────────────────────────────

export const PROPOSAL_LIMITS = { items: 40, summary: 400, title: 160, bodyBytes: 200_000 } as const;

export interface ProposalInput {
  kind: ProposalKind;
  target: Record<string, unknown>;
  body: Record<string, unknown>;
  summary: string;
}

const KNOWN_ROUTES: ReadonlyArray<{ kind: Exclude<ProposalKind, "setting">; method: WriteMethod; re: RegExp; target: (m: RegExpMatchArray) => Record<string, string> }> = [
  { kind: "role_card", method: "POST", re: /^\/api\/org\/role-edit\/([^/]+)$/, target: (m) => ({ roleId: m[1] }) },
  { kind: "page_content", method: "PUT", re: /^\/api\/admin\/content\/([^/]+)$/, target: (m) => ({ section: m[1] }) },
  { kind: "faq_add", method: "POST", re: /^\/api\/admin\/faqs\/([^/]+)$/, target: (m) => ({ pathway: m[1] }) },
  { kind: "faq_remove", method: "DELETE", re: /^\/api\/admin\/faqs\/([^/]+)\/([^/]+)$/, target: (m) => ({ pathway: m[1], id: m[2] }) },
  { kind: "variable", method: "PUT", re: /^\/api\/admin\/variables\/([^/]+)$/, target: (m) => ({ key: m[1] }) },
  { kind: "module_lifecycle", method: "PUT", re: /^\/api\/admin\/modules\/([^/]+)\/lifecycle$/, target: (m) => ({ id: m[1] }) },
  { kind: "module_config", method: "PUT", re: /^\/api\/admin\/modules\/([^/]+)\/config$/, target: (m) => ({ id: m[1] }) },
  { kind: "role_listing", method: "POST", re: /^\/api\/admin\/org\/listing\/only$/, target: () => ({}) },
  { kind: "onboarding_path", method: "PUT", re: /^\/api\/admin\/onboarding-path$/, target: () => ({}) },
];

/**
 * A `setting` that names a route a kind already covers becomes that kind, so its own validator runs at proposal time
 * and the page shows it field by field. The connector may send everything as {method, path, body}.
 */
export function asKnownKind(method: string, path: string, body: Record<string, unknown>): { kind: ProposalKind; target: Record<string, unknown>; body: Record<string, unknown> } | null {
  const m = String(method).toUpperCase();
  for (const r of KNOWN_ROUTES) {
    const hit = path.match(r.re);
    if (!hit || r.method !== m) continue;
    const target = r.target(hit);
    // The variables route takes {value}; the module route {lifecycle}; the onboarding route {doc}; the others their own body.
    if (r.kind === "module_config") return { kind: r.kind, target, body: body.config && typeof body.config === "object" ? (body.config as Record<string, unknown>) : body };
    return { kind: r.kind, target, body };
  }
  return null;
}

const objectOr = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cleanTarget = (t: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).trim().slice(0, 400)]));

/** One proposal as the connector sent it, read; or the sentence saying why it cannot be filed. Shape only: the server checks the rest. */
export function readProposalInput(raw: unknown): { ok: true; value: ProposalInput } | { ok: false; error: string } {
  const r = objectOr(raw);
  if (!r) return { ok: false, error: "Each proposal is an object: {kind, target, body, summary}." };
  const summary = typeof r.summary === "string" ? r.summary.replace(/\s+/g, " ").trim() : "";
  if (summary.length < 4) return { ok: false, error: "Each proposal carries summary: one plain sentence saying what it changes." };
  if (summary.length > PROPOSAL_LIMITS.summary) return { ok: false, error: `Keep the summary under ${PROPOSAL_LIMITS.summary} characters.` };
  const body = r.body === undefined ? {} : objectOr(r.body);
  if (!body) return { ok: false, error: "body is an object, the fields to change." };
  if (JSON.stringify(body).length > PROPOSAL_LIMITS.bodyBytes) return { ok: false, error: "That body is longer than a proposal can carry." };
  const target = objectOr(r.target) ?? {};
  let kind = typeof r.kind === "string" && r.kind ? r.kind : "setting";
  if (!(PROPOSAL_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `kind is one of ${PROPOSAL_KINDS.join(", ")}.` };
  if (kind === "setting") {
    const method = String(target.method ?? "").toUpperCase();
    if (!["PUT", "POST", "PATCH", "DELETE"].includes(method)) return { ok: false, error: "A setting names target.method: PUT, POST, PATCH or DELETE." };
    const path = String(target.path ?? "");
    const pathProblem = settingPathProblem(path);
    if (pathProblem) return { ok: false, error: pathProblem };
    const known = asKnownKind(method, path, body);
    if (known) return { ok: true, value: { ...known, summary } };
    const out: Record<string, unknown> = { method, path };
    if (target.readPath !== undefined) {
      const readProblem = settingPathProblem(target.readPath);
      if (readProblem) return { ok: false, error: `readPath: ${readProblem}` };
      out.readPath = String(target.readPath);
    }
    return { ok: true, value: { kind: "setting", target: out, body, summary } };
  }
  return { ok: true, value: { kind: kind as ProposalKind, target: cleanTarget(target), body, summary } };
}

/** The route this proposal runs through: the pattern for a known kind, the concrete path for a setting. */
export function routeOf(kind: ProposalKind, target: Record<string, unknown>): { method: WriteMethod; path: string; pattern: string } {
  if (kind === "setting") {
    const path = String(target.path ?? "");
    return { method: String(target.method ?? "PUT").toUpperCase() as WriteMethod, path, pattern: path };
  }
  const r = routePatternFor(kind);
  return { method: r.method, path: fillPattern(r.path, target), pattern: r.path };
}

/** Why this proposal may never be filed, read on the route's PATTERN for a known kind so an id or a page name never reads as money. */
export function proposalNever(p: ProposalInput): { key: NeverKey; words: string } | null {
  const r = routeOf(p.kind, p.target);
  return neverProposed(r.method, r.pattern, p.body);
}

// ── Fields: how a body reads as labelled fields, and what changed ───────────

export type Leaf = string | number | boolean | null;

/** Every leaf of a JSON value, by dotted path ("words.aim", "goals.0.text"). An empty list or object is a leaf of its own. */
export function leavesOf(value: unknown, prefix = ""): Array<{ path: string; value: Leaf | [] | Record<string, never> }> {
  if (Array.isArray(value)) {
    if (!value.length) return [{ path: prefix, value: [] }];
    return value.flatMap((v, i) => leavesOf(v, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return [{ path: prefix, value: {} }];
    return entries.flatMap(([k, v]) => leavesOf(v, prefix ? `${prefix}.${k}` : k));
  }
  const leaf: Leaf = value === undefined ? null : (value as Leaf);
  return [{ path: prefix, value: leaf }];
}

export interface FieldDiff {
  /** The dotted path of the field. A list of words is compared whole, as one field. */
  field: string;
  proposed: unknown;
  accepted: unknown;
}

/** A list of plain values (a list of words) is one field; a list of objects is read item by item. */
const isWordList = (v: unknown) => Array.isArray(v) && v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x));

function fieldsOf(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isWordList(value) || value === null || typeof value !== "object") {
    out.set(prefix, value === undefined ? null : value);
    return;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  if (!entries.length) {
    out.set(prefix, value);
    return;
  }
  for (const [k, v] of entries) fieldsOf(v, prefix ? `${prefix}.${k}` : k, out);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What a person changed between the proposal and what they accepted, field by field. This is the lesson: a plain
 * record, computed without any model, read back by agents before they draft the next proposal.
 */
export function fieldDiffs(proposed: unknown, accepted: unknown): FieldDiff[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  fieldsOf(proposed ?? {}, "", a);
  fieldsOf(accepted ?? {}, "", b);
  const keys = Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys())]));
  const out: FieldDiff[] = [];
  for (const k of keys) {
    const pv = a.has(k) ? a.get(k) : null;
    const av = b.has(k) ? b.get(k) : null;
    if (!same(pv, av)) out.push({ field: k, proposed: pv, accepted: av });
  }
  return out;
}

/** The value at a dotted path, or undefined. */
export function valueAt(value: unknown, path: string): unknown {
  if (!path) return value;
  let at: unknown = value;
  for (const k of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

/** The proposed fields deep-merged onto what is live: objects merge, anything else (lists included) replaces. */
export function mergeOnto(live: unknown, patch: unknown): unknown {
  const l = objectOr(live);
  const p = objectOr(patch);
  if (!p) return patch;
  if (!l) return patch;
  const out: Record<string, unknown> = { ...l };
  for (const [k, v] of Object.entries(p)) out[k] = objectOr(v) && objectOr(l[k]) ? mergeOnto(l[k], v) : v;
  return out;
}

/** A field's key as plain words: "whyItMatters" reads "Why it matters", "goals.0.text" reads "Goals 1 text". */
export function fieldLabel(path: string): string {
  const parts = path.split(".").map((p) => (/^\d+$/.test(p) ? String(Number(p) + 1) : p.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase()));
  const s = parts.join(" ").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Value";
}

/** One lesson: a field a person changed before accepting. */
export interface Lesson {
  proposalId: string;
  kind: ProposalKind;
  target: string;
  summary: string;
  field: string;
  proposed: unknown;
  accepted: unknown;
  acceptedAt: string;
}

/** Lessons grouped by kind and then by field, newest first within each, for an agent to read before drafting. */
export function groupLessons(lessons: readonly Lesson[]): Array<{ kind: ProposalKind; fields: Array<{ field: string; changes: Lesson[] }> }> {
  const byKind = new Map<ProposalKind, Map<string, Lesson[]>>();
  for (const l of lessons) {
    const fieldKey = l.field.replace(/\.\d+(?=\.|$)/g, ".n");
    const k = byKind.get(l.kind) ?? new Map<string, Lesson[]>();
    const list = k.get(fieldKey) ?? [];
    list.push(l);
    k.set(fieldKey, list);
    byKind.set(l.kind, k);
  }
  return Array.from(byKind.entries()).map(([kind, fields]) => ({
    kind,
    fields: Array.from(fields.entries()).map(([field, changes]) => ({ field, changes: [...changes].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt)) })),
  }));
}

/** The note every accept leaves in the approval fields the connector's audit already carries. */
export const ACCEPT_NOTE = "accepted on the review page";

export const REVIEW_WORDS = {
  nothingLive: "Nothing was changed. A person reviews it on the review page and accepts it there.",
  personOnly: "Accepting or discarding a proposed change is a person's act on the review page.",
  notProposed: "That one is not waiting any more.",
  gone: "That proposal is not here.",
  noRoute: "There is no such admin route to change.",
  notReader: "The review page is for admins and for holders of the powers its changes need.",
} as const;
