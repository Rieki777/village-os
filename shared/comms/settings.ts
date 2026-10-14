/**
 * THE COMMS SETTINGS DOCUMENT: what a founder supplies to make the village's
 * email work that is neither a dial nor a secret (the comms build spec 5.15
 * and 5.18). Rye, 2026-10-02: every founder of every village adds these and
 * edits them later, from Comms Settings, in plain words.
 *
 * WHERE EACH FACT LIVES, so nothing is kept twice:
 *
 *   the provider key, the delivery-report secret   the secrets store
 *   the From address and the four path inboxes      the `email-config` document
 *   the dials (quiet hours, caps, retention...)     game variables, `comms.*`
 *   everything below                                this document, `comms-settings`
 *
 * A STORED DOCUMENT NEVER MERGES NEW DEFAULTS BY ITSELF. A village that saved
 * its postal address in one release holds a row with that one field, and a
 * field added in the next release is absent from it. So every reader goes
 * through `backfillCommsSettings`, which fills each missing or unreadable field
 * with its default on the way out and never writes anything back. The row
 * keeps only what somebody chose, which is what lets a village that never
 * touched the consent words inherit better ones in a later release.
 *
 * ONLY WHAT WAS CHANGED IS EVER WRITTEN. `validateCommsSettingsPatch` turns an
 * edit into an RFC 7396 merge patch: a field set to `null` there is REMOVED
 * from the stored row and reads as its default again, which is how "use the
 * platform's words" works. The server applies the patch in one statement
 * (server/repos/commsSettings.ts), so two founders saving different fields at
 * the same moment cannot undo each other, and Pause all cannot be lost to a
 * neighbour's save.
 *
 * Pure and isomorphic: the client reads the same defaults and the same rules
 * the server enforces.
 */
import { addressProblem, emailKeyOf } from "./address";

/** The `app_config` key the document is stored under. */
export const COMMS_SETTINGS_KEY = "comms-settings";

/**
 * The words beside the tick-box on every public form that feeds a path (the
 * comms build spec 5.11). Unticked means the acknowledgement only.
 */
export const DEFAULT_CONSENT_TEXT =
  "Walk me through the next steps by email. A few emails over the next month, and you can stop any time.";

/**
 * The two questions every recap carries (5.9). The first is answered yes or
 * no with one click; the second with a few words in a text box.
 */
export const DEFAULT_RECAP_QUESTIONS: readonly [string, string] = [
  "Would you come to the next one?",
  "What would make the next one better?",
];

/** Who read the investor path's words and said they may go, and when. */
export interface InvestorWordsReview {
  by: string;
  at: string;
}

export interface CommsSettings {
  /** The name people see beside the From address. The address itself lives in `email-config.sender`. */
  senderName: string;
  /** The sending domain, lowercased, or "" when none has been added. */
  domain: string;
  /** The provider's id for that domain, or "" when it was added by hand with a key that cannot manage domains. */
  domainId: string;
  /**
   * What the provider last said about the domain: `verified`, `pending`,
   * `not_started`, `failed` and the rest, as it names them. `none` when there
   * is no domain, `unknown` when nothing could ask.
   */
  domainStatus: string;
  /** When that status was last read, as an ISO instant. */
  domainCheckedAt: string | null;
  /**
   * Set only when a person confirmed the domain by hand, because the key in
   * use cannot read domains. Their name, so the record says who vouched.
   */
  domainConfirmedBy: string | null;
  /** The postal address in every email's footer. */
  postalAddress: string;
  /** The words beside the tick-box on public forms. */
  consentText: string;
  /** The two questions a recap asks. */
  recapQuestions: [string, string];
  /** Path id to the user id of the person who writes back for it. */
  pathContacts: Record<string, string>;
  /** Until this is set, the investor journey sends only its welcome and its hand-off (5.11). */
  investorWordsReviewed: InvestorWordsReview | null;
  /** Who receives every rehearsal email. Empty means the admins. */
  rehearsalTo: string[];
  /** Pause all: holds every kind of email except essential mail and member notices (5.16). */
  paused: boolean;
  /** When delivery reports were connected, as an ISO instant. */
  webhookConnectedAt: string | null;
  /** Who connected them. */
  webhookConnectedBy: string | null;
  /** The provider's id for the webhook when the button made it; null when the secret was pasted by hand. */
  webhookId: string | null;
}

export const DEFAULT_COMMS_SETTINGS: Readonly<CommsSettings> = Object.freeze({
  senderName: "",
  domain: "",
  domainId: "",
  domainStatus: "none",
  domainCheckedAt: null,
  domainConfirmedBy: null,
  postalAddress: "",
  consentText: DEFAULT_CONSENT_TEXT,
  recapQuestions: [DEFAULT_RECAP_QUESTIONS[0], DEFAULT_RECAP_QUESTIONS[1]] as [string, string],
  pathContacts: {},
  investorWordsReviewed: null,
  rehearsalTo: [],
  paused: false,
  webhookConnectedAt: null,
  webhookConnectedBy: null,
  webhookId: null,
});

export const SENDER_NAME_MAX = 100;
export const POSTAL_ADDRESS_MAX = 500;
export const CONSENT_TEXT_MIN = 10;
export const CONSENT_TEXT_MAX = 400;
export const RECAP_QUESTION_MAX = 200;
export const REHEARSAL_MAX = 10;

/** A string that is really there, or null. */
function text(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

/** An ISO-looking instant, or null. Anything else in the column reads as never. */
function instant(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return Number.isFinite(Date.parse(v)) ? v : null;
}

/** A provider's status word, kept to the letters it is made of. */
export function sanitizeDomainStatus(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z_]/g, "").slice(0, 32) : "";
  return s || "unknown";
}

/** Valid addresses, one per person, at most `REHEARSAL_MAX`. */
function addressList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const a = raw.trim();
    if (addressProblem(a) !== null) continue;
    const key = emailKeyOf(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= REHEARSAL_MAX) break;
  }
  return out;
}

/**
 * The stored document with every missing or unreadable field filled from its
 * default. Never throws, never writes: a corrupt field reads as its default,
 * which is a better failure than a settings screen that will not open.
 */
export function backfillCommsSettings(stored: unknown): CommsSettings {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const d = DEFAULT_COMMS_SETTINGS;

  const recap = Array.isArray(s.recapQuestions) ? s.recapQuestions : [];
  const question = (i: 0 | 1): string => {
    const q = text(recap[i], RECAP_QUESTION_MAX);
    return q && q.trim() ? q : DEFAULT_RECAP_QUESTIONS[i];
  };

  const contacts: Record<string, string> = {};
  if (s.pathContacts && typeof s.pathContacts === "object" && !Array.isArray(s.pathContacts)) {
    for (const [pathId, userId] of Object.entries(s.pathContacts as Record<string, unknown>)) {
      if (typeof userId === "string" && userId.trim()) contacts[pathId] = userId.trim();
    }
  }

  const review = s.investorWordsReviewed as Record<string, unknown> | null | undefined;
  const reviewed =
    review && typeof review === "object" && typeof review.by === "string" && review.by.trim() && instant(review.at)
      ? { by: review.by.trim(), at: String(review.at) }
      : null;

  const consent = text(s.consentText, CONSENT_TEXT_MAX);
  const domain = text(s.domain, 253)?.trim().toLowerCase() ?? "";

  return {
    senderName: text(s.senderName, SENDER_NAME_MAX)?.trim() ?? d.senderName,
    domain,
    domainId: text(s.domainId, 128)?.trim() ?? d.domainId,
    domainStatus: domain ? sanitizeDomainStatus(s.domainStatus) : "none",
    domainCheckedAt: instant(s.domainCheckedAt),
    domainConfirmedBy: text(s.domainConfirmedBy, 255)?.trim() || null,
    postalAddress: text(s.postalAddress, POSTAL_ADDRESS_MAX) ?? d.postalAddress,
    consentText: consent && consent.trim() ? consent : DEFAULT_CONSENT_TEXT,
    recapQuestions: [question(0), question(1)],
    pathContacts: contacts,
    investorWordsReviewed: reviewed,
    rehearsalTo: addressList(s.rehearsalTo),
    paused: s.paused === true,
    webhookConnectedAt: instant(s.webhookConnectedAt),
    webhookConnectedBy: text(s.webhookConnectedBy, 255)?.trim() || null,
    webhookId: text(s.webhookId, 128)?.trim() || null,
  };
}

// ── The setup checklist's vocabulary ────────────────────────────────────────

/**
 * The thirteen items of the setup checklist, in the spec's order (5.15). The
 * rules that answer each one are server/lib/comms/setup.ts; the keys live here
 * so the Settings screen keys its editors by this union and the compiler
 * refuses an item with no editor.
 */
export const SETUP_KEYS = [
  "api-key",
  "domain",
  "sender",
  "delivery-reports",
  "postal-address",
  "reply-to",
  "path-contacts",
  "consent-words",
  "recap-questions",
  "who-runs-comms",
  "investor-words",
  "rehearsal-inbox",
  "test-email",
] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

/** Items 1 to 5 and 13: what "ready to turn on" means (5.16). */
export const REQUIRED_SETUP_KEYS: readonly SetupKey[] = [
  "api-key",
  "domain",
  "sender",
  "delivery-reports",
  "postal-address",
  "test-email",
];

/** One checklist item, as the server answers it. */
export interface SetupItem {
  key: SetupKey;
  /** The item's number in the spec's table, 1 to 13. */
  n: number;
  label: string;
  done: boolean;
  required: boolean;
  /** What is true right now, in a sentence. */
  detail: string;
  /** What to do next, in a sentence. */
  fix: string;
}

/** The fields a person edits through `PUT /api/admin/comms/settings`. The rest are written by the server. */
export const PERSON_SETTINGS_FIELDS = [
  "postalAddress",
  "consentText",
  "recapQuestions",
  "pathContacts",
  "rehearsalTo",
  "paused",
  "investorWordsReviewed",
] as const;
export type PersonSettingsField = (typeof PERSON_SETTINGS_FIELDS)[number];

/** Why a sender name cannot go in a From line, or null when it can. */
export function senderNameProblem(name: string): string | null {
  const n = String(name ?? "").trim();
  if (!n) return "Give the sender a name, such as your village's name.";
  if (n.length > SENDER_NAME_MAX) return `Keep the sender name under ${SENDER_NAME_MAX} characters.`;
  // These break the From header, or turn one sender into two.
  if (/[<>"\\,;\u0000-\u001f]/.test(n)) return "The sender name cannot hold < > \" \\ , or ; characters.";
  return null;
}

/**
 * A domain as somebody types or pastes it, cleaned: lowercased, with a pasted
 * `https://`, a path, or a leading `@` taken off.
 */
export function normalizeDomain(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

/** Why this is not a domain the village can send from, or null when it is. */
export function domainProblem(domain: string): string | null {
  const d = normalizeDomain(domain);
  if (!d) return "Type the domain your email will come from, such as example.org.";
  if (d.length > 253) return "That domain is too long.";
  const labels = d.split(".");
  if (labels.length < 2) return "A sending domain has at least one dot, such as example.org.";
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) {
    return "That does not look like a domain. Use letters, numbers, dots and hyphens, such as example.org.";
  }
  return null;
}

/** True when the address is on the domain, compared without case. */
export function addressOnDomain(address: string, domain: string): boolean {
  const a = String(address ?? "").trim().toLowerCase();
  const d = normalizeDomain(domain);
  if (!a || !d) return false;
  return a.slice(a.lastIndexOf("@") + 1) === d;
}

export type PatchAnswer =
  | { ok: true; patch: Record<string, unknown>; changed: PersonSettingsField[] }
  | { ok: false; error: string };

/**
 * A person's edit, checked and turned into a merge patch. Refuses a field it
 * does not know by name, because a typo silently ignored is a save that lies.
 *
 * `null` in the patch means "back to the default": an empty consent text, a
 * reset pair of recap questions, an empty rehearsal list (the admins), and a
 * cleared investor review all remove their key.
 */
export function validateCommsSettingsPatch(
  input: unknown,
  ctx: { pathIds: readonly string[]; reviewer?: string | null; now?: Date },
): PatchAnswer {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Send the settings to change as an object." };
  }
  const body = input as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const changed: PersonSettingsField[] = [];

  for (const field of Object.keys(body)) {
    if (!(PERSON_SETTINGS_FIELDS as readonly string[]).includes(field)) {
      return { ok: false, error: `"${field}" is not a setting this screen can change.` };
    }
  }

  if ("postalAddress" in body) {
    if (typeof body.postalAddress !== "string") return { ok: false, error: "The postal address must be words." };
    const a = body.postalAddress.trim();
    if (a.length > POSTAL_ADDRESS_MAX) return { ok: false, error: `Keep the postal address under ${POSTAL_ADDRESS_MAX} characters.` };
    patch.postalAddress = a;
    changed.push("postalAddress");
  }

  if ("consentText" in body) {
    if (body.consentText !== null && typeof body.consentText !== "string") {
      return { ok: false, error: "The tick-box words must be words." };
    }
    const t = String(body.consentText ?? "").trim();
    if (t && t.length < CONSENT_TEXT_MIN) return { ok: false, error: "The tick-box words are too short to tell anybody what they agree to." };
    if (t.length > CONSENT_TEXT_MAX) return { ok: false, error: `Keep the tick-box words under ${CONSENT_TEXT_MAX} characters.` };
    patch.consentText = t ? t : null;
    changed.push("consentText");
  }

  if ("recapQuestions" in body) {
    if (body.recapQuestions === null) {
      patch.recapQuestions = null;
    } else {
      const q = body.recapQuestions;
      if (!Array.isArray(q) || q.length !== 2 || !q.every((x) => typeof x === "string")) {
        return { ok: false, error: "Send exactly two recap questions." };
      }
      const pair = q.map((x) => String(x).trim());
      if (pair.some((x) => !x)) return { ok: false, error: "Both recap questions need words. Use the platform's to start again." };
      if (pair.some((x) => x.length > RECAP_QUESTION_MAX)) {
        return { ok: false, error: `Keep each recap question under ${RECAP_QUESTION_MAX} characters.` };
      }
      patch.recapQuestions = pair;
    }
    changed.push("recapQuestions");
  }

  if ("pathContacts" in body) {
    const c = body.pathContacts;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return { ok: false, error: "Send who writes back for each path as a list by path." };
    }
    const next: Record<string, string | null> = {};
    for (const [pathId, userId] of Object.entries(c as Record<string, unknown>)) {
      if (!ctx.pathIds.includes(pathId)) return { ok: false, error: `This village has no path called "${pathId}".` };
      if (userId !== null && typeof userId !== "string") return { ok: false, error: "Each path's contact must be one member." };
      const id = String(userId ?? "").trim();
      next[pathId] = id ? id : null;
    }
    patch.pathContacts = next;
    changed.push("pathContacts");
  }

  if ("rehearsalTo" in body) {
    const r = body.rehearsalTo;
    if (!Array.isArray(r) || !r.every((x) => typeof x === "string")) {
      return { ok: false, error: "Send the rehearsal inbox as a list of addresses." };
    }
    const typed = r.map((x) => String(x).trim()).filter((x) => x);
    const bad = typed.find((a) => addressProblem(a) !== null);
    if (bad) return { ok: false, error: `"${bad}" does not look like an email address.` };
    const list = addressList(typed);
    if (typed.length > REHEARSAL_MAX) return { ok: false, error: `At most ${REHEARSAL_MAX} addresses receive rehearsals.` };
    patch.rehearsalTo = list.length ? list : null;
    changed.push("rehearsalTo");
  }

  if ("paused" in body) {
    if (typeof body.paused !== "boolean") return { ok: false, error: "Pause all is on or off." };
    patch.paused = body.paused;
    changed.push("paused");
  }

  if ("investorWordsReviewed" in body) {
    if (typeof body.investorWordsReviewed !== "boolean") {
      return { ok: false, error: "Say whether the investor words are reviewed, yes or no." };
    }
    if (body.investorWordsReviewed) {
      const by = String(ctx.reviewer ?? "").trim();
      if (!by) return { ok: false, error: "Marking the investor words as reviewed needs a named person." };
      patch.investorWordsReviewed = { by, at: (ctx.now ?? new Date()).toISOString() };
    } else {
      patch.investorWordsReviewed = null;
    }
    changed.push("investorWordsReviewed");
  }

  if (changed.length === 0) return { ok: false, error: "Nothing to change was sent." };
  return { ok: true, patch, changed };
}

/**
 * What one merge patch does to a document, in memory: the same RFC 7396
 * rules the database applies in `JSON_MERGE_PATCH`. The server uses the
 * database's own function; this exists so a test can say what the database
 * is expected to do, and so the client can preview a save.
 */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const base: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete base[k];
    else base[k] = applyMergePatch(base[k], v);
  }
  return base;
}
