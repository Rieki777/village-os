/**
 * Google sign-in: the four routes.
 *
 *   GET  /api/auth/methods           what this deployment can actually offer
 *   GET  /api/auth/google/start      mint state, send the member to Google
 *   GET  /api/auth/google/callback   Google comes back here
 *   POST /api/auth/google/exchange   the page trades the handoff for a session
 *
 * This is an ADDITIONAL door beside email and password, never a replacement.
 * A village with no Google credentials serves `/api/auth/methods` with
 * `google: false`, the client renders no button, and `start` answers 404. A
 * dead button that fails on click would be worse than no button, and a village
 * that never configured Google is a real zero, and a broken setup is a
 * different fact with a different message.
 *
 * The decisions live in server/lib/oauthGoogle.ts (protocol) and
 * server/lib/oauthAccounts.ts (which account a sign-in becomes). Read the
 * account-linking argument there before changing anything here.
 */
import type { Express, Request, Response } from "express";
import {
  OAUTH_HANDOFF_COOKIE,
  OAUTH_HANDOFF_TTL_MS,
  createHandoffLedger,
  decodeIdTokenPayload,
  googleAuthUrl,
  identityFromClaims,
  makeHandoffToken,
  makeOAuthState,
  normalizeNext,
  readHandoffToken,
  readOAuthState,
  type GoogleAvailability,
} from "../lib/oauthGoogle";
import {
  decideGoogleSignIn,
  makeGoogleLink,
  readGoogleLink,
  type AccountFacts,
} from "../lib/oauthAccounts";
import { decideFounderGrant, parseFounderEmails } from "../lib/founderGrant";

/** What this module reaches. The complete list. */
export interface GoogleAuthDeps {
  authSecret: string;
  /** Re-read per request so a restart is the only thing needed to turn Google on. */
  availability(): GoogleAvailability;
  members: {
    all(): Promise<any[]>;
    byId(id: string): Promise<any | null>;
    byEmail(email: string): Promise<any | null>;
    add(member: any): Promise<any>;
    update(id: string, mutate: (m: any) => void): Promise<any | null>;
  };
  encodeToken(userId: string, email: string, tokenVersion: number): string;
  publicUser(u: any): any;
  makeHandle(name: string): Promise<string>;
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;
  clientIp(req: Request): string;
  recordAudit(text: string, userId: string): void;
  onMemberJoined(user: any): void;
}

/**
 * The token endpoint, overridable ONLY to a loopback address.
 *
 * WHY THIS SEAM EXISTS. The callback cannot be proved by reading it. A test
 * has to be able to play Google's part, and every check that matters (the
 * state signature, the nonce binding, the audience, the expiry, the verified
 * email, the account decision) runs identically whichever host answered. So
 * the suite starts a local stand-in and points this at it.
 *
 * WHY IT CANNOT BE A BACKDOOR. The override is accepted only when it parses as
 * plain http on localhost or 127.0.0.1. Anything else is ignored with a loud
 * line in the log, so this value cannot be pointed at a host an attacker
 * controls, and cannot be used to walk this deployment's client secret off the
 * machine. A production deployment that sets it by accident keeps talking to
 * Google.
 */
export function resolveTokenEndpoint(env: Record<string, string | undefined>): string {
  const real = "https://oauth2.googleapis.com/token";
  const override = String(env.GOOGLE_TOKEN_ENDPOINT ?? "").trim();
  if (!override) return real;
  try {
    const u = new URL(override);
    const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "http:" && loopback) return override;
  } catch {
    /* falls through to the refusal below */
  }
  console.error(
    `[oauth] GOOGLE_TOKEN_ENDPOINT is set to ${override}, which is not a loopback http address. ` +
      "Ignoring it and using Google. This override exists for the local test stand-in only.",
  );
  return real;
}

/** One cookie by name, out of the raw header. No cookie parser is wired in this app. */
function readCookie(req: Request, name: string): string | null {
  const raw = String(req.headers.cookie ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Where a failed sign-in lands, with a reason the page can turn into a sentence. */
function failTo(res: Response, reason: string): void {
  res.redirect(302, `/login?oauth=error&reason=${encodeURIComponent(reason)}`);
}

/**
 * Say at boot which ways in this deployment actually has.
 *
 * A founder standing up a village needs to know this from the log, on the
 * first boot, without clicking anything. "Google sign-in is off" is a
 * different sentence from "Google sign-in is misconfigured", and the second
 * one names every variable that is missing so the whole set is fixed in one
 * pass. Silence here was how a village would discover a dead button from a
 * member who could not get in.
 */
export function reportSignInMethods(avail: GoogleAvailability, log = console): void {
  if (avail.available) {
    log.log(`[auth] sign-in methods: email and password, Google. Google callback: ${avail.config.redirectUri}`);
    return;
  }
  log.log(
    `[auth] sign-in methods: email and password. Google is OFF, missing: ${avail.missing.join(", ")}. ` +
      "No Google button is shown while it is off.",
  );
}

export function register(app: Express, deps: GoogleAuthDeps): void {
  const spent = createHandoffLedger();
  const tokenEndpoint = resolveTokenEndpoint(process.env);
  reportSignInMethods(deps.availability());

  /**
   * What a member can actually use to get in.
   *
   * Read by the sign-in page before it draws anything, so the Google button
   * exists only where it works. `password` is always true: it is the path this
   * platform has always had and the one a member with no Google account needs.
   */
  app.get("/api/auth/methods", (_req: Request, res: Response) => {
    const avail = deps.availability();
    // WHY `missing` IS IN THE RESPONSE, and why it is unauthenticated.
    //
    // This answered `{password, google}` and nothing else, so `google: false`
    // read exactly the same whether a founder had forgotten one variable or
    // all three. `resolveGoogleConfig` already works out precisely which are
    // absent and names every one of them at once, and that list was going only
    // to the boot log, where a founder has to go digging in a hosting
    // dashboard to find it. That is the same empty-versus-zero confusion this
    // codebase has already been burned by: one state, two very different
    // causes, one indistinguishable answer.
    //
    // It has to be unauthenticated to be worth anything. The founder who needs
    // it is the one who cannot sign in yet, which is the entire situation.
    //
    // Safe because these are variable NAMES and never values. The names are
    // published in .env.example and docs/GOOGLE_SIGN_IN.md, and the one fact
    // the list adds, that this village has not finished setting Google up, is
    // already told by `google: false` sitting beside it.
    res.json({
      password: true,
      google: avail.available,
      ...(avail.available ? {} : { missing: avail.missing }),
    });
  });

  app.get("/api/auth/google/start", async (req: Request, res: Response) => {
    const avail = deps.availability();
    if (!avail.available) return res.status(404).json({ error: "Google sign-in is not set up on this village." });
    // Bounded per IP: `start` mints signed state, and an unbounded minter is a
    // free oracle for anybody probing the deployment.
    if (await deps.overLimit(`oauth-start:${deps.clientIp(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const next = normalizeNext(typeof req.query.next === "string" ? req.query.next : null);
    const state = makeOAuthState(deps.authSecret, next);
    const parsed = readOAuthState(deps.authSecret, state);
    if (!parsed) return res.status(500).json({ error: "Could not start sign-in." });
    res.redirect(302, googleAuthUrl(avail.config, state, parsed.nonce));
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const avail = deps.availability();
    if (!avail.available) return failTo(res, "not_configured");

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const rawState = typeof req.query.state === "string" ? req.query.state : "";
    // Google reports a refusal here too. A member who pressed Cancel is not an
    // error to investigate.
    if (typeof req.query.error === "string" && req.query.error) return failTo(res, "cancelled");
    if (!code) return failTo(res, "no_code");

    // THE LOGIN-CSRF GUARD, and it runs before any network call. Without it an
    // attacker can drop a victim onto this URL carrying the attacker's own
    // authorization code, and the victim's browser silently ends up holding a
    // session for the attacker's Google account, or the victim's account gets
    // linked to it.
    const state = readOAuthState(deps.authSecret, rawState);
    if (!state) return failTo(res, "bad_state");

    /*
     * BOUNDED AFTER THE STATE CHECK, WHICH IS THE ONLY PLACE IT BELONGS.
     *
     * `start` is already bounded, and a caller with no valid state is turned
     * away above without costing anything, so the gap this closes is narrow
     * and real: state is signed but not single-use, so ONE trip through
     * `start` yields a token that can be replayed at this URL as often as
     * somebody likes. Every replay is an outbound request to Google's token
     * endpoint on the village's own OAuth client, and a client Google decides
     * is abusive is a village whose sign-in stops working.
     *
     * Counting only requests that got past `bad_state` means garbage traffic
     * never spends a real member's budget. 60 an hour from one address is far
     * more sign-ins than a household makes and far fewer than a flood.
     */
    if (await deps.overLimit(`oauth-callback:${deps.clientIp(req)}`, 60, 60 * 60 * 1000)) {
      return failTo(res, "rate_limited");
    }

    let claims: Record<string, unknown> | null = null;
    try {
      const body = new URLSearchParams({
        code,
        client_id: avail.config.clientId,
        client_secret: avail.config.clientSecret,
        redirect_uri: avail.config.redirectUri,
        grant_type: "authorization_code",
      });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      let payload: any;
      try {
        const r = await fetch(tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "(unreadable)");
          // The four ways this fails in the field are all configuration, and
          // all of them are invisible without the body: a rotated secret, a
          // redirect URI the console does not carry, a spent code, a client id
          // from a different project. Braces are replaced because some log
          // pipelines eat JSON-shaped text.
          console.error(
            `[oauth] Google token exchange failed: status=${r.status} redirectUri=${avail.config.redirectUri} ` +
              `body=${text.slice(0, 400).replace(/[{}]/g, "|")}`,
          );
          return failTo(res, "exchange_failed");
        }
        payload = await r.json();
      } finally {
        clearTimeout(timer);
      }
      claims = decodeIdTokenPayload(String(payload?.id_token ?? ""));
    } catch (e) {
      console.error("[oauth] Google token exchange threw:", e instanceof Error ? e.message : String(e));
      return failTo(res, "exchange_failed");
    }

    const check = identityFromClaims(claims, { clientId: avail.config.clientId, nonce: state.nonce });
    if (!check.ok) {
      console.warn(`[oauth] Google sign-in refused: ${check.reason}`);
      return failTo(res, check.reason);
    }
    const identity = check.identity;

    // Matched on the SUBJECT first. Reading every member to find one link is
    // the cost of storing the link in a JSON column with no index; at village
    // scale it is one query returning tens to hundreds of rows. The
    // `google_sub` column named in oauthAccounts.ts removes both this scan and
    // the create-create race below.
    const everyone = await deps.members.all();
    const bySub =
      everyone.find((m) => readGoogleLink(deps.authSecret, m) === identity.sub) ?? null;
    const byEmail = bySub ? null : await deps.members.byEmail(identity.email);

    const decision = decideGoogleSignIn({
      bySub: bySub as AccountFacts | null,
      byEmail: byEmail as AccountFacts | null,
      sub: identity.sub,
      existingLinkOnEmailMatch: byEmail ? readGoogleLink(deps.authSecret, byEmail) : null,
    });

    let member: any = null;
    if (decision.kind === "refuse") {
      console.warn(`[oauth] Google sign-in refused for ${identity.sub}: ${decision.reason}`);
      return failTo(res, decision.reason);
    }
    if (decision.kind === "sign_in") {
      member = bySub;
    } else if (decision.kind === "link") {
      // The link is written under the row lock `update` holds, and it does NOT
      // touch passwordHash. A member who links Google keeps the password they
      // had, and a member who had none can still set one later.
      member = await deps.members.update(decision.userId, (u: any) => {
        u.prefs = { ...(u.prefs ?? {}), googleLink: makeGoogleLink(deps.authSecret, decision.userId, identity.sub) };
      });
      if (!member) return failTo(res, "account_unavailable");
      deps.recordAudit("auth:google-linked", member.id);
    } else {
      const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const name = identity.name || identity.email.split("@")[0];
      member = {
        id: userId,
        name,
        email: identity.email,
        // No password. Sign-in is by Google until they choose to set one,
        // and `forgot-password` now mints a claim link for exactly this
        // state, so the account is never stranded on one credential.
        passwordHash: "",
        handle: await deps.makeHandle(name),
        paths: [],
        contributions: [],
        quests: [],
        recognitionBalance: 0,
        joinedAt: new Date().toISOString(),
        bio: "",
        avatar: null,
        prefs: { googleLink: makeGoogleLink(deps.authSecret, userId, identity.sub) },
      };
      await deps.members.add(member);
      deps.onMemberJoined(member);
      deps.recordAudit("auth:google-joined", member.id);
    }

    // The role, which is the half that signing in does not settle.
    //
    // A founder who reaches this line as an ordinary member cannot name their
    // village, and from their side that is the same as still being locked out.
    // FOUNDER_EMAILS is the deployment owner's declaration of who founds this
    // village, and it is honoured on every matching sign-in rather than once,
    // so a role lost to a restore or a hand-edit comes back by signing in.
    //
    // Safe because identityFromClaims already refused any address Google did
    // not verify (oauthGoogle.ts:301). decideFounderGrant refuses an unverified
    // address again anyway, so relaxing that check upstream cannot quietly turn
    // this into a way in.
    const grant = decideFounderGrant({
      email: identity.email,
      emailVerified: identity.emailVerified,
      currentRole: member?.role,
      founderEmails: parseFounderEmails(process.env.FOUNDER_EMAILS),
      isExample: Boolean(member?.isExample),
    });
    if (grant.grant) {
      const elevated = await deps.members.update(member.id, (u: any) => {
        u.role = "founder";
      });
      if (elevated) member = elevated;
      console.warn(`[oauth] founder role granted to ${member.id}: ${grant.reason}`);
      deps.recordAudit("auth:founder-granted", member.id);
    }

    const handoff = makeHandoffToken(deps.authSecret, member.id, member.tokenVersion ?? 0);
    // HttpOnly so no script can read it. SameSite=Lax so it survives the
    // top-level navigation back from Google and is still refused on a
    // cross-site POST. Secure whenever this village is served over https;
    // a Secure cookie on plain http would be dropped, which would break
    // local development silently.
    res.cookie(OAUTH_HANDOFF_COOKIE, handoff, {
      httpOnly: true,
      sameSite: "lax",
      secure: avail.config.redirectUri.startsWith("https://"),
      maxAge: OAUTH_HANDOFF_TTL_MS,
      path: "/",
    });
    const next = state.next ?? "/profile";
    res.redirect(302, `/login?oauth=complete&next=${encodeURIComponent(next)}`);
  });

  /**
   * Trade the handoff cookie for a session token.
   *
   * The cookie is cleared on every outcome, so a failed exchange cannot be
   * retried against a different account and a spent one cannot linger in the
   * browser.
   */
  app.post("/api/auth/google/exchange", async (req: Request, res: Response) => {
    const clear = () => res.clearCookie(OAUTH_HANDOFF_COOKIE, { path: "/" });
    const raw = readCookie(req, OAUTH_HANDOFF_COOKIE);
    if (!raw) {
      clear();
      return res.status(401).json({ error: "This sign-in has expired. Start again." });
    }
    const claim = readHandoffToken(deps.authSecret, raw);
    if (!claim) {
      clear();
      return res.status(401).json({ error: "This sign-in has expired. Start again." });
    }
    // Single use. A copied cookie is worth one sign-in inside two minutes, and
    // this is what stops it being worth two. See createHandoffLedger for what
    // this does and does not promise across more than one instance.
    if (!spent.claim(claim.jti)) {
      clear();
      return res.status(401).json({ error: "This sign-in has already been used. Start again." });
    }
    const user = await deps.members.byId(claim.userId);
    if (!user) {
      clear();
      return res.status(401).json({ error: "This sign-in has expired. Start again." });
    }
    // A sign-out anywhere in the two-minute window bumps tokenVersion and kills
    // the pending handoff with every other session.
    if (Number(user.tokenVersion ?? 0) !== claim.v) {
      clear();
      return res.status(401).json({ error: "This sign-in has expired. Start again." });
    }
    clear();
    const token = deps.encodeToken(user.id, user.email, user.tokenVersion ?? 0);
    res.json({ success: true, token, user: deps.publicUser(user) });
  });
}
