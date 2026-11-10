/**
 * OAUTH 2.1 FOR THE VILLAGE CONNECTOR, over HTTP (End of Moon addendum v6, B4).
 * The rules are in server/lib/agentOAuth.ts; read its header first.
 *
 *   GET  /.well-known/oauth-protected-resource          the connector's metadata
 *   GET  /.well-known/oauth-protected-resource/api/agent/v1/mcp   the same, path form
 *   GET  /.well-known/oauth-authorization-server        the sign-in metadata
 *   POST /api/agent/v1/oauth/register                   a client registers itself
 *   POST /api/agent/v1/oauth/token                      a code becomes a vat_ token
 *   GET  /api/agent/oauth/request                       the consent page reads what is asked (member session)
 *   POST /api/agent/oauth/authorize                     the member allows or refuses (member session)
 *
 * The consent page itself is the app's `/oauth/authorize`
 * (client/src/pages/OAuthAuthorize.tsx). A member who is not signed in signs in
 * there first. Nothing is minted until they press Allow, and then only a code:
 * the token is minted at the exchange, through `mintToken`, so the day's mint
 * cap and the live-token cap count it like any other.
 */
import express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { type AgentScope, DEFAULT_TTL_DAYS, holderStands, mintCapProblem, mintToken, revokeTokensNamed } from "../lib/agentTokens";
import {
  authorizationServerMetadata,
  challengeProblem,
  chosenScopes,
  MAX_STATE,
  OAUTH_DEFAULT_SCOPES,
  offeredScopes,
  parseRegistration,
  pkceMatches,
  protectedResourceMetadata,
  redirectWith,
  verifierProblem,
} from "../lib/agentOAuth";
import { insertOAuthClient, insertOAuthCode, oauthClient, oauthCode, spendOAuthCode } from "../repos/agentOAuth";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit"> & {
  clientIp: (req: express.Request) => string;
  /** The village's own origin, with no trailing slash. */
  origin: (req: express.Request) => string;
  memberById: (id: string) => Promise<any | null>;
  /**
   * The extra scopes this member's own rules allow, the same rules the Your
   * agent panel applies: `admin` for an admin, `sera.undoable` for an agent
   * account that is not one.
   */
  extraScopes: (user: any) => Promise<AgentScope[]>;
};

/** What the consent page offers this member, and which of the scopes write. Writes and extras are never ticked. */
const scopeOffer = (extras: readonly AgentScope[]) =>
  offeredScopes(extras).map((s) => ({ scope: s, write: !["moon.read", "moon.review", "roles.read", "applicants.read"].includes(s), ticked: OAUTH_DEFAULT_SCOPES.includes(s) }));

/** The token a connector holds is named after it, and its id's tail tells two connectors with one name apart. */
const tokenName = (client: { name: string; clientId: string }) => `Connector: ${client.name.slice(0, 60)} (${client.clientId.slice(-6)})`;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, clientIp, origin, memberById, extraScopes } = deps;

  const resourceMeta = (req: express.Request, res: express.Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(protectedResourceMetadata(origin(req)));
  };
  app.get("/.well-known/oauth-protected-resource", resourceMeta);
  app.get("/.well-known/oauth-protected-resource/api/agent/v1/mcp", resourceMeta);
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(authorizationServerMetadata(origin(req)));
  });

  app.post("/api/agent/v1/oauth/register", async (req, res) => {
    if (await overLimit(`agent-oauth-register:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
      return res.status(429).set("Retry-After", "600").json({ error: "too_many_requests", error_description: "Too many registrations from here this hour." });
    }
    const parsed = parseRegistration(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, error_description: parsed.description });
    const client = await insertOAuthClient(getPool(), parsed.name, parsed.redirectUris);
    res.status(201).set("Cache-Control", "no-store").json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  /** What the consent page shows: who is asking, where the member goes back to, and the scopes on offer. */
  app.get("/api/agent/oauth/request", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const client = await oauthClient(getPool(), String(req.query.client_id ?? "").slice(0, 64));
    if (!client) return res.status(400).json({ error: "invalid_client", message: "This connector is not registered here." });
    const redirectUri = String(req.query.redirect_uri ?? "");
    if (!client.redirectUris.includes(redirectUri)) return res.status(400).json({ error: "invalid_redirect_uri", message: "This connector did not register that return address." });
    res.json({ clientName: client.name, redirectHost: new URL(redirectUri).host, scopes: scopeOffer(await extraScopes(user)), member: { name: user.name ?? "" } });
  });

  app.post("/api/agent/oauth/authorize", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    if (await overLimit(`agent-oauth-authorize:${user.id}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many sign-ins this hour. Wait a while." });
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const client = await oauthClient(getPool(), String(b.clientId ?? "").slice(0, 64));
    if (!client) return res.status(400).json({ error: "This connector is not registered here." });
    const redirectUri = String(b.redirectUri ?? "");
    // Never send a member anywhere the client did not register, not even with an error.
    if (!client.redirectUris.includes(redirectUri)) return res.status(400).json({ error: "This connector did not register that return address." });
    const state = typeof b.state === "string" ? b.state : undefined;
    if (state !== undefined && state.length > MAX_STATE) return res.json({ redirect: redirectWith(redirectUri, { error: "invalid_request", error_description: `state is at most ${MAX_STATE} characters.` }) });
    if (b.decision !== "allow") return res.json({ redirect: redirectWith(redirectUri, { error: "access_denied", state }) });
    const pkce = challengeProblem(b.codeChallenge, b.codeChallengeMethod);
    if (pkce) return res.json({ redirect: redirectWith(redirectUri, { error: "invalid_request", error_description: pkce, state }) });
    const scopes = chosenScopes(b.scopes, await extraScopes(user));
    if (scopes.length === 0) return res.status(400).json({ error: "Pick at least one thing the connector may do." });
    // A connector signing in again replaces its own token at the exchange, so that one does not count against the live cap here.
    const cap = await mintCapProblem(getPool(), String(user.id));
    if (cap && !/live tokens/.test(cap)) return res.status(429).json({ error: cap });
    const code = await insertOAuthCode(getPool(), { clientId: client.clientId, userId: String(user.id), scopes, codeChallenge: String(b.codeChallenge), redirectUri, sessionVersion: Number(user.tokenVersion ?? 0) });
    await recordEvent(getPool(), {
      kind: "agent_token",
      text: `allowed the connector "${client.name}" (${scopes.join(", ")})`,
      actorUserId: user.id,
      actorKind: "agent",
      entityType: "agent_oauth_client",
      entityRef: client.clientId,
      audience: "admin",
    });
    res.json({ redirect: redirectWith(redirectUri, { code, state }) });
  });

  const oauthError = (res: express.Response, status: number, error: string, description: string) =>
    res.status(status).set("Cache-Control", "no-store").json({ error, error_description: description });

  app.post("/api/agent/v1/oauth/token", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
    if (await overLimit(`agent-oauth-token:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
      return res.status(429).set("Retry-After", "600").json({ error: "too_many_requests", error_description: "Too many token requests from here this hour." });
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const asked = await oauthClient(getPool(), String(b.client_id ?? "").slice(0, 64));
    if (!asked) return res.status(401).set("Cache-Control", "no-store").set("WWW-Authenticate", 'Basic realm="oauth"').json({ error: "invalid_client", error_description: "This client is not registered here." });
    if (b.grant_type !== "authorization_code") return oauthError(res, 400, "unsupported_grant_type", "The only grant here is authorization_code.");
    const code = typeof b.code === "string" ? b.code.slice(0, 200) : "";
    const verifier = b.code_verifier;
    const vp = verifierProblem(verifier);
    if (!code) return oauthError(res, 400, "invalid_request", "Send the code.");
    if (vp) return oauthError(res, 400, "invalid_request", vp);
    const stored = await oauthCode(getPool(), code);
    if (!stored) return oauthError(res, 400, "invalid_grant", "That code is not one this server issued.");
    if (stored.usedAt) return oauthError(res, 400, "invalid_grant", "That code was already used.");
    if (stored.expiresAt.getTime() <= Date.now()) return oauthError(res, 400, "invalid_grant", "That code expired. Sign in again.");
    if (String(b.client_id ?? "") !== stored.clientId) return oauthError(res, 400, "invalid_grant", "That code was issued to a different client.");
    if (String(b.redirect_uri ?? "") !== stored.redirectUri) return oauthError(res, 400, "invalid_grant", "redirect_uri does not match the one the code was issued for.");
    if (!pkceMatches(String(verifier), stored.codeChallenge)) return oauthError(res, 400, "invalid_grant", "code_verifier does not match the code_challenge.");
    // Spent before anything is minted, so two exchanges of one code mint at most one token.
    if (!(await spendOAuthCode(getPool(), code))) return oauthError(res, 400, "invalid_grant", "That code was already used.");
    const member = await memberById(stored.userId);
    if (!holderStands(member)) return oauthError(res, 400, "invalid_grant", "The member who signed in is no longer here.");
    // The member's own rules are read again: an admin flag or an agent flag that changed since Allow closes that scope.
    const extras = await extraScopes(member);
    const scopes = chosenScopes(stored.scopes, extras);
    if (scopes.length !== stored.scopes.length) return oauthError(res, 400, "invalid_grant", "What the member allowed is no longer theirs to give. Sign in again.");
    const name = tokenName(asked);
    await revokeTokensNamed(getPool(), stored.userId, name);
    const minted = await mintToken(getPool(), stored.userId, { name, scopes }, stored.sessionVersion);
    // 401 from the mint: the member's sessions ended (a new password, an admin's revoke) since they pressed Allow.
    if (!minted.ok) return oauthError(res, 400, "invalid_grant", minted.status === 401 ? "The member's sign-in changed since they allowed this. Sign in again." : minted.error);
    res.set("Cache-Control", "no-store").set("Pragma", "no-cache").json({
      access_token: minted.token,
      token_type: "Bearer",
      expires_in: Math.max(0, Math.floor((new Date(minted.row.expiresAt).getTime() - Date.now()) / 1000)) || DEFAULT_TTL_DAYS * 24 * 60 * 60,
      scope: minted.row.scopes.join(" "),
    });
  });
}
