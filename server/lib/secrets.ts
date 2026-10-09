/**
 * Integration secrets (S63): third-party keys a village sets from its own
 * admin panel, masked on every read, resolved admin-first-then-env, and since
 * 2026-08-30 encrypted at rest.
 *
 * The posture this replaces was the worst of both worlds: Stripe keys were
 * env-only (a founder without Railway access could not launch payments at
 * all, and NOTHING anywhere reported whether the webhook secret was even
 * set), while Resend/Anthropic keys were admin-settable but echoed back to
 * the browser in plaintext on every settings load. This store fixes both
 * ends with one rule: **a secret is write-only TO THE BROWSER, and read by
 * the server.** Reads through `secretStatus` return
 * {configured, last4, source, setBy, setAt, atRest, unreadable} and never the
 * value; the value leaves this module through `secretValue` toward the
 * service it belongs to.
 *
 * That distinction is load-bearing and the header used to say only
 * "write-only". A server caller CAN read a stored value back, which means
 * this store already holds an INBOUND signing secret perfectly well: the
 * webhook handler reads it to verify an HMAC, and only the browser ever sees
 * the mask. Anyone reading "write-only" and concluding otherwise would build
 * a second credential mechanism beside this one for no reason.
 *
 * WHAT MUST NEVER BE ADDED HERE. A managed listing's credential. That key is
 * the platform's, not the village's, and putting it here would show a fork
 * admin its source and last4 and let them clear it. It lives in env, is read
 * at call time, and is never returned by any route: the PLATFORM_ASSISTANT_KEY
 * posture, settled as policy in hub ADR-49. `moduleListingProblems` refuses a
 * managed listing that lists secret slots, and the derivation below skips the
 * managed tier a second time, because one guard for this is not enough.
 *
 * Env vars remain a full fallback so existing deployments change nothing:
 * resolution is admin-typed first, env second. `last4` is enough for a
 * founder to recognize which key is live without being enough to steal.
 *
 * ── ENCRYPTION AT REST, AND WHY THE 2026-07-27 DECISION WAS REVERSED ────────
 *
 * Storage used to be plaintext JSON in app_config, same as the email config
 * always was. Encryption at rest was offered and Rye chose masked-read without
 * it on 2026-07-27, with one written revisit condition: revisit if backups
 * start leaving the deployment's trust boundary.
 *
 * That condition fired. `.github/workflows/db-backup.yml` mysqldumps the whole
 * database and uploads it as a GitHub Actions artifact with 30 day retention.
 * The repository was public while those artifacts were produced, so every
 * Stripe secret key, every webhook signing secret and every external calendar
 * URL in this document travelled out of the trust boundary on a schedule. It
 * was made private on 2026-08-30, which narrows who can fetch the artifacts
 * that already exist and does not un-produce them. The condition stays fired
 * either way, because Season 2 fires it a second time: ReGen is about to hold
 * OTHER villages' payment credentials for a fee, and "the operator can read the
 * database anyway" stops being an answer the moment the operator is not the
 * credential's owner.
 *
 * So values are now sealed with AES-256-GCM under `VILLAGE_SECRETS_KEY`, using
 * the same primitive as `memberSecrets.ts` (`sealedBox.ts`, one cipher for the
 * whole platform). The harm metric is the one that matters: a database dump on
 * its own no longer yields a usable payment credential.
 *
 * FAIL CLOSED. With no key, a write REFUSES. It does not fall back to
 * plaintext, because a store that quietly degrades under a missing variable
 * gives an operator a panel that says "set" over a credential sitting in the
 * clear. Clearing a secret (value "") is still allowed without a key: deleting
 * an exposed plaintext value is strictly a safety improvement and an operator
 * locked out of writes must never be locked out of removal.
 *
 * THE DUAL-READ WINDOW. `ACCEPT_LEGACY_PLAINTEXT` is true for one release, so
 * a village upgrading with existing plaintext entries keeps working while they
 * are converted. Conversion happens at boot inside `loadSecrets`: with a key
 * present, every plaintext entry is sealed in place and written back once.
 * Second boot finds nothing to do and writes nothing. There is no numbered SQL
 * migration for this and there cannot be one, because MySQL is not holding the
 * key and must not be asked to. The follow-up release flips
 * `ACCEPT_LEGACY_PLAINTEXT` to false, after which a plaintext entry reads as
 * absent and the env fallback (if any) takes over.
 */
import type { Pool } from "mysql2/promise";
import { registrySecretKeys } from "../../shared/modules";
import { keyEnvProblem, keyFromEnv, openWith, sealWith, type Sealed } from "./sealedBox";

/** The platform's own eight. A literal union, so every call site still typechecks. */
const BASE_SECRET_KEYS = [
  "stripe_secret_key",
  "stripe_webhook_secret",
  "resend_api_key",
  // Village Comms: the signing secret the email provider's delivery reports
  // carry, checked by server/routes/commsWebhook.ts. Declared beside the key it
  // belongs to, the way the Stripe pair sits together.
  "resend_webhook_secret",
  "assistant_api_key",
  "riverside_webhook_secret",
  "governance_hub_secret",
  "basescan_api_key",
] as const;
export type BaseSecretKey = (typeof BASE_SECRET_KEYS)[number];

/**
 * A platform key, or a slot a listing contributed.
 *
 * `string & {}` keeps the eight literals in autocomplete and in every existing
 * call site's type check while admitting a registry-contributed slot. Before
 * this, adding one vendor credential meant editing a frozen union and a
 * hardcoded env map in platform code and shipping a release to every fork,
 * including the forks running nothing of the kind.
 */
export type SecretKey = BaseSecretKey | (string & {});

/**
 * Base keys union the registry's own. Computed once at module load, from a
 * pure data file with no clock and no database in it, so the order and the
 * contents are the same in every process.
 */
export const SECRET_KEYS: readonly SecretKey[] = [
  ...BASE_SECRET_KEYS,
  ...registrySecretKeys().filter((k) => !(BASE_SECRET_KEYS as readonly string[]).includes(k)),
];

/** Env fallback per platform key, the names FORK_RUNBOOK.md has always documented. */
const BASE_ENV_FALLBACK: Record<BaseSecretKey, string> = {
  stripe_secret_key: "STRIPE_SECRET_KEY",
  stripe_webhook_secret: "STRIPE_WEBHOOK_SECRET",
  resend_api_key: "RESEND_API_KEY",
  resend_webhook_secret: "RESEND_WEBHOOK_SECRET", // module-review-ok: the NAME of the env var this slot falls back to, as the runbook documents it, never a value
  assistant_api_key: "ANTHROPIC_API_KEY",
  riverside_webhook_secret: "RIVERSIDE_WEBHOOK_SECRET",
  governance_hub_secret: "GOVERNANCE_HUB_SECRET",
  basescan_api_key: "BASESCAN_API_KEY",
};

/**
 * The env var a slot falls back to. The eight keep the exact names the runbook
 * documents; a registry slot takes its own name uppercased, which is a rule a
 * fork operator can apply without reading any code.
 */
export function envNameFor(key: SecretKey): string {
  return BASE_ENV_FALLBACK[key as BaseSecretKey] ?? String(key).toUpperCase();
}

// ── The key ─────────────────────────────────────────────────────────────────

/** 32 bytes as 64 hex characters. Its own variable, not MEMBER_SECRETS_KEY. */
export const VILLAGE_SECRETS_ENV = "VILLAGE_SECRETS_KEY";

/**
 * The one sentence an operator sees when the key is missing. Deliberately
 * shaped like the member-secrets one, and tested verbatim, so two refusals
 * from the same platform read like the same platform.
 */
export const NO_VILLAGE_SECRETS_KEY_SENTENCE =
  "this deployment has no village-secrets key; ask your operator";

export function villageSecretsKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  return keyFromEnv(VILLAGE_SECRETS_ENV, env);
}

export function villageSecretsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return villageSecretsKey(env) !== null;
}

/**
 * The sentence naming what is wrong with this deployment's key, or null when
 * it is usable: unset, or set in a shape `keyFromEnv` refuses (quotes, a pasted
 * `NAME=`, base64, the wrong length). Every operator-facing refusal and boot
 * line uses this, so "not set" is only ever said about a key that is not set.
 * It never carries any part of the value.
 */
export function villageSecretsKeyProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  return keyEnvProblem(VILLAGE_SECRETS_ENV, env);
}

/**
 * What Admin, Integrations reads before a founder types anything, so the
 * refusal is on the screen before a key is pasted and bounced. Admin-only: the
 * route that returns it checks `isAdmin` first.
 */
export function villageSecretsKeyStatus(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  problem: string | null;
} {
  return { configured: villageSecretsConfigured(env), problem: villageSecretsKeyProblem(env) };
}

/**
 * The second line of the two refusals that stop a founder saving a key, the
 * `message` beside `NO_VILLAGE_SECRETS_KEY_SENTENCE` in a 503.
 *
 * `putSecret` fails closed and THROWS when this deployment has no sealing key,
 * which is right. What it cannot do is answer a browser: Express 4 does not
 * route an async handler rejection anywhere useful, so a founder pasting a
 * Stripe key got an opaque 500 and nothing to act on (measured against the
 * built server in server/secretsWiring.e2e.test.ts). So the routes check
 * first and answer 503 with two fields. `error` carries the store's own
 * sentence verbatim, the shape the member-key route answers with, so two
 * refusals from one platform read like one platform. `message` carries what
 * that sentence cannot: on a self-hosted instance the founder IS the operator
 * it tells them to ask, so this names the problem, the variable and the
 * recipe. Admin.tsx's `refusal()` prefers `message`.
 *
 * Moved here from server/index.ts, where it was a constant that said "Set
 * VILLAGE_SECRETS_KEY" to a founder who had set it in the wrong shape.
 * `retry` is what the founder does once it is fixed, in their own terms.
 */
export function villageSecretsRefusal(
  env: NodeJS.ProcessEnv = process.env,
  retry = "save the key again",
): string {
  const problem = villageSecretsKeyProblem(env) ?? `${VILLAGE_SECRETS_ENV} cannot be read.`;
  const verb = (env[VILLAGE_SECRETS_ENV] ?? "").trim() ? "Correct it" : "Set it";
  return (
    `${problem} ${verb} in this deployment's environment, then restart and ${retry}. ` +
    `It is 32 random bytes as 64 hex characters: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))". ` +
    "Nothing was stored, and nothing already stored has changed."
  );
}

/**
 * The launch journey's reading of the key (`village-secrets-key` in
 * shared/launchRequirements.ts). Lives beside the key because it reads the
 * environment and nothing else, so server/lib/launch.ts resolves it without a
 * closure from server/index.ts.
 */
export function villageSecretsLaunchCheck(env: NodeJS.ProcessEnv = process.env): {
  state: "ok" | "missing";
  detail: string;
} {
  const problem = villageSecretsKeyProblem(env);
  return problem
    ? { state: "missing", detail: problem }
    : { state: "ok", detail: `${VILLAGE_SECRETS_ENV} is set, so Integrations can lock the keys saved there` };
}

/**
 * One release of reading both shapes. Flip to false in the follow-up and a
 * plaintext entry stops resolving. Every read path takes it as a default
 * argument so a test can prove both sides of the flip today, rather than the
 * follow-up shipping a branch nobody has ever executed.
 */
export const ACCEPT_LEGACY_PLAINTEXT = true;

// ── The document ────────────────────────────────────────────────────────────

/** What this store held before 2026-08-30, and still reads during the window. */
interface LegacySecret {
  value: string;
  setBy: string;
  setAt: string;
}

/**
 * The shape written from 2026-08-30. `last4` sits beside the ciphertext on
 * purpose: the admin panel has to render a mask for a key this process may not
 * be able to open, and asking it to decrypt in order to draw four characters
 * would make the panel go blank exactly when an operator needs it to explain
 * what happened.
 */
interface SealedSecret extends Sealed {
  last4: string;
  setBy: string;
  setAt: string;
}

type StoredSecret = LegacySecret | SealedSecret;
type SecretsDoc = Record<string, StoredSecret | undefined>;

function isSealed(entry: StoredSecret | undefined): entry is SealedSecret {
  return !!entry && typeof (entry as SealedSecret).ciphertext === "string";
}

/** An empty value has always meant "not stored", so it is not legacy either. */
function isLegacy(entry: StoredSecret | undefined): entry is LegacySecret {
  return !!entry && !isSealed(entry) && !!(entry as LegacySecret).value;
}

/** Boot-loaded cache, write-through, the store-db discipline. */
let cache: SecretsDoc | null = null;

/** Keys this process has already complained about. One log line, not one per call. */
const warnedUnreadable = new Set<string>();

const DOC_SELECT = "SELECT value FROM app_config WHERE config_key = 'integration-secrets'";
const DOC_UPSERT =
  "INSERT INTO app_config (config_key, value) VALUES ('integration-secrets', ?) " +
  "ON DUPLICATE KEY UPDATE value = VALUES(value)";

export async function loadSecrets(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const [[row]] = await pool.query<any[]>(DOC_SELECT);
  cache = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : {};
  warnedUnreadable.clear();
  await resealPlaintextSecrets(pool, env);
}

function mustCache(): SecretsDoc {
  if (!cache) throw new Error("secrets read before boot loaded them");
  return cache;
}

/**
 * Seal every plaintext entry in place, once, at boot.
 *
 * This is the migration, and it lives here rather than in `drizzle/` because
 * the database cannot do AES and must never be handed the key. Idempotent by
 * construction: it only ever looks at entries carrying a `value` field, and it
 * writes nothing when there are none, so a second boot is a no-op and a
 * hundredth boot is a no-op.
 *
 * With no key it converts nothing and says so, naming the exposed KEYS and
 * never their values. That log line is the only warning an operator gets
 * before the first refused write.
 */
export async function resealPlaintextSecrets(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sealed: number; leftPlaintext: number }> {
  const doc = mustCache();
  const plaintext = Object.keys(doc).filter((k) => isLegacy(doc[k]));
  if (plaintext.length === 0) return { sealed: 0, leftPlaintext: 0 };

  const key = villageSecretsKey(env);
  if (!key) {
    console.warn(
      `[secrets] ${plaintext.length} integration secret(s) are stored in plaintext and cannot be ` +
        `sealed. ${villageSecretsKeyProblem(env)} Every database dump carries them. Keys: ` +
        plaintext.join(", "),
    );
    return { sealed: 0, leftPlaintext: plaintext.length };
  }

  const next: SecretsDoc = { ...doc };
  for (const k of plaintext) {
    const legacy = doc[k] as LegacySecret;
    next[k] = {
      ...sealWith(key, legacy.value),
      last4: legacy.value.slice(-4),
      setBy: legacy.setBy,
      setAt: legacy.setAt,
    };
  }
  await pool.query(DOC_UPSERT, [JSON.stringify(next)]); // module-review-ok: this store IS the repo for its one app_config row, as it has been since S63
  cache = next;
  console.log(`[secrets] sealed ${plaintext.length} plaintext integration secret(s) at rest`);
  return { sealed: plaintext.length, leftPlaintext: 0 };
}

/** Which keys are still stored in the clear. For tests and for an ops read. */
export function plaintextSecretKeys(): string[] {
  const doc = mustCache();
  return Object.keys(doc).filter((k) => isLegacy(doc[k]));
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The admin-typed value, or null when there is not one this process can read.
 * Null covers three different situations on purpose, and `readStored` is the
 * only place that has to tell them apart.
 */
function openStored(
  key: SecretKey,
  env: NodeJS.ProcessEnv,
  acceptLegacy: boolean,
): string | null {
  const entry = mustCache()[key];
  if (isSealed(entry)) {
    const k = villageSecretsKey(env);
    const opened = k ? openWith(k, entry) : null;
    if (opened === null && !warnedUnreadable.has(String(key))) {
      warnedUnreadable.add(String(key));
      console.warn(
        `[secrets] cannot open the stored value for "${String(key)}". ` +
          (k
            ? `${VILLAGE_SECRETS_ENV} does not match the key it was sealed with.`
            : villageSecretsKeyProblem(env)) +
          ` Falling back to ${envNameFor(key)} if that is set.`,
      );
    }
    // An empty plaintext is the same as nothing stored: this store has always
    // treated "" as a delete, so it must never present as a configured
    // credential on the way back out.
    return opened || null;
  }
  if (isLegacy(entry)) return acceptLegacy ? entry.value : null;
  return null;
}

/**
 * The ONE value read. Callers are the outbound integrations (Stripe call,
 * Resend call, Anthropic call) and the inbound signature checks, never a route
 * serializing JSON to a browser.
 */
export function secretValue(
  key: SecretKey,
  env: NodeJS.ProcessEnv = process.env,
  acceptLegacy: boolean = ACCEPT_LEGACY_PLAINTEXT,
): string {
  const stored = openStored(key, env, acceptLegacy);
  if (stored) return stored;
  return env[envNameFor(key)] ?? "";
}

export function secretConfigured(key: SecretKey): boolean {
  return !!secretValue(key);
}

export interface SecretStatus {
  key: SecretKey;
  configured: boolean;
  /** Where the live value comes from: the admin panel beats the host env. */
  source: "admin" | "env" | "none";
  /** Enough to recognize a key, not enough to use one. */
  last4: string | null;
  setBy: string | null;
  setAt: string | null;
  /**
   * How the admin-typed value is held. `null` when nothing is stored here.
   * `"plaintext"` is a finding, not a state: it means this row is readable in
   * any database dump and is waiting for a boot with the key set.
   */
  atRest: "sealed" | "plaintext" | null;
  /**
   * A value IS stored and this process cannot open it, so the store is
   * behaving as if it were empty. The panel needs this to say "the
   * village-secrets key changed" instead of silently losing a credential.
   */
  unreadable: boolean;
}

/** Masked status for the admin UI. NEVER includes a value. */
export function secretStatus(
  key: SecretKey,
  env: NodeJS.ProcessEnv = process.env,
  acceptLegacy: boolean = ACCEPT_LEGACY_PLAINTEXT,
): SecretStatus {
  const entry = mustCache()[key];
  const atRest: SecretStatus["atRest"] = isSealed(entry)
    ? "sealed"
    : isLegacy(entry)
      ? "plaintext"
      : null;
  if (entry && atRest !== null && openStored(key, env, acceptLegacy) !== null) {
    return {
      key,
      configured: true,
      source: "admin",
      last4: isSealed(entry) ? entry.last4 : (entry as LegacySecret).value.slice(-4),
      setBy: entry.setBy,
      setAt: entry.setAt,
      atRest,
      unreadable: false,
    };
  }
  const envValue = env[envNameFor(key)] ?? "";
  return {
    key,
    configured: !!envValue,
    source: envValue ? "env" : "none",
    last4: envValue ? envValue.slice(-4) : null,
    setBy: null,
    setAt: null,
    atRest,
    unreadable: atRest !== null,
  };
}

/**
 * The wrapper is not a style choice. `SECRET_KEYS.map(secretStatus)` passed the
 * index and the array into the second and third parameters, which is harmless
 * only for as long as `secretStatus` takes exactly one argument.
 */
export function allSecretStatuses(env: NodeJS.ProcessEnv = process.env): SecretStatus[] {
  return SECRET_KEYS.map((k) => secretStatus(k, env));
}

/**
 * True when this key is one the store may hold at all.
 *
 * `setAt` on the status above is when somebody TYPED a key. It is not, and can
 * never become, evidence that the key works: that answer lives in
 * server/lib/integrations.ts, written by the driver wrapper on real calls.
 */
export function isSecretKey(key: string): key is SecretKey {
  return SECRET_KEYS.includes(key);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Set (or with "" clear) one secret, attributed. Write-through, sealed.
 *
 * Throws `NO_VILLAGE_SECRETS_KEY_SENTENCE` rather than storing a plaintext
 * value when the deployment has no key. The signature stays `Promise<void>`
 * because a refusal a caller can ignore is not a refusal: every existing call
 * site awaits this and none of them inspect a return value, so the throw is
 * the only shape that cannot be dropped on the floor.
 */
export async function putSecret(
  pool: Pool,
  key: SecretKey,
  value: string,
  by: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const doc = { ...mustCache() };
  const trimmed = value.trim();
  if (trimmed) {
    const k = villageSecretsKey(env);
    if (!k) throw new Error(NO_VILLAGE_SECRETS_KEY_SENTENCE);
    doc[key] = {
      ...sealWith(k, trimmed),
      last4: trimmed.slice(-4),
      setBy: by,
      setAt: new Date().toISOString(),
    };
  } else {
    // Clearing needs no key. An operator who has lost the key must still be
    // able to take an exposed plaintext value back out of the database.
    delete doc[key];
  }
  await pool.query(DOC_UPSERT, [JSON.stringify(doc)]); // module-review-ok: this store IS the repo for its one app_config row, as it has been since S63
  warnedUnreadable.delete(String(key));
  cache = doc;
}
