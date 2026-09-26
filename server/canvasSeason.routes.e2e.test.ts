/**
 * THE CANVAS SEASON, DRIVEN THROUGH THE REAL GATE, against the built server
 * (2026-09-26).
 *
 * server/routes/canvasSeason.test.ts proves the routes against a real
 * database with a MODEL of `guardCapability`, because the real one lives
 * inside server/index.ts. This file boots `dist/index.js` and asks the real
 * one, so it proves what only the running server can:
 *
 *   1. the routes are registered at all, by server/index.ts, with no module
 *      switched on, because the canvas is core;
 *   2. the pen is `story.tell` asked of the ONE gate in its own order: the
 *      founder before the handover, and a member once their role carries it;
 *   3. the refusals are the route's words: 401 to a visitor, 403 and a
 *      sentence to a member without the pen, 400 and the validator's
 *      sentence to a bad file;
 *   4. the Season Two template the platform ships loads through all of it.
 *
 * Boots the BUILT server: run `pnpm build` first. The cases run IN ORDER and
 * build on each other. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { SEASON_PEN_REFUSAL } from "./routes/canvasSeason";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[canvasSeason.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 4050 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "season-admin";
const PASSWORD = "SeasonPen123!";
/** A role this file stands up empty before boot, so the pen can be put on it. */
const ROLE = "season-storytellers";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: Pool;
let founderToken = "";
const people = { pen: { token: "", id: "" }, member: { token: "", id: "" } };

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  }, "");
  expect(r.status, `${name} must register: ${r.text}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

const TEMPLATE = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "docs/seasons/season-two-2026.json"), "utf8"));

const serverLogs: string[] = [];

async function bootServer(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "season-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child!.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child!.stderr?.on("data", (d) => serverLogs.push(String(d)));
  await waitForHealth({ base: BASE, logs: serverLogs, child });
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the canvas season route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-season-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  // Written before boot so the role cache loads it; every later change to it
  // goes through the admin routes, which keep that cache current.
  await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    [ROLE, "Storytellers", "Keeps what the village says about itself.", JSON.stringify([]), 0],
  );
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Season Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "the founder must hold a session").toBeTruthy();

  people.pen = await register("Wren Halloway", "season-wren");
  people.member = await register("Ash Brook", "season-ash");
  const seated = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: people.pen.id, action: "add" });
  expect(seated.status, seated.text).toBe(200);
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the canvas season, through the real gate", () => {
  it("answers a signed-in member with no season, and no module switched on", async () => {
    const r = await call("GET", "/api/canvas/season", undefined, people.member.token);
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ season: null, savedBy: null, savedAt: null, problem: null, mayEdit: false });
  });

  it("refuses a visitor with no session, on every door", async () => {
    expect((await call("GET", "/api/canvas/season", undefined, "")).status).toBe(401);
    expect((await call("PUT", "/api/canvas/season", TEMPLATE, "")).status).toBe(401);
    expect((await call("DELETE", "/api/canvas/season", undefined, "")).status).toBe(401);
  });

  it("refuses a member without the pen with 403 and the route's own sentence", async () => {
    const r = await call("PUT", "/api/canvas/season", TEMPLATE, people.member.token);
    expect(r.status, r.text).toBe(403);
    expect(r.json).toEqual({ error: SEASON_PEN_REFUSAL });
  });

  it("refuses a bad file from the founder in the validator's words, and stores nothing", async () => {
    const r = await call("PUT", "/api/canvas/season", { ...TEMPLATE, weeks: [{ ...TEMPLATE.weeks[0], blocks: ["vibes"] }] });
    expect(r.status, r.text).toBe(400);
    expect(String(r.json?.error)).toMatch(/"vibes" is not one of the twelve canvas blocks/);
    expect((await call("GET", "/api/canvas/season", undefined, people.member.token)).json.season).toBeNull();
  });

  it("lets the founder load the Season Two template before the handover, and every member reads it", async () => {
    const r = await call("PUT", "/api/canvas/season", TEMPLATE);
    expect(r.status, r.text).toBe(200);
    expect(r.json.ignored).toEqual([]);
    const read = await call("GET", "/api/canvas/season", undefined, people.member.token);
    expect(read.status).toBe(200);
    expect(read.json.season.id).toBe("season-two-2026");
    expect(read.json.season.weeks.map((w: any) => w.date)).toEqual(TEMPLATE.weeks.map((w: any) => w.date));
    expect(read.json.savedBy.name).toBe("Season");
    expect((await call("GET", "/api/canvas/season")).json.mayEdit).toBe(true);
  });

  it("lets a member load and remove one once their role carries story.tell", async () => {
    expect((await call("DELETE", "/api/canvas/season", undefined, people.pen.token)).status).toBe(403);
    const armed = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
      capabilities: ["story.tell"],
      grantedEscalations: ["story.tell"],
    });
    expect(armed.status, armed.text).toBe(200);
    expect((await call("GET", "/api/canvas/season", undefined, people.pen.token)).json.mayEdit).toBe(true);
    const removed = await call("DELETE", "/api/canvas/season", undefined, people.pen.token);
    expect(removed.status, removed.text).toBe(200);
    expect(removed.json).toEqual({ removed: true });
    expect((await call("GET", "/api/canvas/season", undefined, people.member.token)).json.season).toBeNull();
    const again = await call("PUT", "/api/canvas/season", TEMPLATE, people.pen.token);
    expect(again.status, again.text).toBe(200);
    expect((await call("GET", "/api/canvas/season", undefined, people.member.token)).json.savedBy.name).toBe("Wren");
  });

  it("hands the founder the gate's 409 once the village holds the pen, and its holder still writes", async () => {
    const moved = await call("PUT", "/api/admin/capabilities/story.tell/holding", { roleId: ROLE });
    expect(moved.status, moved.text).toBe(200);
    expect((await call("DELETE", "/api/canvas/season")).status).toBe(409);
    expect((await call("GET", "/api/canvas/season")).json.mayEdit).toBe(false);
    expect((await call("DELETE", "/api/canvas/season", undefined, people.pen.token)).status).toBe(200);
  });
});
