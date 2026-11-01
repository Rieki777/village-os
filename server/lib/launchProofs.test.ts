/**
 * FOUR LAUNCH ROWS GO GREEN ON EVIDENCE, NEVER ON A KEY BEING SET.
 *
 * Rye, 2026-10-13: "green means a live check passed". Each row below read
 * green while its key was merely present, so a revoked Stripe key, a webhook
 * secret from the wrong endpoint or a guide key with no credit all read as
 * done. This file holds the four readers in server/lib/launchProofs.ts, the two
 * writers that now record real outcomes (Stripe checkout, the guide's reply),
 * the webhook's refusal detail, and then the whole chain against a real
 * schema: a signed delivery through `handleStripeEvent` is what turns the
 * webhook row green, and nothing in server/index.ts wires any of the four.
 */
import crypto from "crypto";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";
import { callAssistant, wireAssistant } from "./assistant";
import { PLATFORM_CALLS, integrationHealth, loadIntegrationHealth, notePlatformCall, type IntegrationHealth } from "./integrations";
import { launchStatus } from "./launch";
import {
  LAUNCH_PROOFS,
  guideKeyProof,
  provesCurrentKey,
  sessionSecretProof,
  stripeKeyMode,
  stripeKeyProof,
  stripeWebhookProof,
} from "./launchProofs";
import { createCheckout, handleStripeEvent } from "./payments";
import { loadSecrets } from "./secrets";
import { LIVE_EVENT, SIGNED_REFUSAL, TEST_EVENT, UNSIGNED_REFUSAL } from "../repos/stripeDeliveries";

const BEFORE = "2026-10-01T00:00:00.000Z";
const TYPED = "2026-10-10T00:00:00.000Z";
const AFTER = "2026-10-20T00:00:00.000Z";
const LATER = "2026-10-25T00:00:00.000Z";

const health = (over: Partial<IntegrationHealth> = {}): IntegrationHealth => ({
  moduleId: "stripe",
  operation: "checkout",
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureStatus: null,
  lastFailureDetail: null,
  lastCorrelationId: "",
  consecutiveFailures: 0,
  ...over,
});

/** A pool that answers every read with no rows and remembers every write. */
function stubPool() {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push({ sql, params });
      return [[], []];
    },
  };
  return { pool: pool as unknown as mysql.Pool, writes };
}

const sign = (payload: string, secret: string, at = Math.floor(Date.now() / 1000)) =>
  `t=${at},v1=${crypto.createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;

describe("which launch rows these readers answer", () => {
  it("names four real rows on the journey", () => {
    expect(Object.keys(LAUNCH_PROOFS).sort()).toEqual(["assistant-key", "session-secret", "stripe-keys", "stripe-webhook"]);
    for (const key of Object.keys(LAUNCH_PROOFS)) {
      expect(LAUNCH_REQUIREMENTS.some((r) => r.checkKey === key), key).toBe(true);
    }
  });

  it("counts a record only when it is newer than the key it proves", () => {
    expect(provesCurrentKey(null, null)).toBe(false);
    expect(provesCurrentKey(BEFORE, null)).toBe(true);
    expect(provesCurrentKey(BEFORE, TYPED)).toBe(false);
    expect(provesCurrentKey(AFTER, TYPED)).toBe(true);
  });
});

describe("stripe-keys: Stripe answering a checkout made with this key", () => {
  it("reads the kind of key from its prefix, and catches the publishable one", () => {
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("pk_live_abc")).toBe("publishable");
    const pk = stripeKeyProof({ mode: "publishable", typedAt: null, checkout: health({ lastSuccessAt: AFTER }) });
    expect(pk.state).toBe("missing");
    expect(pk.detail).toContain("publishable key");
  });

  it("is missing with no key, and planted with a key nobody has used", () => {
    expect(stripeKeyProof({ mode: "none", typedAt: null, checkout: null }).state).toBe("missing");
    const unused = stripeKeyProof({ mode: "live", typedAt: null, checkout: null });
    expect(unused.state).toBe("partial");
    expect(unused.detail).toContain("Start one checkout");
  });

  it("is done once Stripe answered a live checkout, and dates it", () => {
    const r = stripeKeyProof({ mode: "live", typedAt: TYPED, checkout: health({ lastSuccessAt: AFTER }) });
    expect(r).toEqual({ state: "ok", detail: "Stripe answered a checkout made with this key on 2026-10-20" });
  });

  it("keeps a test-mode key planted, because no card is charged for real", () => {
    const r = stripeKeyProof({ mode: "test", typedAt: null, checkout: health({ lastSuccessAt: AFTER }) });
    expect(r.state).toBe("partial");
    expect(r.detail).toContain("test mode");
  });

  it("goes red when Stripe refused the key last, and says what to do about it", () => {
    const r = stripeKeyProof({
      mode: "live",
      typedAt: null,
      checkout: health({ lastSuccessAt: BEFORE, lastFailureAt: AFTER, lastFailureStatus: "401", lastFailureDetail: "invalid_request_error" }),
    });
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("On 2026-10-20 Stripe refused this key");
    expect(r.detail).toContain("Copy the secret key again");
    const restricted = stripeKeyProof({ mode: "live", typedAt: null, checkout: health({ lastFailureAt: AFTER, lastFailureStatus: "403" }) });
    expect(restricted.detail).toContain("may not open a checkout");
  });

  it("counts a request Stripe rejected for its contents as the key being accepted", () => {
    const r = stripeKeyProof({ mode: "live", typedAt: null, checkout: health({ lastFailureAt: AFTER, lastFailureStatus: "400", lastFailureDetail: "Invalid currency" }) });
    expect(r.state).toBe("ok");
  });

  it("does not let an old key's success, or an old key's refusal, speak for a key typed since", () => {
    const old = stripeKeyProof({ mode: "live", typedAt: TYPED, checkout: health({ lastSuccessAt: BEFORE }) });
    expect(old.state).toBe("partial");
    const oldRefusal = stripeKeyProof({
      mode: "live",
      typedAt: TYPED,
      checkout: health({ lastFailureAt: BEFORE, lastFailureStatus: "401" }),
    });
    expect(oldRefusal.state).toBe("partial");
  });

  it("holds an earlier success through a later outage", () => {
    const r = stripeKeyProof({ mode: "live", typedAt: null, checkout: health({ lastSuccessAt: AFTER, lastFailureAt: LATER, lastFailureStatus: "network" }) });
    expect(r.state).toBe("ok");
  });
});

describe("stripe-webhook: a signed event that verified with this secret", () => {
  const base = { configured: true, typedAt: null, verifiedAt: null, refusedAt: null };

  it("is missing with no secret, and planted while no signed event has arrived", () => {
    expect(stripeWebhookProof({ ...base, configured: false }).state).toBe("missing");
    const waiting = stripeWebhookProof(base);
    expect(waiting.state).toBe("partial");
    expect(waiting.detail).toContain("no signed event from Stripe has arrived yet");
  });

  it("is done once a signed event verified, and a later forged call cannot undo it", () => {
    expect(stripeWebhookProof({ ...base, verifiedAt: AFTER })).toEqual({
      state: "ok",
      detail: "Stripe's last signed event arrived on 2026-10-20 and verified with this secret",
    });
    expect(stripeWebhookProof({ ...base, verifiedAt: AFTER, refusedAt: LATER }).state).toBe("ok");
  });

  it("goes red when a signed call was refused and nothing has verified", () => {
    const r = stripeWebhookProof({ ...base, refusedAt: AFTER });
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("copy the signing secret again");
  });

  it("keeps a live village planted while only test-mode events have verified, and a refusal still reads first", () => {
    const testOnly = stripeWebhookProof({ ...base, onlyTestEvents: true });
    expect(testOnly.state).toBe("partial");
    expect(testOnly.detail).toContain("Only test-mode events");
    expect(stripeWebhookProof({ ...base, onlyTestEvents: true, refusedAt: AFTER }).state).toBe("missing");
  });

  it("asks again once the secret is typed anew", () => {
    expect(stripeWebhookProof({ ...base, typedAt: TYPED, verifiedAt: BEFORE }).state).toBe("partial");
    expect(stripeWebhookProof({ ...base, typedAt: TYPED, verifiedAt: AFTER }).state).toBe("ok");
  });
});

describe("assistant-key: one answer from the guide", () => {
  it("is missing with no key, and planted until the guide has answered", () => {
    expect(guideKeyProof({ owner: "none", typedAt: null, reply: null }).state).toBe("missing");
    const unused = guideKeyProof({ owner: "own", typedAt: null, reply: null });
    expect(unused.state).toBe("partial");
    expect(unused.detail).toContain("Ask the guide one question");
    expect(unused.detail).toContain("on record");
  });

  it("is done once the guide answered, on the village's key or the lent one", () => {
    expect(guideKeyProof({ owner: "own", typedAt: TYPED, reply: health({ lastSuccessAt: AFTER }) })).toEqual({
      state: "ok",
      detail: "The guide last answered on 2026-10-20",
    });
    expect(guideKeyProof({ owner: "platform", typedAt: null, reply: health({ lastSuccessAt: AFTER }) }).state).toBe("ok");
  });

  it("goes red when the provider refused the key last", () => {
    const r = guideKeyProof({ owner: "own", typedAt: null, reply: health({ lastSuccessAt: BEFORE, lastFailureAt: AFTER, lastFailureStatus: "401" }) });
    expect(r.state).toBe("missing");
    expect(r.detail).toContain("refused the key");
  });

  it("does not count an answer given before the key was typed", () => {
    expect(guideKeyProof({ owner: "own", typedAt: TYPED, reply: health({ lastSuccessAt: BEFORE }) }).state).toBe("partial");
  });
});

describe("session-secret: a session signed with it verifies", () => {
  it("is missing unset or blank, and done once a signed session verifies", () => {
    expect(sessionSecretProof(undefined).detail).toContain("random per-process key");
    expect(sessionSecretProof("   ").state).toBe("missing");
    expect(sessionSecretProof("a-stable-secret-for-this-test").state).toBe("ok");
  });
});

describe("the writers keep the record the readers read", () => {
  const OLD_ENV = { ...process.env };

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_proof_writer_1234";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_proof_writer";
    await loadSecrets(stubPool().pool, process.env);
  });
  beforeEach(async () => {
    await loadIntegrationHealth(stubPool().pool);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => {
    process.env = { ...OLD_ENV };
  });

  const checkout = () =>
    createCheckout({ module: "stays", orderId: "o-1", name: "A room", amountMinor: 100, successUrl: "https://v.example/ok", cancelUrl: "https://v.example/no" });
  const stripeRecord = () => integrationHealth(PLATFORM_CALLS.stripeCheckout.moduleId, PLATFORM_CALLS.stripeCheckout.operation);

  it("records Stripe opening a checkout, which turns the key row green", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }) })));
    expect(await checkout()).toEqual({ url: "https://checkout.stripe.com/c/cs_1", sessionId: "cs_1" });
    expect(stripeRecord()?.lastSuccessAt).not.toBeNull();
    expect((await LAUNCH_PROOFS["stripe-keys"](stubPool().pool, process.env)).state).toBe("ok");
  });

  it("records Stripe refusing the key, and still throws exactly as before", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { type: "invalid_request_error", message: "Invalid API Key provided" } }) })));
    await expect(checkout()).rejects.toThrow("Stripe checkout failed: Invalid API Key provided");
    expect(stripeRecord()).toMatchObject({ lastFailureStatus: "401", lastFailureDetail: "invalid_request_error" });
    expect((await LAUNCH_PROOFS["stripe-keys"](stubPool().pool, process.env)).state).toBe("missing");
  });

  it("keeps Stripe's code and never its message, which can quote a member's email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { type: "invalid_request_error", code: "email_invalid", message: "Invalid email address: wren@example.com" } }),
    })));
    await expect(checkout()).rejects.toThrow("Stripe checkout failed");
    expect(stripeRecord()?.lastFailureDetail).toBe("email_invalid");
    expect(JSON.stringify(stripeRecord())).not.toContain("wren@example.com");
  });

  it("records a call that never reached Stripe, and rethrows it unchanged", async () => {
    const boom = new Error("getaddrinfo ENOTFOUND api.stripe.com");
    vi.stubGlobal("fetch", vi.fn(async () => { throw boom; }));
    await expect(checkout()).rejects.toBe(boom);
    expect(stripeRecord()?.lastFailureStatus).toBe("network");
  });

  it("says which refusal a webhook call was, so only a signed one can turn the row red", async () => {
    const { pool, writes } = stubPool();
    const alert = async () => {};
    const body = JSON.stringify({ id: "evt_x", type: "ping" });
    expect((await handleStripeEvent(pool, body, undefined, alert)).status).toBe(400);
    expect((await handleStripeEvent(pool, body, sign(body, "whsec_some_other_endpoint"), alert)).status).toBe(400);
    const details = writes.filter((w) => w.sql.includes("payments_log")).map((w) => w.params[7]);
    expect(details).toEqual([UNSIGNED_REFUSAL, SIGNED_REFUSAL]);
  });

  it("tags each verified event with the mode Stripe sent it in", async () => {
    const { pool, writes } = stubPool();
    const alert = async () => {};
    for (const [id, livemode] of [["evt_t", false], ["evt_l", true], ["evt_u", undefined]] as const) {
      const body = JSON.stringify({ id, type: "ping", livemode });
      expect((await handleStripeEvent(pool, body, sign(body, "whsec_proof_writer"), alert)).status).toBe(200);
    }
    const claims = writes.filter((w) => w.sql.includes("INSERT INTO payments_log")).map((w) => [w.params[1], w.params[7]]);
    expect(claims).toEqual([["evt_t", TEST_EVENT], ["evt_l", LIVE_EVENT], ["evt_u", null]]);
  });

  describe("the guide", () => {
    const reply = (status = 200) =>
      ({
        ok: status < 400,
        status,
        json: async () => ({ content: [{ type: "text", text: '{"reply":"hello"}' }] }),
        text: async () => "upstream said no",
      }) as unknown as Response;
    const ask = (memberKey?: { key: string; provider: "anthropic" }) =>
      callAssistant({ mode: "organize", system: "You are a guide.", messages: [{ role: "user", content: "hi" }], model: "test-model", clientIp: "10.0.0.1", memberKey } as any);
    const record = (call: (typeof PLATFORM_CALLS)["guideReply" | "guideReplyBorrowed"]) => integrationHealth(call.moduleId, call.operation);

    afterEach(() => {
      delete process.env.PLATFORM_ASSISTANT_KEY;
    });

    it("records an answer on the village's own key, and a refusal", async () => {
      wireAssistant({ villageKey: () => "village-key", rateLimited: async () => false, fetchImpl: (async () => reply()) as unknown as typeof fetch });
      expect((await ask()).ok).toBe(true);
      expect(record(PLATFORM_CALLS.guideReply)?.lastSuccessAt).not.toBeNull();
      expect((await LAUNCH_PROOFS["assistant-key"](stubPool().pool, process.env)).state).toBe("ok");

      wireAssistant({ villageKey: () => "village-key", rateLimited: async () => false, fetchImpl: (async () => reply(401)) as unknown as typeof fetch });
      expect((await ask()).ok).toBe(false);
      expect(record(PLATFORM_CALLS.guideReply)?.lastFailureStatus).toBe("401");
      expect((await LAUNCH_PROOFS["assistant-key"](stubPool().pool, process.env)).state).toBe("missing");
    });

    it("keeps the lent key's answers apart, and keeps nothing for a member's own key", async () => {
      process.env.PLATFORM_ASSISTANT_KEY = "platform-key";
      wireAssistant({ villageKey: () => "", rateLimited: async () => false, fetchImpl: (async () => reply()) as unknown as typeof fetch });
      expect((await ask()).ok).toBe(true);
      expect(record(PLATFORM_CALLS.guideReplyBorrowed)?.lastSuccessAt).not.toBeNull();
      expect(record(PLATFORM_CALLS.guideReply)).toBeNull();

      await loadIntegrationHealth(stubPool().pool);
      expect((await ask({ key: "member-key", provider: "anthropic" })).ok).toBe(true);
      expect(record(PLATFORM_CALLS.guideReply)).toBeNull();
      expect(record(PLATFORM_CALLS.guideReplyBorrowed)).toBeNull();
    });
  });
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[launchProofs.test] TEST_DATABASE_URL not set. The evidence chain against a real schema is UNCHECKED here.");
}

describe.skipIf(!configured)("the evidence chain against a real schema", () => {
  const SECRET = "whsec_launch_proofs";
  const OLD_ENV = { ...process.env };
  let db: TestDb;
  let pool: mysql.Pool;

  const env = (): NodeJS.ProcessEnv => process.env;
  /** Nothing injected: every one of the four must resolve from ./launchProofs. */
  const row = async (id: string) => {
    const s = await launchStatus(pool, { checks: {}, moduleLifecycle: (m) => (m === "stays" ? "members" : "off"), env: env() });
    const found = s.items.find((i) => i.checkKey === id);
    if (!found) throw new Error(`${id} is not on the journey`);
    return found;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_live_launch_proofs_9876";
    process.env.AUTH_TOKEN_SECRET = "a-stable-secret-for-the-launch-proofs-test";
    await loadSecrets(pool, process.env);
    await loadIntegrationHealth(pool);
    wireAssistant({ villageKey: () => "village-key", rateLimited: async () => false });
  }, 180_000);

  afterAll(async () => {
    process.env = { ...OLD_ENV };
    await pool?.end();
    await db?.drop();
  });

  it("wires all four with nothing injected, so server/index.ts needs none of them", async () => {
    for (const id of Object.keys(LAUNCH_PROOFS)) {
      expect((await row(id)).detail, id).not.toMatch(/No check wired|Check failed/);
    }
  });

  it("turns the webhook row green on a signed delivery, and only on one", async () => {
    const alert = async () => {};
    const body = (id: string) => JSON.stringify({ id, type: "ping", data: { object: {} } });

    expect((await row("stripe-webhook")).state).toBe("partial");
    // A call with no signature is never Stripe, so it changes nothing.
    await handleStripeEvent(pool, body("evt_unsigned"), undefined, alert);
    expect((await row("stripe-webhook")).state).toBe("partial");
    // A call signed with some other endpoint's secret is the mismatch a founder must fix.
    await handleStripeEvent(pool, body("evt_other"), sign(body("evt_other"), "whsec_some_other_endpoint"), alert);
    expect((await row("stripe-webhook")).state).toBe("missing");
    // The signed delivery is the proof.
    expect((await handleStripeEvent(pool, body("evt_real"), sign(body("evt_real"), SECRET), alert)).status).toBe(200);
    const green = await row("stripe-webhook");
    expect(green.state).toBe("ok");
    expect(green.detail).toContain("verified with this secret");
    // And a forged call afterwards cannot turn it back.
    await handleStripeEvent(pool, body("evt_forged"), sign(body("evt_forged"), "whsec_forged"), alert);
    expect((await row("stripe-webhook")).state).toBe("ok");
  });

  it("asks a village with a live key for a live event, since a test event proves only the test secret", async () => {
    await pool.query("DELETE FROM payments_log"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const alert = async () => {};
    const body = (id: string, livemode: boolean) => JSON.stringify({ id, type: "ping", livemode, data: { object: {} } });
    // The key in this environment is sk_live_, so a test event is not enough.
    await handleStripeEvent(pool, body("evt_test", false), sign(body("evt_test", false), SECRET), alert);
    const testOnly = await row("stripe-webhook");
    expect(testOnly.state).toBe("partial");
    expect(testOnly.detail).toContain("Only test-mode events");
    await handleStripeEvent(pool, body("evt_live", true), sign(body("evt_live", true), SECRET), alert);
    expect((await row("stripe-webhook")).state).toBe("ok");
  });

  it("keeps the Stripe and guide evidence through a restart", async () => {
    expect((await row("stripe-keys")).state).toBe("partial");
    expect((await row("assistant-key")).state).toBe("partial");
    await notePlatformCall(PLATFORM_CALLS.stripeCheckout, { ok: true });
    await notePlatformCall(PLATFORM_CALLS.guideReply, { ok: true });
    // A restart reloads the record from the table, and the rows still read done.
    await loadIntegrationHealth(pool);
    expect((await row("stripe-keys")).state).toBe("ok");
    expect((await row("assistant-key")).state).toBe("ok");
  });

  it("reads the session secret the server signs with", async () => {
    expect((await row("session-secret")).state).toBe("ok");
    delete process.env.AUTH_TOKEN_SECRET;
    expect((await row("session-secret")).state).toBe("missing");
  });
});
