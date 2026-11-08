/**
 * Holding an org seat grants the Power groups linked to it (0322), proved over
 * HTTP against the BUILT server, because the bridge only matters where the one
 * gate, the live-holder counters and admin access read it.
 *
 *   - control: a seated member holds nothing from an unlinked seat;
 *   - linking the seat to a group hands the seated member that group's powers,
 *     admin access included when the group carries it, and the counters count them;
 *   - ending the seating takes the power away on the very next request;
 *   - only the holders of power.assign may change the links (an admin acts
 *     only while nobody holds it), a holder gives only what they hold, and
 *     every change is audited;
 *   - leaving the village ends the holder's seating and the power with it.
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

  it("a member who does not hold power.assign may not change a seat's links", async () => {
    const r = await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: ["founders-circle"] }, sam.token);
    expect(r.status).toBe(403);
    expect((await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: [] }, "")).status).toBe(401);
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

  it("the roles shelf counts and names the seat-granted holder, as the gate and the admin roster do (R161)", async () => {
    const shelf = (await call("GET", "/api/roles")).json;
    const founders = (Array.isArray(shelf) ? shelf : shelf?.roles ?? []).find((g: any) => g.id === "founders-circle");
    expect(founders.holders.map((h: any) => h.userId), "Sam sits in Founders Circle through the Ops Lead seat").toContain(sam.id);
    expect(founders.holderCount).toBe(Number(await holderCount("founders-circle")));
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
    const shelf = (await call("GET", "/api/roles")).json;
    const founders = (Array.isArray(shelf) ? shelf : shelf?.roles ?? []).find((g: any) => g.id === "founders-circle");
    expect(founders.holders.map((h: any) => h.userId), "an ended seating holds nothing on the shelf either").not.toContain(sam.id);
  });

  it("unlinking leaves the seat carrying nothing", async () => {
    const r = await call("PUT", "/api/admin/org-roles/ops-lead/power-groups", { roleIds: [] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.removed).toEqual(["founders-circle"]);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_power_groups WHERE org_role_id = 'ops-lead'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe.skipIf(!DB_CONFIGURED)("power.assign: only its holders hand out powers (Q2, Q7)", () => {
  let ola = { id: "", token: "" };
  let bee = { id: "", token: "" };
  const join = async (name: string, email: string) => {
    const r = await call("POST", "/api/auth/register", { name, email, password: PW, paths: ["resident"] }, "");
    expect(r.status, r.text).toBe(200);
    const who = { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? "") };
    expect((await call("PUT", `/api/admin/players/${who.id}/stage`, { stageId: "member" })).status).toBe(200);
    return who;
  };
  const link = (seat: string, roleIds: string[], token = founderToken) => call("PUT", `/api/admin/org-roles/${seat}/power-groups`, { roleIds }, token);

  it("with nobody holding power.assign, the founder acts as the operator and seats it through a role", async () => {
    ola = await join("Ola Convener", "ola-power-assign@example.test");
    bee = await join("Bee Member", "bee-power-assign@example.test");
    expect((await call("POST", "/api/admin/org/roles", { id: "convener", name: "Convener", aim: "Keep the village's roles and powers in order." })).status).toBeLessThan(300);
    expect((await call("POST", "/api/admin/org/roles/convener/holders", { userId: ola.id })).status).toBeLessThan(300);
    const groups = (await call("GET", "/api/roles")).json;
    const founders = (Array.isArray(groups) ? groups : groups?.roles ?? []).find((g: any) => g.id === "founders-circle");
    expect(founders?.capabilities).toContain("power.assign");
    const r = await link("convener", ["founders-circle"]);
    expect(r.status, r.text).toBe(200);
  });

  it("once somebody holds it, an admin who does not is refused, by name, on both routes", async () => {
    const r = await link("convener", []);
    expect(r.status, r.text).toBe(403);
    expect(r.json.code).toBe("holders_only");
    expect(r.json.holders).toContain(ola.id);
    const g = await call("PUT", "/api/admin/roles/practitioners/capabilities", { capabilities: ["forum.post", "proposal.open"] });
    expect(g.status, g.text).toBe(403);
    expect(g.json.code).toBe("holders_only");
  });

  it("control: the same founder still passes an ordinary admin route", async () => {
    expect((await call("GET", "/api/admin/players")).status).toBe(200);
  });

  it("a member who does not hold it is refused", async () => {
    expect((await link("convener", [], bee.token)).status).toBe(403);
  });

  it("the holder may give only what they hold, on a seat and on a group", async () => {
    const seat = await link("convener", ["founders-circle", "treasury"], ola.token);
    expect(seat.status, seat.text).toBe(403);
    expect(seat.json.code).toBe("give_only_what_you_hold");
    expect(seat.json.capabilities).toContain("cash.pay");
    const group = await call("PUT", "/api/admin/roles/practitioners/capabilities", { capabilities: ["forum.post", "cash.pay"] }, ola.token);
    expect(group.status, group.text).toBe(403);
    expect(group.json.code).toBe("give_only_what_you_hold");
  });

  it("the holder gives a power they hold, and the record names them", async () => {
    const r = await call("PUT", "/api/admin/roles/practitioners/capabilities", { capabilities: ["forum.post", "proposal.open"] }, ola.token);
    expect(r.status, r.text).toBe(200);
    expect(r.json.added).toEqual(["proposal.open"]);
    const [rows] = await pool.query<any[]>("SELECT actor_user_id FROM health_events WHERE kind = 'audit' AND text = 'role:capabilities:practitioners:+proposal.open:-none'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(rows.map((x: any) => x.actor_user_id)).toContain(ola.id);
  });

  it("leaving the village ends the holder's seating, and with it the power, so the operator can act again", async () => {
    const opened = await call("POST", "/api/profile/request-exit", { password: PW }, ola.token);
    expect(opened.status, opened.text).toBe(200);
    const resolved = await call("POST", `/api/admin/exits/${String(opened.json?.exit?.id ?? "")}/resolve`, {});
    expect(resolved.status, resolved.text).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_assignments WHERE user_id = ? AND ended_at IS NULL", [ola.id]); // module-review-ok: the e2e harness reading its own scratch schema
    expect(Number(rows[0].n)).toBe(0);
    const r = await link("convener", []);
    expect(r.status, r.text).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("the members' powers page names who holds a power today, through a role", () => {
  it("names a group holder the house way before the village holds the power, and sends suggestions to them", async () => {
    const r = await call("POST", "/api/auth/register", { name: "Cy Storyteller", email: "cy-page@example.test", password: PW, paths: ["resident"] }, "");
    expect(r.status, r.text).toBe(200);
    const cy = { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? "") };
    expect((await call("PUT", `/api/admin/players/${cy.id}/stage`, { stageId: "member" })).status).toBe(200);
    const before = (await call("GET", "/api/village/powers", undefined, cy.token)).json.powers.find((p: any) => p.capability === "story.tell");
    expect(before.heldToday).toEqual([]);
    const g = await call("PUT", "/api/admin/roles/practitioners/capabilities", { capabilities: ["forum.post", "proposal.open", "story.tell"], grantedEscalations: ["story.tell"] });
    expect(g.status, g.text).toBe(200);
    expect((await call("POST", "/api/admin/roles/practitioners/holders", { userId: cy.id, action: "add" })).status).toBe(200);
    const page = await call("GET", "/api/village/powers", undefined, cy.token);
    expect(page.status, page.text).toBe(200);
    const story = page.json.powers.find((p: any) => p.capability === "story.tell");
    expect(story.heldBy).toBeNull();
    expect(story.heldToday).toEqual(["Trained Practitioners (Cy)"]);
    expect(story.suggestionsGoTo).toBe("holders");
    expect(page.json.powers.map((p: any) => p.capability)).toContain("power.assign");
    expect(page.json.families.map((f: any) => f.id)).toContain("structure");
  });
});

describe.skipIf(!DB_CONFIGURED)("operator powers: a holder reaches an admin route, and no admin loses one", () => {
  let cy = { id: "", token: "" };
  const purpose = (token: string) => call("PUT", "/api/admin/purpose", { statement: "" }, token);

  it("control: a member without the power is refused the admin route", async () => {
    const r = await call("POST", "/api/auth/register", { name: "Cy Storyteller", email: "cy-operator@example.test", password: PW, paths: ["resident"] }, "");
    expect(r.status, r.text).toBe(200);
    cy = { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? "") };
    expect((await call("PUT", `/api/admin/players/${cy.id}/stage`, { stageId: "member" })).status).toBe(200);
    expect((await purpose(cy.token)).status).toBe(401);
  });

  it("holding story.tell through a group opens the purpose route, and nothing beside it", async () => {
    const g = await call("PUT", "/api/admin/roles/practitioners/capabilities", { capabilities: ["forum.post", "proposal.open", "story.tell"], grantedEscalations: ["story.tell"] });
    expect(g.status, g.text).toBe(200);
    expect((await call("POST", "/api/admin/roles/practitioners/holders", { userId: cy.id, action: "add" })).status).toBe(200);
    // Past the gate: an empty statement is the route's own 400, never the gate's 401.
    expect((await purpose(cy.token)).status).toBe(400);
    expect((await call("PUT", "/api/admin/settings", {}, cy.token)).status).toBe(401);
    expect((await call("POST", "/api/admin/launch/confirm", {}, cy.token)).status).toBe(401);
  });

  it("the founder still reaches the route, even once the village holds its power", async () => {
    await pool.query("INSERT INTO capability_holding (capability, holder_role_id, note) VALUES ('story.tell', 'practitioners', 'e2e')"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect((await purpose(founderToken)).status).toBe(400);
    expect((await call("GET", "/api/admin/players")).status).toBe(200);
  });
});
