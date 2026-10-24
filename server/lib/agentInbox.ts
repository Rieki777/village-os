/**
 * The agent inbox (round 4, lane L6): one https URL a member sets so the
 * things the village sends them (the week ahead, the weekly digest, an
 * opportunity) also reach their agent, signed, with retries, and with a
 * circuit breaker so a dead endpoint stops being dialled.
 *
 * Every delivery goes out through `guardedFetchJson`, the pinned SSRF-guarded
 * dialer, and the URL is re-checked at every attempt: a member can point the
 * hook at a public host today and re-point its DNS at 169.254.169.254
 * tomorrow, and the guard is per attempt for exactly that reason.
 *
 * The per-inbox secret is HMAC(MEMBER_SECRETS_KEY, inboxId). It is derived, so
 * it is never stored, and it is shown once when the URL is set. Absent
 * MEMBER_SECRETS_KEY there is no secret to derive and the inbox refuses to
 * exist, with the same sentence the key store uses.
 *
 * Signature: `X-Village-Signature: t=<sentAt>,v1=<hex hmac>` over
 * `${sentAt}.${signedBody}`, where signedBody is the JSON of the four fields
 * id, kind, sentAt, data in that order, exactly as this process serialised
 * them; the wire body is that object plus a `signature` field carrying the
 * same value, for receivers that cannot read headers. A receiver rebuilds the
 * four-field JSON (or strips `signature` and re-serialises) and compares.
 *
 * Payloads never carry another member's hidden fields: the kinds this module
 * ships are built from the member's own view (`weekAhead` for the member) or
 * are handed in by L7 already scoped to the recipient. This module does not
 * read anyone else's row.
 */
import { createHmac, randomBytes } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { guardOutboundUrl } from "./toolcheck";
import { NO_MEMBER_SECRETS_KEY_SENTENCE, memberSecretsKey } from "./memberSecrets";
import { recordEvent } from "./events";
import { holderStands, whileSessionHolds } from "./agentTokens";
import { usersRepo } from "../repos/users";
import { enabledInboxUserIds, forgetInboxOf } from "../repos/memberAgent";

export const DELIVERY_KINDS = ["test", "week_ahead", "weekly_digest", "opportunity"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Attempt n (1-based) that fails waits RETRY_DELAYS_MS[n-1] before the next; the fifth failure drops. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
export const DISABLE_AFTER_FAILURES = 10;
export const SIGNATURE_HEADER = "X-Village-Signature";
/**
 * What a dropped delivery records when this deployment has no member-secrets
 * key. Exported because the failed-actions report counts drops by this exact
 * text, and two copies of one sentence drift apart.
 */
export const NO_MEMBER_SECRETS_KEY = "no member-secrets key";

export interface InboxRow {
  id: string;
  userId: string;
  url: string;
  enabled: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  createdAt: string;
}

export interface DeliveryRow {
  id: string;
  inboxId: string;
  kind: DeliveryKind;
  payload: unknown;
  attempts: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  droppedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

function toInbox(r: RowDataPacket): InboxRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    url: String(r.url),
    enabled: Boolean(r.enabled),
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    disabledReason: r.disabled_reason ? String(r.disabled_reason) : null,
    lastDeliveryAt: iso(r.last_delivery_at),
    lastStatus: r.last_status ? String(r.last_status) : null,
    createdAt: iso(r.created_at) ?? "",
  };
}

function toDelivery(r: RowDataPacket): DeliveryRow {
  let payload: unknown = r.payload;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { /* keep the string */ } }
  return {
    id: String(r.id),
    inboxId: String(r.inbox_id),
    kind: String(r.kind) as DeliveryKind,
    payload,
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: iso(r.next_attempt_at) ?? "",
    deliveredAt: iso(r.delivered_at),
    droppedAt: iso(r.dropped_at),
    lastError: r.last_error ? String(r.last_error) : null,
    createdAt: iso(r.created_at) ?? "",
  };
}

// ── The secret and the signature ─────────────────────────────────────────────

/** Derived, never stored. Null when the deployment has no member-secrets key. */
export function inboxSecret(inboxId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const master = memberSecretsKey(env);
  if (!master) return null;
  return createHmac("sha256", master).update(`agent-inbox:${inboxId}`).digest("hex");
}

export function signDelivery(secret: string, sentAt: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${sentAt}.${rawBody}`).digest("hex");
}

/** The header value, in the shape most webhook receivers already parse. */
export function signatureHeader(sentAt: string, signature: string): string {
  return `t=${sentAt},v1=${signature}`;
}

export interface Envelope {
  id: string;
  kind: DeliveryKind;
  sentAt: string;
  data: unknown;
}

/**
 * What goes on the wire: the raw body string (sign THIS), the header, and the
 * body with `signature` folded in for receivers that cannot read headers.
 * The header signature is over `rawBody`, which is the envelope WITHOUT the
 * signature field, so a receiver checks the header against the body minus
 * `signature`, or the in-body signature against `${sentAt}.${JSON of the four
 * fields id, kind, sentAt, data in that order}`. Both recipes are documented in
 * docs/skills/references/agent-inbox.md, shared by all three skills.
 */
export function buildDelivery(secret: string, env: Envelope): { rawBody: string; header: string; body: Envelope & { signature: string } } {
  const rawBody = JSON.stringify({ id: env.id, kind: env.kind, sentAt: env.sentAt, data: env.data });
  const signature = signDelivery(secret, env.sentAt, rawBody);
  return {
    rawBody,
    header: signatureHeader(env.sentAt, signature),
    body: { id: env.id, kind: env.kind, sentAt: env.sentAt, data: env.data, signature },
  };
}

/** For a receiver in this codebase (tests, the hub): true when either recipe matches. */
export function verifyDelivery(secret: string, body: any, header?: string | null): boolean {
  if (!body || typeof body !== "object") return false;
  const rawBody = JSON.stringify({ id: body.id, kind: body.kind, sentAt: body.sentAt, data: body.data });
  const want = signDelivery(secret, String(body.sentAt ?? ""), rawBody);
  const fromHeader = header ? /v1=([0-9a-f]+)/.exec(header)?.[1] ?? null : null;
  const given = fromHeader ?? (typeof body.signature === "string" ? body.signature : null);
  if (!given || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ── The inbox ────────────────────────────────────────────────────────────────

/**
 * Whether anybody still stands behind an inbox: a member row that is not an
 * erasure's tombstone. The same test a `vat_` token meets at use
 * (`holderStands`), and a missing row fails it too.
 *
 * WHY THE INBOX ASKS, when the erasure sweep deletes inboxes again after the
 * tombstone ("member-agent-after-tombstone"). A request checks its session
 * once, at the start, and `setInbox` then waits on a DNS lookup whose length
 * the member's own nameserver sets. Started before an erasure, it could write
 * after that step had deleted, and no step runs again. So the write asks
 * under the member's row lock (`whileSessionHolds`, which also refuses a
 * session a new password or a revoke ended), and every place a delivery is
 * queued or sent asks here before anything leaves. An inbox that fails is
 * removed where it is found, with everything queued for it.
 */
async function holderListens(pool: Pool, userId: string): Promise<boolean> {
  return holderStands(await usersRepo(pool).byId(userId));
}

const INBOX_HOLDER_GONE = "This account can no longer hold an agent inbox";

export async function getInbox(pool: Pool, userId: string): Promise<InboxRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM agent_inboxes WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ? toInbox(rows[0]) : null;
}

export type SetInboxResult =
  | { ok: true; inbox: InboxRow; secret: string }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string };

/**
 * Set or replace the member's inbox URL. Setting a new URL mints a new inbox
 * id, so the secret rotates with the URL and the old one stops verifying.
 * The secret is in the result and nowhere else.
 *
 * `sessionVersion` is the tokenVersion the request's session was checked at.
 * The write lands only while the member's row still carries it, and a
 * session that a new password, a revoke or signing out ended since its check
 * answers 401 with nothing written (`whileSessionHolds`).
 */
export async function setInbox(
  pool: Pool,
  userId: string,
  rawUrl: unknown,
  env: NodeJS.ProcessEnv = process.env,
  sessionVersion: number,
): Promise<SetInboxResult> {
  if (!memberSecretsKey(env)) return { ok: false, status: 503, error: NO_MEMBER_SECRETS_KEY_SENTENCE };
  const url = String(rawUrl ?? "").trim();
  if (!url || url.length > 2048) return { ok: false, status: 400, error: "Give the URL your agent listens on" };
  const guard = await guardOutboundUrl(url);
  // Generic on purpose: the guard's own sentence names the address a host
  // resolved to, and a member-reachable route must not be an oracle for what
  // an internal name points at.
  if (!guard.ok) return { ok: false, status: 400, error: "That URL is not reachable from here. It must be a public https host" };
  const prior = await getInbox(pool, userId);
  const id = `inb-${randomBytes(8).toString("hex")}`;
  // The holder and the session are asked UNDER THE MEMBER'S ROW LOCK, and the
  // write happens inside the same transaction, which is what closes both
  // races. The guard above can wait seconds on DNS. An erasure's tombstone or
  // a tokenVersion bump that lands in that wait has committed before the lock
  // is taken, and this refuses; one that comes later waits for the commit,
  // and the sweep after the tombstone or the end after the bump removes what
  // this wrote. No secret leaves for a write that is refused.
  const held = await whileSessionHolds(pool, userId, sessionVersion, async (conn) => {
    // Replacing the URL retires the old inbox whole: its id, its derived
    // secret and anything still queued for it. A fresh id means a fresh secret.
    if (prior) {
      await conn.query("DELETE FROM agent_deliveries WHERE inbox_id = ?", [prior.id]);
      await conn.query("DELETE FROM agent_inboxes WHERE user_id = ?", [userId]);
    }
    await conn.query(
      "INSERT INTO agent_inboxes (id, user_id, url, enabled, consecutive_failures) VALUES (?,?,?,1,0)",
      [id, userId, url],
    );
  });
  if (!held.ok && held.refusal === "session_ended") return { ok: false, status: 401, error: "auth_required" };
  if (!held.ok) {
    // An inbox that fails its holder is removed where it is found.
    await forgetInboxOf(pool, userId);
    return { ok: false, status: 403, error: INBOX_HOLDER_GONE };
  }
  const inbox = await getInbox(pool, userId);
  const secret = inbox ? inboxSecret(inbox.id, env) : null;
  if (!inbox || !secret) return { ok: false, status: 503, error: NO_MEMBER_SECRETS_KEY_SENTENCE };
  await recordEvent(pool, {
    kind: "agent_inbox",
    text: `set an agent inbox (${new URL(url).hostname})`,
    actorUserId: userId, actorKind: "agent", entityType: "agent_inbox", entityRef: inbox.id, audience: "admin",
  });
  return { ok: true, inbox, secret };
}

/**
 * Remove the member's inbox and everything still queued for it.
 *
 * `endedBy` names what ended it when the member did not press Remove: a new
 * password or an admin's revoke sessions (`endAgentReach`,
 * server/lib/agentTokens.ts). The audit line then says the platform did it,
 * and never credits the member with a removal somebody else caused.
 */
export async function removeInbox(pool: Pool, userId: string, endedBy?: string): Promise<boolean> {
  const inbox = await getInbox(pool, userId);
  if (!inbox) return false;
  await pool.query("DELETE FROM agent_deliveries WHERE inbox_id = ?", [inbox.id]);
  await pool.query("DELETE FROM agent_inboxes WHERE user_id = ?", [userId]);
  await recordEvent(pool, {
    kind: "agent_inbox", text: endedBy ? `agent inbox removed: ${endedBy}` : "removed their agent inbox",
    actorUserId: userId, actorKind: endedBy ? "system" : "agent", entityType: "agent_inbox", entityRef: inbox.id, audience: "admin",
  });
  return true;
}

// ── The queue ────────────────────────────────────────────────────────────────

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "no_inbox" | "disabled" | "bad_kind" };

/**
 * THE SEAM FOR L7 AND L5b: queue one delivery to a member's agent inbox.
 *
 *   enqueueAgentDelivery(pool, userId, { kind: "weekly_digest", data })
 *
 * Nothing is sent here; the drain job sends. A member with no inbox, or a
 * disabled one, is a quiet no-op with a reason, never an error into the
 * caller: the digest goes on landing in the member's own inbox and email
 * whether or not their agent is listening. An inbox nobody stands behind any
 * more (`holderListens`) answers "no_inbox" and is removed.
 */
export async function enqueueAgentDelivery(
  pool: Pool,
  userId: string,
  payload: { kind: DeliveryKind; data: unknown },
): Promise<EnqueueResult> {
  if (!DELIVERY_KINDS.includes(payload?.kind)) return { ok: false, reason: "bad_kind" };
  const inbox = await getInbox(pool, userId);
  if (!inbox) return { ok: false, reason: "no_inbox" };
  if (!(await holderListens(pool, userId))) {
    await forgetInboxOf(pool, userId);
    return { ok: false, reason: "no_inbox" };
  }
  if (!inbox.enabled) return { ok: false, reason: "disabled" };
  const id = `dlv-${randomBytes(8).toString("hex")}`;
  await pool.query(
    "INSERT INTO agent_deliveries (id, inbox_id, kind, payload, attempts, next_attempt_at) VALUES (?,?,?,?,0,UTC_TIMESTAMP())",
    [id, inbox.id, payload.kind, JSON.stringify(payload.data ?? null)],
  );
  return { ok: true, id };
}

/** Injected so this file never imports the calendar's readers. */
export interface WeekAheadDeps {
  /** The member's own view of the week (`weekAhead` for that member). */
  build(userId: string): Promise<unknown>;
  timezone: string;
}

/**
 * The `agent-week-ahead` job's body: the week ahead, queued to every enabled
 * inbox whose holder still stands, from the member's own view of the calendar.
 *
 * The holder is asked BEFORE the week is built. Any user id reads the circle
 * and household layers (`visibleLayersFor`), so a tombstone's id would build
 * the village's signed-in week, places and all, and only the enqueue's own
 * check would stop it leaving.
 */
export async function queueWeekAhead(pool: Pool, deps: WeekAheadDeps): Promise<{ queued: number }> {
  let queued = 0;
  for (const userId of await enabledInboxUserIds(pool)) {
    if (!(await holderListens(pool, userId))) {
      await forgetInboxOf(pool, userId);
      continue;
    }
    const items = await deps.build(userId);
    const q = await enqueueAgentDelivery(pool, userId, { kind: "week_ahead", data: { timezone: deps.timezone, items } });
    if (q.ok) queued += 1;
  }
  return { queued };
}

export async function listDeliveries(pool: Pool, inboxId: string, limit = 20): Promise<DeliveryRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM agent_deliveries WHERE inbox_id = ? ORDER BY created_at DESC LIMIT ?",
    [inboxId, Math.max(1, Math.min(100, limit))],
  );
  return rows.map(toDelivery);
}

/** Injected so this file never imports the server. */
export interface DrainDeps {
  /** POST JSON to a guarded URL with extra headers. Throws on refusal or non-2xx. */
  post(url: string, body: unknown, headers: Record<string, string>): Promise<unknown>;
  /** Tell the member their inbox was switched off, and why. Never throws. */
  notifyDisabled(userId: string, reason: string): Promise<void>;
  env?: NodeJS.ProcessEnv;
  now?(): Date;
}

export interface DrainSummary {
  sent: number;
  failed: number;
  dropped: number;
  disabled: number;
}

/**
 * Send what is due. Each row is claimed with a conditional UPDATE on
 * `attempts`, so two processes ticking together never send one delivery
 * twice. Failures back off along RETRY_DELAYS_MS; the fifth failure drops the
 * row; ten consecutive failures across rows disable the inbox and tell the
 * member. The URL is re-guarded at every attempt through `post`, which is
 * `guardedFetchJson` in production. A row whose holder no longer stands
 * (`holderListens`) is never dialled: its inbox goes, and the row with it.
 */
export async function drainDeliveries(pool: Pool, deps: DrainDeps, batch = 50): Promise<DrainSummary> {
  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : new Date();
  const summary: DrainSummary = { sent: 0, failed: 0, dropped: 0, disabled: 0 };
  const [due] = await pool.query<RowDataPacket[]>(
    "SELECT d.*, i.url AS inbox_url, i.user_id AS inbox_user_id, i.enabled AS inbox_enabled, i.consecutive_failures AS inbox_failures " +
      "FROM agent_deliveries d JOIN agent_inboxes i ON i.id = d.inbox_id " +
      "WHERE d.delivered_at IS NULL AND d.dropped_at IS NULL AND d.next_attempt_at <= ? " +
      "ORDER BY d.next_attempt_at ASC LIMIT ?",
    [now, Math.max(1, Math.min(200, batch))],
  );
  // Asked once per holder per batch, before anything is claimed or dialled. A
  // holder who fails takes their inbox and everything queued for it with them,
  // so the rest of this batch for them is already gone.
  const listens = new Map<string, boolean>();
  for (const r of due) {
    const row = toDelivery(r);
    const inboxUserId = String(r.inbox_user_id);
    if (!listens.has(inboxUserId)) {
      const stands = await holderListens(pool, inboxUserId);
      listens.set(inboxUserId, stands);
      if (!stands) await forgetInboxOf(pool, inboxUserId);
    }
    if (!listens.get(inboxUserId)) {
      summary.dropped += 1;
      continue;
    }
    if (!Boolean(r.inbox_enabled)) {
      // The inbox went dark after this was queued. Drop, quietly.
      await pool.query("UPDATE agent_deliveries SET dropped_at = ?, last_error = 'inbox disabled' WHERE id = ?", [now, row.id]);
      summary.dropped += 1;
      continue;
    }
    // Claim.
    const [claim]: any = await pool.query(
      "UPDATE agent_deliveries SET attempts = attempts + 1 WHERE id = ? AND attempts = ?",
      [row.id, row.attempts],
    );
    if (!Number(claim?.affectedRows ?? 0)) continue;
    const attempt = row.attempts + 1;
    const secret = inboxSecret(row.inboxId, env);
    let error: string | null = null;
    if (!secret) {
      error = NO_MEMBER_SECRETS_KEY;
    } else {
      const wire = buildDelivery(secret, { id: row.id, kind: row.kind, sentAt: now.toISOString(), data: row.payload });
      try {
        await deps.post(String(r.inbox_url), wire.body, { [SIGNATURE_HEADER]: wire.header });
      } catch (e: any) {
        // Status codes and timeouts as they are; a range-guard refusal is
        // shortened so the panel never shows what a name resolved to.
        const msg = String(e?.message ?? e);
        error = (/private address|DNS resolution/.test(msg) ? "refused by the outbound guard" : msg).slice(0, 200);
      }
    }
    if (!error) {
      await pool.query("UPDATE agent_deliveries SET delivered_at = ?, last_error = NULL WHERE id = ?", [now, row.id]);
      await pool.query(
        "UPDATE agent_inboxes SET consecutive_failures = 0, last_delivery_at = ?, last_status = 'delivered' WHERE id = ?",
        [now, row.inboxId],
      );
      summary.sent += 1;
      continue;
    }
    summary.failed += 1;
    // Never a body, never a URL with a query in it: a status word or a short refusal.
    const status = `failed: ${error}`.slice(0, 64);
    if (attempt >= MAX_ATTEMPTS) {
      await pool.query("UPDATE agent_deliveries SET dropped_at = ?, last_error = ? WHERE id = ?", [now, error, row.id]);
      summary.dropped += 1;
    } else {
      const next = new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]);
      await pool.query("UPDATE agent_deliveries SET next_attempt_at = ?, last_error = ? WHERE id = ?", [next, error, row.id]);
    }
    const failures = Number(r.inbox_failures ?? 0) + 1;
    if (failures >= DISABLE_AFTER_FAILURES) {
      const reason = `switched off after ${failures} failed deliveries in a row`;
      await pool.query(
        "UPDATE agent_inboxes SET enabled = 0, consecutive_failures = ?, disabled_reason = ?, last_status = ? WHERE id = ?",
        [failures, reason, status, row.inboxId],
      );
      summary.disabled += 1;
      // The rest of this batch for the same inbox drops instead of dialling a
      // dead endpoint nine more times.
      for (const other of due) if (String(other.inbox_id) === row.inboxId) other.inbox_enabled = 0;
      try { await deps.notifyDisabled(inboxUserId, reason); } catch { /* notify never blocks the drain */ }
    } else {
      await pool.query(
        "UPDATE agent_inboxes SET consecutive_failures = ?, last_status = ? WHERE id = ?",
        [failures, status, row.inboxId],
      );
      // The JOIN read the count once; carry it forward so ten failures inside
      // one batch still disable, instead of only across ticks.
      for (const other of due) if (String(other.inbox_id) === row.inboxId) other.inbox_failures = failures;
    }
  }
  return summary;
}
