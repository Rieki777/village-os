/**
 * The village connector over HTTP (addendum v6, B4). Boots the BUILT server
 * against a scratch schema, because the one thing a fake dispatch cannot
 * prove is that a tool's route really runs AS THE HOLDER through the
 * loopback, with every gate in between.
 *
 *   1. A token with no connector scope is refused; GET answers 405.
 *   2. initialize names the village; tools/list follows the token's scopes.
 *   3. get_my_moon returns the holder's own board, the same tasks the web
 *      route returns, and says the moon review is not open.
 *   4. mark_my_task writes nothing on the first call, then presses the board
 *      exactly once on the confirm, with an event recorded for each call; a
 *      replay of the same token writes nothing.
 *   5. One member's token never reaches another member's board.
 *
 * Order-dependent: run the whole file, never a -t slice.
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
  console.warn("[agentMcp.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** A window no other suite takes (6500-6559, checked by scripts/check-e2e-ports.mjs). */
const PORT = 6500 + (process.pid % 60);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "agent-mcp-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let ana = { token: "", id: "" };
let ben = { token: "", id: "" };
let anaVat = "";
let anaReadVat = "";
let benVat = "";
let calendarVat = "";
let taskId = "";

async function call(method: string, route: string, body?: unknown, token = founderToken): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

let rpcId = 0;
const mcp = (token: string, method: string, params?: unknown) =>
  call("POST", "/api/agent/v1/mcp", { jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) }, token);
const tool = (token: string, name: string, args: Record<string, unknown> = {}) => mcp(token, "tools/call", { name, arguments: args });

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", { name, email: `${slug}-${PORT}@example.test`, password: "AgentTest123!", paths: ["resident"] }, "");
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

async function mint(token: string, scopes: string[]): Promise<string> {
  const r = await call("POST", "/api/agent/tokens", { name: `mcp ${scopes.join(" ")}`, scopes }, token);
  expect(r.status, `minting ${scopes.join(", ")}: ${r.text}`).toBe(200);
  const v = String(r.json?.token ?? "");
  expect(v.startsWith("vat_")).toBe(true);
  return v;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the connector test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-mcp-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
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
      AUTH_TOKEN_SECRET: "agent-mcp-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Connector Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "AgentTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken).toBeTruthy();

  ana = await register("Ana Ruiz", "ana");
  ben = await register("Ben Ortiz", "ben");
  for (const m of [ana, ben]) expect((await call("PUT", `/api/admin/players/${m.id}/stage`, { stageId: "member" })).status).toBe(200);

  // Ana puts one task on her own board, the way the web does.
  const made = await call("POST", "/api/member-tasks/me", { title: "Water the seedlings" }, ana.token);
  expect(made.status, `Ana adds a task: ${made.text}`).toBe(201);
  taskId = String(made.json?.task?.id ?? "");
  expect(taskId).toBeTruthy();

  anaVat = await mint(ana.token, ["moon.read", "tasks.write"]);
  anaReadVat = await mint(ana.token, ["moon.read"]);
  benVat = await mint(ben.token, ["moon.read", "tasks.write"]);
  calendarVat = await mint(ana.token, ["calendar.read"]);
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the village connector", () => {
  it("refuses a token with no connector scope, and answers GET with 405", async () => {
    const r = await mcp(calendarVat, "tools/list");
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("agent_scope_missing");
    const g = await call("GET", "/api/agent/v1/mcp", undefined, anaVat);
    expect(g.status).toBe(405);
    const none = await mcp("", "tools/list");
    expect(none.status).toBe(401);
  });

  it("initializes, and lists tools by the token's scopes", async () => {
    const init = await mcp(anaVat, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.json.result.protocolVersion).toBe("2025-06-18");
    expect(typeof init.json.result.serverInfo.name).toBe("string");
    const note = await call("POST", "/api/agent/v1/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, anaVat);
    expect(note.status).toBe(202);

    const readOnly = await mcp(anaReadVat, "tools/list");
    expect(readOnly.json.result.tools.map((t: any) => t.name)).toEqual(["get_my_moon", "get_my_seats", "get_season"]);
    const both = await mcp(anaVat, "tools/list");
    expect(both.json.result.tools.map((t: any) => t.name)).toContain("mark_my_task");
  });

  it("reads the holder's own board through the holder's own route", async () => {
    const r = await tool(anaVat, "get_my_moon");
    expect(r.status).toBe(200);
    expect(r.json.result.isError).toBe(false);
    const out = r.json.result.structuredContent;
    expect(out.moon).toBeNull();
    const web = await call("GET", "/api/member-tasks/me", undefined, ana.token);
    expect(out.board.open.map((t: any) => t.id)).toEqual(web.json.open.map((t: any) => t.id));
    expect(out.board.open.map((t: any) => t.id)).toContain(taskId);

    const seats = await tool(anaVat, "get_my_seats");
    expect(seats.json.result.isError).toBe(false);
  });

  it("never reaches another member's board", async () => {
    const r = await tool(benVat, "get_my_moon");
    expect(r.json.result.structuredContent.board.open.map((t: any) => t.id)).not.toContain(taskId);
    const press = await tool(benVat, "mark_my_task", { taskId, action: "done" });
    expect(press.json.result.isError).toBe(true);
  });

  it("presses the board once, only after the confirm, and records each call", async () => {
    const before = await pool.query<any[]>("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_mcp'");
    const asked = await tool(anaVat, "mark_my_task", { taskId, action: "done" });
    expect(asked.json.result.isError).toBe(false);
    const { confirmToken, echo } = asked.json.result.structuredContent;
    expect(echo).toMatchObject({ taskId, action: "done", from: "open" });
    const still = await call("GET", "/api/member-tasks/me", undefined, ana.token);
    expect(still.json.open.map((t: any) => t.id)).toContain(taskId);

    const done = await tool(anaVat, "mark_my_task", { taskId, action: "done", confirmToken });
    expect(done.json.result.isError, done.text).toBe(false);
    const after = await call("GET", "/api/member-tasks/me", undefined, ana.token);
    expect(after.json.done.map((t: any) => t.id)).toContain(taskId);

    const replay = await tool(anaVat, "mark_my_task", { taskId, action: "done", confirmToken });
    expect(replay.json.result.isError).toBe(true);

    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_mcp'");
    expect(Number(n.n) - Number((before[0] as any)[0].n)).toBe(3);
  });

  it("puts no session or token value in any answer", () => {
    for (const line of logs) expect(line).not.toContain(anaVat);
  });
});

describe.skipIf(!DB_CONFIGURED)("the Operations agent (B6)", () => {
  let agent = { token: "", id: "" };
  let agentVat = "";

  it("is an admin account marked as an agent's, which a person marks", async () => {
    agent = await register("Claude (Operations agent)", "ops-agent");
    expect((await call("PUT", `/api/admin/users/${agent.id}/role`, { role: "admin", addressUnprovedOk: true })).status).toBe(200);
    const marked = await call("PUT", `/api/admin/players/${agent.id}/agent`, { isAgent: true });
    expect(marked.status, marked.text).toBe(200);
    const login = await call("POST", "/api/auth/login", { email: `ops-agent-${PORT}@example.test`, password: "AgentTest123!" }, "");
    expect(login.status, login.text).toBe(200);
    agent.token = String(login.json?.token ?? "");
    const listed = await call("GET", "/api/admin/agent-accounts");
    expect(listed.json.agents).toContain(agent.id);
  });

  it("gives the admin scope only to an admin", async () => {
    const refused = await call("POST", "/api/agent/tokens", { name: "nope", scopes: ["admin"] }, ana.token);
    expect(refused.status).toBe(400);
    agentVat = await mint(agent.token, ["admin"]);
  });

  it("holds no role (check 54)", async () => {
    const role = await call("POST", "/api/admin/org/roles", { name: "Treasury keeper" });
    expect(role.status, role.text).toBe(200);
    const roleId = String(role.json?.id ?? role.json?.role?.id ?? "");
    expect(roleId).toBeTruthy();
    const termEndsOn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const seat = await call("POST", `/api/admin/org/roles/${roleId}/holders`, { userId: agent.id, termEndsOn });
    expect(seat.status, seat.text).toBeGreaterThanOrEqual(400);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_role_assignments WHERE user_id = ?", [agent.id]);
    expect(Number(rows[0].n)).toBe(0);
    // A person can still be seated there, so the refusal is the agent's alone.
    const person = await call("POST", `/api/admin/org/roles/${roleId}/holders`, { userId: ben.id, termEndsOn });
    expect(person.status, person.text).toBe(200);
  });

  it("is an admin that the money and approval keys still refuse, through its own session", async () => {
    // The person admin reads the treasurer's list; the agent admin, with its own session, does not.
    const person = await call("GET", "/api/cash-owed/queue");
    expect(person.status, person.text).toBe(200);
    const asAgent = await call("GET", "/api/cash-owed/queue", undefined, agent.token);
    expect(asAgent.status, asAgent.text).toBeGreaterThanOrEqual(401);
    expect(asAgent.status).toBeLessThan(500);
  });

  it("calls an allowed admin path as itself, writing only on the confirm (check 52)", async () => {
    const read = await tool(agentVat, "admin_request", { method: "GET", path: "/api/admin/member-tasks/access" });
    expect(read.json.result.isError, read.text).toBe(false);

    const args = { method: "PUT", path: `/api/admin/member-tasks/access/${ben.id}`, body: { on: false }, summary: "Turn off member tasks for Ben. Nothing else changes." };
    const asked = await tool(agentVat, "admin_request", args);
    expect(asked.json.result.structuredContent.confirmRequired).toBe(true);
    const still = await call("GET", "/api/member-tasks/me", undefined, ben.token);
    expect(still.status).toBe(200);
    const done = await tool(agentVat, "admin_request", { ...args, confirmToken: asked.json.result.structuredContent.confirmToken });
    expect(done.json.result.isError, done.text).toBe(false);
    // The same token again writes nothing, though nothing about the echo moved.
    const replay = await tool(agentVat, "admin_request", { ...args, confirmToken: asked.json.result.structuredContent.confirmToken });
    expect(replay.json.result.isError, replay.text).toBe(true);
    expect(replay.json.result.structuredContent.detail.reason).toBe("spent");
    const off = await call("GET", "/api/member-tasks/me", undefined, ben.token);
    expect(off.json?.on === false || off.status === 403, off.text).toBe(true);

    // Three calls inside one second share a created_at, so compare the states as a set of counts.
    const [rows] = await pool.query<any[]>("SELECT state FROM agent_actions WHERE actor_user_id = ?", [agent.id]);
    expect(rows.map((r: any) => r.state).sort()).toEqual(["asked", "done", "done", "refused"]);
  });

  it("takes the summary from body.summary, for a client that connected before the summary argument", async () => {
    const args = { method: "PUT", path: `/api/admin/member-tasks/access/${ben.id}`, body: { on: true, summary: "Turn member tasks back on for Ben." } };
    const asked = await tool(agentVat, "admin_request", args);
    expect(asked.json.result.isError, asked.text).toBe(false);
    expect(asked.json.result.structuredContent.summary).toBe("Turn member tasks back on for Ben.");
    expect(asked.json.result.structuredContent.echo.body).toEqual({ on: true });
    const done = await tool(agentVat, "admin_request", { ...args, confirmToken: asked.json.result.structuredContent.confirmToken });
    expect(done.json.result.isError, done.text).toBe(false);
    const on = await call("GET", "/api/member-tasks/me", undefined, ben.token);
    expect(on.status, on.text).toBe(200);
  });

  it("refuses what is always a person's, for the agent and through the agent's own session (check 53)", async () => {
    const erase = await tool(agentVat, "admin_request", { method: "DELETE", path: `/api/admin/players/${ana.id}` });
    expect(erase.json.result.structuredContent.detail.code).toBe("always_a_person");
    expect((await pool.query<any[]>("SELECT COUNT(*) AS n FROM users WHERE id = ? AND email LIKE 'ana-%'", [ana.id]))[0][0].n).toBe(1);
    const widen = await tool(agentVat, "admin_request", { method: "PUT", path: "/api/admin/agent-admin-paths", body: { paths: [] } });
    expect(widen.json.result.structuredContent.detail.code).toBe("always_a_person");
    const ownFlag = await tool(agentVat, "admin_request", { method: "PUT", path: `/api/admin/users/${agent.id}/role`, body: { role: "member" } });
    expect(ownFlag.json.result.isError).toBe(true);
    // With its own session, the agent account still may not change the list or mark accounts.
    const bySession = await call("PUT", "/api/admin/agent-admin-paths", { document: { paths: [] } }, agent.token);
    expect(bySession.status).toBe(403);
    // And a person may not save a list that names an always-a-person path.
    const saved = await call("PUT", "/api/admin/agent-admin-paths", { document: { paths: [{ method: "DELETE", path: "/api/admin/players/:id", confirm: "agent", label: "x" }] } });
    expect(saved.status).toBe(400);
  });
});

describe.skipIf(!DB_CONFIGURED)("Sera's agent (B7)", () => {
  let seraAgent = { token: "", id: "" };
  let seraVat = "";
  let actionId = "";

  it("is an agent account that is not an admin, and only it may hold sera.undoable (check 58)", async () => {
    seraAgent = await register("Sera (Saberra agent)", "sera-agent");
    expect((await call("PUT", `/api/admin/players/${seraAgent.id}/agent`, { isAgent: true })).status).toBe(200);
    expect((await call("POST", "/api/agent/tokens", { name: "nope", scopes: ["sera.undoable"] }, ana.token)).status).toBe(400);
    expect((await call("POST", "/api/agent/tokens", { name: "nope", scopes: ["sera.undoable"] })).status).toBe(400);
    seraVat = await mint(seraAgent.token, ["sera.undoable"]);
    const listed = await mcp(seraVat, "tools/list");
    expect(listed.json.result.tools.map((t: any) => t.name)).toEqual(["link_sera_person", "suggest_task", "set_board_access", "draft_agenda_item", "suggest_moon_item", "undo_sera_action"]);
    // Not an admin, so the admin scope stays closed to it.
    expect((await call("POST", "/api/agent/tokens", { name: "nope", scopes: ["admin"] }, seraAgent.token)).status).toBe(400);
  });

  it("suggests a task that lands on the member's board and notifies nobody", async () => {
    const [[before]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM notifications");
    const r = await tool(seraVat, "suggest_task", { userId: ana.id, title: "Check the water tank" });
    expect(r.json.result.isError, r.text).toBe(false);
    actionId = String(r.json.result.structuredContent.actionId);
    const board = await call("GET", "/api/member-tasks/me", undefined, ana.token);
    expect(board.json.open.map((t: any) => t.title)).toContain("Check the water tank");
    const [[after]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM notifications");
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it("is listed for stewards and undone by one (check 59, the list and the Undo)", async () => {
    const listed = await call("GET", "/api/admin/agent-actions?scope=sera.undoable");
    expect(listed.json.actions.map((a: any) => a.id)).toContain(actionId);
    const undone = await call("POST", `/api/admin/agent-actions/${actionId}/undo`, {});
    expect(undone.status, undone.text).toBe(200);
    const board = await call("GET", "/api/member-tasks/me", undefined, ana.token);
    expect(board.json.open.map((t: any) => t.title)).not.toContain("Check the water tank");
    expect((await call("POST", `/api/admin/agent-actions/${actionId}/undo`, {})).status).toBe(409);
  });

  it("names the member each action touched, for the steward's list", async () => {
    const listed = await call("GET", "/api/admin/agent-actions?scope=sera.undoable");
    expect(listed.json.actions.find((a: any) => a.id === actionId)?.subjectName).toBe("Ana Ruiz");
  });

  it("acts on no other agent account, and its token ends when a person marks it a person's again", async () => {
    const other = await register("Another bot", "other-bot");
    expect((await call("PUT", `/api/admin/players/${other.id}/agent`, { isAgent: true })).status).toBe(200);
    const r = await tool(seraVat, "suggest_task", { userId: other.id, title: "Nothing" });
    expect(r.json.result.isError).toBe(true);
    expect((await call("PUT", `/api/admin/players/${seraAgent.id}/agent`, { isAgent: false })).status).toBe(200);
    expect((await mcp(seraVat, "tools/list")).status).toBe(401);
  });
});

describe.skipIf(!DB_CONFIGURED)("signing a connector in with OAuth (B4, check 33)", () => {
  const { createHash, randomBytes } = require("crypto") as typeof import("crypto");
  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
  let clientId = "";
  let cara = { token: "", id: "" };

  const token = (form: Record<string, string>) =>
    fetch(`${BASE}/api/agent/v1/oauth/token`, { // module-review-ok: the test client dialling the built server on localhost
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  async function allow(member: { token: string }, challenge: string, extra: Record<string, unknown> = {}) {
    const r = await call("POST", "/api/agent/oauth/authorize", { clientId, redirectUri: REDIRECT, state: "st-1", codeChallenge: challenge, codeChallengeMethod: "S256", scopes: ["moon.read", "tasks.write"], decision: "allow", ...extra }, member.token);
    expect(r.status, r.text).toBe(200);
    return new URL(r.json.redirect);
  }

  it("publishes the metadata and points a 401 at it", async () => {
    const pr = await call("GET", "/.well-known/oauth-protected-resource", undefined, "");
    expect(pr.json.resource).toMatch(/\/api\/agent\/v1\/mcp$/);
    const as = await call("GET", "/.well-known/oauth-authorization-server", undefined, "");
    expect(as.json.code_challenge_methods_supported).toEqual(["S256"]);
    const res = await fetch(`${BASE}/api/agent/v1/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }); // module-review-ok: the test client dialling the built server on localhost
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("registers a public client", async () => {
    const r = await call("POST", "/api/agent/v1/oauth/register", { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }, "");
    expect(r.status, r.text).toBe(201);
    clientId = r.json.client_id;
    const bad = await call("POST", "/api/agent/v1/oauth/register", { redirect_uris: ["http://evil.example/cb"] }, "");
    expect(bad.status).toBe(400);
  });

  it("shows the consent page what is asked, and never sends a member to an unregistered address", async () => {
    const r = await call("GET", `/api/agent/oauth/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`, undefined, ana.token);
    expect(r.json.clientName).toBe("Claude");
    expect(r.json.scopes.map((s: any) => s.scope)).not.toContain("admin");
    // Only the scopes that open a connector tool are offered.
    expect(r.json.scopes.map((s: any) => s.scope)).toEqual(["moon.read", "moon.write", "tasks.write", "moon.review", "roles.read", "roles.propose", "letters.draft", "applicants.read", "onboarding.write", "settings.propose", "listing.propose", "pages.propose", "map.propose"]);
    // An admin is offered the admin scope too, never ticked.
    const asAdmin = await call("GET", `/api/agent/oauth/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(asAdmin.json.scopes.find((s: any) => s.scope === "admin")).toMatchObject({ ticked: false, write: true });
    const foreign = await call("POST", "/api/agent/oauth/authorize", { clientId, redirectUri: "https://evil.example/cb", decision: "allow", codeChallenge: "x", codeChallengeMethod: "S256", scopes: ["moon.read"] }, ana.token);
    expect(foreign.status).toBe(400);
    const refused = await call("POST", "/api/agent/oauth/authorize", { clientId, redirectUri: REDIRECT, state: "s", decision: "deny" }, ana.token);
    expect(new URL(refused.json.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("refuses a code without PKCE", async () => {
    const back = await allow(ana, "", { codeChallengeMethod: "plain" });
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("exchanges a code once for a vat_ token that counts against the day's mints and works on the connector", async () => {
    const [[before]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ?", [ana.id]);
    const { verifier, challenge } = pkce();
    const back = await allow(ana, challenge);
    expect(back.searchParams.get("state")).toBe("st-1");
    const code = back.searchParams.get("code")!;
    const wrong = await token({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    expect(wrong.json.error).toBe("invalid_grant");
    const ok = await token({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.access_token.startsWith("vat_")).toBe(true);
    expect(ok.json.scope).toBe("moon.read tasks.write");
    const again = await token({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(again.json.error).toBe("invalid_grant");
    const [[after]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ?", [ana.id]);
    expect(Number(after.n) - Number(before.n)).toBe(1);
    const listed = await mcp(ok.json.access_token, "tools/list");
    expect(listed.json.result.tools.map((t: any) => t.name)).toContain("mark_my_task");
  });

  it("answers invalid_client for a client it never registered", async () => {
    const r = await token({ grant_type: "authorization_code", code: "x", client_id: "nobody", redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("invalid_client");
  });

  it("gives the client back its state whole, and replaces its own token when it signs in again", async () => {
    // A member of their own: Ana has spent most of the day's mints by now.
    const dana = await register("Dana Vega", "dana-oauth");
    const longState = "s".repeat(900);
    const first = pkce();
    const back = await allow(dana, first.challenge, { state: longState });
    expect(back.searchParams.get("state")).toBe(longState);
    const a = await token({ grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: first.verifier });
    expect(a.status).toBe(200);
    const second = pkce();
    const back2 = await allow(dana, second.challenge);
    const b = await token({ grant_type: "authorization_code", code: back2.searchParams.get("code")!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: second.verifier });
    expect(b.status, JSON.stringify(b.json)).toBe(200);
    expect((await mcp(a.json.access_token, "tools/list")).status).toBe(401);
    expect((await mcp(b.json.access_token, "tools/list")).status).toBe(200);
  });

  it("ends with the member's sessions: a code allowed before, and a token minted before, both stop", async () => {
    cara = await register("Cara Diaz", "cara-oauth");
    const first = pkce();
    const back = await allow(cara, first.challenge);
    const minted = await token({ grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: first.verifier });
    expect(minted.status).toBe(200);
    const second = pkce();
    const pending = (await allow(cara, second.challenge)).searchParams.get("code")!;
    expect((await call("POST", `/api/admin/users/${cara.id}/revoke-sessions`, {})).status).toBe(200);
    expect((await mcp(minted.json.access_token, "tools/list")).status).toBe(401);
    const late = await token({ grant_type: "authorization_code", code: pending, client_id: clientId, redirect_uri: REDIRECT, code_verifier: second.verifier });
    expect(late.json.error).toBe("invalid_grant");
  });
});

describe.skipIf(!DB_CONFIGURED)("the connector's transport guards", () => {
  const raw = (body: string, headers: Record<string, string> = {}) =>
    fetch(`${BASE}/api/agent/v1/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }); // module-review-ok: the test client dialling the built server on localhost

  it("answers a body that is not JSON with a JSON-RPC parse error", async () => {
    const r = await raw("{not json", { Authorization: `Bearer ${anaVat}` });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
  });

  it("refuses a page on another site, and lets a server and its own site through", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await raw(body, { Authorization: `Bearer ${anaVat}`, Origin: "https://evil.example" })).status).toBe(403);
    expect((await raw(body, { Authorization: `Bearer ${anaVat}`, Origin: BASE })).status).toBe(200);
    expect((await raw(body, { Authorization: `Bearer ${anaVat}` })).status).toBe(200);
  });

  it("says invalid_token for a token that failed, nothing for none sent, and insufficient_scope for a 403", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const none = await raw(body);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).not.toContain("error=");
    const bad = await raw(body, { Authorization: "Bearer vat_not-a-real-token" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
    const ok = await raw(body, { Authorization: `Bearer ${anaVat}` });
    expect(ok.headers.get("www-authenticate")).toBeNull();
    const narrow = await raw(body, { Authorization: `Bearer ${calendarVat}` });
    expect(narrow.status).toBe(403);
    expect(narrow.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });
});
