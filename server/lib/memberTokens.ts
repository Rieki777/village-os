/**
 * Member session tokens and set-password claim tokens: mint, and verify.
 *
 * `<base64url payload>.<HMAC-SHA256 signature>`. The payload is still readable,
 * it carries nothing secret, but it can no longer be edited: changing the user
 * id invalidates the signature. The format before this was bare base64 JSON
 * with no signature at all, so any caller could mint a token for any account.
 * Tokens in the old shape are rejected here, which logs everyone out once.
 * That is intended.
 *
 * WHY THIS IS ITS OWN MODULE. It was six functions in the middle of
 * server/index.ts, a 33,000-line file, and it had NO TESTS AT ALL. Its twin
 * for agent tokens, server/lib/agentTokens.ts, is a module with a forgery test
 * (`cannot be forged by editing the payload`). The member session token, which
 * is the one that authenticates every real person on the deployment, had no
 * equivalent, because there was no unit to test it against: the functions were
 * private to a file that boots a database pool and an HTTP server on import.
 * server/lib/memberTokens.test.ts is that missing test.
 *
 * THE SECRET IS A PARAMETER, not a module-level read of the environment, for
 * the same reason it is a parameter in agentTokens.ts: a test needs to be able
 * to sign with a key it chose, and a function that reaches for
 * `process.env` mid-verify cannot be reasoned about from its signature. The
 * live secret stays where boot configuration belongs, in server/index.ts.
 */
import crypto from "node:crypto";
import { numberVar } from "./variables";

/**
 * Fallback only. The live value is the `auth.session_days` game variable, read
 * at validation time so an admin's change takes effect without a deploy (for
 * tokens minted after it: the mint stamp is what gets compared).
 */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Set-password claim tokens expire hard, and much sooner than a session. */
export const SET_PASSWORD_TTL_MS = 60 * 60 * 1000;

export interface SessionClaims {
  userId: string;
  email: string;
  timestamp: number;
  /** The session-revocation lever. See encodeToken. */
  v?: number;
}

/**
 * The one signer every member-facing token shares: the session token, the
 * set-password claim, the Google sign-in state and handoff
 * (server/lib/oauthGoogle.ts), the identity confirmation
 * (server/lib/identityConfirm.ts) and the Google link record
 * (server/lib/oauthAccounts.ts).
 *
 * CODEQL ALERT 36 (`js/insufficient-password-hash`) IS REPORTED ON THE LINE
 * BELOW, and what it can and cannot see is recorded here so nobody has to
 * trace it a fourth time. The rule reads this HMAC as a password hash, and it
 * picks its sources BY NAME: CodeQL 2.27.0 treats any identifier matching
 * `pass(wd|word|code|.?phrase)`, `oauth`, `api.?(key|tok)` and a few more as a
 * password, unless the name also says `hash`, `sha`, `random`, `crypt` or
 * similar. So it never followed a stored password hash (`passwordHash` is
 * excluded by its own name). What it named was `passwordFingerprint(...)`, an
 * HMAC of the stored hash that rode in the set-password claim as `pw`. That
 * one was real: the claim travels by email and is readable by whoever holds
 * the link. It is gone as of 2026-09-21, and the claim is bound to
 * `tokenVersion` instead (makeSetPasswordToken, below).
 *
 * WHAT STILL MATCHES, AND WHY EACH IS BENIGN. The rule keeps firing here on
 * names alone: `SET_PASSWORD_TTL_MS` (the integer 3600000, added to `exp`),
 * `OAUTH_HANDOFF_TTL_MS` (the integer 120000, likewise), and calls to
 * `makeSetPasswordToken` and `makeOAuthState`, whose results are these same
 * signed tokens coming back to be verified. None of them carries anything
 * derived from a password. Renaming them to slip past the pattern would hide
 * the alert and change nothing, so they keep their names. If you add a field
 * to any payload signed here, it must not come from a password or a stored
 * hash, keyed or not; memberTokens.test.ts pins the set-password claim's keys.
 */
export function signTokenPayload(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeToken(secret: string, userId: string, email: string, tokenVersion = 0): string {
  // `v` is the session-revocation lever (S1): bumping user.tokenVersion
  // invalidates every token minted before the bump, for one member only.
  const payload = Buffer.from(
    JSON.stringify({ userId, email, timestamp: Date.now(), v: tokenVersion }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

/**
 * The session window, in milliseconds, clamped to between one day and a year.
 *
 * Split out of decodeToken so the clamp can be asserted directly. A broken or
 * hostile `auth.session_days` (zero, negative, NaN, 100000) must never yield an
 * immortal token, and must never yield a zero-length one that logs the whole
 * village out either.
 */
export function sessionWindowMs(rawSessionDays: number): number {
  return Math.max(1, Math.min(365, rawSessionDays || 30)) * 24 * 60 * 60 * 1000;
}

/**
 * Verify a session token's signature and age, and return its claims.
 *
 * `rawSessionDays` defaults to the live game variable, evaluated per call,
 * which is exactly when the inline version read it. A test passes its own.
 */
export function decodeToken(
  secret: string,
  token: string,
  rawSessionDays: number = numberVar("auth.session_days"),
): SessionClaims | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1 || dot === token.length - 1) return null; // unsigned or malformed
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (!decoded.userId || !decoded.email || typeof decoded.timestamp !== "number") return null;
    // Session length is a village choice (auth.session_days), applied at
    // validation: shortening it retires old sessions early, lengthening it
    // extends them. Guarded so a broken read never yields an immortal token.
    const ttlMs = sessionWindowMs(rawSessionDays);
    // `|| TOKEN_TTL_MS` is unreachable, since sessionWindowMs floors at one
    // day. Kept exactly as it was written: this move is behaviour-preserving,
    // and deleting a branch is a behaviour change however dead it looks.
    if (Date.now() - decoded.timestamp > (ttlMs || TOKEN_TTL_MS)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Set-password claim tokens (S1): the founder-bootstrap invite, and later the
 * platform's password-reset primitive. Same HMAC as session tokens, different
 * purpose field so one can never be replayed as the other, and a hard expiry.
 *
 * SINGLE USE, AND WHAT MAKES IT SO. The claim carries `v`, the member's
 * tokenVersion when the link was minted, and redemption refuses it unless that
 * is still the member's tokenVersion (setPasswordLinkRefusal). Every write
 * that changes a stored password hash bumps tokenVersion in the same row
 * update: redeeming one of these links (`POST /api/auth/set-password`) and the
 * erasure tombstone (server/lib/erasure.ts). So once the password changes,
 * every link minted before the change is dead, including a second letter the
 * member asked for and never opened. A sign-out and an admin's session revoke
 * bump the same counter, so they retire an unopened link too. That is
 * stricter than "used", and it fails safe: the member asks for a new one.
 *
 * WHY NOT A FINGERPRINT OF THE HASH (it was one until 2026-09-21). The claim
 * used to carry `pw`, an HMAC of the stored password hash, compared at
 * redemption. This link travels by email and its claim is readable by whoever
 * holds it, so nothing derived from a password belongs in it, keyed or not.
 * tokenVersion moves on every password change as well, and is derived from
 * nothing. CodeQL alert 36 named the fingerprint; see signTokenPayload.
 *
 * WHY THE PURPOSE IS "set-password-2" AND NOT "set-password". Rolling the
 * image back is the one recovery lever a village has, so the previous release
 * will meet these links. Its reader accepts any "set-password" claim and its
 * route skips the single-use compare when `pw` is absent, so under the old
 * name every link from the hour before a rollback would be replayable until it
 * expired. Under this name the previous release refuses them outright, as
 * invalid: a rollback fails closed.
 *
 * The third argument used to be the stored hash. A caller still passing one
 * must fail here, loudly, and never mint: a string is refused, not coerced.
 */
export function makeSetPasswordToken(secret: string, userId: string, tokenVersion: number): string {
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new TypeError("makeSetPasswordToken takes the member's tokenVersion, a non-negative integer");
  }
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      purpose: "set-password-2",
      v: tokenVersion,
      exp: Date.now() + SET_PASSWORD_TTL_MS,
    }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

/**
 * A verified set-password claim. `v` is null for a claim this server signed in
 * the shape it used before 2026-09-21 (purpose "set-password", a `pw`
 * fingerprint, no `v`). Those are retired, by name, in setPasswordLinkRefusal.
 */
export interface SetPasswordClaim {
  userId: string;
  v: number | null;
}

export function readSetPasswordToken(secret: string, token: string): SetPasswordClaim | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    const current = decoded.purpose === "set-password-2";
    if ((!current && decoded.purpose !== "set-password") || !decoded.userId) return null;
    if (typeof decoded.exp !== "number" || Date.now() > decoded.exp) return null;
    // The old shape is retired whatever else it carries. The PURPOSE decides,
    // never the presence of `v`: reading a missing `v` as `?? 0` would match
    // every account that never signed out, and let those links through.
    if (!current) return { userId: decoded.userId, v: null };
    if (!Number.isSafeInteger(decoded.v) || decoded.v < 0) return null;
    return { userId: decoded.userId, v: decoded.v };
  } catch {
    return null;
  }
}

/** What the member reads when a signed, unexpired link still cannot be used. */
export const SET_PASSWORD_LINK_REFUSAL = {
  retired: "This link was sent before a security update and no longer works. Ask for a new one.",
  spent: "This link has already been used, or this account was signed out everywhere after it was sent. Ask for a new one.",
} as const;

/**
 * The redemption decision, whole: null means the link may set a password now.
 *
 * The route asks twice: once on a plain read, so a dead link costs no bcrypt,
 * and again inside the locked row update, so two clicks racing on one link
 * cannot both land. `currentTokenVersion` is the member's, read fresh.
 */
export function setPasswordLinkRefusal(claim: SetPasswordClaim, currentTokenVersion: unknown): string | null {
  if (claim.v === null) return SET_PASSWORD_LINK_REFUSAL.retired;
  if (claim.v !== Number(currentTokenVersion ?? 0)) return SET_PASSWORD_LINK_REFUSAL.spent;
  return null;
}
