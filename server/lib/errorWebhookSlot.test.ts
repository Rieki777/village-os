/**
 * CRASH ALERTS TO AN ADDRESS TYPED INTO ADMIN, INTEGRATIONS (readiness R171).
 *
 * A founder on a hosted village holds Admin and not the host, and the crash
 * alert address was read from ERROR_WEBHOOK_URL alone. An incoming-webhook
 * address carries its token in the path, so it is held where the other
 * credentials are: sealed in the store, with the host variable as fallback.
 *
 * Against a real store, because the point is that the reporter reads what the
 * store holds. The outbound call is the one thing stubbed, as in errors.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";

const guardedFetchJson = vi.fn();
vi.mock("./toolcheck", () => ({ guardedFetchJson: (...a: any[]) => guardedFetchJson(...a) }));

const { reportError } = await import("./errors");
const { loadSecrets, putSecret } = await import("./secrets");

const STORED = "https://collector.example/hooks/stored-in-admin";
const HOST = "https://collector.example/hooks/set-on-the-host";
const KEY = "5e".repeat(32);

describe.skipIf(!testDbConfigured())("crash alerts to an address typed into Admin, Integrations (R171)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const prior = { key: process.env.VILLAGE_SECRETS_KEY, hook: process.env.ERROR_WEBHOOK_URL };
  let errSpy: ReturnType<typeof vi.spyOn>;
  let n = 0;
  /** A fresh `where` each time, so the reporter's repeat suppression never hides a case. */
  const report = () => reportError(new Error("the slot under test"), { where: `error webhook slot case ${++n}` });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
    process.env.VILLAGE_SECRETS_KEY = KEY;
    delete process.env.ERROR_WEBHOOK_URL;
    await loadSecrets(pool);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  }, 180_000);

  afterEach(() => {
    guardedFetchJson.mockReset();
    guardedFetchJson.mockResolvedValue({});
  });

  afterAll(async () => {
    errSpy?.mockRestore();
    if (prior.key === undefined) delete process.env.VILLAGE_SECRETS_KEY;
    else process.env.VILLAGE_SECRETS_KEY = prior.key;
    if (prior.hook === undefined) delete process.env.ERROR_WEBHOOK_URL;
    else process.env.ERROR_WEBHOOK_URL = prior.hook;
    await pool?.end();
    await db?.drop();
  });

  it("tells nobody outside while neither home holds an address, which is the control", async () => {
    guardedFetchJson.mockResolvedValue({});
    expect((await report()).webhook).toBe("not configured");
    expect(guardedFetchJson).not.toHaveBeenCalled();
  });

  it("posts to the stored address with no host variable", async () => {
    guardedFetchJson.mockResolvedValue({});
    await putSecret(pool, "error_webhook_url", STORED, "slot-test");
    expect((await report()).webhook).toBe("sent");
    expect(guardedFetchJson.mock.calls[0][0]).toBe(STORED);
  });

  it("posts to the stored address over the host's", async () => {
    guardedFetchJson.mockResolvedValue({});
    process.env.ERROR_WEBHOOK_URL = HOST;
    expect((await report()).webhook).toBe("sent");
    expect(guardedFetchJson.mock.calls[0][0]).toBe(STORED);
  });

  it("goes back to the host's address once the stored one is cleared", async () => {
    guardedFetchJson.mockResolvedValue({});
    await putSecret(pool, "error_webhook_url", "", "slot-test");
    expect((await report()).webhook).toBe("sent");
    expect(guardedFetchJson.mock.calls[0][0]).toBe(HOST);
  });
});
