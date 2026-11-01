/**
 * WHAT TURNS FOUR LAUNCH ROWS GREEN: EVIDENCE, NEVER A KEY BEING SET.
 *
 * Rye, 2026-10-13: "green means a live check passed". These rows went green on
 * presence alone, so a revoked Stripe key, a webhook secret copied from the
 * wrong endpoint, or a guide key with no credit all read as done. Each now
 * reads what the platform records when the thing really happens:
 *
 *   stripe-keys      Stripe answering a checkout made with this key, from the
 *                    record payments.ts keeps through server/lib/integrations.ts.
 *                    A test-mode key reads planted, never done: no card is
 *                    charged for real.
 *   stripe-webhook   a signed event from Stripe that verified with this secret
 *                    (server/repos/stripeDeliveries.ts).
 *   assistant-key    the guide answering on the key it spends, the village's
 *                    own or the one the platform lends it.
 *   session-secret   a session signed with the secret verifying, through the
 *                    same two functions that sign members in.
 *
 * The fifth, `village-secrets-key`, is read beside the key in
 * server/lib/secrets.ts (`villageSecretsLaunchCheck`).
 *
 * EVIDENCE IS TIED TO THE KEY IT PROVES. A success recorded before the key was
 * last typed under Integrations proves the old key, so it does not count. A key
 * set only on the host has no typing time to compare with; changing it means a
 * restart, and the next real call records its own outcome.
 *
 * NOTHING HERE CALLS OUT. The journey is read on every visit to the page and by
 * the guide, so every answer comes from what is already recorded, and the proof
 * is a real checkout, a real reply, a real event. The detail on each row says
 * which one to make.
 *
 * Resolved by server/lib/launch.ts by `checkKey`, after any check the caller
 * injects, so server/index.ts carries none of them.
 */
import type { Pool } from "mysql2/promise";
import { assistantKeyOwner } from "./assistant";
import { PLATFORM_CALLS, integrationHealth, type IntegrationHealth } from "./integrations";
import { decodeToken, encodeToken } from "./memberTokens";
import { secretStatus, secretValue, type SecretKey } from "./secrets";
import { lastStripeDeliveries } from "../repos/stripeDeliveries";

export type ProofState = "ok" | "missing" | "partial";
export interface Proof {
  state: ProofState;
  detail: string;
}

/** The day a founder reads, from an ISO instant. */
const day = (iso: string): string => iso.slice(0, 10);

const after = (a: string, b: string): boolean => Date.parse(a) >= Date.parse(b);

/**
 * True when something recorded at `at` is evidence about the key typed at
 * `typedAt`. A key set on the host has no typing time (`typedAt` null), so any
 * record counts for it.
 */
export function provesCurrentKey(at: string | null, typedAt: string | null): boolean {
  if (!at) return false;
  return typedAt === null || after(at, typedAt);
}

/** When this slot's value was typed under Integrations, or null for a host-set key. */
function typedAt(key: SecretKey, env: NodeJS.ProcessEnv): string | null {
  const s = secretStatus(key, env);
  return s.source === "admin" ? s.setAt : null;
}

/** True when the most recent call recorded here failed. */
function failedLast(h: IntegrationHealth | null): h is IntegrationHealth & { lastFailureAt: string } {
  return !!h?.lastFailureAt && (!h.lastSuccessAt || after(h.lastFailureAt, h.lastSuccessAt));
}

// ── stripe-keys ──────────────────────────────────────────────────────────────

export type StripeKeyMode = "live" | "test" | "publishable" | "unknown";

/** Which kind of Stripe key this is, from its prefix. The key itself never leaves the server. */
export function stripeKeyMode(key: string): StripeKeyMode {
  const k = key.trim();
  if (/^pk_(live|test)_/.test(k)) return "publishable";
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return "unknown";
}

/** Stripe checks the key before anything else, so these answers prove the key was accepted. */
const STRIPE_ANSWERED = new Set(["400", "402", "404", "409"]);
/** The answers that mean Stripe refused the key itself. */
const STRIPE_REFUSED = new Set(["401", "403"]);

export interface StripeKeyFacts {
  /** `none` when no key is set. */
  mode: StripeKeyMode | "none";
  typedAt: string | null;
  checkout: IntegrationHealth | null;
}

export function stripeKeyProof(f: StripeKeyFacts): Proof {
  if (f.mode === "none") {
    return { state: "missing", detail: "No Stripe key: card checkout answers 503; the manual payment path still works" };
  }
  if (f.mode === "publishable") {
    return {
      state: "missing",
      detail: "That is Stripe's publishable key, which cannot open a checkout. The secret key starts with sk_live_, or rk_live_ for a restricted one",
    };
  }
  const h = f.checkout;
  const lastFailure = h?.lastFailureAt && provesCurrentKey(h.lastFailureAt, f.typedAt) ? h : null;
  if (lastFailure && failedLast(lastFailure) && STRIPE_REFUSED.has(String(lastFailure.lastFailureStatus))) {
    return {
      state: "missing",
      detail:
        lastFailure.lastFailureStatus === "403"
          ? `On ${day(lastFailure.lastFailureAt)} Stripe said this key may not open a checkout, the answer a restricted key gives without that permission. Plant the standard secret key`
          : `On ${day(lastFailure.lastFailureAt)} Stripe refused this key. Copy the secret key again from Stripe's dashboard, or roll it there and save the new one`,
    };
  }
  const answeredAt = [
    h?.lastSuccessAt ?? null,
    lastFailure && STRIPE_ANSWERED.has(String(lastFailure.lastFailureStatus)) ? lastFailure.lastFailureAt : null,
  ]
    .filter((at): at is string => provesCurrentKey(at, f.typedAt))
    .sort()
    .pop();
  if (!answeredAt) {
    return {
      state: "partial",
      detail: "A key is set and no checkout made with it is on record yet. Start one checkout and close it before paying: Stripe answering is the proof",
    };
  }
  if (f.mode === "test") {
    return {
      state: "partial",
      detail: `Stripe answered this key on ${day(answeredAt)}, in test mode, so no card is charged for real. Plant the live key before members pay`,
    };
  }
  return { state: "ok", detail: `Stripe answered a checkout made with this key on ${day(answeredAt)}` };
}

// ── stripe-webhook ───────────────────────────────────────────────────────────

export interface StripeWebhookFacts {
  configured: boolean;
  typedAt: string | null;
  /**
   * The newest delivery that passed the signature check. For a village whose
   * Stripe key is live, the newest LIVE one: a test event is signed with the
   * test endpoint's secret and proves nothing about the live endpoint's.
   */
  verifiedAt: string | null;
  /** The newest call that carried a signature this secret did not verify. */
  refusedAt: string | null;
  /** The key is live, and only test events have verified. */
  onlyTestEvents?: boolean;
}

export function stripeWebhookProof(f: StripeWebhookFacts): Proof {
  if (!f.configured) {
    return { state: "missing", detail: "Cards would charge but credits would never arrive. The settle callback has no signature to verify" };
  }
  if (provesCurrentKey(f.verifiedAt, f.typedAt)) {
    return { state: "ok", detail: `Stripe's last signed event arrived on ${day(f.verifiedAt!)} and verified with this secret` };
  }
  if (provesCurrentKey(f.refusedAt, f.typedAt)) {
    return {
      state: "missing",
      detail:
        `On ${day(f.refusedAt!)} a call reached the webhook with a signature this secret did not verify. ` +
        "If it came from Stripe, copy the signing secret again from the endpoint in Stripe's dashboard",
    };
  }
  if (f.onlyTestEvents) {
    return {
      state: "partial",
      detail:
        "Only test-mode events from Stripe have verified, and this village's key is live. The live endpoint has its own " +
        "signing secret, and the first live card payment proves it",
    };
  }
  return {
    state: "partial",
    detail:
      "A signing secret is set and no signed event from Stripe has arrived yet. The first card payment proves it; " +
      "in test mode, one checkout paid with Stripe's test card",
  };
}

// ── assistant-key ────────────────────────────────────────────────────────────

export interface GuideKeyFacts {
  owner: "own" | "platform" | "none";
  typedAt: string | null;
  reply: IntegrationHealth | null;
}

function guideFailure(status: string | null): string {
  if (status === "401" || status === "403") return "the provider refused the key";
  if (status === "429") return "the provider was rate limiting this key";
  if (status === "network") return "the provider could not be reached";
  return `the call failed with ${status ?? "an error"}`;
}

export function guideKeyProof(f: GuideKeyFacts): Proof {
  if (f.owner === "none") return { state: "missing", detail: "No Anthropic key. Every form still works, without the guide" };
  const h = f.reply;
  if (failedLast(h) && provesCurrentKey(h.lastFailureAt, f.typedAt)) {
    return { state: "missing", detail: `The guide's last call, on ${day(h.lastFailureAt)}, did not answer: ${guideFailure(h.lastFailureStatus)}` };
  }
  if (!provesCurrentKey(h?.lastSuccessAt ?? null, f.typedAt)) {
    return { state: "partial", detail: "A key is set and no answer from the guide on it is on record yet. Ask the guide one question and this turns green" };
  }
  return { state: "ok", detail: `The guide last answered on ${day(h!.lastSuccessAt!)}` };
}

// ── session-secret ───────────────────────────────────────────────────────────

const PROBE_USER = "launch-check";

export function sessionSecretProof(secret: string | undefined): Proof {
  const s = String(secret ?? "");
  if (!s) return { state: "missing", detail: "Signing with a random per-process key. Every restart logs everyone out" };
  if (!s.trim()) {
    return { state: "missing", detail: "AUTH_TOKEN_SECRET is only blank space, so every session is signed with a value anyone could guess" };
  }
  const back = decodeToken(s, encodeToken(s, PROBE_USER, `${PROBE_USER}@example.invalid`), 30);
  return back?.userId === PROBE_USER
    ? { state: "ok", detail: "A session signed with it verifies, so sessions survive restarts and extra replicas" }
    : { state: "missing", detail: "A session signed with it did not verify. This is a platform bug, report it" };
}

// ── The resolvers server/lib/launch.ts reads ─────────────────────────────────

export const LAUNCH_PROOFS: Record<string, (pool: Pool, env: NodeJS.ProcessEnv) => Proof | Promise<Proof>> = {
  "stripe-keys": (_pool, env) => {
    const key = secretValue("stripe_secret_key", env);
    return stripeKeyProof({
      mode: key ? stripeKeyMode(key) : "none",
      typedAt: typedAt("stripe_secret_key", env),
      checkout: integrationHealth(PLATFORM_CALLS.stripeCheckout.moduleId, PLATFORM_CALLS.stripeCheckout.operation),
    });
  },
  "stripe-webhook": async (pool, env) => {
    if (!secretValue("stripe_webhook_secret", env)) {
      return stripeWebhookProof({ configured: false, typedAt: null, verifiedAt: null, refusedAt: null });
    }
    const seen = await lastStripeDeliveries(pool);
    const key = secretValue("stripe_secret_key", env);
    const live = !!key && stripeKeyMode(key) === "live";
    return stripeWebhookProof({
      configured: true,
      typedAt: typedAt("stripe_webhook_secret", env),
      verifiedAt: live ? seen.verifiedLiveAt : seen.verifiedAt,
      refusedAt: seen.refusedAt,
      onlyTestEvents: live && !seen.verifiedLiveAt && !!seen.verifiedAt,
    });
  },
  "assistant-key": (_pool, env) => {
    const owner = assistantKeyOwner(env);
    const call = owner === "platform" ? PLATFORM_CALLS.guideReplyBorrowed : PLATFORM_CALLS.guideReply;
    return guideKeyProof({
      owner,
      typedAt: owner === "own" ? typedAt("assistant_api_key", env) : null,
      reply: integrationHealth(call.moduleId, call.operation),
    });
  },
  "session-secret": (_pool, env) => sessionSecretProof(env.AUTH_TOKEN_SECRET),
};
