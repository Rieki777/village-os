/**
 * WHICH ADMIN PATHS AN AGENT MAY CALL (End of Moon addendum v6, B6, with the
 * three changes approved on 3 November).
 *
 * The connector's `admin_request(method, path, body)` calls an admin path as
 * its holder. Two lists decide whether it may, and the holder's own route
 * gates still run after both:
 *
 *   THE ALLOW-LIST is data, in the `agent-admin-paths` document, and an admin
 *   who is a person edits it. A path not on it stays closed to the agent,
 *   which means a NEW admin route is closed until somebody adds it. It ships
 *   holding the Operations paths B6 names that exist today: task-board
 *   access, the Sera bridge's view and sync, and the moon rhythm.
 *
 *   ALWAYS A PERSON is code, and nothing on the allow-list overrides it:
 *   erasing a member, powers and capabilities, the money and the moon
 *   review's approvals, secrets, and the agent accounts and tokens
 *   themselves. An allow-list that names one of these is refused when it is
 *   saved and again when it is used.
 *
 * WHO CONFIRMS. Each allowed write says who confirms it. `agent`: the agent
 * may confirm its own call through the two-call contract, which keeps an
 * exact record and stops an accidental write; only the Operations writes on
 * the shipped list are marked so. `person`: the write changes members or a
 * setting next to money, so the connector does not make it, and a person
 * makes it in the app. A path an admin adds is `person` unless they say
 * otherwise.
 */

import { BREAK_GLASS_SEAT, isBadgeGrantable } from "./capabilities";

export const AGENT_ADMIN_PATHS_DOC = "agent-admin-paths";

export const ADMIN_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type AdminMethod = (typeof ADMIN_METHODS)[number];

export type AdminConfirm = "agent" | "person";

export interface AllowedAdminPath {
  method: AdminMethod;
  /** A path with `:name` for one segment, such as `/api/admin/member-tasks/access/:userId`. */
  path: string;
  /** Who confirms a write. Ignored for GET, which writes nothing. */
  confirm: AdminConfirm;
  /** What this path is for, in a few words. */
  label: string;
}

export interface AgentAdminPathsDoc {
  paths: AllowedAdminPath[];
}

/** The Operations paths B6 names that exist on the platform today. */
export const DEFAULT_AGENT_ADMIN_PATHS: AgentAdminPathsDoc = {
  paths: [
    { method: "GET", path: "/api/admin/member-tasks/access", confirm: "agent", label: "Who has a task board" },
    { method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "Turn a member's task board on or off" },
    { method: "GET", path: "/api/admin/member-tasks/bridge", confirm: "agent", label: "Organisational Memory: links, queue and last sync" },
    { method: "POST", path: "/api/admin/member-tasks/bridge/sync", confirm: "agent", label: "Run the Organisational Memory sync now" },
    { method: "GET", path: "/api/moon-review/rhythm", confirm: "agent", label: "The moon rhythm" },
    { method: "PUT", path: "/api/moon-review/rhythm", confirm: "agent", label: "Move a moon's days, the send hour or the guide link" },
  ],
};

/** The things an agent never does through the connector, whatever the allow-list says. */
export type PersonMode =
  /** Refused for every method. */
  | "always"
  /** Refused for a write; a GET answers once an admin has put the path on the list. */
  | "writes"
  /** Applicant and member personal data: a write is always refused, and a GET waits for the Anchor's approval of AI agents. */
  | "personal";

/**
 * The words-only routes name a SECTION or a PATHWAY in their last segment, and a page called "page-journey-steward" or
 * "governance" is wording, not a power. `PUT /api/admin/content/:section` is guarded by its own shape validator and
 * `/api/admin/faqs/:pathway` writes question and answer text, so the powers rule reads those paths with that one
 * segment blanked. Only the powers rule does this: every other rule still reads the whole path.
 */
const WORDS_ONLY_ROUTE = /^(\/api\/admin\/(?:content|faqs)\/)[^/]+((?:\/[^/]+)?)$/i;
function withoutWordsSegment(p: string): string {
  return p.replace(WORDS_ONLY_ROUTE, "$1_$2");
}

export const ALWAYS_A_PERSON: ReadonlyArray<{ key: string; words: string; mode: PersonMode; test: (method: string, path: string) => boolean }> = [
  {
    key: "erasure",
    mode: "always",
    words: "Erasing or anonymising a member is always a person's act.",
    test: (m, p) => /anonymi[sz]|erase|erasure|forget/i.test(p) || (m === "DELETE" && /^\/api\/admin\/(players|users|members)\/[^/]+$/.test(p)),
  },
  {
    key: "powers",
    mode: "writes",
    words: "Power handover, the break-glass, power groups and capabilities are always a person's act.",
    test: (_m, p) => /power|break-?glass|override|capabilit|badge|handover|veto|steward|admin-access|governance|\/org\/(drafts|seatings|roles)|\/roles(\/|$)|\/stages?(\/|$)/i.test(withoutWordsSegment(p)),
  },
  {
    key: "money",
    mode: "always",
    words: "Payers, pay routes, and the moon review's approvals, invoices and payments are always a person's act.",
    test: (_m, p) =>
      /payer|pay-?route|\/pay(\/|$)|invoice|payout|payment|cash|settle|ledger|wallet|treasury|exchange|mint|approv|refund|\/comps?(\/|$)|purchase|budget|\/cycles?(\/|$)|economy|owed|\/api\/admin\/tokens|token-jobs|role-?pay|\/terms?(\/|$)|terms-?offer|\/moon-review\/(?!rhythm$)/i.test(p),
  },
  {
    key: "members",
    mode: "writes",
    words: "Letting a member in, a member leaving, and removing one are always a person's act.",
    test: (_m, p) => /\/exits?(\/|$|-)|hard-?delete|invit/i.test(p),
  },
  {
    key: "settings",
    mode: "writes",
    words: "Sending letters and email, and the village's modules, variables and settings, are always a person's act.",
    test: (_m, p) => /\/letters?(\/|$)|\/send(\/|$)|email-?config|\/comms(\/|$)|\/modules?(\/|$)|variables|settings|\/brand(\/|$)|\/launch(\/|$)/i.test(p),
  },
  {
    // Role journey L13, tier C: the acts a machine only ever proposes. Adopting an application, seating, publishing a draft,
    // sending a first reply or a decision letter, and setting a role's pay or terms (the 24 Sept ruling: a person or a vote adopts).
    key: "tier_c",
    mode: "writes",
    words: "Adopting, seating, publishing, changing powers, sending, setting pay or terms, inviting and erasing are always a person's act. A connector proposes them and a person does them.",
    test: (_m, p) => /adopt|seat-?claims?|seatings?|publish|first-?repl|decision-?letter|letter-?drafts?|\/hold(s|ers)(\/|$)/i.test(p),
  },
  {
    // Applicant and member personal data (role journey L13, part B). Reads open only with the Anchor's approval of AI agents.
    key: "personal",
    mode: "personal",
    words: "Applicant and member personal data (open proposals, applications, scores, join requests, member details) is closed to agents until the Anchor records its approval of AI agents, and changing it is always a person's act.",
    test: (_m, p) => /join-?requests?|open-?proposals?|applications?|score-?cards?|\/scores?(\/|$)|interviews?|recusals?|\/(players|users|members)(\/|$)/i.test(p),
  },
  {
    key: "secrets",
    mode: "always",
    words: "Secrets and integration keys are always a person's act.",
    test: (_m, p) => /secret|integration|api-?key|credential|\/keys?(\/|$)/i.test(p),
  },
  {
    key: "accounts",
    mode: "always",
    words: "A member's admin flag, sign-in and sessions are always a person's act.",
    test: (_m, p) => /\/(users|players|members)\/[^/]+\/(role|revoke-sessions|send-password-link|password|email)$/i.test(p),
  },
  {
    key: "agents",
    mode: "always",
    words: "The agent accounts, their admin flag and their tokens are always a person's act.",
    test: (_m, p) => /\/agent(s)?(\/|$)|agent-admin-paths|agent-accounts|agent-actions|ai-?agents?-?approval|agent-proposals|\/api\/agent\//i.test(p),
  },
];

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** The path's segments, or null when it is not a plain path an agent may name. */
function segmentsOf(path: string): string[] | null {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.length > 400) return null;
  const parts = path.slice(1).split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || !SEGMENT.test(p))) return null;
  return parts;
}

function patternSegments(pattern: string): string[] | null {
  if (typeof pattern !== "string" || !pattern.startsWith("/api/") || pattern.length > 400) return null;
  const parts = pattern.slice(1).split("/");
  if (parts.some((p) => p === "" || (!p.startsWith(":") && !SEGMENT.test(p)) || (p.startsWith(":") && !/^:[A-Za-z][A-Za-z0-9]*$/.test(p)))) return null;
  return parts;
}

/**
 * A pattern so open it stands for many routes: a `:name` in the area or the
 * resource (the first two parts after /api/admin, or the first after /api),
 * or as many `:name` parts as named ones. "Always a person" is tested on the
 * concrete path at every call as well, but a list should say what it opens.
 */
function tooOpen(segs: readonly string[]): boolean {
  const fixedHead = segs[1] === "admin" ? 3 : 2;
  if (segs.slice(0, fixedHead).some((p) => p.startsWith(":"))) return true;
  const params = segs.filter((p) => p.startsWith(":")).length;
  return params * 2 >= segs.length;
}

/** Whether a concrete path matches an allow-list pattern. */
export function pathMatches(pattern: string, path: string): boolean {
  const want = patternSegments(pattern);
  const got = segmentsOf(path);
  if (!want || !got || want.length !== got.length) return false;
  return want.every((w, i) => w.startsWith(":") || w === got[i]);
}

/** The first always-a-person rule this path falls under, or null. */
export function alwaysAPerson(
  method: string,
  path: string,
  selfUserId?: string | null,
  opts: AgentDecisionOpts = {},
): { key: string; words: string } | null {
  const m = String(method ?? "").toUpperCase();
  // The lead-approved writes lift only the rules their entry names, and only while the village has the opt-in on.
  const lifted = opts.leadApprovedWrites === true ? leadApprovedEntry(m, path)?.lifts ?? [] : [];
  for (const r of ALWAYS_A_PERSON) {
    if (!r.test(m, path)) continue;
    if ((lifted as readonly string[]).includes(r.key)) continue;
    // A read of a "writes" rule answers once an admin has listed it. Personal data reads wait for the Anchor's switch.
    if (m === "GET" && r.mode === "writes") continue;
    if (m === "GET" && r.mode === "personal" && opts.applicantDataOpen === true) continue;
    return { key: r.key, words: r.words };
  }
  if (selfUserId && path.split("/").includes(selfUserId)) {
    return { key: "agents", words: "An agent never acts on its own account through the connector." };
  }
  return null;
}

export type AdminRequestDecision =
  | { ok: true; entry: AllowedAdminPath; write: boolean; confirm: AdminConfirm; leadApproved?: LeadApprovedKind }
  | { ok: false; code: "bad_path" | "always_a_person" | "not_allowed"; words: string };

/** Whether an agent may call `method path` through `admin_request`, and who confirms it. */
export function adminRequestDecision(method: string, path: string, doc: AgentAdminPathsDoc, selfUserId?: string | null, opts: AgentDecisionOpts = {}): AdminRequestDecision {
  const m = String(method ?? "").toUpperCase();
  if (!(ADMIN_METHODS as readonly string[]).includes(m)) return { ok: false, code: "bad_path", words: `method is one of ${ADMIN_METHODS.join(", ")}.` };
  const bare = String(path ?? "");
  // The path is dispatched exactly as given, so a query string or a fragment is refused, never trimmed.
  if (/[?#%]/.test(bare) || !segmentsOf(bare)) return { ok: false, code: "bad_path", words: "path is a plain path starting with /api/, with no query string and no dots." };
  const person = alwaysAPerson(m, bare, selfUserId, opts);
  if (person) return { ok: false, code: "always_a_person", words: person.words };
  const entry = doc.paths.find((e) => e.method === m && pathMatches(e.path, bare));
  if (!entry) {
    return { ok: false, code: "not_allowed", words: "That admin path is not open to agents in this village. An admin who is a person can add it to the agent paths list." };
  }
  const write = m !== "GET";
  // An entry that lifts no rule opens nothing and only adds its body check, so it holds whatever the switch says:
  // the role editor refuses pay, budget line and funding source from an agent always (coordinator, 11 Nov 2026).
  const found = write ? leadApprovedEntry(m, bare) : null;
  const lead = found && (opts.leadApprovedWrites === true || found.lifts.length === 0) ? found : null;
  return { ok: true, entry, write, confirm: write ? entry.confirm : "agent", ...(lead ? { leadApproved: lead.kind } : {}) };
}

/**
 * The stored list, checked: a bad document reads as the shipped list, and an entry a person must make is refused.
 * `leadApprovedWrites` is the village's opt-in (below): with it on, a lead-approved write may be saved on the list.
 */
export function parseAgentAdminPaths(raw: unknown, opts: { leadApprovedWrites?: boolean } = {}): { ok: true; value: AgentAdminPathsDoc } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(r.paths)) return { ok: false, error: "Send {paths: [...]}." };
  if (r.paths.length > 100) return { ok: false, error: "A hundred paths at most." };
  const out: AllowedAdminPath[] = [];
  for (let i = 0; i < r.paths.length; i++) {
    const e: unknown = r.paths[i];
    const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const method = String(x.method ?? "").toUpperCase();
    if (!(ADMIN_METHODS as readonly string[]).includes(method)) return { ok: false, error: `Path ${i + 1}: method is one of ${ADMIN_METHODS.join(", ")}.` };
    const path = String(x.path ?? "");
    const segs = patternSegments(path);
    if (!segs) return { ok: false, error: `Path ${i + 1}: write it as /api/... with :name for one part, and no query string.` };
    if (tooOpen(segs)) return { ok: false, error: `Path ${i + 1}: name the route itself. A :name may only stand for one member or one thing, after the words that say what the route is.` };
    const person = alwaysAPerson(method, path.replace(/:[A-Za-z][A-Za-z0-9]*/g, "x"), null, { applicantDataOpen: true, leadApprovedWrites: opts.leadApprovedWrites === true });
    if (person) return { ok: false, error: `Path ${i + 1}: ${person.words}` };
    const confirm: AdminConfirm = x.confirm === "agent" ? "agent" : "person";
    const label = String(x.label ?? "").trim().slice(0, 120);
    if (!label) return { ok: false, error: `Path ${i + 1}: give it a few words saying what it is for.` };
    out.push({ method: method as AdminMethod, path, confirm, label });
  }
  return { ok: true, value: { paths: out } };
}

/**
 * The list an agent is held to: the stored one when it parses, the shipped one otherwise.
 *
 * Read as if the opt-in were on, so a village that turns `agents.lead_approved_writes` off keeps the rest of
 * its list working. The lead-approved paths on it then refuse at every call, because `adminRequestDecision`
 * asks "always a person" again with the village's opt-in as it stands at that moment.
 */
export function effectiveAgentAdminPaths(stored: unknown): AgentAdminPathsDoc {
  if (stored === null || stored === undefined) return DEFAULT_AGENT_ADMIN_PATHS;
  const parsed = parseAgentAdminPaths(stored, { leadApprovedWrites: true });
  return parsed.ok ? parsed.value : DEFAULT_AGENT_ADMIN_PATHS;
}

// ── LEAD-APPROVED WRITES ─────────────────────────────────────────────────────
/**
 * THE LEAD'S RULING (10 and 11 November 2026), binding, in the lead's words:
 *
 *   "I want you to extend agent powers to be able to make these changes -
 *   they're text changes and I'm still approving them here."
 *
 *   On seating: "they should be seated already and this is again one of those
 *   powers our connector should have. Especially when I'm giving the approval
 *   in chat here - this is the 'human decides' when I give the comment or
 *   approval in a prompt here."
 *
 * The connector is used by the lead's own AI coordinator, and the lead
 * approves each change in the chat before the coordinator confirms it. So the
 * human decision is still there; it is made in the conversation, and the
 * two-call confirm plus the approval carried in the body keep the record.
 *
 * ON BY DEFAULT SINCE 2026-11-11 (the lead). The game variable
 * `agents.lead_approved_writes` ships true. That opens nothing by itself: the
 * agent paths list is still saved only by a person, and every write still needs
 * the approval note. With it set false nothing below has any effect:
 * `alwaysAPerson` answers exactly as it did before (pinned by a regression test
 * over the whole list). A person sets it in Admin, Game Mechanics, Connector.
 * The agent can never turn it on or off: no variable under `agents.` is a
 * wording variable.
 *
 * WHAT IT OPENS, AND HOW NARROWLY. Each entry below names one route and the
 * always-a-person rules it lifts for that route alone. Only `powers`, `tier_c`
 * and `settings` may ever be lifted (`LIFTABLE_RULES`); erasure, money, the
 * members rules, personal data, secrets, accounts and the agent accounts are
 * never lifted, so a role id or variable key that also reads as money is still
 * refused. The path is only half the check: `leadApprovedBodyProblem` reads
 * the body of every such write and refuses pay, value, cash, budget lines,
 * powers and agent seats, and a seat whose powers a badge could not carry.
 *
 * WHAT STAYS A PERSON'S, unchanged: erasure, money (pay, value, cash, payers,
 * invoices, approvals), secrets, the agent accounts and their tokens,
 * granting capabilities or badges directly (power groups, the capabilities
 * routes, `/api/admin/roles/:id/holders` on the power-group plane), publishing
 * a draft, settings and brand, and the moon review's approvals.
 *
 * THE ROUTE GATES STILL RUN AS THE TOKEN'S HOLDER. The connector acts as the
 * account that minted its `vat_` token or connected it through OAuth
 * (`resolveAgent`, server/index.ts, signs the holder's own session), and the
 * `admin` scope is only ever given to an admin. When the lead connects from
 * their own profile, the holder IS the lead: `story.tell` (content, FAQs, story
 * pages), `org.seat` (seating, unseating, the onboarding path) and `dial.set`
 * (variables) are asked of the lead's own account. On a key the village has
 * not taken up, an admin passes; on a key the village holds, the lead needs a
 * live seat carrying it, as in the app. Lifting a rule here only lets the call
 * reach the route; the one capability gate decides there. Nothing in code
 * grants a power. A seating never seats the holder (`self` below).
 */
export const LEAD_APPROVED_WRITES_VARIABLE = "agents.lead_approved_writes";

/** The rules a lead-approved write may lift. Never erasure, money, members, personal, secrets, accounts or agents. */
export const LIFTABLE_RULES = ["powers", "tier_c", "settings"] as const;
export type LiftableRule = (typeof LIFTABLE_RULES)[number];

export type LeadApprovedKind = "role_text" | "role_edit" | "role_draft" | "seat" | "unseat" | "seat_note" | "wording_variable";

export interface AgentDecisionOpts {
  /** Whether the Anchor has recorded its approval of AI agents (personal data reads). */
  applicantDataOpen?: boolean;
  /** Whether the village has turned on `agents.lead_approved_writes`. */
  leadApprovedWrites?: boolean;
}

/**
 * Game variables an agent may write under the opt-in: pure wording, or a switch that moves no money and changes
 * no power. A key is added here by a reviewed code change, never by a list edit.
 */
export const AGENT_WORDING_VARIABLES: readonly string[] = [
  "org.start_after_confidentiality",
  "org.start_after_membership",
  "org.start_after_paid_terms",
  "org.apply_needs_complete_card",
  "org.applicant_reply_days",
  "org.ccos_terms",
];

export interface LeadApprovedEntry {
  kind: LeadApprovedKind;
  method: AdminMethod;
  path: string;
  lifts: readonly LiftableRule[];
  /** A further test on the concrete path, for an entry narrower than its pattern. */
  when?: (segments: readonly string[]) => boolean;
}

export const LEAD_APPROVED_WRITES: readonly LeadApprovedEntry[] = [
  // a. A role card's words: create and update. The body is held to ROLE_CARD_TEXT_KEYS.
  { kind: "role_text", method: "POST", path: "/api/admin/org/roles", lifts: ["powers"] },
  { kind: "role_text", method: "PUT", path: "/api/admin/org/roles/:id", lifts: ["powers"] },
  // The role card's own editor. No rule refuses its path; its body is checked with the switch on or off, so pay stays out.
  { kind: "role_edit", method: "POST", path: "/api/org/role-edit/:id", lifts: [] },
  // A draft of the org chart, terms on offer included, with publishing still a person's (tier_c is not lifted).
  { kind: "role_draft", method: "POST", path: "/api/admin/org/drafts", lifts: ["powers"] },
  { kind: "role_draft", method: "POST", path: "/api/admin/org/drafts/:id/changes", lifts: ["powers"] },
  { kind: "role_draft", method: "PUT", path: "/api/admin/org/drafts/:id/vision", lifts: ["powers"] },
  // b. Seating and unseating a person, with the lead's approval in the body.
  { kind: "seat", method: "POST", path: "/api/admin/org/roles/:id/holders", lifts: ["powers", "tier_c"] },
  { kind: "unseat", method: "DELETE", path: "/api/admin/org/seatings/:id", lifts: ["powers", "tier_c"] },
  // The focus and note on a live seating, which leaves the holder and the term alone.
  { kind: "seat_note", method: "PATCH", path: "/api/admin/org/seatings/:id", lifts: ["powers", "tier_c"] },
  // c. The wording and the non-money switches among the game variables, by name.
  { kind: "wording_variable", method: "PUT", path: "/api/admin/variables/:key", lifts: ["settings"], when: (s) => AGENT_WORDING_VARIABLES.includes(s[s.length - 1] ?? "") },
];

/** The lead-approved entry a concrete call falls under, or null. Pure; says nothing about the opt-in. */
export function leadApprovedEntry(method: string, path: string): LeadApprovedEntry | null {
  const m = String(method ?? "").toUpperCase();
  const segs = segmentsOf(path);
  if (!segs) return null;
  return LEAD_APPROVED_WRITES.find((e) => e.method === m && pathMatches(e.path, path) && (!e.when || e.when(segs))) ?? null;
}

/** The body keys a direct role write may carry: words and listing details. Anything else is refused by name. */
export const ROLE_CARD_TEXT_KEYS: readonly string[] = [
  "id", "name", "circleId", "aim", "domain", "whyItMatters", "accountabilities", "seats", "recruiting", "listed",
  "authority", "firstYearOutcomes", "first90DayOutcomes", "locationExpectations", "compensationReality",
  "evidenceRequired", "howChosen", "howChosenGloss", "icon", "color", "order", "archetypes", "statusOverride",
  "statusOverrideDays", "villageGoals", "track", "selectionCriteria", "conversations", "conversationMode",
  "whereWorked", "languages", "reviewAfterDays", "accessBundle", "bookingUrl",
];

/** Keys that carry money or power, refused in a draft's payload and the role editor's details. */
const MONEY_OR_POWER_KEY = /value|cash|pay|budget|funded|capabilit|power|grantsAdmin|admin|badge|veto/i;
/** The terms-on-offer groups that record money (MONEY_GROUPS in shared/seatSettings.ts). */
const TERMS_MONEY_GROUPS = ["pay", "allowance", "bonus"];
const DRAFT_OPS = ["create_seat", "update_seat"];

/** What the platform knows about the seat a seating or unseating reaches, read fresh at each call. */
export interface LeadSeatFacts {
  /** False when there is no such role, or no live seating with that id. */
  found: boolean;
  /** The role the seat is, for the record. */
  roleId?: string | null;
  isExample: boolean;
  /** Every capability the seat's linked power groups carry. */
  capabilities: readonly string[];
  /** Whether a linked power group opens the admin panel. */
  grantsAdmin: boolean;
  /** For an unseating: the seating is an agent's. */
  seatingIsAgent?: boolean;
  /** For an unseating: who holds it, so an agent never unseats itself. */
  seatingUserId?: string | null;
}

/**
 * The fields an approval carries in the body of EVERY lead-approved write (role card words, org drafts, the wording
 * variables, seating and unseating). Stripped before the route sees the body, and kept as the record: one admin-only
 * audit event and one record sent to the village's organisational memory (server/lib/agentLeadApproval.ts).
 *
 * The lead, 11 Nov 2026: "ensure that agents are acting as people with their permission and agreement in Claude so
 * it's all recorded here in Claude and in Sera." The connector acts as the person who connected it; the approval says
 * which person agreed to this one change, in their own words.
 */
export const APPROVAL_FIELDS = ["approvedBy", "approvalNote"] as const;

export const LEAD_APPROVAL_WORDS = {
  approval:
    "Every lead-approved write through the connector carries the approval: approvedBy (who approved it) and approvalNote (their approval in the chat, quoted or summed up). Ask them, then send it again with both.",
  agentSeat: "Seating or unseating an agent is a person's act in the app.",
  self: "An agent never seats or unseats itself.",
  missingSeat: "There is no such role or live seating to change.",
  example: "A standing example is never changed through the connector.",
  ungrantable:
    "This role carries a power a badge may never carry (the steward's veto and the break-glass among them), or it opens the admin panel. The village fills it by its own vote, and a person does it.",
  variable: "That game variable is not one an agent may set. A person sets it in Admin, Variables.",
  draftOp: "An agent may draft a role's creation or its words. Other draft changes are a person's to make.",
} as const;

/** The approval a seating or unseating carries, read and checked. */
export function readLeadApproval(body: Record<string, unknown> | undefined): { ok: true; approvedBy: string; approvalNote: string } | { ok: false; words: string } {
  const by = typeof body?.approvedBy === "string" ? body.approvedBy.replace(/\s+/g, " ").trim() : "";
  const note = typeof body?.approvalNote === "string" ? body.approvalNote.trim() : "";
  if (by.length < 2 || by.length > 120 || note.length < 4 || note.length > 2000) return { ok: false, words: LEAD_APPROVAL_WORDS.approval };
  return { ok: true, approvedBy: by, approvalNote: note };
}

/** The body as the route should see it: the approval fields taken out. */
export function withoutApproval(body: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body ?? {}) };
  for (const k of APPROVAL_FIELDS) delete out[k];
  return out;
}

/** The seat a seating or unseating names: the role id, or the seating id. */
export function leadSeatTarget(kind: LeadApprovedKind, path: string): { roleId: string } | { seatingId: string } | null {
  const segs = segmentsOf(path);
  if (!segs) return null;
  if (kind === "seat") return { roleId: segs[4] ?? "" };
  if (kind === "unseat" || kind === "seat_note") return { seatingId: segs[4] ?? "" };
  return null;
}

/**
 * THE BODY HALF OF THE GATE, for a call `adminRequestDecision` marked lead-approved. Null when the write may go
 * ahead; the sentence saying why when it may not. Pure: the seat's facts are read by the caller and passed in.
 */
export function leadApprovedBodyProblem(
  kind: LeadApprovedKind,
  path: string,
  body: Record<string, unknown> | undefined,
  ctx: {
    holderId?: string | null;
    seat?: LeadSeatFacts | null;
    /**
     * Whether this write must carry the approval. True unless the caller says otherwise: the one exception is the
     * role editor with the village's switch off, which agents could already reach before the switch existed.
     */
    approvalRequired?: boolean;
  } = {},
): string | null {
  // The approval first, for every kind: a write the switch made possible never goes ahead unattributed.
  if (ctx.approvalRequired !== false) {
    const approval = readLeadApproval(body);
    if (!approval.ok) return approval.words;
  }
  const b = withoutApproval(body);
  const keys = Object.keys(b);
  switch (kind) {
    case "role_text": {
      const bad = keys.filter((k) => !ROLE_CARD_TEXT_KEYS.includes(k));
      return bad.length ? `An agent writes a role's words and listing details. These stay a person's: ${bad.slice(0, 8).join(", ")}.` : null;
    }
    case "role_edit": {
      const bad = keys.filter((k) => !["words", "parameters", "archetypes"].includes(k));
      const params = b.parameters && typeof b.parameters === "object" && !Array.isArray(b.parameters) ? Object.keys(b.parameters) : [];
      bad.push(...params.filter((k) => MONEY_OR_POWER_KEY.test(k)).map((k) => `parameters.${k}`));
      return bad.length ? `An agent writes a role's words and listing details. These stay a person's: ${bad.slice(0, 8).join(", ")}.` : null;
    }
    case "role_draft": {
      if (!path.endsWith("/changes")) return null;
      if (!DRAFT_OPS.includes(String(b.op ?? ""))) return LEAD_APPROVAL_WORDS.draftOp;
      const payload = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
      const bad = Object.keys(payload).filter((k) => k !== "termsOffer" && MONEY_OR_POWER_KEY.test(k));
      const terms = payload.termsOffer;
      if (terms && typeof terms === "object" && !Array.isArray(terms)) {
        bad.push(...Object.keys(terms).filter((g) => TERMS_MONEY_GROUPS.includes(g)).map((g) => `termsOffer.${g}`));
      } else if (terms !== undefined && terms !== null) {
        bad.push("termsOffer");
      }
      return bad.length ? `An agent drafts a role's words and the wording of its terms. Money and powers stay a person's: ${bad.slice(0, 8).join(", ")}.` : null;
    }
    case "seat":
    case "unseat":
    case "seat_note": {
      // Seating always carries the approval, whatever the caller asked.
      const approval = readLeadApproval(body);
      if (!approval.ok) return approval.words;
      if (b.isAgent || b.agentSlug) return LEAD_APPROVAL_WORDS.agentSeat;
      if (kind === "seat_note") {
        const bad = keys.filter((k) => k !== "focus" && k !== "note");
        if (bad.length) return `An agent changes a seating's focus and note. Nothing else on it: ${bad.slice(0, 8).join(", ")}.`;
      }
      const seat = ctx.seat;
      if (!seat || !seat.found) return LEAD_APPROVAL_WORDS.missingSeat;
      if (seat.isExample) return LEAD_APPROVAL_WORDS.example;
      if ((kind === "unseat" || kind === "seat_note") && seat.seatingIsAgent) return LEAD_APPROVAL_WORDS.agentSeat;
      const who = kind === "seat" ? (typeof b.userId === "string" ? b.userId : null) : seat.seatingUserId ?? null;
      if (ctx.holderId && who === ctx.holderId) return LEAD_APPROVAL_WORDS.self;
      if (seat.grantsAdmin || seat.capabilities.some((c) => !isBadgeGrantable(c) || c === BREAK_GLASS_SEAT)) return LEAD_APPROVAL_WORDS.ungrantable;
      return null;
    }
    case "wording_variable": {
      const segs = segmentsOf(path) ?? [];
      return AGENT_WORDING_VARIABLES.includes(segs[segs.length - 1] ?? "") ? null : LEAD_APPROVAL_WORDS.variable;
    }
  }
}

/** What one lead-approved write changed, said without any member's personal data: names of fields, never values. */
export interface LeadApprovalSubject {
  /** A short sentence: "Changed a role card's words". */
  what: string;
  /** The role, draft or variable it reached, by id or key; null when the call names none. */
  target: string | null;
  /** The field names the write carried (approval fields and member ids left out). */
  changed: string[];
}

const keysOf = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object) : []);
const idLike = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

/** The record's subject for one lead-approved write. Pure. */
export function leadApprovalSubject(kind: LeadApprovedKind, path: string, body: Record<string, unknown> | undefined, seatRoleId?: string | null): LeadApprovalSubject {
  const segs = segmentsOf(path) ?? [];
  const b = withoutApproval(body);
  const top = Object.keys(b).filter((k) => k !== "userId");
  switch (kind) {
    case "role_text":
      return segs.length > 4
        ? { what: "Changed a role card's words", target: segs[4] ?? null, changed: top }
        : { what: "Created a role card", target: idLike(b.id) ?? idLike(b.name), changed: top };
    case "role_edit": {
      const nested = [...keysOf(b.words).map((k) => `words.${k}`), ...keysOf(b.parameters).map((k) => `parameters.${k}`)];
      return { what: "Changed a role's words in the role editor", target: segs[3] ?? null, changed: [...top.filter((k) => k !== "words" && k !== "parameters"), ...nested] };
    }
    case "role_draft":
      if (path.endsWith("/changes")) {
        return { what: `Drafted a role change (${String(b.op ?? "change").slice(0, 24)})`, target: idLike(b.orgRoleId) ?? segs[4] ?? null, changed: keysOf(b.payload) };
      }
      if (path.endsWith("/vision")) return { what: "Wrote an org chart draft's vision", target: segs[4] ?? null, changed: top };
      return { what: "Started an org chart draft", target: idLike(b.title), changed: top };
    case "seat":
      return { what: "Seated a member in a role", target: seatRoleId ?? segs[4] ?? null, changed: [] };
    case "unseat":
      return { what: "Ended a seating", target: seatRoleId ?? null, changed: [] };
    case "seat_note":
      return { what: "Changed a seating's note", target: seatRoleId ?? null, changed: top.filter((k) => k === "focus" || k === "note") };
    case "wording_variable":
      return { what: "Set a wording variable", target: segs[segs.length - 1] ?? null, changed: ["value"] };
  }
}

// ── PASTING A LIST IN THE PANEL ──────────────────────────────────────────────

export interface PastedPathsPlan {
  /** The whole list as it would be saved: every path already there, then the new ones. */
  merged: AllowedAdminPath[];
  added: AllowedAdminPath[];
  changed: Array<{ before: AllowedAdminPath; after: AllowedAdminPath }>;
  unchanged: number;
}

/**
 * A pasted list merged into the list on screen, by method and path, for Admin, Agents, "Paste a list".
 *
 * Nothing already on the list is ever dropped: a pasted path that is there already replaces its confirm and label,
 * and a new one is added at the end. The pasted list is read by the save parser itself, so a path the save would
 * refuse is refused here with the same reason, and the merged list is read again, which catches the hundred-path
 * limit. Pure; the person still presses Save, and the server reads it a third time.
 */
export function mergePastedAgentPaths(
  current: readonly AllowedAdminPath[],
  pasted: unknown,
  opts: { leadApprovedWrites?: boolean } = {},
): { ok: true; plan: PastedPathsPlan } | { ok: false; error: string } {
  let raw = pasted;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: "That is not JSON. Paste a list shaped like {\"paths\": [...]}." };
    }
  }
  if (Array.isArray(raw)) raw = { paths: raw };
  const read = parseAgentAdminPaths(raw, opts);
  if (!read.ok) return { ok: false, error: `In the pasted list: ${read.error}` };
  const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
  const merged = current.map((e) => ({ ...e }));
  const added: AllowedAdminPath[] = [];
  const changed: PastedPathsPlan["changed"] = [];
  let unchanged = 0;
  for (const e of read.value.paths) {
    const at = merged.findIndex((x) => key(x) === key(e));
    if (at < 0) {
      if (!added.some((x) => key(x) === key(e))) {
        merged.push(e);
        added.push(e);
      }
      continue;
    }
    const before = merged[at];
    if (before.confirm === e.confirm && before.label === e.label) {
      unchanged++;
      continue;
    }
    merged[at] = e;
    changed.push({ before, after: e });
  }
  const whole = parseAgentAdminPaths({ paths: merged }, opts);
  if (!whole.ok) return { ok: false, error: `With the pasted paths added: ${whole.error}` };
  return { ok: true, plan: { merged, added, changed, unchanged } };
}
