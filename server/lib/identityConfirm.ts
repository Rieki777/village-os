/**
 * Confirming who you are before an act that cannot be taken back.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * A member who joins by signing in with Google has no password
 * (`passwordHash: ""`, server/routes/authGoogle.ts). Leaving the village
 * (`POST /api/profile/request-exit`) and deleting the account
 * (`POST /api/profile/delete-account`) both asked for a password and nothing
 * else, so that member could do neither. The screens drew a password box they
 * could never fill, and the server answered "Confirm with your password"
 * forever. Those two routes are the only self-service doors that re-check a
 * credential: login is the third `verifyPassword` call site, and no member
 * route changes an email address or a password against the current one.
 *
 * ── WHY A PROMPT IS THERE AT ALL, AND WHAT REPLACES IT ──────────────────────
 *
 * The password prompt exists so that a stolen session token alone cannot end
 * somebody's membership or erase them. Dropping it for Google members would
 * make their accounts the weaker ones. So a member with no password confirms
 * with a FRESH Google sign-in instead, through the same start, callback and
 * token exchange that sign them in, and the answer is:
 *
 *   - bound to the member: the callback accepts only the Google subject already
 *     linked to an account (the signed link in prefs), never an email match,
 *     and never creates or links an account on this path;
 *   - bound to one action: a confirmation to leave cannot delete;
 *   - bound to the session generation: `v` is the member's tokenVersion, so
 *     signing out anywhere retires it;
 *   - short: five minutes;
 *   - single use, and durably so: the callback writes a digest of the token's
 *     id into the member's own row, and the route spends it inside
 *     `members.update`, which holds the row FOR UPDATE. Two requests carrying
 *     the same confirmation serialise on that lock and exactly one finds the
 *     record. It survives a restart and holds across instances, which the
 *     in-process handoff ledger in oauthGoogle.ts does not claim to.
 *   - carried in an HttpOnly cookie scoped to `/api/profile`, so no script can
 *     read it and it reaches only the two routes that spend it. The routes
 *     still demand the bearer token, so a cross-site form cannot spend it.
 *
 * A stolen session token alone therefore cannot pass: the thief also has to
 * complete a Google sign-in as the linked Google account inside five minutes.
 *
 * WHAT IT CANNOT PROVE, said plainly. Google's discovery document lists no
 * `auth_time` claim, so this server cannot tell a Google session typed a
 * moment ago from one the browser has held for a week. The account chooser is
 * always shown (`prompt=select_account`), so the member picks the account
 * themselves. Somebody sitting at the member's own unlocked machine with
 * Google signed in could pass this, as they could pass a password the browser
 * had saved.
 *
 * ── NO MIGRATION ────────────────────────────────────────────────────────────
 *
 * The pending record lives in `users.prefs` beside `googleLink`, one slot per
 * action. A newer confirmation for the same action replaces the older one,
 * which also revokes it. `publicUser` never needed to hide the slot: it holds a
 * SHA-256 digest of a random id, and the token itself never leaves the cookie.
 *
 * ── WHO USES WHICH PATH ─────────────────────────────────────────────────────
 *
 * A member WITH a password keeps the password path exactly as it was, same
 * body, same sentence. A Google confirmation is refused for them: this lane
 * adds a door for the member who had none, and widens nothing for anybody
 * else. A member with no password on a village with Google off is refused in
 * a sentence that names the way forward, which is setting a password through
 * forgot-password (server/routes/authRecovery.ts already sends a claim link to
 * exactly this account). An emailed one-time code was considered and left out
 * for that reason: the codebase has no code pattern, and the emailed claim link
 * already exists and ends in the password path.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { signTokenPayload } from "./memberTokens";
import { readGoogleLink } from "./oauthAccounts";

export const CONFIRM_ACTIONS = ["request-exit", "delete-account"] as const;
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

export function isConfirmAction(v: unknown): v is ConfirmAction {
  return typeof v === "string" && (CONFIRM_ACTIONS as readonly string[]).includes(v);
}

/** Long enough to switch back to the tab and press the button, short enough to be stale when stolen. */
export const IDENTITY_CONFIRM_TTL_MS = 5 * 60 * 1000;

/** Sent only to the routes that spend it. */
export const IDENTITY_CONFIRM_COOKIE_PATH = "/api/profile";

/** One cookie per action, so confirming one never displaces the other. */
export function confirmCookieName(action: ConfirmAction): string {
  return `village_confirm_${action}`;
}

/** Where each action's screen lives, for a return with no `next`. */
export const CONFIRM_HOME: Record<ConfirmAction, string> = {
  "request-exit": "/exit-policy",
  "delete-account": "/profile",
};

/** The password refusals, byte for byte what the two routes answered before this lane. */
export const PASSWORD_REFUSAL: Record<ConfirmAction, string> = {
  "request-exit": "Confirm with your password",
  "delete-account": "Confirm with your password to delete your account",
};

const DOING: Record<ConfirmAction, string> = {
  "request-exit": "open your departure",
  "delete-account": "delete your account",
};

export const NO_WAY_TO_CONFIRM =
  "Your account has no password, and this village has no other way to confirm it is you. " +
  "Set a password with Forgot password on the sign-in page, then come back.";

export function googleRefusal(action: ConfirmAction): string {
  return `Confirm with Google before you ${DOING[action]}. Your account has no password, so a fresh Google sign-in is how the village knows it is you.`;
}

export const CONFIRM_REFUSAL = {
  unreadable: "That Google confirmation could not be read. Confirm with Google again.",
  expired: "That Google confirmation has expired. It lasts five minutes. Confirm with Google again.",
  otherMember: "That Google confirmation belongs to a different account. Confirm with the Google account connected to yours.",
  otherAction: "That Google confirmation was given for something else. Confirm with Google again from this page.",
  spent: "That Google confirmation has already been used. Confirm with Google again.",
} as const;

export interface ConfirmClaims {
  userId: string;
  action: ConfirmAction;
  v: number;
  jti: string;
  exp: number;
}

export function mintConfirmation(
  secret: string,
  userId: string,
  action: ConfirmAction,
  tokenVersion: number,
  nowMs: number = Date.now(),
): { token: string; jti: string; exp: number } {
  const jti = crypto.randomBytes(18).toString("hex");
  const exp = nowMs + IDENTITY_CONFIRM_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ purpose: "identity-confirm", userId, action, v: Number(tokenVersion ?? 0), jti, exp }),
  ).toString("base64url");
  return { token: `${payload}.${signTokenPayload(secret, payload)}`, jti, exp };
}

export type ReadConfirmation = { ok: true; claims: ConfirmClaims } | { ok: false; reason: "unreadable" | "expired" };

/** Signature, purpose and shape first, then age. A session token or a handoff is refused by purpose. */
export function readConfirmation(secret: string, token: string, nowMs: number = Date.now()): ReadConfirmation {
  try {
    const raw = String(token ?? "");
    const dot = raw.lastIndexOf(".");
    if (dot < 1 || dot === raw.length - 1) return { ok: false, reason: "unreadable" };
    const payload = raw.slice(0, dot);
    const provided = Buffer.from(raw.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return { ok: false, reason: "unreadable" };
    }
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (d?.purpose !== "identity-confirm" || !d.userId || !isConfirmAction(d.action)) return { ok: false, reason: "unreadable" };
    if (typeof d.jti !== "string" || !d.jti || typeof d.exp !== "number") return { ok: false, reason: "unreadable" };
    if (nowMs > d.exp) return { ok: false, reason: "expired" };
    return { ok: true, claims: { userId: String(d.userId), action: d.action, v: Number(d.v ?? 0), jti: d.jti, exp: d.exp } };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function digest(jti: string): string {
  return crypto.createHash("sha256").update(jti).digest("hex");
}

const PREFS_KEY = "identityConfirm";

/** Record a pending confirmation on the member, replacing any earlier one for the same action. Call inside `members.update`. */
export function recordPending(member: { prefs?: any }, action: ConfirmAction, jti: string, exp: number): void {
  const prefs = { ...(member.prefs ?? {}) };
  const slots = prefs[PREFS_KEY] && typeof prefs[PREFS_KEY] === "object" ? { ...prefs[PREFS_KEY] } : {};
  slots[action] = { h: digest(jti), exp };
  prefs[PREFS_KEY] = slots;
  member.prefs = prefs;
}

/**
 * Spend the pending confirmation. True exactly once, for the matching,
 * unexpired record, which it removes. Call inside `members.update`: the row
 * lock is what makes "exactly once" hold between two requests.
 */
export function spendPending(member: { prefs?: any }, action: ConfirmAction, jti: string, nowMs: number = Date.now()): boolean {
  const slot = member.prefs?.[PREFS_KEY]?.[action];
  if (!slot || typeof slot.h !== "string" || typeof slot.exp !== "number") return false;
  const a = Buffer.from(slot.h);
  const b = Buffer.from(digest(jti));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (nowMs > slot.exp) return false;
  const slots = { ...member.prefs[PREFS_KEY] };
  delete slots[action];
  member.prefs = { ...member.prefs, [PREFS_KEY]: slots };
  return true;
}

/** One cookie by name, out of the raw header. No cookie parser is wired in this app. */
export function readCookieValue(header: string | undefined, name: string): string | null {
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Back to the screen the member came from, with a word the page turns into a sentence. */
export function confirmReturnUrl(next: string | null, action: ConfirmAction | null, query: string): string {
  const base = next || (action ? CONFIRM_HOME[action] : "/profile");
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

export type ConfirmWith = "password" | "google" | "none";

/** What this member can confirm with, for the screen to draw the right control. */
export function confirmWithFor(member: { id: string; passwordHash?: string; prefs?: any }, secret: string, googleAvailable: boolean): ConfirmWith {
  if (member.passwordHash) return "password";
  return googleAvailable && readGoogleLink(secret, member) ? "google" : "none";
}

export interface IdentityGateDeps {
  authSecret: string;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  googleAvailable(): boolean;
  members: { update(id: string, mutate: (m: any) => void): Promise<any | null> };
  now?(): number;
}

export type GateOutcome =
  | { ok: true; via: "password" | "google" }
  | { ok: false; body: { error: string; confirmWith?: ConfirmWith } };

/**
 * The one check both destructive routes make, in place of the password line
 * they each carried. Refusals are always a 403 with a sentence.
 */
export function makeIdentityGate(deps: IdentityGateDeps) {
  const now = () => (deps.now ? deps.now() : Date.now());
  return async function confirmIdentity(req: Request, res: Response, user: any, action: ConfirmAction): Promise<GateOutcome> {
    if (user.passwordHash) {
      const password = (req.body ?? {}).password;
      if (!password || !(await deps.verifyPassword(String(password), user.passwordHash))) {
        return { ok: false, body: { error: PASSWORD_REFUSAL[action] } };
      }
      return { ok: true, via: "password" };
    }

    const confirmWith = confirmWithFor(user, deps.authSecret, deps.googleAvailable());
    if (confirmWith === "none") return { ok: false, body: { error: NO_WAY_TO_CONFIRM, confirmWith } };

    const cookie = confirmCookieName(action);
    const raw = readCookieValue(req.headers.cookie, cookie);
    if (!raw) return { ok: false, body: { error: googleRefusal(action), confirmWith } };

    const refuse = (error: string): GateOutcome => {
      res.clearCookie(cookie, { path: IDENTITY_CONFIRM_COOKIE_PATH });
      return { ok: false, body: { error, confirmWith } };
    };
    const read = readConfirmation(deps.authSecret, raw, now());
    if (!read.ok) return refuse(CONFIRM_REFUSAL[read.reason]);
    const { claims } = read;
    if (claims.userId !== String(user.id)) return refuse(CONFIRM_REFUSAL.otherMember);
    if (claims.action !== action) return refuse(CONFIRM_REFUSAL.otherAction);
    if (claims.v !== Number(user.tokenVersion ?? 0)) return refuse(CONFIRM_REFUSAL.expired);

    let spent = false;
    await deps.members.update(user.id, (m: any) => {
      spent = spendPending(m, action, claims.jti, now());
    });
    if (!spent) return refuse(CONFIRM_REFUSAL.spent);
    res.clearCookie(cookie, { path: IDENTITY_CONFIRM_COOKIE_PATH });
    return { ok: true, via: "google" };
  };
}
