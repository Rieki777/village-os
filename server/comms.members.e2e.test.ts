/**
 * VILLAGE COMMS, WHAT MEMBERS SEE, DRIVEN THROUGH THE BUILT SERVER
 * (the comms build spec 5.13, lane D3).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Then, in order:
 *
 *   - the member page answers the comms module's 404 while the module is off,
 *     and while it only rehearses, to everyone but the founder;
 *   - once live, a member reads every journey, its steps, timing and words,
 *     and the comms dials, and a stranger is asked to sign in;
 *   - the member cannot turn a journey on, edit a step or change an email's
 *     words, and the journey reads off afterwards;
 *   - the propose door files a `comms-change` submission that the founder's
 *     admin queue lists at once, which is what proves the server hands the
 *     route the one submissions collection; and a dial the village votes on is
 *     sent to the Game Mechanics page with nothing filed.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.members] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 4100 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-members-admin";
const PASSWORD = "CommsMembers123!";
const FOUNDER_EMAIL = `members-founder-${PORT}@example.test`;
const MEMBER_EMAIL = `members-ana-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_d3";
const SENDER = "Test Village <hello@village.example.test>";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
let memberToken = "";

interface Answer { status: number; json: any }

async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? memberToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lifecycle = (to: string) => call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: to, examples: false }, token: founderToken });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms members test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-members-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "comms-d3-token",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      FRONTEND_URL: "https://village.example.test",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, what members see", () => {
  it("sets the village up: a founder and one member", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Ada Founder" }, token: null });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();

    const reg = await call("POST", "/api/auth/register", {
      body: { name: "Ana Member", email: MEMBER_EMAIL, password: "MemberPass123!", paths: ["resident"] },
      token: null,
    });
    expect(reg.status, JSON.stringify(reg.json)).toBe(200);
    memberToken = String(reg.json?.token ?? "");
    expect(memberToken, "the member holds a session").toBeTruthy();
  });

  it("answers the module's 404 while comms is off, and while it rehearses to everyone but the founder", async () => {
    const off = await call("GET", "/api/comms/village");
    expect(off.status, JSON.stringify(off.json)).toBe(404);
    expect(off.json).toMatchObject({ error: "module_disabled", module: "comms" });
    expect((await call("POST", "/api/comms/village/propose", { body: { target: "words", key: "gathering.confirm", change: "Say what to bring." } })).status).toBe(404);

    expect((await lifecycle("preview")).status).toBe(200);
    expect((await call("GET", "/api/comms/village")).status).toBe(404);
    const founder = await call("GET", "/api/comms/village", { token: founderToken });
    expect(founder.status, JSON.stringify(founder.json)).toBe(200);
  });

  it("a member sees every journey, its steps, timing and words, and the comms dials, once comms is live", async () => {
    expect((await lifecycle("members")).status).toBe(200);
    expect((await call("GET", "/api/comms/village", { token: null })).status).toBe(401);

    const view = await call("GET", "/api/comms/village");
    expect(view.status, JSON.stringify(view.json)).toBe(200);
    const going = view.json.journeys.find((j: any) => j.key === "gathering.going");
    expect(going).toMatchObject({ title: "Saying yes to a gathering", state: "off" });
    expect(going.steps.map((s: any) => s.timing)).toEqual(["When they say yes", "1 day before it starts", "2 hours before it starts"]);
    expect(going.steps[0].email.subject).toBe("You're coming to Community supper");
    expect(going.steps[0].email.text.startsWith("Hi Ana,")).toBe(true);
    expect(view.json.journeys.map((j: any) => j.key)).toEqual(expect.arrayContaining(["member.welcome", "joining.request", "path.resident", "path.investor"]));
    const cap = view.json.dials.find((d: any) => d.key === "comms.daily_cap");
    expect(cap).toMatchObject({ value: "2", door: "mechanics" });
    expect(view.json.dials.find((d: any) => d.key === "comms.retention_months")).toMatchObject({ door: "submission" });
  });

  it("a member cannot turn a journey on, edit its steps or change its words", async () => {
    expect((await call("POST", "/api/admin/comms/journeys/gathering.going/state", { body: { state: "on" } })).status).toBe(403);
    expect((await call("PUT", "/api/admin/comms/journeys/gathering.going/steps/day", { body: { offsetMinutes: -60 } })).status).toBe(403);
    expect((await call("PUT", "/api/admin/comms/words/gathering.confirm", { body: { subject: "Mine now", bodyMd: "x" } })).status).toBe(403);
    const view = await call("GET", "/api/comms/village");
    const going = view.json.journeys.find((j: any) => j.key === "gathering.going");
    expect(going.state).toBe("off");
    expect(going.steps[1].timing).toBe("1 day before it starts");
    expect(going.steps[0].email.subject).toBe("You're coming to Community supper");
  });

  it("the propose door files a comms-change the admin queue lists at once, and sends a voted dial to Game Mechanics", async () => {
    const filed = await call("POST", "/api/comms/village/propose", {
      body: { target: "step", key: "path.resident", step: "meet_us", change: "Send the gathering invite a week in." },
    });
    expect(filed.status, JSON.stringify(filed.json)).toBe(200);
    const queue = await call("GET", "/api/admin/submissions?type=comms-change", { token: founderToken });
    expect(queue.status, JSON.stringify(queue.json)).toBe(200);
    expect(queue.json).toHaveLength(1);
    expect(queue.json[0]).toMatchObject({
      id: filed.json.id,
      type: "comms-change",
      status: "new",
      data: { target: "step", key: "path.resident", step: "meet_us", change: "Send the gathering invite a week in." },
    });

    const dial = await call("POST", "/api/comms/village/propose", { body: { target: "dial", key: "comms.daily_cap", change: "Three emails a day is fine." } });
    expect(dial.status).toBe(409);
    expect(dial.json.link).toBe("/game-mechanics?dial=comms.daily_cap");
    expect((await call("GET", "/api/admin/submissions?type=comms-change", { token: founderToken })).json).toHaveLength(1);
  });
});
