/**
 * A SIGNED-OUT SESSION MUST NOT MOVE THE METER (QA2-05).
 *
 * `markModuleUse` is what R59's economics pay out on: a member counted in
 * `membersReached` is a member the pool has been told about, and the same
 * member sits in the `activeMembers` denominator every other module in the
 * village is measured against. So who the meter is willing to count is an
 * economic question, not a hygiene one.
 *
 * The meter reads the member id straight out of the signed token, which is
 * free and correct as far as it goes. What it skipped was the one thing that
 * makes a token stop being a session: `users.token_version`. A member who
 * signs out, or whom the village signs out, kept counting for the rest of the
 * lunation.
 *
 * The drive, over HTTP against the BUILT `dist/index.js`:
 *
 *   1. CONTROL. A live member opens the tools hub and the meter counts them.
 *   2. They sign out, and `/api/profile` refuses the same token with 401, so
 *      the session really is dead and not merely stale in this test's hand.
 *   3. The same dead token opens the events module. The module answers,
 *      because it is public and a stranger may read it, and the meter counts
 *      NOBODY.
 *   4. CONTROL. They sign back in and open events again, and now it counts.
 *      Without this the whole file would pass on a meter that had simply
 *      stopped working.
 *
 * Run `pnpm build` first or you are testing stale code. Skips loudly without
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
  console.warn("[meterRevocation] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It is checked, not asserted.
 *
 * A hand-written survey used to live here, ending with RE-GREP BEFORE
 * TRUSTING THIS. Nobody re-grepped, the tree moved, and the paragraph went on
 * claiming the window was clear when it had not been for over a week. Worse,
 * every one of those surveys grepped for `process.pid %` and so never saw the
 * stub ports (GOOGLE_PORT, BARE_PORT, STUB_PORT) or the fixed 8127 that
 * actually caused a failure.
 *
 * `scripts/check-e2e-ports.mjs` is that survey, executable, run in CI. It
 * refuses any two windows in different files that overlap at all, any fixed
 * port, and anything reaching into Linux's ephemeral range. Change the number
 * below and it will tell you.
 */
const PORT = 21102 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "MeterRevocation123!";
const PASSWORD = "NiaMeter123!";

let child: ChildProcess | null = null;
let testDb: TestDb | undefined;
let dataDir = "";
const logs: string[] = [];

let founderToken = "";
const niaEmail = () => `nia-${PORT}@example.test`;

interface Answer { status: number; json: any; text: string }

async function call(method: string, route: string, body?: unknown, token?: string | null): Promise<Answer> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/**
 * Let the meter catch up.
 *
 * The mark is written on the response's `finish` event and is deliberately not
 * awaited, because nothing about a member's page may wait on a measurement. So
 * the write can still be in flight when the client already holds the response.
 * `modulePool.e2e.test.ts` carries the same wait for the same reason.
 */
const settle = () => new Promise((r) => setTimeout(r, 600));

/** What the pool is told: members reached per module, and the denominator. */
async function meter(): Promise<{ active: number; reached: Record<string, number> }> {
  const r = await call("GET", "/api/platform/module-usage", undefined, null);
  expect(r.status, "the usage report must answer").toBe(200);
  const reached: Record<string, number> = {};
  for (const m of r.json?.modules ?? []) reached[m.moduleId] = Number(m.membersReached);
  return { active: Number(r.json?.activeMembers ?? -1), reached };
}

describe.skipIf(!DB_CONFIGURED)("a revoked session cannot move the meter", () => {
  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before this drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-meter-revoke-"));
    testDb = await provisionTestDb();

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
        AUTH_TOKEN_SECRET: "meter-revocation-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
        RESEND_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => logs.push(String(d)));
    child.stderr?.on("data", (d) => logs.push(String(d)));

    // Reports the last /health answer and when the server logged that it was
    // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
    await waitForHealth({ base: BASE, logs, child });

    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Meter Founder",
    }, null);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN }, null);
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    // Public, so the module answers a request that carries no live session at
    // all. That is the state this file is about: the door is open to everyone
    // and the meter still has to know who counts.
    for (const id of ["tools", "events"]) {
      const r = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "public" }, founderToken);
      expect(r.status, `${id} must turn on: ${r.text.slice(0, 200)}`).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    child?.kill();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("counts a live member, and stops counting the moment they sign out", async () => {
    const reg = await call("POST", "/api/auth/register", {
      name: "Nia", email: niaEmail(), password: PASSWORD, paths: ["resident"],
    }, null);
    expect(reg.status, "Nia must register").toBe(200);
    const live = String(reg.json?.token ?? "");
    expect(live, "Nia must hold a session").toBeTruthy();

    // 1 · CONTROL. A live member opens the tools hub and the meter counts her.
    expect((await call("GET", "/api/tools", undefined, live)).status).toBe(200);
    await settle();
    const counted = await meter();
    expect(counted.reached.tools, "a live member must be counted").toBe(1);
    expect(counted.active, "and must be in the denominator").toBe(1);
    expect(counted.reached.events ?? 0, "events is untouched so far").toBe(0);

    // 2 · She signs out, and the same token is refused where the rest of the
    // auth path reads it. This is what makes step 3 a measurement of the meter
    // rather than of a token this test forgot to invalidate.
    expect((await call("POST", "/api/auth/logout", {}, live)).status).toBe(200);
    const dead = await call("GET", "/api/profile", undefined, live);
    expect(dead.status, "the session really is dead").toBe(401);

    // 3 · THE FINDING. The same dead token opens a module she has never
    // opened. The module answers, because it is public. The meter counts
    // nobody: she is not reached, and she is not in the denominator twice.
    const afterLogout = await call("GET", "/api/events", undefined, live);
    expect(afterLogout.status, "a public module still answers a stranger").toBe(200);
    await settle();
    const quiet = await meter();
    expect(quiet.reached.events ?? 0, "a signed-out session earns a module nothing").toBe(0);
    expect(quiet.active, "and never enters the denominator the pool divides by").toBe(1);

    // 4 · CONTROL. She signs back in and opens events again. Without this the
    // whole file would pass on a meter that had simply stopped working.
    const back = await call("POST", "/api/auth/login", { email: niaEmail(), password: PASSWORD }, null);
    expect(back.status, "Nia must be able to sign back in").toBe(200);
    const fresh = String(back.json?.token ?? "");
    expect(fresh, "a fresh session").toBeTruthy();
    expect(fresh, "and a different token from the revoked one").not.toBe(live);

    expect((await call("GET", "/api/events", undefined, fresh)).status).toBe(200);
    await settle();
    const again = await meter();
    expect(again.reached.events, "a live session is counted as it always was").toBe(1);
    expect(again.active).toBe(1);
  });
});
