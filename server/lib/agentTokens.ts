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
import { insertToken, revokeLiveTokensOf } from "../repos/agentTokens";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { revokeOpenInvitesOf } from "../repos/memberInvites";
import { removeInbox } from "./agentInbox";
import { endVoiceGiven, type DelegationNotice } from "./delegation";
import { recordEvent } from "./events";
import { revokeFeedTokens } from "./icsFeed";
import { removeMemberKey } from "./memberSecrets";
import { insertNotification } from "./notify";
import { stopAddress } from "./sessionCalendar";
import { whileSessionHolds } from "./sessionHold";

/*
 * The session lock and the tombstone test live in server/lib/sessionHold.ts,
 * which keeps this file's imports out from under the ballots. `holderStands`
 * is answered from here as well, for the callers that always asked here.
 */
export { holderStands } from "./sessionHold";

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
  | { ok: false; status: 400 | 401 | 429; error: string };

/**
 * Mint. The token value is in the result and nowhere else: not in the row,
 * not in the audit line, not in a log.
 *
 * MINTED WHILE THE SESSION HOLDS (adversarial round 4). `sessionVersion` is
 * the tokenVersion the request's session was checked at, and
 * `POST /api/agent/tokens` always passes it. A token reads as the member for
 * up to a year, and a new password and an admin's revoke sessions end every
 * token on both sides of the bump (`endAgentReach`). With a version the row
 * is written under the member's row lock, and only while the row still
 * carries it (`whileSessionHolds`): a change that committed first is refused
 * with status 401 and no token, and one that comes later waits for the
 * commit, and the end after the bump revokes the token. Without one it writes
 * as it always has, for a caller that acts for no session.
 */
export async function mintToken(pool: Pool, userId: string, input: MintInput, sessionVersion?: number): Promise<MintResult> {
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
  const write = (db: Pool | PoolConnection) =>
    insertToken(db, { id, userId, name, tokenHash: hashToken(token), prefix, scopes: input.scopes, expiresAt });
  if (sessionVersion === undefined) {
    await write(pool);
  } else {
    const held = await whileSessionHolds(pool, userId, sessionVersion, write);
    if (!held.ok) return { ok: false, status: 401, error: "auth_required" };
  }
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
  if (done) await recordRevoke(pool, userId, id);
  return done;
}

/** The audit line a revoke writes, whichever door ended the token. */
async function recordRevoke(pool: Pool, userId: string, id: string): Promise<void> {
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

/**
 * End every live token a member holds, and say how many.
 *
 * Setting a password (the first claim, a reset, a change) and an admin's
 * "revoke sessions" reach this through `endAgentReach` (set-password inside
 * `withAgentReachEnded`). Both bump tokenVersion, which ends every session, and
 * an agent token is not a session: the agent resolver (server/index.ts) mints
 * one from the holder's CURRENT tokenVersion on every call, so the bump alone
 * never reached a token. Somebody holding a stolen password could mint one for
 * a year and keep it past the reset that answered the theft.
 *
 * One audit line per token, the line `revokeToken` writes.
 */
export async function revokeAllTokens(pool: Pool, userId: string): Promise<number> {
  const ids = await revokeLiveTokensOf(pool, userId);
  for (const id of ids) await recordRevoke(pool, userId, id);
  return ids.length;
}

/** What `endAgentReach` ended, part by part. */
export interface AgentReachEnded {
  /** `vat_` tokens revoked. */
  agentTokens: number;
  /** Private calendar feed addresses revoked. */
  feeds: number;
  /** The agent inbox removed, with every delivery still queued for it. */
  inbox: boolean;
  /** The member's own model key removed. */
  key: boolean;
  /** Open invitation links withdrawn. A link somebody already used stays: it records an admission. */
  invites: number;
  /** The circle calendar's private address stopped, 1 or 0. */
  circleFeed: number;
  /** The delegation the member gave, accepted or still an offer, ended (`endVoiceGiven`, lib/delegation.ts). */
  delegation: boolean;
}

const NOTHING_ENDED: AgentReachEnded = { agentTokens: 0, feeds: 0, inbox: false, key: false, invites: 0, circleFeed: 0, delegation: false };

/** What `endAgentReach` needs from its host. */
export interface AgentReachDeps {
  /**
   * The notification spine as the server holds it, so the one notice this
   * writes, the member's vote handed back to them, follows their mail
   * preference. Absent, the notice is written to the bell with no mail
   * (`bellOnly` below), so leaving it out loses no notice: the daily digest
   * still carries it.
   */
  notify?: (notice: DelegationNotice) => Promise<unknown>;
}

/** The notification spine with no mail, for a caller that hands no `notify`: a script or a test. */
const bellOnly = (pool: Pool) => (notice: DelegationNotice) =>
  insertNotification(
    {
      pool,
      memberById: async () => null,
      sendEmail: async () => ({ accepted: false, status: "skipped", reason: "the reach end was handed no mailer" }),
      origin: () => "",
      projectName: () => "",
      isPresent: () => false,
    },
    notice,
  );

/** What the audit lines say ended the feeds, the inbox, the key and the links. */
const ENDED_BY = "a new password or a session revoke ended it";

/** Thrown once every part was tried and one or more could not be ended. */
export class AgentReachNotEnded extends Error {
  readonly parts: string[];
  readonly ended: AgentReachEnded;
  constructor(parts: string[], ended: AgentReachEnded, cause: unknown) {
    super(`could not end the member's ${parts.join(", ")}`, { cause });
    this.name = "AgentReachNotEnded";
    this.parts = parts;
    this.ended = ended;
  }
}

/**
 * End everything a signed-in session can leave standing for an agent, and say
 * what ended (adversarial round 1, findings 0 and 33).
 *
 * A token is one of six. A stolen session can also mint a private calendar
 * feed address, which never expires and serves the member's own layers; point
 * the agent inbox at a host it owns, so the week ahead, the weekly digest and
 * every introduction keep arriving there signed; and store a model key on an
 * endpoint it owns, so every question the member asks the assistant sends its
 * prompt, the member's own note among it, to that host. All four stood past
 * the reset that answered the theft until this ended them.
 *
 * Two more act in the member's name (adversarial round 3, finding 7). A
 * session holding `member.vouch` can make up to twenty invitation links, and
 * each one admits a stranger on the member's vouch for fourteen days, in an
 * invite-only village too, where a link is the only way in. And it can make
 * the circle calendar's private address, which never expires and serves the
 * members-only meetings of the circles the member follows. Open links are
 * withdrawn; a link somebody already used made an account and stays the
 * record of that admission, with the arrival vouch it recorded.
 *
 * It only calls the functions that already end each one, so this file grows
 * no SQL: `revokeAllTokens`, `revokeFeedTokens` (lib/icsFeed.ts),
 * `removeInbox` (lib/agentInbox.ts, which also drops the queue),
 * `removeMemberKey` (lib/memberSecrets.ts), `revokeOpenInvitesOf`
 * (repos/memberInvites.ts) and `stopAddress` (lib/sessionCalendar.ts). The
 * member's own notes, drafts and agent profile stay: a reset ends access,
 * never what the member wrote. The member can make links and an address
 * again from the session the reset hands back.
 *
 * And the vote the member handed on (round 3, finding 8, a decision for Rye
 * built as recommended): a session needs only `ballot.vote` to hand it to an
 * account the thief holds, and once that account accepts, every open ballot
 * copies its choice onto the member's row. `endVoiceGiven` ends the
 * delegation the member GAVE, derives every open ballot again and tells the
 * member through `deps.notify`. One handed TO the member stays. A vote the
 * stolen session cast directly stays as cast.
 *
 * Every part is tried even when an earlier one throws, so one bad table never
 * leaves the others standing. Then, if any failed, it throws
 * `AgentReachNotEnded` naming them. Idempotent: a second run ends nothing.
 */
export async function endAgentReach(pool: Pool, userId: string, deps: AgentReachDeps = {}): Promise<AgentReachEnded> {
  const failed: string[] = [];
  let cause: unknown;
  async function part<T>(name: string, end: () => Promise<T>, none: T): Promise<T> {
    try {
      return await end();
    } catch (err) {
      failed.push(name);
      cause ??= err;
      return none;
    }
  }
  const ended: AgentReachEnded = {
    agentTokens: await part("agent tokens", () => revokeAllTokens(pool, userId), 0),
    feeds: await part("calendar feed", () => revokeFeedTokens(pool, userId), 0),
    inbox: await part("agent inbox", () => removeInbox(pool, userId, ENDED_BY), false),
    key: await part("model key", () => removeMemberKey(pool, userId), false),
    invites: await part("invitation links", () => revokeOpenInvitesOf(pool, userId), 0),
    circleFeed: await part("circle calendar address", () => stopAddress(pool, { userId }), 0),
    delegation: await part("delegation", () => endVoiceGiven(pool, userId, deps.notify ?? bellOnly(pool)), false),
  };
  const line = { actorUserId: userId, actorKind: "system" as const, audience: "admin" as const };
  if (ended.feeds) {
    await recordEvent(pool, { ...line, kind: "calendar_feed_revoked", text: `private calendar feed address revoked: ${ENDED_BY}`, entityType: "calendar", entityRef: "feed" });
  }
  if (ended.key) {
    await recordEvent(pool, { ...line, kind: "agent_key", text: `own assistant key removed: ${ENDED_BY}`, entityType: "member_key", entityRef: userId });
  }
  if (ended.invites) {
    const links = ended.invites === 1 ? "1 open invitation link" : `${ended.invites} open invitation links`;
    await recordEvent(pool, { ...line, kind: "invites_withdrawn", text: `${links} withdrawn: ${ENDED_BY}`, entityType: "member_invites", entityRef: userId });
  }
  if (ended.circleFeed) {
    await recordEvent(pool, { ...line, kind: "calendar_feed_revoked", text: `circle calendar address stopped: ${ENDED_BY}`, entityType: "calendar", entityRef: "circles" });
  }
  if (ended.delegation) {
    await recordEvent(pool, { ...line, kind: "delegation_ended", text: `vote delegation ended: ${ENDED_BY}`, entityType: "delegation", entityRef: userId });
  }
  if (failed.length) throw new AgentReachNotEnded(failed, ended, cause);
  return ended;
}

function addEnded(a: AgentReachEnded, b: AgentReachEnded): AgentReachEnded {
  return {
    agentTokens: a.agentTokens + b.agentTokens,
    feeds: a.feeds + b.feeds,
    inbox: a.inbox || b.inbox,
    key: a.key || b.key,
    invites: a.invites + b.invites,
    circleFeed: a.circleFeed + b.circleFeed,
    delegation: a.delegation || b.delegation,
  };
}

/**
 * Change a member's password with their agent's reach ended on BOTH sides of
 * the change (adversarial round 1, finding 28). set-password runs its
 * tokenVersion bump through this.
 *
 * An admin's revoke sessions does NOT. It has no link to keep unspent, and
 * ending the sessions must never wait on anything else, because that revoke is
 * the lever for a compromise. So it bumps first, then calls `endAgentReach`,
 * whose failure answers 500 by name; pressing again finishes it.
 *
 * BEFORE the change, and a failure here throws: `change` never runs, so the
 * password and tokenVersion are as they were and a set-password link is still
 * unspent. "Try again" then really finishes the reset. The reset used to bump
 * first, which spends the link, so a failure after it left every token
 * standing and refused the retry as a used link.
 *
 * AFTER the change, because the bump is what stops an old session planting a
 * replacement: anything planted between the two calls ends here. This end
 * never throws. The change has landed (the link is spent), everything that
 * stood before it is already ended, and a 500 now would only withhold the new
 * session. It is tried twice, and a second failure is logged and recorded for
 * an admin by name.
 *
 * A request already past its session check when the bump lands can still
 * reach its write after the second end returns. Every write this end reaches
 * closes that itself: a `vat_` token (`mintToken`), the private calendar feed
 * (`mintFeedToken`), the inbox, the model key, an invitation link
 * (`makeInvite`), the circle calendar address (`makeAddress`) and the
 * delegation the member gives (`setDelegation`). Each writes under the
 * member's row lock only while the session's tokenVersion is still the row's
 * (`whileSessionHolds`, server/lib/sessionHold.ts), so such a write either
 * lands before the bump, and the second end removes it, or is refused with
 * 401 auth_required (adversarial round 2, finding 15; rounds 3 and 4).
 */
export async function withAgentReachEnded<T>(
  pool: Pool,
  userId: string,
  change: () => Promise<T>,
  deps: {
    end?: (pool: Pool, userId: string, reach?: AgentReachDeps) => Promise<AgentReachEnded>;
    log?: (message: string, err: unknown) => void;
    /** Handed to each end (`AgentReachDeps.notify`). */
    notify?: AgentReachDeps["notify"];
  } = {},
): Promise<{ changed: T; ended: AgentReachEnded }> {
  const end = deps.end ?? endAgentReach;
  const log = deps.log ?? ((message: string, err: unknown) => console.error(message, err));
  const reach: AgentReachDeps = { notify: deps.notify };
  const before = await end(pool, userId, reach);
  const changed = await change();
  let after = NOTHING_ENDED;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      after = addEnded(after, await end(pool, userId, reach));
      break;
    } catch (err) {
      if (err instanceof AgentReachNotEnded) after = addEnded(after, err.ended);
      if (attempt < 2) continue;
      log(`[agent] the agent reach planted during a credential change for ${userId} was NOT ended`, err);
      await recordEvent(pool, {
        kind: "agent_reach",
        text: "could not end the agent reach planted while a password changed or sessions ended; revoke sessions again",
        actorUserId: userId, actorKind: "system", entityType: "user", entityRef: userId, audience: "admin",
      });
    }
  }
  return { changed, ended: addEnded(before, after) };
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
