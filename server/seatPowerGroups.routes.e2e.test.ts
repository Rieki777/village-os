/**
 * Holding an org seat grants the Power groups linked to it (0322), proved over
 * HTTP against the BUILT server, because the bridge only matters where the one
 * gate, the live-holder counters and admin access read it.
 *
 *   - control: a seated member holds nothing from an unlinked seat;
 *   - linking the seat to a group hands the seated member that group's powers,
 *     admin access included when the group carries it, and the counters count them;
 *   - ending the seating takes the power away on the very next request;
 *   - only an admin may change the links (power.assign comes next), and the
 *     change is audited.
 *
 * Boots dist/index.js against a throwaway schema like every routes suite, and
 * skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[seatPowerGroups.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs.
const PORT = 2000 + (process.pid % 49);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "seat-power-groups-admin";
const PW = "SeatPowers123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
const serverLogs: string[] = [];

async function call(method: string, route: string, body?: unknown, token = founderToken): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialing the server under test on localhost
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the seat power groups route test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-seat-powers-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the e2e harness scratch-schema pool, the routes-suite shape
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "seat-power-groups-token-secret", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      VILLAGE_SECRETS_KEY: "1f".repeat(32), // module-review-ok: fixture sealing key, same as every e2e suite
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child.stderr?.on("data", (d) => serverLogs.push(String(d)));
  await waitForHealth({ base: BASE, logs: serverLogs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Seat Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PW }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("0322: holding a seat grants its Power groups", () => {
  let sam = { id: "", token: "" };
  let assignmentId = "";
  const held = async (key: string, token: string) =>
    !!((await call("GET", "/api/game/progression", undefined, token)).json?.capabilityCatalogue ?? []).find((c: any) => c.key === key)?.held;
  const opensPanel = async (token: string) => (await call("GET", "/api/admin/players", undefined, token)).status === 200;
  const holderCount = async (groupId: string) =>
    ((await call("GET", "/api/admin/capabilities/holding")).json?.roles ?? []).find((r: any) => r.id === groupId)?.holderCount;

  it("control: a member seated in an unlinked seat holds nothing from it", async () => {
    const r = await call("POST", "/api/auth/register", { name: "Sam Ops", email: "sam-seat-powers@example.test", password: PW, paths: ["resident"] }, "");
    expect(r.status, r.text).toBe(200);
    sam = { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? "") };
    expect((await call("PUT", `/api/admin/players/${sam.id}/stage`, { stageId: "member" })).status).toBe(200);
    const made = await call("POST", "/api/admin/org/roles", { id: "ops-lead", name: "Ops Lead", aim: "Keep the village's structure working." });
    expect(made.status, made.text).toBeLessThan(300);
    const seated = await call("POST", "/api/admin/org/roles/ops-lead/holders", { userId: sam.id });
    expect(seated.status, seated.text).toBeLessThan(300);
    const [rows] = await pool.query<any[]>("SELECT id FROM org_role_assignments WHERE org_role_id = 'ops-lead' AND user_id = ? AND ended_at IS NULL", [sam.id]); // module-review-ok: the e2e harness reading its own scratch schema
    assignmentId = String(rows[0]?.id ?? "");
    expect(assignmentId).toBeTruthy();
    expect(await held("org.seat", sam.token)).toBe(false);
    expect(await opensPanel(sam.token)).toBe(false);
    expect((await call("GET", "/api/admin/org-roles/ops-lead/power-groups")).json?.roleIds).toEqual([]);
  });

  it("only an admin may change a seat's links", async () => {
    const r = await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: ["founders-circle"] }, sam.token);
    expect(r.status).toBe(401);
  });

  it("refuses a group that does not exist, and a body that is not a list", async () => {
    expect((await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: ["no-such-group"] })).status).toBe(404);
    expect((await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: "founders-circle" })).status).toBe(400);
    expect((await call("PUT", "/api/admin/org-roles/no-such-seat/power-groups", { roleIds: [] })).status).toBe(404);
  });

  it("linking the seat to Founders Circle hands the seated member its powers and its admin access, and the counter counts them", async () => {
    const before = Number(await holderCount("founders-circle") ?? 0);
    const r = await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: ["founders-circle"] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.added).toEqual(["founders-circle"]);
    expect(await held("org.seat", sam.token)).toBe(true);
    expect(await held("org.decide", sam.token)).toBe(true);
    expect(await opensPanel(sam.token)).toBe(true);
    expect(Number(await holderCount("founders-circle"))).toBe(before + 1);
    expect((await call("GET", "/api/admin/org-roles/ops-lead/power-groups")).json?.roleIds).toEqual(["founders-circle"]);
  });

  it("writes the link to the admin trail", async () => {
    const [rows] = await pool.query<any[]>("SELECT text FROM health_events WHERE kind = 'audit' AND entity_type = 'org_role' AND entity_ref = 'ops-lead'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(rows.map((r: any) => r.text)).toContain("org_role:groups:ops-lead:+founders-circle:-none");
  });

  it("ending the seating takes the powers away on the very next request, same token", async () => {
    const ended = await call("DELETE", `/api/admin/org/seatings/${assignmentId}`, { reason: "e2e" });
    expect(ended.status, ended.text).toBeLessThan(300);
    expect(await held("org.seat", sam.token)).toBe(false);
    expect(await opensPanel(sam.token)).toBe(false);
  });

  it("unlinking leaves the seat carrying nothing", async () => {
    const r = await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: [] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.removed).toEqual(["founders-circle"]);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_power_groups WHERE org_role_id = 'ops-lead'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(Number(rows[0].n)).toBe(0);
  });
});
