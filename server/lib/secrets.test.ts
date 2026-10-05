/**
 * Integration secrets at rest.
 *
 * The harm metric this file exists to hold: obtaining a village's database
 * dump must not yield a usable payment credential. Every assertion below is
 * written so that a check which did not actually decrypt anything FAILS.
 * "The dump does not contain the key" is true of an empty database too, so
 * every negative assertion is paired with a positive round trip that proves a
 * real value went in and came back out.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { keyFromEnv, openWith, sealWith } from "./sealedBox";
import {
  ACCEPT_LEGACY_PLAINTEXT,
  NO_VILLAGE_SECRETS_KEY_SENTENCE,
  VILLAGE_SECRETS_ENV,
  allSecretStatuses,
  loadSecrets,
  plaintextSecretKeys,
  putSecret,
  resealPlaintextSecrets,
  secretStatus,
  secretValue,
  villageSecretsConfigured,
  villageSecretsKeyProblem,
  villageSecretsKeyStatus,
  villageSecretsLaunchCheck,
  villageSecretsRefusal,
} from "./secrets";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const withA = { [VILLAGE_SECRETS_ENV]: KEY_A } as NodeJS.ProcessEnv;
const withB = { [VILLAGE_SECRETS_ENV]: KEY_B } as NodeJS.ProcessEnv;
const withNone = {} as NodeJS.ProcessEnv;

const LIVE_KEY = "sk_live_51QhelloWORLDpayments9f8e7d6c5b4a";

describe("sealedBox", () => {
  it("round trips, and a tampered or wrongly keyed box opens as null", () => {
    const key = keyFromEnv(VILLAGE_SECRETS_ENV, withA)!;
    expect(key).not.toBeNull();
    const box = sealWith(key, LIVE_KEY);
    // The positive half. Without this the negatives below prove nothing.
    expect(openWith(key, box)).toBe(LIVE_KEY);
    expect(box.ciphertext).not.toContain("hello");
    // A fresh iv per call, so two seals of one plaintext are not equal.
    expect(sealWith(key, LIVE_KEY).ciphertext).not.toBe(box.ciphertext);
    // The wrong key, and a flipped tag.
    expect(openWith(keyFromEnv(VILLAGE_SECRETS_ENV, withB)!, box)).toBeNull();
    expect(openWith(key, { ...box, tag: Buffer.alloc(16).toString("base64") })).toBeNull();
    expect(openWith(key, { ...box, ciphertext: Buffer.from("xxxx").toString("base64") })).toBeNull();
  });

  it("treats a missing, short or non-hex key as absent rather than erroring", () => {
    expect(keyFromEnv(VILLAGE_SECRETS_ENV, withNone)).toBeNull();
    expect(keyFromEnv(VILLAGE_SECRETS_ENV, { [VILLAGE_SECRETS_ENV]: "abc" })).toBeNull();
    expect(keyFromEnv(VILLAGE_SECRETS_ENV, { [VILLAGE_SECRETS_ENV]: "z".repeat(64) })).toBeNull();
    expect(keyFromEnv(VILLAGE_SECRETS_ENV, { [VILLAGE_SECRETS_ENV]: ` ${KEY_A} ` })).not.toBeNull();
  });
});

describe("villageSecretsConfigured", () => {
  it("is exactly whether a usable key is present", () => {
    expect(villageSecretsConfigured(withA)).toBe(true);
    expect(villageSecretsConfigured(withNone)).toBe(false);
  });
});

/**
 * A key set in the wrong shape is not a key nobody set (2026-10-02). These
 * pin what an operator reads in each case: the Integrations 503's `message`,
 * the status the Integrations screen reads before anybody types, and the
 * launch journey's detail. The shapes themselves are pinned in sealedBox.test.ts.
 */
describe("naming what is wrong with the key", () => {
  const quoted = { [VILLAGE_SECRETS_ENV]: `"${KEY_A}"` } as NodeJS.ProcessEnv;

  it("the 503 message names the problem, and the verb fits it", () => {
    const malformed = villageSecretsRefusal(quoted);
    expect(malformed).toContain(`${VILLAGE_SECRETS_ENV} is set, but it is 66 characters with quotes around it.`);
    expect(malformed).toContain("Correct it in this deployment's environment, then restart and save the key again.");
    expect(malformed).not.toContain("is not set");
    const missing = villageSecretsRefusal(withNone);
    expect(missing).toContain(`${VILLAGE_SECRETS_ENV} is not set`);
    expect(missing).toContain("Set it in this deployment's environment");
    // What the founder does after the fix is the caller's to say.
    expect(villageSecretsRefusal(withNone, "add the calendar again")).toContain("then restart and add the calendar again.");
    // The verbatim `error` sentence is untouched, and tested elsewhere as such.
    expect(NO_VILLAGE_SECRETS_KEY_SENTENCE).toBe("this deployment has no village-secrets key; ask your operator");
    // And never the value, refusal or not.
    for (const said of [malformed, missing]) expect(said).not.toContain(KEY_A.slice(0, 8));
  });

  it("the status agrees with the gate, and carries a sentence only when there is a problem", () => {
    for (const e of [withA, withNone, quoted, { [VILLAGE_SECRETS_ENV]: ` ${KEY_A} ` } as NodeJS.ProcessEnv]) {
      const st = villageSecretsKeyStatus(e);
      expect(st.configured).toBe(villageSecretsConfigured(e));
      expect(st.problem === null).toBe(st.configured);
      expect(st.problem).toBe(villageSecretsKeyProblem(e));
    }
    expect(villageSecretsKeyStatus(quoted).problem).toContain("quotes around it");
  });

  it("the launch check reads ok only for a usable key, and its detail names the shape", () => {
    expect(villageSecretsLaunchCheck(withA).state).toBe("ok");
    expect(villageSecretsLaunchCheck(withNone)).toMatchObject({ state: "missing" });
    expect(villageSecretsLaunchCheck(withNone).detail).toContain("is not set");
    expect(villageSecretsLaunchCheck(quoted).detail).toContain("quotes around it");
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the store against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: a scratch schema, and reading the raw row IS the evidence
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM app_config WHERE config_key = 'integration-secrets'"); // module-review-ok: scratch schema teardown
  });

  /** The row exactly as it sits in a mysqldump. */
  async function rawDoc(): Promise<string> {
    const [rows] = await pool.query<any[]>(
      "SELECT value FROM app_config WHERE config_key = 'integration-secrets'",
    );
    if (!rows[0]) return "";
    return typeof rows[0].value === "string" ? rows[0].value : JSON.stringify(rows[0].value);
  }

  /** Seed the pre-2026-08-30 shape, the way an upgrading village already has it. */
  async function seedPlaintext(key: string, value: string): Promise<void> {
    const doc = { [key]: { value, setBy: "founder", setAt: "2026-07-01T00:00:00.000Z" } };
    await pool.query( // module-review-ok: seeding the pre-2026-08-30 shape by hand is the only way to test reading it
      "INSERT INTO app_config (config_key, value) VALUES ('integration-secrets', ?) " +
        "ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [JSON.stringify(doc)],
    );
  }

  it("writes a secret sealed and reads it back, and the dump no longer carries it", async () => {
    await loadSecrets(pool, withA);
    await putSecret(pool, "stripe_secret_key", LIVE_KEY, "founder", withA);

    // POSITIVE ROUND TRIP FIRST. From the live cache...
    expect(secretValue("stripe_secret_key", withA)).toBe(LIVE_KEY);
    // ...and from a cold read of the database, which is the one that proves
    // the ciphertext on disk is what decrypts, not a value left in memory.
    await loadSecrets(pool, withA);
    expect(secretValue("stripe_secret_key", withA)).toBe(LIVE_KEY);

    // Only now is the absence meaningful.
    const dump = await rawDoc();
    expect(dump).not.toContain(LIVE_KEY);
    expect(dump).not.toContain("sk_live");
    expect(dump).toContain("ciphertext");
    // The mask survives without decryption, and it is only four characters.
    const st = secretStatus("stripe_secret_key", withA);
    expect(st).toMatchObject({ configured: true, source: "admin", last4: "5b4a", atRest: "sealed", unreadable: false });
    expect(JSON.stringify(st)).not.toContain(LIVE_KEY);
    // No status anywhere carries a value, an iv, a tag or a ciphertext. Read
    // with the real key, so this is the readable-sealed shape and not a row
    // that fell back to env and therefore had nothing to leak.
    const wire = JSON.stringify(allSecretStatuses(withA));
    expect(wire).toContain("\"atRest\":\"sealed\"");
    for (const leak of [LIVE_KEY, "ciphertext", "\"iv\"", "\"tag\""]) expect(wire).not.toContain(leak);
  });

  it("refuses to store when the key is absent, and writes nothing at all", async () => {
    await loadSecrets(pool, withNone);
    await expect(putSecret(pool, "stripe_secret_key", LIVE_KEY, "founder", withNone))
      .rejects.toThrow(NO_VILLAGE_SECRETS_KEY_SENTENCE);
    // The refusal is total: no row, no plaintext, no half-written document.
    expect(await rawDoc()).toBe("");
    expect(secretValue("stripe_secret_key", withNone)).toBe("");
    // And the same call succeeds the moment a key exists, so the refusal is
    // about the key and not about the value being rejected for some other reason.
    await putSecret(pool, "stripe_secret_key", LIVE_KEY, "founder", withA);
    expect(secretValue("stripe_secret_key", withA)).toBe(LIVE_KEY);
  });

  it("still reads a pre-existing plaintext row during the dual-read window", async () => {
    expect(ACCEPT_LEGACY_PLAINTEXT).toBe(true);
    await seedPlaintext("resend_api_key", "re_LEGACY_plain_1234");
    // No key on this deployment, so nothing is converted and the old row must
    // keep working: an upgrade that silently drops a live credential is worse
    // than the exposure it is fixing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadSecrets(pool, withNone);
    expect(secretValue("resend_api_key", withNone)).toBe("re_LEGACY_plain_1234");
    expect(secretStatus("resend_api_key", withNone)).toMatchObject({
      configured: true, source: "admin", last4: "1234", atRest: "plaintext", unreadable: false,
    });
    expect(plaintextSecretKeys()).toEqual(["resend_api_key"]);
    // The operator is told, by key name and never by value.
    const said = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(said).toContain(VILLAGE_SECRETS_ENV);
    expect(said).toContain("resend_api_key");
    expect(said).not.toContain("re_LEGACY_plain_1234");
    warn.mockRestore();

    // After the follow-up flips the flag, the same row reads as absent and the
    // env fallback takes over. Proving the flip today means the follow-up is
    // not shipping a branch nobody has executed.
    expect(secretValue("resend_api_key", withNone, false)).toBe("");
    expect(secretValue("resend_api_key", { RESEND_API_KEY: "re_env_9999" }, false)).toBe("re_env_9999");
    expect(secretStatus("resend_api_key", withNone, false)).toMatchObject({
      configured: false, source: "none", atRest: "plaintext", unreadable: true,
    });
  });

  it("seals a plaintext row at boot, keeps it readable, and the second boot is a no-op", async () => {
    await seedPlaintext("stripe_webhook_secret", "whsec_legacy_abcd");
    const before = await rawDoc();
    expect(before).toContain("whsec_legacy_abcd");

    // Run 1: converts.
    await loadSecrets(pool, withA);
    expect(secretValue("stripe_webhook_secret", withA)).toBe("whsec_legacy_abcd");
    const afterFirst = await rawDoc();
    expect(afterFirst).not.toContain("whsec_legacy_abcd");
    expect(afterFirst).toContain("ciphertext");
    expect(plaintextSecretKeys()).toEqual([]);
    // Attribution survives the conversion; it is not re-stamped as today.
    expect(secretStatus("stripe_webhook_secret", withA)).toMatchObject({
      setBy: "founder", setAt: "2026-07-01T00:00:00.000Z", last4: "abcd", atRest: "sealed",
    });

    // Run 2: the same call, on the converted document. Byte-identical row and
    // a reported zero. A re-seal would change the ciphertext (fresh iv), so
    // equality here is what proves nothing ran, rather than a count that could
    // be right by accident.
    await loadSecrets(pool, withA);
    expect(await rawDoc()).toBe(afterFirst);
    expect(await resealPlaintextSecrets(pool, withA)).toEqual({ sealed: 0, leftPlaintext: 0 });
    expect(await rawDoc()).toBe(afterFirst);
    expect(secretValue("stripe_webhook_secret", withA)).toBe("whsec_legacy_abcd");
  });

  it("reports a sealed row it cannot open instead of pretending it is not there", async () => {
    await loadSecrets(pool, withA);
    await putSecret(pool, "basescan_api_key", "bs_key_wxyz", "founder", withA);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadSecrets(pool, withB);

    // The rotated key cannot read it. The store behaves as empty for reads...
    expect(secretValue("basescan_api_key", withB)).toBe("");
    // ...falls through to env like any unset slot...
    expect(secretValue("basescan_api_key", { ...withB, BASESCAN_API_KEY: "bs_env" })).toBe("bs_env");
    // ...and says WHY, which is the difference between a rotation and a loss.
    expect(secretStatus("basescan_api_key", withB)).toMatchObject({
      configured: false, source: "none", atRest: "sealed", unreadable: true,
    });
    expect(warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain(VILLAGE_SECRETS_ENV);
    warn.mockRestore();

    // The correct key still opens it, so the row was never damaged.
    await loadSecrets(pool, withA);
    expect(secretValue("basescan_api_key", withA)).toBe("bs_key_wxyz");
  });

  it("names a malformed key in the boot warning, never calling it unset", async () => {
    // The live report: the variable WAS set, with quotes around it, and the
    // boot line said "not set". It now says what is wrong with it.
    await seedPlaintext("resend_api_key", "re_LEGACY_plain_5678");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quoted = { [VILLAGE_SECRETS_ENV]: `"${KEY_A}"` } as NodeJS.ProcessEnv;
    await loadSecrets(pool, quoted);
    const said = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(said).toContain("with quotes around it");
    expect(said).not.toContain("is not set");
    expect(said).not.toContain("re_LEGACY_plain_5678");
    expect(said).not.toContain(KEY_A.slice(0, 8));
    // Nothing was sealed under a key the gate refuses.
    expect(plaintextSecretKeys()).toEqual(["resend_api_key"]);
    warn.mockRestore();
  });

  it("lets an operator with no key delete an exposed plaintext value", async () => {
    await seedPlaintext("assistant_api_key", "sk-ant-legacy-0000");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadSecrets(pool, withNone);
    expect(secretValue("assistant_api_key", withNone)).toBe("sk-ant-legacy-0000");
    // Clearing needs no key: removal is never the dangerous direction.
    await putSecret(pool, "assistant_api_key", "", "founder", withNone);
    expect(await rawDoc()).not.toContain("sk-ant-legacy-0000");
    expect(secretValue("assistant_api_key", withNone)).toBe("");
    warn.mockRestore();
  });
});
