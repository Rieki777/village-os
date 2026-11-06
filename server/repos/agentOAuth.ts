/**
 * The connector's OAuth clients and codes (0319; End of Moon addendum v6, B4).
 *
 *   agent_oauth_clients  a client registered dynamically: its id, the name it
 *                        gave and the redirect URIs it may send a member back
 *                        to. It names no member.
 *   agent_oauth_codes    a single-use, ten-minute code for one member, bound to
 *                        one client, one redirect URI, the scopes the member
 *                        chose and a PKCE challenge. Only its hash is kept.
 *                        `scopes_json` also carries the session version the
 *                        member allowed it under, so a password change in
 *                        between ends the code as it ends every token.
 *                        Erased with the member (`forgetAgentForMember`).
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const CODE_TTL_MS = 10 * 60 * 1000;

const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

export async function insertOAuthClient(pool: Pool, name: string, redirectUris: string[]): Promise<OAuthClient> {
  const clientId = `vac-${randomBytes(12).toString("hex")}`;
  await pool.query("INSERT INTO `agent_oauth_clients` (`client_id`, `name`, `redirect_uris_json`) VALUES (?,?,?)", [clientId, name, JSON.stringify(redirectUris)]);
  return (await oauthClient(pool, clientId))!;
}

export async function oauthClient(pool: Pool, clientId: string): Promise<OAuthClient | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `agent_oauth_clients` WHERE `client_id` = ? LIMIT 1", [clientId]);
  const r = rows[0];
  if (!r) return null;
  let uris: unknown = [];
  try {
    uris = JSON.parse(String(r.redirect_uris_json ?? "[]"));
  } catch {
    uris = [];
  }
  return {
    clientId: String(r.client_id),
    name: String(r.name),
    redirectUris: Array.isArray(uris) ? uris.map(String) : [],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
  };
}

export interface CodeInput {
  clientId: string;
  userId: string;
  scopes: string[];
  codeChallenge: string;
  redirectUri: string;
  /** The member's tokenVersion when they pressed Allow. */
  sessionVersion: number;
}

/** A fresh code. The value is returned once and only its hash is stored. */
export async function insertOAuthCode(pool: Pool, c: CodeInput, now = Date.now()): Promise<string> {
  const code = `vco_${randomBytes(32).toString("base64url")}`;
  await pool.query(
    "INSERT INTO `agent_oauth_codes` (`code_hash`, `client_id`, `user_id`, `scopes_json`, `code_challenge`, `redirect_uri`, `expires_at`) VALUES (?,?,?,?,?,?,?)",
    [hash(code), c.clientId, c.userId, JSON.stringify({ scopes: c.scopes, sessionVersion: c.sessionVersion }), c.codeChallenge, c.redirectUri, new Date(now + CODE_TTL_MS)],
  );
  return code;
}

export interface StoredCode extends CodeInput {
  expiresAt: Date;
  usedAt: Date | null;
}

export async function oauthCode(pool: Pool, code: string): Promise<StoredCode | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM `agent_oauth_codes` WHERE `code_hash` = ? LIMIT 1", [hash(code)]);
  const r = rows[0];
  if (!r) return null;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(String(r.scopes_json ?? "{}"));
  } catch {
    parsed = {};
  }
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as { scopes?: unknown; sessionVersion?: unknown };
  return {
    clientId: String(r.client_id),
    userId: String(r.user_id),
    scopes: Array.isArray(p.scopes) ? p.scopes.map(String) : [],
    // A code with no recorded version can never pass `whileSessionHolds`.
    sessionVersion: Number.isInteger(p.sessionVersion) ? Number(p.sessionVersion) : -1,
    codeChallenge: String(r.code_challenge),
    redirectUri: String(r.redirect_uri),
    expiresAt: new Date(r.expires_at),
    usedAt: r.used_at ? new Date(r.used_at) : null,
  };
}

/** Spend a code. True exactly once: a second spend, even a concurrent one, answers false. */
export async function spendOAuthCode(pool: Pool, code: string): Promise<boolean> {
  const [res] = await pool.query("UPDATE `agent_oauth_codes` SET `used_at` = CURRENT_TIMESTAMP WHERE `code_hash` = ? AND `used_at` IS NULL", [hash(code)]);
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) === 1;
}
