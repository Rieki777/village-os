/**
 * PROPOSED CHANGES, end to end, against the BUILT server (dist/index.js) and a scratch schema.
 *
 * The one thing the route suite's stand-in target cannot prove is that an accepted change runs through the
 * village's REAL routes (the role editor, Pages, the variables) as the person accepting, with every gate between.
 *
 *   1. An agent token proposes a batch of three through the connector: a page, a role card and a variable.
 *      Nothing live moves. The connector cannot accept.
 *   2. The person reads the page: each change beside what is live.
 *   3. The person edits one field (the role's aim), saves it as a draft, and makes the page's headline too long for its layout.
 *   4. Bulk accept: the role card and the variable land through their own routes; the page fails on its field
 *      and the other two stay landed.
 *   5. The person fixes the headline and accepts it again: it lands.
 *   6. The lessons read shows the edit, by kind and field.
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
  console.warn("[proposedChanges.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** A window no other suite takes (32752-32767, the last below the ephemeral range; checked by scripts/check-e2e-ports.mjs). */
const PORT = 32752 + (process.pid % 16);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "proposed-changes-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let adminVat = "";
let roleId = "";
let ids: string[] = [];

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
const tool = (token: string, name: string, args: Record<string, unknown> = {}) =>
  call("POST", "/api/agent/v1/mcp", { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, token);

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before this test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-proposals-"));
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
      AUTH_TOKEN_SECRET: "proposed-changes-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Rosa Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "ProposalTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken).toBeTruthy();

  const role = await call("POST", "/api/admin/org/roles", { id: "pc-finance-steward", name: "Lead Finance Steward", aim: "Keep the books." });
  expect(role.status, role.text).toBe(200);
  roleId = String(role.json.id);

  const minted = await call("POST", "/api/agent/tokens", { name: "proposals", scopes: ["admin"] });
  expect(minted.status, minted.text).toBe(200);
  adminVat = String(minted.json.token);
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("proposed changes, end to end", () => {
  it("the connector refuses a never-proposable item and files nothing", async () => {
    const r = await tool(adminVat, "propose_changes", {
      batch: "Keys",
      items: [{ kind: "setting", target: { method: "PUT", path: "/api/admin/integrations/resend" }, body: { key: "x" }, summary: "Set the mail key." }],
    });
    expect(r.json.result.isError).toBe(true);
    expect(JSON.stringify(r.json.result.structuredContent)).toContain("never");
  });

  it("an agent token proposes a batch of three through the connector, and nothing live moves", async () => {
    const r = await tool(adminVat, "propose_changes", {
      batch: "Phase A content",
      items: [
        { kind: "page_content", target: { section: "page-home" }, body: { hero: { headline: "A home on the land" } }, summary: "Reword the homepage headline." },
        { kind: "role_card", target: { roleId }, body: { words: { aim: "Hold the village's money." } }, summary: "Give the Lead Finance Steward card a clearer aim." },
        { kind: "variable", target: { key: "org.applicant_reply_days" }, body: { value: "10" }, summary: "Promise a reply to applicants within ten days." },
      ],
    });
    expect(r.json.result.isError, r.text).toBe(false);
    const out = r.json.result.structuredContent;
    expect(out).toMatchObject({ proposed: true, applied: false });
    ids = out.ids;
    expect(ids).toHaveLength(3);
    const live = await call("GET", `/api/org/role-edit/${roleId}`);
    expect(live.json.state.words.aim).toBe("Keep the books.");
  });

  it("the connector cannot accept, through any tool", async () => {
    const r = await tool(adminVat, "admin_request", { method: "POST", path: "/api/admin/proposals/accept", body: { items: [{ id: ids[0] }] }, summary: "Accept it." });
    expect(r.json.result.isError).toBe(true);
    expect(r.json.result.structuredContent.code ?? JSON.stringify(r.json.result.structuredContent)).toContain("always_a_person");
    const [rows] = await pool.query<any[]>("SELECT status FROM proposed_changes WHERE id = ?", [ids[0]]); // module-review-ok: the e2e reading back its own scratch schema
    expect(rows[0].status).toBe("proposed");
  });

  it("the review page shows each change beside what is live", async () => {
    const page = await call("GET", "/api/admin/proposals");
    expect(page.status).toBe(200);
    expect(page.json.batches.map((b: any) => b.title)).toEqual(["Phase A content"]);
    const role = page.json.changes.find((c: any) => c.kind === "role_card");
    expect(role.targetLabel).toBe("Lead Finance Steward card");
    expect(role.live).toEqual({ words: { aim: "Keep the books." } });
    expect(role.labels["words.aim"]).toBeTruthy();
    expect((await call("GET", "/api/admin/proposals/count")).json.open).toBe(3);
  });

  it("an edit saves as a draft; a bulk accept lands two and leaves the one that failed", async () => {
    const edited = { words: { aim: "Hold the village's money with care, and show the books every moon." } };
    expect((await call("PUT", `/api/admin/proposals/${ids[1]}/draft`, { body: edited })).status).toBe(200);
    const acc = await call("POST", "/api/admin/proposals/accept", {
      items: [{ id: ids[0], body: { hero: { headline: "A home on the land, held together by the families who live and work there" } } }, { id: ids[1] }, { id: ids[2] }],
    });
    expect(acc.status, acc.text).toBe(200);
    expect(acc.json.results.map((x: any) => x.ok)).toEqual([false, true, true]);
    expect(acc.json.results[0].error).toMatch(/48|long|characters/i);
    // The role card and the variable landed through their own routes, the card exactly as edited.
    const role = await call("GET", `/api/org/role-edit/${roleId}`);
    expect(role.json.state.words.aim).toBe(edited.words.aim);
    const vars = await call("GET", "/api/admin/variables");
    const list = (vars.json.categories as any[]).flatMap((c) => c.variables);
    expect(list.find((v: any) => v.key === "org.applicant_reply_days").value).toBe("10");
    const left = await call("GET", "/api/admin/proposals");
    expect(left.json.changes.map((c: any) => [c.id, c.status])).toEqual([[ids[0], "failed"]]);
  });

  it("the failed one is fixed and accepted again", async () => {
    const acc = await call("POST", "/api/admin/proposals/accept", { items: [{ id: ids[0], body: { hero: { headline: "A home on the land, held together" } } }] });
    expect(acc.json.results, acc.text).toEqual([{ id: ids[0], ok: true }]);
    const content = await call("GET", "/api/admin/content");
    expect(content.json["page-home"].hero.headline).toBe("A home on the land, held together");
    expect((await call("GET", "/api/admin/proposals/count")).json.open).toBe(0);
    const [ev] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'proposed_change' AND text LIKE '%accepted by Rosa%'"); // module-review-ok: the e2e reading back its own scratch schema
    expect(Number(ev[0].n)).toBe(3);
  });

  it("the lessons read shows the edits, by kind and field", async () => {
    const r = await tool(adminVat, "read_proposal_lessons", {});
    expect(r.json.result.isError, r.text).toBe(false);
    const groups = r.json.result.structuredContent.groups as any[];
    const role = groups.find((g) => g.kind === "role_card");
    expect(role.fields[0]).toMatchObject({ field: "words.aim", changes: [expect.objectContaining({ proposed: "Hold the village's money.", accepted: "Hold the village's money with care, and show the books every moon." })] });
    const page = groups.find((g) => g.kind === "page_content");
    expect(page.fields[0].changes[0]).toMatchObject({ proposed: "A home on the land", accepted: "A home on the land, held together" });
  });
});
