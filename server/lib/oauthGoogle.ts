/**
 * Google sign-in, the protocol half: configuration, signed state, and the
 * claims Google hands back. No Express, no database, no environment reads at
 * module scope, so every rule below is a unit test away.
 *
 * WHY THIS EXISTS AT ALL. The platform has one way in: an email address and a
 * password. A member who never set a password cannot log in, and until this
 * lane also fixed `forgot-password`, could not ask for one either. That state
 * is not hypothetical. It is where the founder of the live deployment is
 * sitting today, and `/api/admin/bootstrap` is the only door left, which needs
 * a shared secret and an environment variable a founder does not have.
 *
 * Google sign-in is an ADDITIONAL door. It never replaces the password path:
 * a village will have members with no Google account, and a village that
 * configures no Google credentials keeps working exactly as it does now.
 *
 * ── THIRTEEN DEPLOYMENTS, ONE PIECE OF CODE ─────────────────────────────────
 *
 * A Google OAuth client is registered against exact redirect URIs, and this
 * platform is about to run on thirteen hostnames. Three shapes were considered
 * and the reasoning is recorded in docs/GOOGLE_SIGN_IN.md. The decision here:
 * the deployment reads its OWN client id, secret and redirect URI from its own
 * environment, and this file never knows or cares who registered them. That
 * one mechanism covers two of the three options at zero extra cost. A founder
 * who creates their own OAuth client sets three variables. A founder who is
 * handed ReGen Civics' shared client sets the same three variables, and the
 * only difference is who added the callback URL in the Google console. The
 * third option, a central broker on one origin that redirects onward, is
 * refused: it would make one server able to mint an identity for any member of
 * any village, and it would put every village's sign-in behind one host that
 * ReGen Civics has to keep alive forever.
 *
 * ── THE REDIRECT URI IS CONFIGURED, NEVER OBSERVED ──────────────────────────
 *
 * `deploymentOrigin()` in server/index.ts falls back to the host of the first
 * inbound request. That is right for an email link and wrong here. Google
 * compares the redirect URI byte for byte against a registered value, so a
 * village reachable at both an apex and a www hostname would get a working
 * sign-in or a `redirect_uri_mismatch` depending on which one a stranger hit
 * first after a restart. So an explicit origin is REQUIRED, and a deployment
 * without one reports Google sign-in as unavailable instead of rendering a
 * button that fails on click.
 *
 * ── THERE IS NO PKCE HERE, AND THAT IS A DECISION ───────────────────────────
 *
 * PKCE stops a stolen authorization code being redeemed by whoever stole it.
 * It earns its place on a PUBLIC client, a mobile app or a single-page app
 * that holds no secret, where the code is the only thing standing between an
 * attacker and a session. This is a CONFIDENTIAL client: the code is redeemed
 * server side in a POST carrying this deployment's `client_secret`, which the
 * browser never sees, so a stolen code is not redeemable without also stealing
 * the secret from the server's environment. At that point the attacker has the
 * deployment and PKCE protects nothing.
 *
 * The other half of the reason is that a half-built PKCE is worse than none.
 * The verifier has to survive the hop to Google, and this flow is stateless by
 * design (the nonce rides in the signed state so a browser that drops cookies
 * can still sign in). Putting the verifier in that same state would send the
 * verifier and the code down the same channel, which is a challenge an
 * interceptor answers with the values it just intercepted. Doing it properly
 * needs a cookie the flow deliberately does not depend on.
 *
 * What DOES defend this flow is written below and tested: HMAC-signed state
 * with a fifteen-minute life (login CSRF), a nonce bound into the id_token
 * (this answer belongs to this request), and an audience check (an id_token
 * minted for another Google application is refused).
 */
import crypto from "node:crypto";
import { signTokenPayload } from "./memberTokens";

/** Long enough for a slow sign-in with a password prompt, short enough that a captured state is stale. */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

/**
 * The window between Google's redirect and the browser collecting its session.
 * Two minutes covers a slow single-page-app boot on a bad connection. It is
 * not a session length: nothing here is stored past the exchange.
 */
export const OAUTH_HANDOFF_TTL_MS = 2 * 60 * 1000;

/** The one-time cookie the callback sets and the exchange consumes. */
export const OAUTH_HANDOFF_COOKIE = "village_oauth_handoff";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Absolute, and byte-identical to a URI registered on the OAuth client. */
  redirectUri: string;
}

export type GoogleAvailability =
  | { available: true; config: GoogleConfig }
  | { available: false; missing: string[] };

/**
 * What this deployment can actually do, from its environment alone.
 *
 * THE EMPTY STATE AND THE REAL ZERO ARE DIFFERENT FACTS, and this is the
 * function that keeps them apart. "No Google credentials configured" is a
 * village that never set them up, and it must present no Google button at all.
 * It is not the same as a configured village whose credentials are wrong, which
 * fails later with a message naming Google. Code that tested one truthy value
 * would report both as the same nothing.
 *
 * `missing` names every variable that is absent, all of them at once, so a
 * founder fixes the whole set in one pass instead of discovering them one
 * restart at a time.
 */
export function resolveGoogleConfig(
  env: Record<string, string | undefined>,
  configuredOrigin: string,
): GoogleAvailability {
  const clientId = String(env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const explicitRedirect = String(env.GOOGLE_REDIRECT_URI ?? "").trim().replace(/\/$/, "");
  const origin = String(configuredOrigin ?? "").trim().replace(/\/$/, "");

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!explicitRedirect && !origin) missing.push("FRONTEND_URL (or GOOGLE_REDIRECT_URI)");

  if (missing.length) return { available: false, missing };
  const redirectUri = explicitRedirect || `${origin}/api/auth/google/callback`;
  // A relative or malformed redirect would be refused by Google with a message
  // nobody reads. Say it here, at boot, in the founder's own words.
  if (!/^https?:\/\/[^\s]+$/.test(redirectUri)) {
    return { available: false, missing: ["GOOGLE_REDIRECT_URI (must be an absolute http or https URL)"] };
  }
  return { available: true, config: { clientId, clientSecret, redirectUri } };
}

/**
 * Only same-origin relative paths survive as a post-sign-in destination.
 * Everything else is dropped silently, so a crafted sign-in link cannot bounce
 * a member off the village afterwards. The backslash and protocol-relative
 * variants are refused by name because browsers normalise them to an
 * off-site URL.
 */
export function normalizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/\\")) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  return trimmed;
}

export interface OAuthState {
  /** Where to land afterwards, already normalised. */
  next: string | null;
  /** Bound into the id_token by Google, which is what ties the answer to this request. */
  nonce: string;
  /**
   * The invitation this sign-in may use to make an account: its ID, never its
   * token. `start` checks the token and writes only an invitation it found
   * open into the SIGNED payload, so a caller cannot put an id here, and the
   * secret half of the link never travels to Google and back.
   */
  invite: string | null;
  /**
   * Set when this round trip confirms a signed-in member for one destructive
   * action (server/lib/identityConfirm.ts) and signs nobody in. Carried as a
   * plain word; the route decides whether it names a real action.
   */
  confirm: string | null;
}

/** An invitation id in the shape `server/routes/invites.ts` mints, or null. */
function readInviteId(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw : "";
  return /^inv-[A-Za-z0-9-]{1,60}$/.test(id) ? id : null;
}

/**
 * Mint the `state` parameter.
 *
 * State does two jobs. It carries the destination, and it is the login-CSRF
 * token: the callback accepts nothing this server did not mint inside the TTL,
 * so an attacker cannot drop a victim onto a callback URL holding their own
 * authorization code and quietly link the victim's browser to the attacker's
 * Google account.
 *
 * The nonce rides inside the SIGNED payload. A cookie would not survive a
 * browser that drops them across the Google hop, and this does. It is readable
 * by whoever holds the URL, which is fine: its job is to prove that the
 * id_token Google returned answers THIS authorization request, and an id_token
 * is minted by Google against a nonce it was given, not by the holder of one.
 */
export function makeOAuthState(
  secret: string,
  next: string | null,
  nowMs: number = Date.now(),
  /**
   * What this round trip is FOR beyond signing in, as ONE object rather than a
   * growing tail of positional arguments. Two lanes took the fourth slot on the
   * same day, the invitation and the confirmation, and a third field would have
   * taken a fifth. Both are optional and absent means an ordinary sign-in.
   */
  opts: { invite?: string | null; confirm?: string | null } = {},
): string {
  const payload = Buffer.from(
    JSON.stringify({
      purpose: "oauth-state",
      next: normalizeNext(next) ?? "",
      nonce: crypto.randomBytes(16).toString("hex"),
      t: nowMs,
      invite: readInviteId(opts.invite) ?? "",
      ...(opts.confirm ? { confirm: opts.confirm } : {}),
    }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

/** Verify signature, purpose and freshness. Any failure is a refused sign-in. */
export function readOAuthState(secret: string, state: string, nowMs: number = Date.now()): OAuthState | null {
  try {
    const dot = String(state ?? "").lastIndexOf(".");
    if (dot < 1 || dot === state.length - 1) return null;
    const payload = state.slice(0, dot);
    const provided = Buffer.from(state.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.purpose !== "oauth-state") return null;
    if (typeof decoded.nonce !== "string" || !decoded.nonce) return null;
    if (typeof decoded.t !== "number" || nowMs - decoded.t > OAUTH_STATE_TTL_MS) return null;
    // Re-normalised on the way out. A signature proves this server wrote the
    // value; it does not prove the value was safe when it was written.
    return {
      next: normalizeNext(decoded.next),
      nonce: decoded.nonce,
      invite: readInviteId(decoded.invite),
      confirm: typeof decoded.confirm === "string" && decoded.confirm ? decoded.confirm : null,
    };
  } catch {
    return null;
  }
}

/** The authorization URL a member is sent to. */
export function googleAuthUrl(config: GoogleConfig, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    // `select_account` so a shared machine does not silently sign the last
    // person back in when a second member clicks the button.
    prompt: "select_account",
    state,
    nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleIdentity {
  /** Google's stable subject id. The identity, and the only field that never changes. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Read an id_token's payload WITHOUT verifying its signature, and say so.
 *
 * This is safe in exactly one position: the token came back in the body of our
 * own HTTPS POST to `https://oauth2.googleapis.com/token`, authenticated with
 * this deployment's client secret. Google documents that case as needing no
 * local signature check, because TLS already proves who answered. Google's own
 * documentation is the source, and this comment is the reason the check is
 * absent, so nobody deletes the exchange and starts feeding this function
 * tokens from a browser.
 *
 * IF THIS FUNCTION IS EVER CALLED ON A TOKEN THAT DID NOT COME STRAIGHT FROM
 * THE TOKEN ENDPOINT, it must be replaced by a JWKS verification first. There
 * is no signature check here to fall back on.
 */
export function decodeIdTokenPayload(idToken: string): Record<string, unknown> | null {
  try {
    const parts = String(idToken ?? "").split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export type IdentityCheck =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: string };

/**
 * Turn a token-endpoint id_token into an identity this village will act on, or
 * refuse with a reason.
 *
 * EVERY CHECK HERE IS LOAD-BEARING, so each one says what an attacker gets if
 * it is removed:
 *
 *  - `iss`: without it, any JWT-shaped string reaches the claim checks.
 *  - `aud` equals our client id: an id_token minted for a DIFFERENT Google
 *    application would otherwise be accepted here. That is the classic
 *    confused-deputy: an attacker runs their own Google app, collects a real
 *    id_token from their own user, and replays it at this village.
 *  - `exp`: an id_token captured months ago would work forever.
 *  - `nonce` equals the one this server put in the authorization request: this
 *    is what makes the answer belong to THIS sign-in and not a replay of a
 *    token collected elsewhere.
 *  - `email_verified` is true: see below. This is the one that decides whether
 *    an attacker can take a founder's account.
 *
 * WHY `email_verified` IS NOT OPTIONAL. This village links a Google sign-in to
 * an existing account by email address. A Google account can carry an address
 * its owner never proved they control, and Google reports exactly that with
 * `email_verified: false`. Accepting one would mean an attacker signs up to
 * Google claiming the founder's address, clicks Sign in with Google, and is
 * handed the founder's village. So an unverified address is refused before any
 * account is looked at, and the member is told to use the password path.
 */
export function identityFromClaims(
  claims: Record<string, unknown> | null,
  expected: { clientId: string; nonce: string; nowSeconds?: number },
): IdentityCheck {
  if (!claims) return { ok: false, reason: "unreadable_id_token" };
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);

  const iss = String(claims.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    return { ok: false, reason: "bad_issuer" };
  }
  // `aud` is a string for a normal web client. An array form is valid OIDC, so
  // both shapes are checked; a match anywhere in the array is a match.
  const aud = claims.aud;
  const audOk = Array.isArray(aud)
    ? aud.some((a) => String(a) === expected.clientId)
    : String(aud ?? "") === expected.clientId;
  if (!audOk) return { ok: false, reason: "wrong_audience" };

  const exp = Number(claims.exp ?? 0);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, reason: "expired_id_token" };

  const nonce = String(claims.nonce ?? "");
  // Constant-time, and length-checked first, so a mismatch leaks no timing.
  const a = Buffer.from(nonce);
  const b = Buffer.from(expected.nonce);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  const sub = String(claims.sub ?? "").trim();
  if (!sub) return { ok: false, reason: "no_subject" };

  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };

  // Google sends this as a real boolean. A string "true" from some other
  // issuer is refused: only the boolean counts.
  if (claims.email_verified !== true) return { ok: false, reason: "email_unverified" };

  return {
    ok: true,
    identity: { sub, email, emailVerified: true, name: String(claims.name ?? "").trim() },
  };
}

/**
 * The one-time handoff between the callback redirect and the single-page app.
 *
 * WHY THERE IS A HANDOFF AT ALL. This deployment authenticates with
 * `Authorization: Bearer` and stores the member's token in localStorage. A
 * server-side redirect cannot write localStorage, so the session token has to
 * cross from the callback into the page somehow. The two obvious routes are
 * both worse than this one: a token in the query string lands in server logs,
 * browser history and any `Referer` the next page sends, and a token in the
 * URL fragment stays in history too.
 *
 * So the callback sets a short-lived HttpOnly cookie holding THIS value, which
 * is not a session token. It names a member for two minutes. The page then
 * POSTs to the exchange route, which trades it for a real session token and
 * clears the cookie. A copy of the cookie is worth a sign-in for two minutes
 * and nothing after that.
 *
 * `v` pins the member's tokenVersion at mint time, so a sign-out anywhere in
 * that window kills the pending handoff too.
 */
export function makeHandoffToken(
  secret: string,
  userId: string,
  tokenVersion: number,
  nowMs: number = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      purpose: "oauth-handoff",
      userId,
      v: Number(tokenVersion ?? 0),
      jti: crypto.randomBytes(12).toString("hex"),
      exp: nowMs + OAUTH_HANDOFF_TTL_MS,
    }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

export function readHandoffToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): { userId: string; v: number; jti: string } | null {
  try {
    const dot = String(token ?? "").lastIndexOf(".");
    if (dot < 1 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.purpose !== "oauth-handoff" || !decoded.userId) return null;
    if (typeof decoded.jti !== "string" || !decoded.jti) return null;
    if (typeof decoded.exp !== "number" || nowMs > decoded.exp) return null;
    return { userId: String(decoded.userId), v: Number(decoded.v ?? 0), jti: decoded.jti };
  } catch {
    return null;
  }
}

/**
 * Handoff ids already spent, so a copied cookie cannot be used twice.
 *
 * IN PROCESS, AND THAT IS THE HONEST LIMIT OF IT. This deployment runs one
 * container, so in practice a spent handoff is spent. Two containers behind one
 * address would each keep their own set, and a handoff spent on one could be
 * spent again on the other inside its two-minute life. Saying so here beats
 * a comment claiming a guarantee the code does not make. The fix, if this ever
 * runs on more than one instance, is a `used_handoffs` table keyed on `jti`.
 */
export function createHandoffLedger(now: () => number = Date.now) {
  const spent = new Map<string, number>();
  return {
    /** True the first time a jti is seen, false every time after. */
    claim(jti: string): boolean {
      const t = now();
      // Array.from, because this file compiles under a target without
      // downlevel iteration over a Map.
      for (const [id, exp] of Array.from(spent.entries())) if (exp < t) spent.delete(id);
      if (spent.has(jti)) return false;
      spent.set(jti, t + OAUTH_HANDOFF_TTL_MS);
      return true;
    },
    get size() {
      return spent.size;
    },
  };
}
