/**
 * Personal access tokens for a member's own agent (round 4, lane L6).
 *
 * The token is `vat_` plus 32 random bytes, base64url. It is shown once at
 * mint and stored as a SHA-256 hex digest. NO SALT, and here is why: a salt
 * defends a low-entropy secret (a password) against a precomputed table. This
 * secret carries 256 bits of randomness, so the table does not exist, and a
 * per-row salt would cost the unique index that makes "which member is this"
 * one indexed lookup instead of a scan with a hash per row.
 *
 * Scopes are a closed vocabulary chosen at mint. They are NOT a second
 * permission system: a scope says which of the member's OWN routes the agent
 * may call, and every one of those routes still runs its own gate for the
 * holder (`authedUser`, `hasCapability`, `requireModule`). A token can only
 * ever narrow what its holder already sees.
 *
 * Confirm tokens close the two-call write. The first call answers 202 with an
 * echo of exactly what will be written and a token that binds the hash of that
 * echo, the action, the holder and a ten-minute expiry under the server's
 * signing secret. The second call must send the same echo back with the token.
 * A changed echo, a missing token, an old token or someone else's token is a
 * 409 and nothing writes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { recordEvent } from "./events";

export const TOKEN_PREFIX = "vat_";

/*
 * `map.draft` lets the agent read the village's masterplan and keep a drafted
 * map as the holder's draft (server/routes/agentMap.ts). It never publishes:
 * the holder does that on the map. Only a holder who may draft the land
 * (`map.edit`) gets anything from it, like every scope here.
 */
export const AGENT_SCOPES = ["calendar.read", "directory.read", "me.read", "rsvp.write", "intents.write", "map.draft"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** Read scopes are on by default in the panel; writes are opt-in. */
export const READ_SCOPES: readonly AgentScope[] = ["calendar.read", "directory.read", "me.read"];

export const MINTS_PER_DAY = 5;
export const LIVE_PER_USER = 10;
export const DEFAULT_TTL_DAYS = 90;
export const MAX_TTL_DAYS = 365;
export const CONFIRM_TTL_MS = 10 * 60 * 1000;

export interface AgentTokenRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: AgentScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
}

/** What the panel sees. Never the hash. */
export type AgentTokenView = AgentTokenRow & { live: boolean };

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isAgentBearer(header: string | undefined): boolean {
  return typeof header === "string" && header.startsWith(`Bearer ${TOKEN_PREFIX}`);
}

/** The scope list a member asked for, or a sentence saying why not. */
export function cleanScopes(raw: unknown, opts: { intentsAllowed: boolean }): { ok: true; scopes: AgentScope[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Pick at least one scope" };
  const seen = new Set<string>();
  const scopes: AgentScope[] = [];
  for (const s of raw) {
    const v = String(s);
    if (!(AGENT_SCOPES as readonly string[]).includes(v)) return { ok: false, error: `Unknown scope: ${v.slice(0, 40)}` };
    if (v === "intents.write" && !opts.intentsAllowed) return { ok: false, error: "Posting intents is not open on this deployment yet" };
    if (!seen.has(v)) { seen.add(v); scopes.push(v as AgentScope); }
  }
  return { ok: true, scopes };
}

function toRow(r: RowDataPacket): AgentTokenRow {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  let scopes: unknown = r.scopes;
  if (typeof scopes === "string") { try { scopes = JSON.parse(scopes); } catch { scopes = []; } }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    prefix: String(r.prefix),
    scopes: (Array.isArray(scopes) ? scopes : []).filter((s): s is AgentScope => (AGENT_SCOPES as readonly string[]).includes(String(s))),
    createdAt: iso(r.created_at) ?? "",
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.expires_at) ?? "",
    revokedAt: iso(r.revoked_at),
  };
}

export function isLive(row: AgentTokenRow, now = new Date()): boolean {
  return !row.revokedAt && new Date(row.expiresAt).getTime() > now.getTime();
}

const COLS = "id, user_id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at";

export interface MintInput {
  name: string;
  scopes: AgentScope[];
  ttlDays?: number;
}

export type MintResult =
  | { ok: true; token: string; row: AgentTokenRow }
  | { ok: false; status: 400 | 429; error: string };

/**
 * Mint. The token value is in the result and nowhere else: not in the row,
 * not in the audit line, not in a log.
 */
export async function mintToken(pool: Pool, userId: string, input: MintInput): Promise<MintResult> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, status: 400, error: "Give this token a name so you can tell it apart later" };
  if (!input.scopes.length) return { ok: false, status: 400, error: "Pick at least one scope" };
  const ttl = Math.min(MAX_TTL_DAYS, Math.max(1, Math.floor(Number(input.ttlDays ?? DEFAULT_TTL_DAYS)) || DEFAULT_TTL_DAYS));

  const [[day]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 DAY)",
    [userId],
  );
  if (Number(day?.n ?? 0) >= MINTS_PER_DAY) {
    return { ok: false, status: 429, error: `You can mint ${MINTS_PER_DAY} tokens a day. Revoke one you no longer use, or come back tomorrow` };
  }
  const [[live]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()",
    [userId],
  );
  if (Number(live?.n ?? 0) >= LIVE_PER_USER) {
    return { ok: false, status: 429, error: `You already hold ${LIVE_PER_USER} live tokens. Revoke one first` };
  }

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const id = `atk-${randomBytes(8).toString("hex")}`;
  const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO agent_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at) VALUES (?,?,?,?,?,?,?)",
    [id, userId, name, hashToken(token), prefix, JSON.stringify(input.scopes), expiresAt],
  );
  const row = await tokenById(pool, id);
  if (!row) return { ok: false, status: 400, error: "The token did not save" };
  await recordEvent(pool, {
    kind: "agent_token",
    text: `minted agent token ${prefix}... (${input.scopes.join(", ")}), expires ${expiresAt.toISOString().slice(0, 10)}`,
    actorUserId: userId,
    actorKind: "agent",
    entityType: "agent_token",
    entityRef: id,
    audience: "admin",
  });
  return { ok: true, token, row };
}

export async function tokenById(pool: Pool, id: string): Promise<AgentTokenRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLS} FROM agent_tokens WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listTokens(pool: Pool, userId: string): Promise<AgentTokenView[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => { const row = toRow(r); return { ...row, live: isLive(row) }; });
}

/** Revoke one of your own. A token id that is not yours reads as not found. */
export async function revokeToken(pool: Pool, userId: string, id: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE agent_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [id, userId],
  );
  const done = Number(r?.affectedRows ?? 0) > 0;
  if (done) {
    await recordEvent(pool, {
      kind: "agent_token",
      text: `revoked agent token ${id}`,
      actorUserId: userId,
      actorKind: "agent",
      entityType: "agent_token",
      entityRef: id,
      audience: "admin",
    });
  }
  return done;
}

export type VerifyResult =
  | { ok: true; row: AgentTokenRow }
  | { ok: false; reason: "malformed" | "unknown" | "revoked" | "expired" };

/**
 * Resolve a bearer value to its row. Constant work whether or not the token
 * exists: one hash, one indexed lookup. `last_used_at` is written at most once
 * a minute per token so a busy agent does not turn every read into a write.
 */
export async function verifyToken(pool: Pool, bearer: string): Promise<VerifyResult> {
  const token = String(bearer ?? "").trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 40 || token.length > 128) {
    return { ok: false, reason: "malformed" };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM agent_tokens WHERE token_hash = ? LIMIT 1`,
    [hashToken(token)],
  );
  if (!rows[0]) return { ok: false, reason: "unknown" };
  const row = toRow(rows[0]);
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  if (Date.now() - last > 60_000) {
    void pool.query("UPDATE agent_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]).catch(() => {});
  }
  return { ok: true, row };
}

// ── Confirm tokens ───────────────────────────────────────────────────────────

/** JSON with sorted keys at every level, so two equal echoes hash equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function echoHash(echo: unknown): string {
  return createHash("sha256").update(canonical(echo), "utf8").digest("hex");
}

export interface ConfirmClaims {
  /** What will be written: `rsvp` or `intent`. */
  action: string;
  /** The holder. A confirm token is bound to the member it was issued to. */
  userId: string;
  /** The exact echo the client must send back. */
  echo: unknown;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintConfirmToken(secret: string, claims: ConfirmClaims, now = Date.now(), ttlMs = CONFIRM_TTL_MS): { token: string; expiresAt: string } {
  const exp = now + ttlMs;
  const payload = Buffer.from(
    // `p` is the purpose discriminator: session tokens and set-password tokens
    // share the signing secret and the <b64>.<hmac> shape, and a field name
    // is a weaker wall than a stated purpose.
    JSON.stringify({ p: "confirm", a: claims.action, u: claims.userId, h: echoHash(claims.echo), exp, n: randomBytes(6).toString("base64url") }),
  ).toString("base64url");
  return { token: `${payload}.${sign(secret, payload)}`, expiresAt: new Date(exp).toISOString() };
}

export type ConfirmCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "wrong_action" | "wrong_holder" | "echo_mismatch" };

/**
 * Every reason is distinct so the agent can say which step it got wrong, and
 * every failure is a refusal: there is no branch here that writes.
 */
export function verifyConfirmToken(secret: string, token: unknown, claims: ConfirmClaims, now = Date.now()): ConfirmCheck {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const dot = token.lastIndexOf(".");
  if (dot < 1 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(secret, payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false, reason: "bad_signature" };
  let decoded: any;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (decoded?.p !== "confirm") return { ok: false, reason: "malformed" };
  if (typeof decoded?.exp !== "number" || decoded.exp <= now) return { ok: false, reason: "expired" };
  if (decoded.a !== claims.action) return { ok: false, reason: "wrong_action" };
  if (decoded.u !== claims.userId) return { ok: false, reason: "wrong_holder" };
  if (decoded.h !== echoHash(claims.echo)) return { ok: false, reason: "echo_mismatch" };
  return { ok: true };
}

/** The sentence a 409 carries for each reason. Plain, and never a hint about the secret. */
export const CONFIRM_REASON_SENTENCE: Record<Exclude<ConfirmCheck, { ok: true }>["reason"], string> = {
  missing: "Send confirm: true with the confirmToken and the echo you were given. Nothing was written",
  malformed: "That confirmToken is not one this server issued. Nothing was written",
  bad_signature: "That confirmToken is not one this server issued. Nothing was written",
  expired: "That confirmation expired. Ask again to get a fresh one. Nothing was written",
  wrong_action: "That confirmToken was issued for a different action. Nothing was written",
  wrong_holder: "That confirmToken belongs to a different member. Nothing was written",
  echo_mismatch: "The echo you sent back does not match what you were shown. Nothing was written",
};
