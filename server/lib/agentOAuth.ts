/**
 * OAUTH 2.1 FOR THE VILLAGE CONNECTOR (End of Moon addendum v6, B4).
 *
 * Claude's custom connectors sign a member in with OAuth: they read the
 * metadata, register themselves, send the member to a consent page in the
 * app, and exchange a code for a token. The token they get is an ordinary
 * `vat_` agent token minted through `mintToken`, so everything that holds for
 * a token from the Your agent panel holds here: `MINTS_PER_DAY`,
 * `LIVE_PER_USER`, the 90-day life, revoking in the panel, and `endAgentReach`
 * on a password change or an admin's revoke. The token is named after the
 * client. There are no refresh tokens.
 *
 *   GET  /.well-known/oauth-protected-resource[/api/agent/v1/mcp]  RFC 9728
 *   GET  /.well-known/oauth-authorization-server                   RFC 8414
 *   POST /api/agent/v1/oauth/register   dynamic client registration, RFC 7591
 *   GET  /oauth/authorize               the consent page, in the app
 *   POST /api/agent/v1/oauth/token      code for token, PKCE S256 required
 *
 * This file is the rules and nothing that touches the database; the routes
 * are server/routes/agentOAuth.ts and the rows server/repos/agentOAuth.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { AGENT_SCOPES, type AgentScope } from "./agentTokens";

export const MCP_RESOURCE_PATH = "/api/agent/v1/mcp";
export const REGISTER_PATH = "/api/agent/v1/oauth/register";
export const TOKEN_PATH = "/api/agent/v1/oauth/token";
export const AUTHORIZE_PAGE = "/oauth/authorize";

/** The scopes a connector may ask a member for. Admin and Sera stay with the panel and their own accounts' rules. */
export const OAUTH_SCOPES: readonly AgentScope[] = ["moon.read", "tasks.write", "calendar.read", "directory.read", "me.read"];
/** Ticked on the consent page unless the member unticks them. Writes are opt-in. */
export const OAUTH_DEFAULT_SCOPES: readonly AgentScope[] = ["moon.read"];

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PAGE}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

/** The header a 401 from the connector carries, so a client finds the metadata. */
export function wwwAuthenticate(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

/**
 * A redirect URI a client may register: https, or http on the loopback for a
 * desktop client, with no fragment and no credentials in it.
 */
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return "A redirect URI is a URL of at most 2000 characters.";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "A redirect URI must be an absolute URL.";
  }
  if (u.hash) return "A redirect URI has no fragment.";
  if (u.username || u.password) return "A redirect URI carries no credentials.";
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && loopback) return null;
  return "A redirect URI is https, or http on localhost.";
}

export type Registration = { ok: true; name: string; redirectUris: string[] } | { ok: false; error: string; description: string };

/** A registration body, checked. Only public clients: no secret is issued. */
export function parseRegistration(body: unknown): Registration {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) {
    return { ok: false, error: "invalid_redirect_uri", description: "Send one to five redirect_uris." };
  }
  for (const u of uris) {
    const p = redirectUriProblem(u);
    if (p) return { ok: false, error: "invalid_redirect_uri", description: p };
  }
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return { ok: false, error: "invalid_client_metadata", description: "Only public clients register here: token_endpoint_auth_method is none." };
  }
  const grants = b.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || grants.some((g) => g !== "authorization_code" && g !== "refresh_token"))) {
    return { ok: false, error: "invalid_client_metadata", description: "The only grant here is authorization_code." };
  }
  const name = String(b.client_name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "A connector";
  return { ok: true, name, redirectUris: uris.map(String) };
}

/** The code challenge for a verifier, as S256 makes it. */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** RFC 7636: a verifier is 43 to 128 unreserved characters. */
export function verifierProblem(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(v)) return "code_verifier is 43 to 128 letters, digits, - . _ or ~.";
  return null;
}

/** A challenge as a client sends it: 43 base64url characters, the S256 of a verifier. */
export function challengeProblem(c: unknown, method: unknown): string | null {
  if (method !== "S256") return "code_challenge_method must be S256.";
  if (typeof c !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(c)) return "code_challenge must be the S256 of a code verifier.";
  return null;
}

/** Whether the verifier matches the stored challenge, in constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The scopes a member picked, kept to the connector's list. Empty means none chosen. */
export function chosenScopes(raw: unknown): AgentScope[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : [];
  const out: AgentScope[] = [];
  for (const s of list) {
    const v = String(s);
    if ((OAUTH_SCOPES as readonly string[]).includes(v) && (AGENT_SCOPES as readonly string[]).includes(v) && !out.includes(v as AgentScope)) out.push(v as AgentScope);
  }
  return out;
}

/** Where to send the member back: the registered URI with the code or the error, and the client's state. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  return u.toString();
}
