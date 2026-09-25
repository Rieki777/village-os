/**
 * THE CANVAS PEN, DRIVEN THROUGH THE REAL GATE (0222), against the built server.
 *
 * server/routes/canvas.test.ts proves the routes against a real database with
 * a MODEL of `guardCapability`, because the real one lives inside
 * server/index.ts. This file boots `dist/index.js` and asks the real one, so
 * it proves the three things only the running server can:
 *
 *   1. the routes are registered at all, with no module switched on, because
 *      the canvas is core and no lifecycle switch may take it away;
 *   2. the pen is `story.tell` asked of the ONE gate, in the gate's own order:
 *      an admin before the handover, a role that carries it, and once the
 *      village holds it, its holder and not the admin;
 *   3. the refusals are the route's words: 401 to a visitor, 403 and a
 *      sentence to a member without the pen, and the gate's own 409 hatch to
 *      an admin on a key the village holds.
 *
 * ── FIXTURE, SAID ONCE ─────────────────────────────────────────────────────
 *
 * The village HOLDING `story.tell` is a state this file creates. No village
 * on this platform has handed a power over yet, so a green here says the code
 * is right for that day and nothing about any village having reached it.
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
import { CANVAS_BLOCK_IDS } from "../shared/governanceCanvas";
import { CANVAS_PEN_REFUSAL } from "./routes/canvas";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[canvas.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, never claimed by hand here.
const PORT = 2500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "canvas-admin";
const PASSWORD = "CanvasPen123!";
/** A role this file stands up empty before boot, so the pen can be put on it and taken off. */
const ROLE = "canvas-storytellers";

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

const reading = (over: Record<string, unknown> = {}) => ({
  blockId: "purpose",
  level: 2,
  sentence: "Three of us could say why this exists and the answers did not match.",
  ...over,
});

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
      AUTH_TOKEN_SECRET: "canvas-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the canvas route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-canvas-"));
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
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Canvas Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "the founder must hold a session").toBeTruthy();

  people.pen = await register("Wren Halloway", "canvas-wren");
  people.member = await register("Ash Brook", "canvas-ash");
  const seated = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: people.pen.id, action: "add" });
  expect(seated.status, seated.text).toBe(200);
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the canvas, through the real gate", () => {
  it("answers a signed-in member with every block, with no module switched on", async () => {
    const r = await call("GET", "/api/canvas", undefined, people.member.token);
    expect(r.status, r.text).toBe(200);
    expect(r.json.blocks.map((b: any) => b.id)).toEqual([...CANVAS_BLOCK_IDS]);
    expect(r.json.mayRecord).toBe(false);
  });

  it("refuses a visitor with no session, on both doors", async () => {
    expect((await call("GET", "/api/canvas", undefined, "")).status).toBe(401);
    expect((await call("POST", "/api/canvas/readings", reading(), "")).status).toBe(401);
  });

  it("refuses a member without the pen with 403 and the route's own sentence", async () => {
    const r = await call("POST", "/api/canvas/readings", reading(), people.member.token);
    expect(r.status, r.text).toBe(403);
    expect(r.json).toEqual({ error: CANVAS_PEN_REFUSAL });
  });

  it("refuses a seated member whose role does not carry the pen yet", async () => {
    const r = await call("POST", "/api/canvas/readings", reading(), people.pen.token);
    expect(r.status, r.text).toBe(403);
  });

  it("lets the founder record before the handover, as for the village's other words", async () => {
    const r = await call("POST", "/api/canvas/readings", reading({ level: 2 }));
    expect(r.status, r.text).toBe(201);
    expect(r.json.reading).toMatchObject({ blockId: "purpose", level: 2, word: "Forming", moment: "baseline" });
    expect(r.json.reading.recordedBy.name).toBe("Canvas");
    expect((await call("GET", "/api/canvas")).json.mayRecord).toBe(true);
  });

  it("refuses a bad reading from the pen in the validator's words", async () => {
    const r = await call("POST", "/api/canvas/readings", reading({ level: 6 }));
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toMatch(/1 \(Absent\) to 5 \(Thriving\)/);
  });

  it("lets a member write once their role carries story.tell", async () => {
    const armed = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
      capabilities: ["story.tell"],
      grantedEscalations: ["story.tell"],
    });
    expect(armed.status, armed.text).toBe(200);
    const r = await call("POST", "/api/canvas/readings", reading({ level: 3, moment: "canvas-moon" }), people.pen.token);
    expect(r.status, r.text).toBe(201);
    expect(r.json.reading.recordedBy).toEqual({ id: people.pen.id, name: "Wren" });
    expect((await call("GET", "/api/canvas", undefined, people.pen.token)).json.mayRecord).toBe(true);
  });

  it("hands the founder the gate's 409 once the village holds the pen, and its holder still writes", async () => {
    const moved = await call("PUT", "/api/admin/capabilities/story.tell/holding", { roleId: ROLE });
    expect(moved.status, moved.text).toBe(200);

    const founder = await call("POST", "/api/canvas/readings", reading({ level: 5 }));
    expect(founder.status, founder.text).toBe(409);
    expect((await call("GET", "/api/canvas")).json.mayRecord).toBe(false);

    const holder = await call("POST", "/api/canvas/readings", reading({ level: 4, moment: "canvas-moon" }), people.pen.token);
    expect(holder.status, holder.text).toBe(201);
  });

  it("keeps every reading, newest first, and the newest is the block's level", async () => {
    const r = await call("GET", "/api/canvas", undefined, people.member.token);
    const purpose = r.json.blocks.find((b: any) => b.id === "purpose");
    expect(purpose.history.map((h: any) => h.level)).toEqual([4, 3, 2]);
    expect(purpose.latest).toMatchObject({ level: 4, word: "Growing", recordedBy: { name: "Wren" } });
    for (const b of r.json.blocks.filter((x: any) => x.id !== "purpose")) expect(b.latest).toBeNull();
  });
});
