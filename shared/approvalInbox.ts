/**
 * THE ONE-TAP APPROVAL INBOX (role journey L13, part A).
 *
 * Everything that stays a person's act becomes a PROPOSAL the connector files,
 * and one inbox where a person approves it. This file is the pure half: the
 * kinds, the seven-day expiry, what can never be filed, and the plain words a
 * card shows.
 *
 * APPROVING IS NOT A SHORTCUT AROUND ANYTHING. The inbox holds the exact call
 * the thing's own admin route takes. A person's Approve runs that call as THEM,
 * through that route and its gates (the capability gate, `requireModule`, the
 * route's own checks), so a person without the power gets the route's refusal.
 * The connector can only file; it holds no call that decides.
 *
 * NEVER FILED. Money, secrets, erasure, invites and power changes can be
 * proposed through no tool. `neverProposable` reads the key, module or page
 * a proposal names, and the filing route refuses at the door.
 */

export const INBOX_KINDS = ["setting", "listing", "page_copy", "map_publish", "seating"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** A proposal that nobody has decided lapses after this long. */
export const EXPIRES_AFTER_DAYS = 7;
export const EXPIRES_AFTER_MS = EXPIRES_AFTER_DAYS * 24 * 60 * 60 * 1000;

export const expiresAt = (createdAt: string | Date): Date => new Date(new Date(createdAt).getTime() + EXPIRES_AFTER_MS);
export const isExpired = (createdAt: string | Date, now: Date = new Date()): boolean => expiresAt(createdAt).getTime() <= now.getTime();

/** What a decision leaves on a proposal. `waiting` is the only live state. */
export const INBOX_STATES = ["waiting", "approved", "declined", "expired", "reverted"] as const;
export type InboxState = (typeof INBOX_STATES)[number];

/** One call to a thing's own route. Approve runs `call` as the approver; a revert runs `revert` as the person reverting. */
export interface InboxCall {
  method: "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Extra request headers, for example the version a page was read at. */
  headers?: Record<string, string>;
}

/** What is stored with a proposal, as JSON in its body. */
export interface InboxBody {
  words: { what: string; before: string; after: string };
  /** The route to run on Approve. Null for a map publish, whose scene is read when it is approved. */
  call: InboxCall | null;
  /** How to put it back, where the route allows. Null when it cannot be undone. */
  revert: InboxCall | null;
  /** Kind-specific facts the approval needs. */
  facts?: Record<string, unknown>;
  /** The decision, once there is one. */
  decision?: { state: InboxState; by: string | null; at: string; result?: string };
}

export const INBOX_WORDS = {
  tooLong: "That is longer than a proposal can carry.",
  expired: "This proposal waited a week and lapsed. File it again if it still matters.",
  gone: "That proposal is not here.",
  notWaiting: "That proposal was already decided.",
  noRevert: "This one cannot be undone from here. Change it the way you would any other change.",
  futureSeating: (from: string) => `This seating is dated ${from}. Approve it on or after that day.`,
  listingNotHere: "Listing is not available in this village yet.",
  mapNothing: "There is no map draft of theirs to publish.",
} as const;

// ── Never proposable ─────────────────────────────────────────────────────────

export const NEVER_PROPOSE: ReadonlyArray<{ key: string; words: string; test: RegExp }> = [
  { key: "money", words: "Money is always a person's act. Nothing about pay, payments, tokens, prices, budgets or the treasury can be proposed here.", test: /payment|payer|pay-?route|\bpay\b|invoice|payout|cash|ledger|wallet|treasury|exchange|mint|refund|purchase|budget|economy|token|price|stripe|dues|fee\b|comps?\b|crowdpool|funding/i },
  { key: "secrets", words: "Secrets and keys are always a person's act.", test: /secret|api-?key|credential|password|integration|webhook|\bkeys?\b/i },
  { key: "erasure", words: "Erasing or anonymising a member is always a person's act.", test: /erase|erasure|anonymi[sz]|forget|retention/i },
  { key: "invites", words: "Inviting people and letting them in is always a person's act.", test: /invit|join-?requests?|admit|admission/i },
  { key: "powers", words: "Changing who holds a power is always a person's act.", test: /power|capabilit|badge|steward|veto|override|break-?glass|handover|governance|admin-?access|\bstages?\b/i },
];

/** The first thing this proposal may never be about, or null. `subject` is the key, module id or page section it names. */
export function neverProposable(subject: string): { key: string; words: string } | null {
  for (const r of NEVER_PROPOSE) if (r.test.test(String(subject ?? ""))) return { key: r.key, words: r.words };
  return null;
}

// ── Words ────────────────────────────────────────────────────────────────────

/** A value as one plain line, clipped. */
export function plain(v: unknown, max = 400): string {
  const text = v === undefined || v === null ? "nothing" : typeof v === "string" ? v : JSON.stringify(v);
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}...` : one || "nothing";
}

export const TERM_WORDS: Record<string, string> = { season: "next season", moon: "this moon" };
