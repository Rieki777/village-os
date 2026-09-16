/**
 * What a village does when it has no `VILLAGE_SECRETS_KEY`.
 *
 * Sealing integration secrets at rest (`server/lib/secrets.ts`) made
 * `putSecret` REFUSE rather than store a credential in the clear. That is the
 * right call and it is not the whole change: every caller of `putSecret` now
 * has a failure path it did not have before, and two of them were left
 * holding a throw.
 *
 * WHY A TEST HERE AND NOT IN secrets.test.ts. The unit suite proves the store
 * throws. It cannot prove what a FOUNDER sees, because what a founder sees is
 * decided by Express: this deployment patches its four registration verbs to
 * forward an async rejection to `next()` (server/index.ts, "Express 4 does not
 * route async handler rejections"), so an unguarded throw reaches the browser
 * as `500 {"error":"Internal server error"}`. A person holding a Stripe key
 * gets an opaque server error and no way to learn that the fix is one
 * environment variable. That is a property of the wiring, so it is measured
 * against the built server.
 *
 * WHY THE KEY IS DELETED FROM THE CHILD'S ENV RATHER THAN LEFT UNSET. Every
 * other e2e suite here spreads `process.env` into the child and then sets a
 * fixture `VILLAGE_SECRETS_KEY` (see server/loop.e2e.test.ts). Both halves
 * matter: a developer with the variable in their own `.env` would otherwise
 * hand it to this child and every assertion below would pass by testing the
 * configured path twice. It is removed explicitly, and the first assertion in
 * each block is that the deployment really has no key.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { NO_VILLAGE_SECRETS_KEY_SENTENCE, VILLAGE_SECRETS_ENV } from "./lib/secrets";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[secretsWiring] TEST_DATABASE_URL not set, so DB-backed tests are SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** Its own range, clear of every port claimed by the suites listed in loop.e2e. */
const PORT_A = 26402 + (process.pid % 400);
const PORT_B = 26802 + (process.pid % 400);
const BASE_A = `http://localhost:${PORT_A}`;
const BASE_B = `http://localhost:${PORT_B}`;
const ADMIN = "secrets-wiring-admin";

/** A value shaped like the real thing, so nothing here passes on an empty string. */
const LIVE_STRIPE_KEY = "sk_live_51SecretsWiringNotARealKey8842";
const LIVE_ASSISTANT_KEY = "sk-ant-secrets-wiring-not-a-real-key-7731";
/** What a pre-S63 deployment still has sitting in its email-config document. */
const LEGACY_RESEND_KEY = "re_LegacyPlaintextNotARealKey_5150";

interface Server {
  child: ChildProcess;
  dataDir: string;
  logs: string[];
}

/** The child's environment WITHOUT a village-secrets key, whatever this machine has. */
function envWithoutKey(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env[VILLAGE_SECRETS_ENV];
  return env;
}

async function boot(port: number, dbUrl: string, tokenSecret: string): Promise<Server> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-secrets-wiring-"));

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(port);
  const child = spawn(process.execPath, [DIST], {
    env: envWithoutKey({
      NODE_ENV: "production",
      PORT: String(port),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: dbUrl,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: tokenSecret, // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  // A boot that REFUSES is the failure this file was written to catch, and
  // waiting the full two minutes for it turns a clear answer into a timeout.
  let exited: number | null = null;
  child.on("exit", (code) => { exited = code ?? 0; });

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: `http://localhost:${port}`, logs, child });
  return { child, dataDir, logs };
}

/**
 * One request. The timeout is the point: an unhandled rejection in an Express
 * 4 handler answers NOTHING, and a suite that waits forever for that reports
 * a hang as a hang rather than as an assertion.
 */
async function call(
  base: string,
  method: string,
  route: string,
  body?: unknown,
  auth?: string,
): Promise<{ status: number; json: any }> {
  const res = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function founderTokenFor(base: string, port: number): Promise<string> {
  const bootRes = await call(base, "POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${port}@example.test`, name: "Secrets Wiring Founder",
  }, "");
  const claim = decodeURIComponent(String(bootRes.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call(base, "POST", "/api/auth/set-password", { token: claim, password: "SecretsWiring123!" }, "");
  const token = String(setPw.json?.token ?? "");
  expect(token, "founder must hold a session").toBeTruthy();
  return token;
}

// ── A: the admin write paths ────────────────────────────────────────────────

describe.skipIf(!DB_CONFIGURED)("saving a key on a deployment with no village-secrets key", () => {
  let server: Server | undefined;
  let db: TestDb | undefined;
  let token = "";
  const api = (m: string, r: string, b?: unknown) => call(BASE_A, m, r, b, token);

  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this suite.`);
    }
    db = await provisionTestDb();
    server = await boot(PORT_A, db.url, "secrets-wiring-a-token-secret"); // module-review-ok: fixture, throwaway server
    token = await founderTokenFor(BASE_A, PORT_A);
  }, 300_000);

  afterAll(async () => {
    server?.child.kill();
    await db?.drop();
    if (server) fs.rmSync(server.dataDir, { recursive: true, force: true });
  });

  const statusOf = async (key: string) => {
    const r = await api("GET", "/api/admin/integrations");
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return (r.json.secrets ?? []).find((s: any) => s.key === key);
  };

  it("this deployment really has no key, so nothing below passes by accident", async () => {
    // The control. Every refusal in this block means nothing if the child is
    // quietly running with a key inherited from the developer's own .env.
    const before = await statusOf("stripe_secret_key");
    expect(before, "the store must report the slot").toBeTruthy();
    expect(before.atRest, "no admin-typed value is stored yet").toBeNull();
    expect(before.configured).toBe(false);
  });

  it("refuses in plain language instead of an opaque 500, and stores nothing", async () => {
    const before = await statusOf("stripe_secret_key");
    const put = await api("PUT", "/api/admin/integrations/stripe_secret_key", { value: LIVE_STRIPE_KEY });
    // 503, not 500: the deployment is missing a thing an operator can supply.
    expect(put.status, JSON.stringify(put.json)).toBe(503);
    expect(String(put.json?.error ?? "")).toContain(NO_VILLAGE_SECRETS_KEY_SENTENCE);
    // It names the variable, because "ask your operator" is not actionable on
    // its own for the founder who IS the operator.
    expect(JSON.stringify(put.json)).toContain(VILLAGE_SECRETS_ENV);
    // Nothing may leak back, refusal or not.
    expect(JSON.stringify(put.json)).not.toContain(LIVE_STRIPE_KEY);
    // The row is exactly as it was: not stored, and not stored in the clear.
    expect(await statusOf("stripe_secret_key")).toEqual(before);
  });

  it("still lets an operator CLEAR a key without one", async () => {
    // Deleting an exposed value is a safety improvement and must never need
    // the key that was never set. The store already allows it; this proves
    // the new pre-check did not take that away.
    const put = await api("PUT", "/api/admin/integrations/stripe_secret_key", { value: "" });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect((await statusOf("stripe_secret_key")).atRest).toBeNull();
  });

  it("refuses a key sent through email-config, and saves NOTHING of that request", async () => {
    // The legacy route: an older client posts routing addresses and a key in
    // one body. A half-applied save reported as a failure is the exact thing
    // scripts/check-save-honesty.mjs exists to stop, so the whole request is
    // refused before anything is written.
    const before = await call(BASE_A, "GET", "/api/admin/email-config", undefined, token);
    expect(before.status).toBe(200);

    const put = await api("PUT", "/api/admin/email-config", {
      investor: "half-applied@example.test",
      assistant_api_key: LIVE_ASSISTANT_KEY,
    });
    expect(put.status, JSON.stringify(put.json)).toBe(503);
    expect(String(put.json?.error ?? "")).toContain(NO_VILLAGE_SECRETS_KEY_SENTENCE);
    expect(JSON.stringify(put.json)).not.toContain(LIVE_ASSISTANT_KEY);

    const after = await call(BASE_A, "GET", "/api/admin/email-config", undefined, token);
    expect(after.json.investor, "the routing address must not have moved").toBe(before.json.investor);
    expect((await statusOf("assistant_api_key")).atRest).toBeNull();
  });

  it("still saves a routing-only email-config change, and still clears a key", async () => {
    // The other direction. Refusing every email-config save because the
    // deployment has no sealing key would lock a founder out of settings that
    // have nothing to do with credentials.
    const routing = await api("PUT", "/api/admin/email-config", { investor: "routing-only@example.test" });
    expect(routing.status, JSON.stringify(routing.json)).toBe(200);
    const read = await call(BASE_A, "GET", "/api/admin/email-config", undefined, token);
    expect(read.json.investor).toBe("routing-only@example.test");

    const cleared = await api("PUT", "/api/admin/email-config", { assistant_api_key: "" });
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
  });
});

// ── B: boot, on a village that never booted the sealed release ──────────────

describe.skipIf(!DB_CONFIGURED)("booting with a legacy plaintext key and no village-secrets key", () => {
  let server: Server | undefined;
  let db: TestDb | undefined;

  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this suite.`);
    }
    db = await provisionTestDb();
    // A pre-S63 email-config document, written straight into app_config the
    // way an upgrading deployment (or a restored backup) would already hold
    // it. Nothing in the shipped code can produce this row any more: the
    // email-config route writes "" over both key fields on every save. That
    // is what makes it worth seeding rather than waiting for.
    const seed = await mysql.createConnection({ uri: db.url, timezone: "Z" });
    try {
      await seed.query(
        "INSERT INTO app_config (config_key, value) VALUES ('email-config', ?) " +
          "ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [JSON.stringify({ investor: "", steward: "", resident: "", prosperity: "", sender: "", resend_api_key: LEGACY_RESEND_KEY })],
      );
    } finally {
      await seed.end();
    }
    server = await boot(PORT_B, db.url, "secrets-wiring-b-token-secret"); // module-review-ok: fixture, throwaway server
  }, 300_000);

  afterAll(async () => {
    server?.child.kill();
    await db?.drop();
    if (server) fs.rmSync(server.dataDir, { recursive: true, force: true });
  });

  it("serves", async () => {
    // `boot` already threw if the child exited, so reaching here is most of
    // the assertion. This states it anyway, because the reason this file
    // exists is that a village refused to start over an unset variable.
    const health = await call(BASE_B, "GET", "/health");
    expect(health.status).toBe(200);
  });

  it("leaves the legacy value where it is rather than destroying it", async () => {
    // The move blanks the field in the email-config document once the value
    // is safely in the store. Skipping the move must skip the blanking too,
    // or the only copy of a working key is gone.
    const conn = await mysql.createConnection({ uri: db!.url, timezone: "Z" });
    try {
      const [rows] = await conn.query<any[]>(
        "SELECT value FROM app_config WHERE config_key = 'email-config'",
      );
      const doc = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
      expect(doc.resend_api_key).toBe(LEGACY_RESEND_KEY);
    } finally {
      await conn.end();
    }
  });

  it("says so out loud, naming the variable and the keys it did not move", async () => {
    // The whole cost of the skip is that an operator has to be told. A silent
    // skip is a key that stays in the clear forever and nobody ever knows.
    const log = server!.logs.join("");
    expect(log).toContain(VILLAGE_SECRETS_ENV);
    expect(log).toContain("resend_api_key");
    // And never the value itself: logs travel further than databases do.
    expect(log).not.toContain(LEGACY_RESEND_KEY);
  });
});
