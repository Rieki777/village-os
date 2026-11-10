/**
 * The access bundle a role card lists: what a holder is given access to.
 *
 * The card names the ITEMS ("shared drive for the finance circle", "bank
 * portal, view only"). It never holds the way in. No credential, username,
 * password, token or token-bearing link is stored anywhere; a person who
 * grants access does it in the tool itself, and the task here only records
 * that it was done. Credential-shaped text is refused at the door.
 */
export const ACCESS_ITEM_MAX = 20;
export const ACCESS_LABEL_MAX = 120;

export interface AccessItem {
  /** Stable key, derived from the label, so a task is raised once per item. */
  key: string;
  label: string;
  /** The role that grants it. Null means the admins are asked. */
  grantingRoleId: string | null;
}

const CREDENTIAL_WORDS =
  /\b(pass(word|wd|phrase)?|pwd|passcode|secret|api[ _-]?key|token|bearer|username|user ?name|login|credentials?|private key|seed phrase|2fa code|otp)\b\s*[:=]/i;
const KNOWN_PREFIXES =
  /\b(sk[-_][a-z0-9]{8,}|pk[-_]live|ghp_[A-Za-z0-9]{10,}|github_pat_|xox[abprs]-|AKIA[0-9A-Z]{8,}|eyJ[A-Za-z0-9_-]{10,}|ya29\.|AIza[0-9A-Za-z_-]{10,})/;
const LONG_OPAQUE = /[A-Za-z0-9+/_=-]{24,}/;
const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Why a string cannot be a bundle item, or null when it is fine. */
export function credentialProblem(text: string): string | null {
  const s = String(text ?? "");
  if (CREDENTIAL_WORDS.test(s)) return "Name the access, never the credential. Passwords, usernames and tokens are not stored here.";
  if (KNOWN_PREFIXES.test(s)) return "That looks like a key or token. Name the access instead.";
  if (EMAIL_RE.test(s)) return "That looks like an account name. Name the access instead.";
  for (const u of s.match(URL_RE) ?? []) {
    try {
      const url = new URL(u);
      if (url.username || url.password || url.search || url.hash) {
        return "A link that carries a token or a query cannot be stored. Name the access instead.";
      }
    } catch {
      return "That link cannot be read. Name the access instead.";
    }
  }
  if (LONG_OPAQUE.test(s.replace(URL_RE, ""))) return "That looks like a key or token. Name the access instead.";
  return null;
}

const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export type BundleResult = { ok: true; items: AccessItem[] } | { ok: false; error: string };

/** Validate what an editor sent. Strict: the first bad item refuses the whole list. */
export function parseAccessBundle(raw: unknown): BundleResult {
  let v: unknown = raw;
  if (typeof v === "string") {
    if (!v.trim()) return { ok: true, items: [] };
    try {
      v = JSON.parse(v);
    } catch {
      return { ok: false, error: "The access list could not be read." };
    }
  }
  if (v == null) return { ok: true, items: [] };
  if (!Array.isArray(v)) return { ok: false, error: "The access list must be a list." };
  if (v.length > ACCESS_ITEM_MAX) return { ok: false, error: `At most ${ACCESS_ITEM_MAX} items.` };
  const items: AccessItem[] = [];
  const seen = new Set<string>();
  for (const e of v) {
    const label = String(typeof e === "string" ? e : (e as any)?.label ?? "").trim();
    if (!label) return { ok: false, error: "Each item needs a name." };
    if (label.length > ACCESS_LABEL_MAX) return { ok: false, error: `An item name is at most ${ACCESS_LABEL_MAX} characters.` };
    const bad = credentialProblem(label);
    if (bad) return { ok: false, error: bad };
    const key = keyOf(label);
    if (!key) return { ok: false, error: "Each item needs a name." };
    if (seen.has(key)) continue;
    seen.add(key);
    const g = typeof e === "object" && e ? String((e as any).grantingRoleId ?? "").trim() : "";
    items.push({ key, label, grantingRoleId: g ? g.slice(0, 64) : null });
  }
  return { ok: true, items };
}

/** Lenient read for a stored value: a bad stored item is dropped, never thrown. */
export function readAccessBundle(raw: unknown): AccessItem[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: AccessItem[] = [];
  for (const e of v) {
    const r = parseAccessBundle([e]);
    if (r.ok) out.push(...r.items);
  }
  return out;
}

export const ACCESS_STATES = ["open", "done", "not_needed"] as const;
export type AccessState = (typeof ACCESS_STATES)[number];
