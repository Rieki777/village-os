/**
 * THE SATELLITE PROVIDER AND ITS KEY, SET FROM ADMIN (readiness R171).
 *
 * A founder on a hosted village holds Admin and not the host, and both the
 * provider and its key were host variables. Against a real store and the real
 * dial, because what matters is that the land routes, which call
 * `configuredProvider()` with no arguments, read what the village set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { configuredProvider, satelliteKeyCards } from "./satellite";
import { loadSecrets, putSecret } from "./secrets";
import { loadVariables, setVariable } from "./variables";

const KEY = "6f".repeat(32);

describe.skipIf(!testDbConfigured())("the satellite provider and its key, set from Admin (R171)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const prior = { key: process.env.VILLAGE_SECRETS_KEY, provider: process.env.SATELLITE_PROVIDER, token: process.env.MAPBOX_TOKEN };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
    process.env.VILLAGE_SECRETS_KEY = KEY;
    delete process.env.SATELLITE_PROVIDER;
    delete process.env.MAPBOX_TOKEN;
    await loadVariables(pool);
    await loadSecrets(pool);
  }, 180_000);

  afterAll(async () => {
    for (const [name, value] of [["VILLAGE_SECRETS_KEY", prior.key], ["SATELLITE_PROVIDER", prior.provider], ["MAPBOX_TOKEN", prior.token]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await pool?.end();
    await db?.drop();
  });

  it("reads nothing chosen while neither home chose one, which is the control", () => {
    expect(configuredProvider().provider).toBeNull();
  });

  it("reads the provider the village chose on the dial", async () => {
    expect((await setVariable(pool, "village.satellite_provider", "mapbox")).ok).toBe(true);
    const status = configuredProvider();
    expect(status.provider?.id).toBe("mapbox");
    expect(status.ready, "no key yet").toBe(false);
    expect(status.missingEnv).toBe("MAPBOX_TOKEN");
  });

  it("reads the key typed into Admin, Integrations, over the host's", async () => {
    await putSecret(pool, "satellite_mapbox_token", "stored-token", "slot-test");
    expect(configuredProvider()).toMatchObject({ ready: true, key: "stored-token" });
    process.env.MAPBOX_TOKEN = "host-token";
    expect(configuredProvider().key).toBe("stored-token");
    await putSecret(pool, "satellite_mapbox_token", "", "slot-test");
    expect(configuredProvider().key, "cleared, the host's key is back").toBe("host-token");
    delete process.env.MAPBOX_TOKEN;
  });

  it("keeps the card of a key still stored after the village chose another provider, so it can be cleared", async () => {
    await putSecret(pool, "satellite_mapbox_token", "left-behind", "slot-test");
    expect((await setVariable(pool, "village.satellite_provider", "esri")).ok).toBe(true);
    expect(satelliteKeyCards().map((c) => c.key).sort()).toEqual(["satellite_esri_api_key", "satellite_mapbox_token"]);
    await putSecret(pool, "satellite_mapbox_token", "", "slot-test");
    expect(satelliteKeyCards().map((c) => c.key)).toEqual(["satellite_esri_api_key"]);
  });
});
