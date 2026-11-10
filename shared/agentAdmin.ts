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
export const ALWAYS_A_PERSON: ReadonlyArray<{ key: string; words: string; test: (method: string, path: string) => boolean }> = [
  {
    key: "erasure",
    words: "Erasing or anonymising a member is always a person's act.",
    test: (m, p) => /anonymi[sz]|erase|erasure|forget/i.test(p) || (m === "DELETE" && /^\/api\/admin\/(players|users|members)\/[^/]+$/.test(p)),
  },
  {
    key: "powers",
    words: "Power handover, the break-glass, power groups and capabilities are always a person's act.",
    test: (_m, p) => /power|break-?glass|override|capabilit|badge|handover|veto|steward|admin-access|governance|\/org\/(drafts|seatings|roles)|\/roles(\/|$)|\/stages?(\/|$)/i.test(p),
  },
  {
    key: "money",
    words: "Payers, pay routes, and the moon review's approvals, invoices and payments are always a person's act.",
    test: (_m, p) =>
      /payer|pay-?route|\/pay(\/|$)|invoice|payout|payment|cash|settle|ledger|wallet|treasury|exchange|mint|approv|refund|\/comps?(\/|$)|purchase|budget|\/cycles?(\/|$)|economy|owed|\/api\/admin\/tokens|token-jobs|\/moon-review\/(?!rhythm$)/i.test(p),
  },
  {
    key: "members",
    words: "Letting a member in, a member leaving, and removing one are always a person's act.",
    test: (_m, p) => /join-?requests?|\/exits?(\/|$|-)|hard-?delete|invit/i.test(p),
  },
  {
    key: "settings",
    words: "Sending letters and email, and the village's modules, variables and settings, are always a person's act.",
    test: (_m, p) => /\/letters?(\/|$)|\/send(\/|$)|email-?config|\/comms(\/|$)|\/modules?(\/|$)|variables|settings|\/brand(\/|$)|\/launch(\/|$)/i.test(p),
  },
  {
    // Role journey L13, tier C: the acts a machine only ever proposes. Adopting an application, seating, publishing a draft,
    // sending a first reply or a decision letter, and setting a role's pay or terms (the 24 Sept ruling: a person or a vote adopts).
    key: "tier_c",
    words: "Adopting, seating, publishing, changing powers, sending, setting pay or terms, inviting and erasing are always a person's act. A connector proposes them and a person does them.",
    test: (_m, p) => /adopt|seat-?claims?|seatings?|publish|first-?repl|decision-?letter|role-?pay|\/terms?(\/|$)|terms-?offer|\/hold(s|ers)(\/|$)/i.test(p),
  },
  {
    key: "secrets",
    words: "Secrets and integration keys are always a person's act.",
    test: (_m, p) => /secret|integration|api-?key|credential|\/keys?(\/|$)/i.test(p),
  },
  {
    key: "accounts",
    words: "A member's admin flag, sign-in and sessions are always a person's act.",
    test: (_m, p) => /\/(users|players|members)\/[^/]+\/(role|revoke-sessions|send-password-link|password|email)$/i.test(p),
  },
  {
    key: "agents",
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
export function alwaysAPerson(method: string, path: string, selfUserId?: string | null): { key: string; words: string } | null {
  const m = String(method ?? "").toUpperCase();
  for (const r of ALWAYS_A_PERSON) if (r.test(m, path)) return { key: r.key, words: r.words };
  if (selfUserId && path.split("/").includes(selfUserId)) {
    return { key: "agents", words: "An agent never acts on its own account through the connector." };
  }
  return null;
}

export type AdminRequestDecision =
  | { ok: true; entry: AllowedAdminPath; write: boolean; confirm: AdminConfirm }
  | { ok: false; code: "bad_path" | "always_a_person" | "not_allowed"; words: string };

/** Whether an agent may call `method path` through `admin_request`, and who confirms it. */
export function adminRequestDecision(method: string, path: string, doc: AgentAdminPathsDoc, selfUserId?: string | null): AdminRequestDecision {
  const m = String(method ?? "").toUpperCase();
  if (!(ADMIN_METHODS as readonly string[]).includes(m)) return { ok: false, code: "bad_path", words: `method is one of ${ADMIN_METHODS.join(", ")}.` };
  const bare = String(path ?? "");
  // The path is dispatched exactly as given, so a query string or a fragment is refused, never trimmed.
  if (/[?#%]/.test(bare) || !segmentsOf(bare)) return { ok: false, code: "bad_path", words: "path is a plain path starting with /api/, with no query string and no dots." };
  const person = alwaysAPerson(m, bare, selfUserId);
  if (person) return { ok: false, code: "always_a_person", words: person.words };
  const entry = doc.paths.find((e) => e.method === m && pathMatches(e.path, bare));
  if (!entry) {
    return { ok: false, code: "not_allowed", words: "That admin path is not open to agents in this village. An admin who is a person can add it to the agent paths list." };
  }
  const write = m !== "GET";
  return { ok: true, entry, write, confirm: write ? entry.confirm : "agent" };
}

/** The stored list, checked: a bad document reads as the shipped list, and an entry a person must make is refused. */
export function parseAgentAdminPaths(raw: unknown): { ok: true; value: AgentAdminPathsDoc } | { ok: false; error: string } {
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
    const person = alwaysAPerson(method, path.replace(/:[A-Za-z][A-Za-z0-9]*/g, "x"));
    if (person) return { ok: false, error: `Path ${i + 1}: ${person.words}` };
    const confirm: AdminConfirm = x.confirm === "agent" ? "agent" : "person";
    const label = String(x.label ?? "").trim().slice(0, 120);
    if (!label) return { ok: false, error: `Path ${i + 1}: give it a few words saying what it is for.` };
    out.push({ method: method as AdminMethod, path, confirm, label });
  }
  return { ok: true, value: { paths: out } };
}

/** The list an agent is held to: the stored one when it parses, the shipped one otherwise. */
export function effectiveAgentAdminPaths(stored: unknown): AgentAdminPathsDoc {
  if (stored === null || stored === undefined) return DEFAULT_AGENT_ADMIN_PATHS;
  const parsed = parseAgentAdminPaths(stored);
  return parsed.ok ? parsed.value : DEFAULT_AGENT_ADMIN_PATHS;
}
