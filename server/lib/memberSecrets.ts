/**
 * A member's own LLM key, encrypted at rest (round 4, lane L6).
 *
 * A MEMBER's key is a third party's credential that one person typed for their
 * own use, and an operator reading the table should not be able to spend it.
 *
 * This file used to say it was the one place in the platform that encrypts,
 * and that its asymmetry with the plaintext village store was deliberate. That
 * stopped being true on 2026-08-30: `secrets.ts` now seals the village's
 * integration credentials too, under its own `VILLAGE_SECRETS_KEY`, because
 * the database backup started leaving the deployment. The cipher both use is
 * `sealedBox.ts`, extracted from this file unchanged rather than copied, so
 * the two stores cannot drift into two different ideas of what sealing means.
 * Separate keys, one implementation.
 *
 * AES-256-GCM under MEMBER_SECRETS_KEY, 32 bytes hex, set at provisioning.
 * ABSENT MEANS REFUSE. `AUTH_TOKEN_SECRET` shows why a per-process fallback
 * is wrong here: it falls back to a random secret so sessions still work for
 * one process lifetime, and that is tolerable for a session because a restart
 * only logs people out. A random encryption key would let a member store a
 * credential this deployment can never read again after its next restart, and
 * the panel would keep saying "set". Refusing to store, with a sentence naming
 * the operator, is the honest failure.
 *
 * Nothing in this file logs, returns or persists a plaintext. `open` is
 * called on the way to the provider and nowhere else.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { keyEnvProblem, keyFromEnv, openWith, sealWith, type Sealed } from "./sealedBox";
import { guardOutboundUrl } from "./toolcheck";

export type { Sealed };

export const MEMBER_SECRETS_ENV = "MEMBER_SECRETS_KEY";

/** The one sentence the panel shows when the key is missing. Tested verbatim. */
export const NO_MEMBER_SECRETS_KEY_SENTENCE =
  "this deployment has no member-secrets key; ask your operator";

export type MemberKeyProvider = "anthropic" | "openai_compatible";
export const MEMBER_KEY_PROVIDERS: readonly MemberKeyProvider[] = ["anthropic", "openai_compatible"];

/** What a route may return. No ciphertext, no iv, no tag, no plaintext. */
export interface MemberKeyView {
  provider: MemberKeyProvider;
  last4: string;
  baseUrl: string | null;
  model: string | null;
  setAt: string;
}

/**
 * The key, or null. Read at call time, never cached at import, so a test can
 * set and unset it and so a deployment that adds the variable and restarts is
 * not surprised by a stale read.
 */
export function memberSecretsKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  return keyFromEnv(MEMBER_SECRETS_ENV, env);
}

export function memberSecretsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return memberSecretsKey(env) !== null;
}

/**
 * For the OPERATOR: what is wrong with this deployment's key, or null when it
 * is usable. Says "not set" only about a key that is not set, and names the
 * shape of a malformed one (`sealedBox.ts`, `describeKeyEnv`). Never shown to a
 * member, who reads `NO_MEMBER_SECRETS_KEY_SENTENCE` and cannot fix it.
 */
export function memberSecretsKeyProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  return keyEnvProblem(MEMBER_SECRETS_ENV, env);
}

/**
 * Seal a plaintext under this deployment's member key. Fresh 12-byte iv per
 * call, so the same key stored twice produces two different rows and nothing
 * about the plaintext leaks through equality. Throws when the deployment has
 * no key: callers check `memberSecretsConfigured` first and answer with the
 * sentence.
 */
export function seal(plaintext: string, env: NodeJS.ProcessEnv = process.env): Sealed {
  const key = memberSecretsKey(env);
  if (!key) throw new Error(NO_MEMBER_SECRETS_KEY_SENTENCE);
  return sealWith(key, plaintext);
}

/** Open a sealed value. Null on a missing key or a tampered row, never a throw into a route. */
export function open(sealed: Sealed, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = memberSecretsKey(env);
  if (!key) return null;
  return openWith(key, sealed);
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Shape only: https, no credentials, trailing slash dropped. The reachability
 * check (public address ranges, DNS) is `guardOutboundUrl` in `storeMemberKey`
 * and again in the dialer at call time; this function stays sync so the shape
 * rules are testable without a resolver.
 */
export function cleanBaseUrl(raw: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, url: null };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "The base URL is not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "The base URL must start with https://" };
  if (u.username || u.password) return { ok: false, error: "The base URL must not carry credentials" };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

export interface StoreInput {
  provider: MemberKeyProvider;
  key: string;
  baseUrl?: string | null;
  model?: string | null;
}

/**
 * Store (or replace) a member's key. Returns the view the panel shows.
 * The caller has already checked `memberSecretsConfigured`; this throws the
 * sentence if it was not, so a route that forgets still cannot store.
 */
export async function storeMemberKey(
  pool: Pool,
  userId: string,
  input: StoreInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; view: MemberKeyView } | { ok: false; error: string }> {
  if (!memberSecretsConfigured(env)) return { ok: false, error: NO_MEMBER_SECRETS_KEY_SENTENCE };
  if (!MEMBER_KEY_PROVIDERS.includes(input.provider)) return { ok: false, error: "Unknown provider" };
  const key = String(input.key ?? "").trim();
  if (key.length < 8 || key.length > 512) return { ok: false, error: "That does not look like an API key" };
  const base = cleanBaseUrl(input.baseUrl);
  if (!base.ok) return base;
  const model = String(input.model ?? "").trim().slice(0, 128) || null;
  if (input.provider === "openai_compatible" && !base.url) {
    return { ok: false, error: "An OpenAI-compatible provider needs a base URL" };
  }
  if (input.provider === "openai_compatible" && !model) {
    return { ok: false, error: "An OpenAI-compatible provider needs a model name" };
  }
  if (input.provider === "openai_compatible" && base.url) {
    // The same guard every member- or admin-typed host meets: public ranges
    // only. The refusal is generic on purpose, so this route is not an oracle
    // for what an internal name resolves to.
    const guard = await guardOutboundUrl(base.url);
    if (!guard.ok) return { ok: false, error: "That base URL is not reachable from here. It must be a public https host" };
  }
  const sealed = seal(key, env);
  const last4 = key.slice(-4);
  const compat = input.provider === "openai_compatible";
  await pool.query(
    "INSERT INTO member_llm_keys (user_id, provider, base_url, model, ciphertext, iv, tag, last4, set_at) " +
      "VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) " +
      "ON DUPLICATE KEY UPDATE provider = VALUES(provider), base_url = VALUES(base_url), model = VALUES(model), " +
      "ciphertext = VALUES(ciphertext), iv = VALUES(iv), tag = VALUES(tag), last4 = VALUES(last4), set_at = CURRENT_TIMESTAMP",
    [userId, input.provider, compat ? base.url : null, compat ? model : null, sealed.ciphertext, sealed.iv, sealed.tag, last4],
  );
  const view = await memberKeyView(pool, userId);
  return view ? { ok: true, view } : { ok: false, error: "The key did not save" };
}

/** The panel's read. Never the value. */
export async function memberKeyView(pool: Pool, userId: string): Promise<MemberKeyView | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT provider, base_url, model, last4, set_at FROM member_llm_keys WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    provider: String(r.provider) as MemberKeyProvider,
    last4: String(r.last4),
    baseUrl: r.base_url ? String(r.base_url) : null,
    model: r.model ? String(r.model) : null,
    setAt: r.set_at instanceof Date ? r.set_at.toISOString() : String(r.set_at),
  };
}

export async function removeMemberKey(pool: Pool, userId: string): Promise<boolean> {
  const [r]: any = await pool.query("DELETE FROM member_llm_keys WHERE user_id = ?", [userId]);
  return Number(r?.affectedRows ?? 0) > 0;
}

/** The plaintext, on its way to the provider. The only reader of the ciphertext column. */
export interface ResolvedMemberKey {
  provider: MemberKeyProvider;
  key: string;
  baseUrl: string | null;
  model: string | null;
}

export async function resolveMemberKey(
  pool: Pool,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedMemberKey | null> {
  if (!memberSecretsConfigured(env)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT provider, base_url, model, ciphertext, iv, tag FROM member_llm_keys WHERE user_id = ? LIMIT 1",
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  const key = open({ ciphertext: String(r.ciphertext), iv: String(r.iv), tag: String(r.tag) }, env);
  if (!key) return null;
  return {
    provider: String(r.provider) as MemberKeyProvider,
    key,
    baseUrl: r.base_url ? String(r.base_url) : null,
    model: r.model ? String(r.model) : null,
  };
}
