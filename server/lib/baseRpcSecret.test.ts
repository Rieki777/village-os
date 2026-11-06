/**
 * THE BASE RPC ENDPOINT IS AN INTEGRATION SECRET.
 *
 * A dedicated endpoint carries its provider key in the address
 * (`https://base-mainnet.g.alchemy.com/v2/<key>`), and this village kept it in
 * the plain game variable `tokens.base_rpc_url`, where every database dump,
 * the admin variables listing and the amendment ledger carried it in the
 * clear. It now lives in the sealed store beside the Stripe keys.
 *
 * What this file holds, each with a positive half so an absence proves
 * something:
 *
 *   - the slot exists, falls back to BASE_RPC_URL, then to the public node
 *   - the dial refuses a new value on every write path and still clears
 *   - a legacy value is moved and sealed at boot, the variable is cleared,
 *     and the move is recorded with no key in the record
 *   - with no usable sealing key the legacy value keeps working, the boot
 *     warning names the slot, and the admin card says it sits in the clear
 *   - clearing the card removes the plaintext variable too, key or no key
 *   - no status, listing, log line or record carries the key
 *
 * Every key below is fake.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { VARIABLES_BY_KEY, validateVariable } from "../../shared/gameVariables";
import { allVariables, loadVariables, setVariable, storedOverride } from "./variables";
import {
  SECRET_KEYS,
  VILLAGE_SECRETS_ENV,
  allSecretStatuses,
  envNameFor,
  loadSecrets,
  putSecret,
  secretStatus,
} from "./secrets";
import { PUBLIC_BASE_RPC_URL, baseRpcUrl } from "./base-reads";

const SLOT = "base_rpc_url";
const DIAL = "tokens.base_rpc_url";
const FAKE_KEY = "FakeRpcKeyNotReal0123456789abcd";
const KEY_URL = `https://base-mainnet.g.alchemy.com/v2/${FAKE_KEY}`;
const ENV_KEY = "EnvFakeKeyNotReal987654321wxyz";
const ENV_URL = `https://base-mainnet.g.alchemy.com/v2/${ENV_KEY}`;
const SEAL = "c3".repeat(32);
const withKey = { [VILLAGE_SECRETS_ENV]: SEAL } as NodeJS.ProcessEnv;
const noKey = {} as NodeJS.ProcessEnv;
const quotedKey = { [VILLAGE_SECRETS_ENV]: `"${SEAL}"` } as NodeJS.ProcessEnv;

describe("the slot and the dial", () => {
  it("is a slot in the sealed store, and its host variable is BASE_RPC_URL", () => {
    expect(SECRET_KEYS).toContain(SLOT);
    expect(envNameFor(SLOT)).toBe("BASE_RPC_URL");
  });

  it("the dial says where its value went, refuses a new one, and still accepts its default", () => {
    const def = VARIABLES_BY_KEY[DIAL];
    expect(def?.movedToSecret).toBe(SLOT);
    const refused = validateVariable(def, KEY_URL);
    expect(refused, "a dedicated endpoint must not be storable as a game rule").not.toBeNull();
    expect(String(refused)).toContain("Integrations");
    // A public node and a loopback node are refused too: one home for one setting.
    expect(validateVariable(def, "http://127.0.0.1:8545")).not.toBeNull();
    // Going back to the default is how the variable is cleared, so it stays open.
    expect(validateVariable(def, def.default)).toBeNull();
    expect(def.default).toBe(PUBLIC_BASE_RPC_URL);
  });

  it("the public fallback is the public Base node", () => {
    expect(PUBLIC_BASE_RPC_URL).toBe("https://mainnet.base.org");
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the endpoint against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: a scratch schema, and reading the raw rows IS the evidence
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM app_config WHERE config_key = 'integration-secrets'"); // module-review-ok: scratch schema teardown
    await pool.query("DELETE FROM game_variables WHERE config_key = ?", [DIAL]); // module-review-ok: scratch schema teardown
    await pool.query("DELETE FROM mechanics_changes WHERE config_key = ?", [DIAL]); // module-review-ok: scratch schema teardown
    await pool.query("DELETE FROM health_events WHERE entity_ref = ?", [SLOT]); // module-review-ok: scratch schema teardown
    await loadVariables(pool);
  });

  /** The pre-upgrade shape: the endpoint stored as a plain game variable row. */
  async function seedLegacyVariable(url: string): Promise<void> {
    await pool.query( // module-review-ok: seeding the pre-upgrade row by hand is the only way to test moving it
      "INSERT INTO game_variables (config_key, value, value_type) VALUES (?,?,'text') " +
        "ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [DIAL, url],
    );
    await loadVariables(pool);
  }

  async function variableRows(): Promise<number> {
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM game_variables WHERE config_key = ?", [DIAL]); // module-review-ok: reading the scratch row is the evidence
    return Number(rows[0]?.n ?? 0);
  }

  async function secretsDoc(): Promise<string> {
    const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'integration-secrets'"); // module-review-ok: the row as a dump carries it
    if (!rows[0]) return "";
    return typeof rows[0].value === "string" ? rows[0].value : JSON.stringify(rows[0].value);
  }

  async function ledgerRows(): Promise<any[]> {
    const [rows] = await pool.query<any[]>("SELECT * FROM mechanics_changes WHERE config_key = ? ORDER BY at, id", [DIAL]); // module-review-ok: reading the scratch ledger is the evidence
    return rows;
  }

  async function eventRows(): Promise<any[]> {
    const [rows] = await pool.query<any[]>("SELECT * FROM health_events WHERE entity_ref = ? ORDER BY at, id", [SLOT]); // module-review-ok: reading the scratch events is the evidence
    return rows;
  }

  function said(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
  }

  it("readers take the admin-typed secret, which beats the host variable", async () => {
    await loadSecrets(pool, withKey);
    await putSecret(pool, SLOT, KEY_URL, "founder", withKey);
    expect(baseRpcUrl(withKey)).toBe(KEY_URL);
    expect(baseRpcUrl({ ...withKey, BASE_RPC_URL: ENV_URL })).toBe(KEY_URL);
    // Sealed on disk, so the dump has no key in it.
    const doc = await secretsDoc();
    expect(doc).toContain("ciphertext");
    expect(doc).not.toContain(FAKE_KEY);
  });

  it("falls back to BASE_RPC_URL when nothing is typed", async () => {
    await loadSecrets(pool, withKey);
    expect(baseRpcUrl({ ...withKey, BASE_RPC_URL: ENV_URL })).toBe(ENV_URL);
    expect(secretStatus(SLOT, { ...withKey, BASE_RPC_URL: ENV_URL })).toMatchObject({
      configured: true, source: "env", last4: "wxyz",
    });
  });

  it("falls back to the public node when nothing is configured, key or no key", async () => {
    await loadSecrets(pool, withKey);
    expect(baseRpcUrl(withKey)).toBe(PUBLIC_BASE_RPC_URL);
    await loadSecrets(pool, noKey);
    expect(baseRpcUrl(noKey)).toBe(PUBLIC_BASE_RPC_URL);
  });

  it("moves a legacy variable into the sealed store at boot, clears it, and records the move", async () => {
    await seedLegacyVariable(KEY_URL);
    expect(storedOverride(DIAL)).toBe(KEY_URL);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadSecrets(pool, withKey);

    // POSITIVE FIRST: the village still reads the same endpoint.
    expect(baseRpcUrl(withKey)).toBe(KEY_URL);
    // The plain copy is gone, from the cache and from the table.
    expect(storedOverride(DIAL)).toBeUndefined();
    expect(await variableRows()).toBe(0);
    await loadVariables(pool);
    expect(storedOverride(DIAL)).toBeUndefined();
    // A cold read of the store opens what the boot sealed.
    await loadSecrets(pool, withKey);
    expect(baseRpcUrl(withKey)).toBe(KEY_URL);
    const doc = await secretsDoc();
    expect(doc).toContain("ciphertext");
    expect(doc).not.toContain(FAKE_KEY);
    expect(secretStatus(SLOT, withKey)).toMatchObject({
      configured: true, source: "admin", last4: "abcd", atRest: "sealed", unreadable: false,
    });

    // The move is recorded twice and the key is in neither record.
    const ledger = await ledgerRows();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ source: "platform", new_value: null });
    expect(String(ledger[0].old_value)).toContain("base-mainnet.g.alchemy.com");
    expect(JSON.stringify(ledger)).not.toContain(FAKE_KEY);
    const events = await eventRows();
    expect(events.map((e) => e.text)).toContain(`integrations:${SLOT}:moved-from-variable`);
    expect(JSON.stringify(events)).not.toContain(FAKE_KEY);

    // Nothing printed the key while it moved.
    expect(said(log) + said(warn)).not.toContain(FAKE_KEY);
    log.mockRestore();
    warn.mockRestore();

    // A second boot finds nothing to move and records nothing more.
    const before = await secretsDoc();
    await loadSecrets(pool, withKey);
    expect(await secretsDoc()).toBe(before);
    expect(await ledgerRows()).toHaveLength(1);
  });

  it("with no usable sealing key, keeps the legacy endpoint working and says so by name", async () => {
    for (const env of [noKey, quotedKey]) {
      await seedLegacyVariable(KEY_URL);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await loadSecrets(pool, env);

      // The village does not lose its endpoint on upgrade...
      expect(baseRpcUrl(env)).toBe(KEY_URL);
      // ...and nothing was destroyed, because there was nowhere safe to put it.
      expect(storedOverride(DIAL)).toBe(KEY_URL);
      expect(await variableRows()).toBe(1);
      expect(await ledgerRows()).toHaveLength(0);

      // The admin card reports it as a value sitting in the clear, masked.
      const st = secretStatus(SLOT, env);
      expect(st).toMatchObject({ configured: true, source: "admin", last4: "abcd", atRest: "plaintext", unreadable: false });
      expect(JSON.stringify(allSecretStatuses(env))).not.toContain(FAKE_KEY);

      // The boot line names the slot, the variable and the key's problem, never the value.
      const text = said(warn);
      expect(text).toContain(SLOT);
      expect(text).toContain(DIAL);
      expect(text).toContain(VILLAGE_SECRETS_ENV);
      expect(text).not.toContain(FAKE_KEY);
      warn.mockRestore();
    }
  });

  it("clearing the card takes the plaintext variable out too, with no key needed", async () => {
    await seedLegacyVariable(KEY_URL);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadSecrets(pool, noKey);
    warn.mockRestore();
    expect(baseRpcUrl(noKey)).toBe(KEY_URL);

    await putSecret(pool, SLOT, "", "founder", noKey);

    expect(storedOverride(DIAL)).toBeUndefined();
    expect(await variableRows()).toBe(0);
    expect(baseRpcUrl(noKey)).toBe(PUBLIC_BASE_RPC_URL);
    expect(secretStatus(SLOT, noKey)).toMatchObject({ configured: false, source: "none", atRest: null });
  });

  it("typing a new endpoint into the card seals it and retires the plaintext variable", async () => {
    await seedLegacyVariable(KEY_URL);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadSecrets(pool, noKey);
    warn.mockRestore();

    await putSecret(pool, SLOT, ENV_URL, "founder", withKey);

    expect(baseRpcUrl(withKey)).toBe(ENV_URL);
    expect(storedOverride(DIAL)).toBeUndefined();
    expect(await variableRows()).toBe(0);
    const doc = await secretsDoc();
    expect(doc).not.toContain(ENV_KEY);
    expect(doc).not.toContain(FAKE_KEY);
  });

  it("the variable write path refuses the endpoint and stores nothing", async () => {
    const r = await setVariable(pool, DIAL, KEY_URL);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("Integrations");
    expect(await variableRows()).toBe(0);
    expect(storedOverride(DIAL)).toBeUndefined();
  });

  it("the admin variables listing never carries the stored endpoint", async () => {
    await seedLegacyVariable(KEY_URL);
    // The value really is stored, so its absence below is masking and not emptiness.
    expect(storedOverride(DIAL)).toBe(KEY_URL);
    const row = allVariables().find((v) => v.key === DIAL);
    expect(row, "the dial is still listed").toBeTruthy();
    expect(row!.value).not.toContain(FAKE_KEY);
    expect(JSON.stringify(allVariables())).not.toContain(FAKE_KEY);
  });
});
