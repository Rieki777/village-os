/**
 * A VILLAGE DOES NOT LAUNCH ON A GUESSED ADDRESS (readiness R108).
 *
 * Without FRONTEND_URL every link the village emails sits on whatever address
 * the first request it answered carried. The coordinator's ruling of
 * 2026-11-05 made naming the address a BLOCKING launch row, so this holds the
 * row, its check, and the one property that makes adding a blocking row safe
 * for villages already running: it never touches `launchedAt`.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { launchStatus, siteAddressLaunchCheck, type LaunchDeps } from "./launch";
import { LAUNCH_REQUIREMENTS } from "../../shared/launchRequirements";

describe("the site-address check reads FRONTEND_URL's shape", () => {
  const read = (FRONTEND_URL?: string) => siteAddressLaunchCheck({ FRONTEND_URL } as NodeJS.ProcessEnv);

  it("is missing when unset, and says what the server falls back to", () => {
    expect(read().state).toBe("missing");
    expect(read("   ").state).toBe("missing");
    expect(read().detail).toContain("first request");
  });

  it("names the wrong shape instead of calling a set value unset", () => {
    for (const [value, said] of [
      ['"https://village.example.org"', "quotes"],
      ["FRONTEND_URL=https://village.example.org", "variable name"],
      ["village.example.org", "scheme"],
      ["ftp://village.example.org", "http or https"],
    ] as const) {
      const r = read(value);
      expect(r.state, value).toBe("missing");
      expect(r.detail, value).toContain(said);
      expect(r.detail, value).not.toContain("not set");
    }
  });

  it("is ok for an address with a scheme and a host, and says where links go", () => {
    expect(read("https://village.example.org")).toEqual({ state: "ok", detail: "Emailed links go to https://village.example.org." });
    expect(read("http://localhost:3000/").state).toBe("ok");
  });

  it("is on the journey as a blocking row", () => {
    const row = LAUNCH_REQUIREMENTS.find((r) => r.id === "site-address");
    expect(row?.severity).toBe("blocking");
    expect(row?.checkKey).toBe("site-address");
    expect(row?.why).toContain("FRONTEND_URL");
  });
});

describe.skipIf(!testDbConfigured())("the site-address row against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  /** Every OTHER check answers ok, so only FRONTEND_URL moves the journey. */
  const deps = (env: NodeJS.ProcessEnv): LaunchDeps => {
    const checks: LaunchDeps["checks"] = {};
    for (const r of LAUNCH_REQUIREMENTS) {
      if (r.checkKey.startsWith("manual:") || r.checkKey.startsWith("decide:") || r.checkKey === "site-address") continue;
      checks[r.checkKey] = () => ({ state: "ok", detail: "not in this test" });
    }
    return { checks, moduleLifecycle: () => "off", env };
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("is resolved from the environment with nothing injected, and holds blockingOpen until it is set", async () => {
    const without = await launchStatus(pool, deps({} as NodeJS.ProcessEnv));
    const withIt = await launchStatus(pool, deps({ FRONTEND_URL: "https://village.example.org" } as NodeJS.ProcessEnv));
    const row = (s: typeof without) => s.items.find((i) => i.id === "site-address")!;
    expect(row(without).state).toBe("missing");
    expect(row(without).detail).not.toMatch(/No check wired/);
    expect(row(withIt).state).toBe("ok");
    // The row is the whole difference between the two, and launch state is not part of it.
    expect(without.blockingOpen - withIt.blockingOpen).toBe(1);
    expect(without.launchedAt).toBe(withIt.launchedAt);
  });

  it("lets an injected check win, so a suite can hold this row still", async () => {
    const d = deps({} as NodeJS.ProcessEnv);
    d.checks["site-address"] = () => ({ state: "ok", detail: "held" });
    const s = await launchStatus(pool, d);
    expect(s.items.find((i) => i.id === "site-address")).toMatchObject({ state: "ok", detail: "held" });
  });
});
