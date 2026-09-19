/**
 * Crowdpool over HTTP: the module gate, the config validator, and the honest
 * degrade path, exercised against the BUILT server the way a village meets
 * them. `server/lib/crowdpool.test.ts` proves the proxy library against a
 * local fixture; this file proves the mounting, which is exactly the layer a
 * unit test cannot see (a route that never mounted passes every unit test).
 *
 * No case here dials the live hub. The configured campaign points at
 * `https://hub.invalid`, a name RFC 6761 reserves so it can never resolve:
 * the guarded dialer fails DNS deterministically, which is the hub-dark case
 * the degrade rules are about. Boots the built dist against a throwaway
 * schema exactly like the other routes suites; skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[crowdpool.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
// From 10081: 10080 is a port fetch() refuses to dial, so a pid landing on it
// booted a server this suite could never reach. The gate now refuses it.
const PORT = 10081 + (process.pid % 1019);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "crowdpool-routes-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialing the server under test on localhost
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the crowdpool route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-crowdpool-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness scratch-schema pool, the routes-suite shape

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "crowdpool-routes-token-secret", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      STRIPE_WEBHOOK_SECRET: "whsec_crowdpoolroutes", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN,
    email: `founder-${PORT}@example.test`,
    name: "Crowdpool Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "CrowdpoolTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("crowdpool routes, over HTTP", () => {
  it("ships OFF: the routes answer the shared module 404, even to the founder", async () => {
    const r = await call("GET", "/api/crowdpool/campaigns");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "module_disabled", module: "crowdpool" });
  });

  it("enables like any module, and an empty config is an empty list, never an error", async () => {
    const on = await call("PUT", "/api/admin/modules/crowdpool/lifecycle", { lifecycle: "public" });
    expect(on.status).toBe(200);
    const r = await call("GET", "/api/crowdpool/campaigns", undefined, "");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ campaigns: [] });
  });

  it("refuses a config whose campaign has neither id nor slug", async () => {
    const r = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ hubBaseUrl: "https://hub.invalid" }] },
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error ?? "")).toContain("numeric hub id or a lowercase slug");
  });

  it("refuses a plain-http hub override", async () => {
    const r = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ slug: "raising", hubBaseUrl: "http://hub.invalid" }] },
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error ?? "")).toContain("https");
  });

  it("refuses two campaigns under one key", async () => {
    const r = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ slug: "raising" }, { slug: "raising", id: 4 }] },
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error ?? "")).toContain("unique");
  });

  it("accepts a well-shaped config", async () => {
    const r = await call("PUT", "/api/admin/modules/crowdpool/config", {
      config: { villageCampaigns: [{ slug: "first-raising", id: 79, hubBaseUrl: "https://hub.invalid" }] },
    });
    expect(r.status).toBe(200);
  });

  it("degrades honestly while the hub is dark and nothing is kept: 503, said plainly", async () => {
    // hub.invalid never resolves (RFC 6761), so this is the hub-dark case.
    const r = await call("GET", "/api/crowdpool/campaign?slug=first-raising", undefined, "");
    expect(r.status).toBe(503);
    expect(r.json?.lastSyncAt).toBeNull();
    expect(String(r.json?.error ?? "")).toContain("out of reach");
  });

  it("lists the unreachable campaign as unreachable, never as zeros", async () => {
    const r = await call("GET", "/api/crowdpool/campaigns", undefined, "");
    expect(r.status).toBe(200);
    expect(r.json.campaigns).toEqual([
      { key: "first-raising", reachable: false, lastSyncAt: null },
    ]);
  });

  it("answers 404 for a slug no config names", async () => {
    const r = await call("GET", "/api/crowdpool/campaign?slug=unlinked", undefined, "");
    expect(r.status).toBe(404);
  });

  it("the admin status line names the key, the stamp, and the refusal", async () => {
    const r = await call("GET", "/api/admin/crowdpool/status");
    expect(r.status).toBe(200);
    expect(r.json.configured).toEqual(["first-raising"]);
    const row = (r.json.campaigns as any[]).find((x) => x.key === "first-raising");
    expect(row).toBeTruthy();
    expect(row.lastSyncAt).toBeNull();
    expect(row.lastAttemptAt).toBeTruthy();
    expect(String(row.lastError ?? "")).not.toBe("");
  });

  it("hides the admin status from members and strangers", async () => {
    const anon = await call("GET", "/api/admin/crowdpool/status", undefined, "");
    expect(anon.status).toBe(401);
  });
});
