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
 * A fingerprint of the account's password state at mint time. Including it
 * makes the token SINGLE-USE without a nonce table: setting a password changes
 * the hash, so the fingerprint no longer matches and a replayed link is
 * refused. Stateless, which is how the route is written; an empty hash (a
 * claim-pending account) fingerprints just as well as a real one.
 *
 * WHY THIS IS AN HMAC AND NOT A BARE HASH. The input is the STORED hash, so
 * over a bcrypt string a plain digest would tell an attacker nothing. It was
 * not bcrypt everywhere: an account dormant since the bcrypt migration could
 * still hold an unsalted SHA-256 of the password itself, and for that account
 * a bare digest puts sha256(sha256(password)) into a link that travels by
 * email, where whoever holds it can guess candidates offline until one
 * matches. Keying the digest with the server secret removes that: the
 * fingerprint still changes when the hash changes, and it can no longer be
 * reproduced from a password guess alone. CodeQL alert 36 named this.
 */
export function passwordFingerprint(secret: string, passwordHash: string | null | undefined): string {
  return crypto.createHmac("sha256", secret).update(String(passwordHash ?? "")).digest("hex").slice(0, 16);
}

/**
 * Set-password claim tokens (S1): the founder-bootstrap invite, and later the
 * platform's password-reset primitive. Same HMAC as session tokens, different
 * purpose field so one can never be replayed as the other, and a hard expiry.
 */
export function makeSetPasswordToken(
  secret: string,
  userId: string,
  currentPasswordHash: string | null | undefined,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      purpose: "set-password",
      pw: passwordFingerprint(secret, currentPasswordHash),
      exp: Date.now() + SET_PASSWORD_TTL_MS,
    }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

export function readSetPasswordToken(secret: string, token: string): { userId: string; pw: string | null } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.purpose !== "set-password" || !decoded.userId) return null;
    if (typeof decoded.exp !== "number" || Date.now() > decoded.exp) return null;
    return { userId: decoded.userId, pw: typeof decoded.pw === "string" ? decoded.pw : null };
  } catch {
    return null;
  }
}
