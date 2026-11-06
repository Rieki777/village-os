/**
 * THE SETUP GAME'S CO-SIGN, against a real schema (migration 0306).
 *
 * The coordinator's order of 2026-10-31: take the five defaults, and "another
 * admin co-signs" must not lock out a village with ONE admin. So the
 * single-admin case is written first: nobody else can co-sign, the key waits
 * the cooling-off, the steward and founder role holders are told, and then it
 * lands on its own. The rest hold the co-sign itself: the asker cannot sign,
 * a decline or an expiry wipes the value, a newer ask supersedes an older one,
 * and the value is never in the table once a request is decided.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { COSIGN_SLOTS, askToPlant, cosignPlanting, declinePlanting, needsCosign, sweepPlantings, waitingPlantings } from "./plantingRequests";
import { VILLAGE_SECRETS_ENV, loadSecrets, secretStatus, secretValue } from "./secrets";
import { loadVariables } from "./variables";
import { backdatePlantingRequest, plantingRequestById, sealedValueOf } from "../repos/plantingRequests";
import type { NotifyInput } from "./notify";

const ENV = { [VILLAGE_SECRETS_ENV]: "7e".repeat(32) } as NodeJS.ProcessEnv;
const ADA = { id: "u-ada", name: "Ada" };
const BEN = { id: "u-ben", name: "Ben" };
const STRIPE = "sk_live_cosign_value_ab12";

describe("which keys wait for a co-sign", () => {
  it("the six keystone slots in the village's own store, and only after launch", () => {
    expect([...COSIGN_SLOTS.keys()].sort()).toEqual([
      "assistant_api_key",
      "dns_zone_token",
      "railway_project_token",
      "resend_api_key",
      "stripe_secret_key",
      "stripe_webhook_secret",
    ]);
    expect(needsCosign("stripe_secret_key", "after-launch")).toBe(true);
    expect(needsCosign("stripe_secret_key", "before-launch")).toBe(false);
    // An ordinary seed never waits.
    expect(needsCosign("resend_webhook_secret", "after-launch")).toBe(false);
  });
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[plantingRequests.test] TEST_DATABASE_URL not set. The co-sign against a real schema is UNCHECKED here.");
}

describe.skipIf(!configured)("the co-sign against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let told: NotifyInput[] = [];
  const notify = async (n: NotifyInput) => {
    told.push(n);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await loadVariables(pool);
  }, 180_000);

  beforeEach(async () => {
    told = [];
    await pool.query("DELETE FROM app_config WHERE config_key = 'integration-secrets'"); // module-review-ok: fixture SQL against the S5 scratch schema
    await pool.query("DELETE FROM planting_requests"); // module-review-ok: fixture SQL against the S5 scratch schema
    await loadSecrets(pool, ENV);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** The table exactly as a dump would carry it. */
  const dump = async () => JSON.stringify((await pool.query("SELECT * FROM planting_requests"))[0]); // module-review-ok: reading the raw row IS the evidence

  it("ONE ADMIN IS NEVER LOCKED OUT: the key waits the cooling-off, the role holders are told, then it lands", async () => {
    const asked = await askToPlant(pool, { slot: "stripe_secret_key", value: STRIPE, requestedBy: ADA, admins: [ADA], objectors: ["u-steward", ADA.id], notify, env: ENV });
    expect(asked.mode).toBe("cooling_off");
    expect(asked.message).toContain("48 hours");
    // The steward is told; the person who asked is not told about their own key.
    expect(told.map((t) => t.userId)).toEqual(["u-steward"]);
    expect(told[0].link).toBe("/setup-game");
    // Nothing is saved yet, and the dump holds only ciphertext.
    expect(secretValue("stripe_secret_key", ENV)).toBe("");
    expect(await dump()).not.toContain(STRIPE);
    // Not before its time.
    expect(await sweepPlantings(pool, ENV)).toEqual({ landed: 0, expired: 0 });
    await backdatePlantingRequest(pool, asked.id, 49);
    expect(await sweepPlantings(pool, ENV)).toEqual({ landed: 1, expired: 0 });
    expect(secretValue("stripe_secret_key", ENV)).toBe(STRIPE);
    expect(secretStatus("stripe_secret_key", ENV).setBy).toBe(ADA.id);
    expect((await plantingRequestById(pool, asked.id))?.status).toBe("planted");
    expect(await sealedValueOf(pool, asked.id)).toBeNull();
  });

  it("a role holder can decline inside the cooling-off, and the value is wiped", async () => {
    const asked = await askToPlant(pool, { slot: "stripe_secret_key", value: STRIPE, requestedBy: ADA, admins: [ADA], objectors: ["u-steward"], notify, env: ENV });
    expect(await declinePlanting(pool, asked.id, { id: "u-steward", name: "Steward" })).toEqual({ ok: true });
    await backdatePlantingRequest(pool, asked.id, 49);
    expect(await sweepPlantings(pool, ENV)).toEqual({ landed: 0, expired: 0 });
    expect(secretValue("stripe_secret_key", ENV)).toBe("");
    expect(await dump()).not.toContain('"ciphertext":"');
  });

  it("with a second admin it waits for that admin, and the asker cannot sign their own key", async () => {
    const asked = await askToPlant(pool, { slot: "resend_api_key", value: "re_cosign_value_zz99", requestedBy: ADA, admins: [ADA, BEN], objectors: [], notify, env: ENV });
    expect(asked.mode).toBe("cosign");
    expect(told.map((t) => t.userId)).toEqual([BEN.id]);
    expect(await cosignPlanting(pool, asked.id, ADA, ENV)).toMatchObject({ ok: false, status: 409 });
    expect(secretValue("resend_api_key", ENV)).toBe("");
    expect(await cosignPlanting(pool, asked.id, BEN, ENV)).toEqual({ ok: true });
    expect(secretValue("resend_api_key", ENV)).toBe("re_cosign_value_zz99");
    // Signed once; a second press is told it is decided.
    expect(await cosignPlanting(pool, asked.id, BEN, ENV)).toMatchObject({ ok: false, status: 409 });
    expect(await dump()).not.toContain("re_cosign_value_zz99");
  });

  it("an unsigned co-sign expires, its value wiped, and nothing is saved", async () => {
    const asked = await askToPlant(pool, { slot: "assistant_api_key", value: "sk-ant-cosign-1234", requestedBy: ADA, admins: [ADA, BEN], objectors: [], notify, env: ENV });
    await backdatePlantingRequest(pool, asked.id, 73);
    expect(await sweepPlantings(pool, ENV)).toEqual({ landed: 0, expired: 1 });
    expect((await plantingRequestById(pool, asked.id))?.status).toBe("expired");
    expect(await sealedValueOf(pool, asked.id)).toBeNull();
    expect(secretValue("assistant_api_key", ENV)).toBe("");
  });

  it("a newer ask for the same key supersedes the older one, and the asker can withdraw", async () => {
    const first = await askToPlant(pool, { slot: "stripe_webhook_secret", value: "whsec_first_1111", requestedBy: ADA, admins: [ADA, BEN], objectors: [], notify, env: ENV });
    const second = await askToPlant(pool, { slot: "stripe_webhook_secret", value: "whsec_second_2222", requestedBy: ADA, admins: [ADA, BEN], objectors: [], notify, env: ENV });
    expect((await plantingRequestById(pool, first.id))?.status).toBe("superseded");
    expect((await waitingPlantings(pool)).map((w) => [w.id, w.last4, w.title])).toEqual([[second.id, "2222", "Let Stripe tell the village a payment settled"]]);
    expect(await declinePlanting(pool, second.id, ADA)).toEqual({ ok: true });
    expect((await plantingRequestById(pool, second.id))?.status).toBe("withdrawn");
    expect(await dump()).not.toContain("whsec_");
  });
});
