/**
 * THE APPROVAL INBOX, over real HTTP and the scratch schema (role journey L13, part A).
 *
 *   - a proposal waits and changes nothing; money, secrets, erasure, invites and power are refused at filing
 *   - Approve runs the stored call through the thing's OWN route as the APPROVER: the route sees the approver's
 *     authorization, never the proposer's, and its refusal leaves the proposal waiting
 *   - decisions are recorded (who, when, what); an approved one reverts where its route allows
 *   - a proposal lapses after seven days
 *   - a batch runs each one through its own route, and one refusal does not stop the rest
 *   - only an admin or a holder of one of the inbox's powers opens it
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NEVER_PROPOSE } from "../../shared/approvalInbox";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole } from "../lib/orgChart";
import { addProposal, proposalById } from "../repos/agentProposals";
import { usersRepo } from "../repos/users";
import { register as registerAgentProposals } from "./agentProposals";
import { register } from "./approvalInbox";

const configured = testDbConfigured();
if (!configured) console.warn("[approvalInbox] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ADMIN = { id: "u-admin", name: "Fern Oak", email: "fern@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const BEN = { id: "u-ben", name: "Ben Moss", email: "ben@example.test" };
const CAL = { id: "u-cal", name: "Cal Wren", email: "cal@example.test" };
const SECTION = { headline: "Welcome home" };

describe.skipIf(!configured)("the approval inbox, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let target: http.Server;
  let base = "";
  let targetPort = 0;
  let role = "";
  const state = { viewer: null as string | null, holders: [] as string[], day: "2026-12-01", answer: 200 };
  const hits: Array<{ method: string; path: string; auth: string; body: any; was: string | undefined }> = [];

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    const users = usersRepo(pool);
    for (const p of [ADMIN, ANA, BEN, CAL]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-care', 'Care Circle', '[]', 0)");
    role = await createOrgRole(pool, { id: "ib-role-gardener", name: "Gardener", seats: 2, circleId: "c-care", aim: "Tend the beds." });

    // A stand-in for the admin routes an approval runs. It records who the call came from.
    const fake = express();
    fake.use(express.json());
    fake.use((req, res) => {
      hits.push({ method: req.method, path: req.path, auth: String(req.headers.authorization ?? ""), body: req.body, was: req.get("x-content-was") });
      res.status(state.answer).json(state.answer < 300 ? { success: true } : { error: "That needs a power you do not hold." });
    });
    target = http.createServer(fake);
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    targetPort = (target.address() as { port: number }).port;

    const authedUser = async (req: any) => {
      const who = state.viewer ?? String(req.headers.authorization ?? "").replace("Bearer ", "");
      return who ? await usersRepo(pool).byId(who) : null;
    };
    const app = express();
    app.use(express.json());
    const shared = {
      authedUser,
      getPool: () => pool,
      isAdmin: async (req: any) => (await authedUser(req))?.id === ADMIN.id,
      overLimit: async () => false,
      members: usersRepo(pool),
      liveHoldersOf: async () => state.holders,
    };
    registerAgentProposals(app, shared as any);
    register(app, {
      ...shared,
      port: () => targetPort,
      clientIp: () => "203.0.113.9",
      today: () => state.day,
      filing: () => ({
        variable: (key: string) => (key === "org.start_after_open" ? { key, label: "Start after open", value: "7" } : key === "payments.cap" ? { key, label: "Payment cap", value: "10" } : null),
        module: (id: string) => (id === "gathering" ? { id, name: "Gatherings", core: false, lifecycle: "off", sellsToken: false } : id === "stays" ? { id, name: "Stays", core: false, lifecycle: "off", sellsToken: true } : null),
        openTerm: async () => "season",
        content: (section: string) => (section === "home" ? SECTION : undefined),
        contentVersion: () => "v1",
        pageProblem: (_s: string, body: any) => (body?.headline === "" ? "A headline is needed." : null),
      }),
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await new Promise<void>((resolve) => target?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.viewer = null;
    state.holders = [];
    state.answer = 200;
    state.day = "2026-12-01";
    hits.length = 0;
    await q("DELETE FROM agent_proposals");
    await q("DELETE FROM org_draft_changes");
    await q("DELETE FROM org_drafts");
  });

  const call = async (method: string, path: string, body?: unknown, as: string | null = null) => {
    const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(as ? { authorization: `Bearer ${as}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const fileSetting = async () => (await call("POST", "/api/agent-proposals/setting", { target: "variable", key: "org.start_after_open", value: "14" }, ANA.id)).body.id as string;

  it("files each kind as a waiting proposal and changes nothing", async () => {
    const setting = await call("POST", "/api/agent-proposals/setting", { target: "variable", key: "org.start_after_open", value: "14" }, ANA.id);
    const mod = await call("POST", "/api/agent-proposals/setting", { target: "module", id: "gathering", lifecycle: "members" }, ANA.id);
    const term = await call("POST", "/api/agent-proposals/setting", { target: "open_proposals_term", term: "moon" }, ANA.id);
    const page = await call("POST", "/api/agent-proposals/page-copy", { section: "home", content: { headline: "Welcome back" } }, ANA.id);
    for (const r of [setting, mod, term, page]) {
      expect(r.status).toBe(200);
      expect(r.body.applied).toBe(false);
    }
    expect(hits).toEqual([]);
    const rows = await q("SELECT kind, status, body FROM agent_proposals ORDER BY created_at");
    expect(rows.map((r) => `${r.kind}:${r.status}`)).toEqual(["setting:waiting", "setting:waiting", "setting:waiting", "page_copy:waiting"]);
    const stored = JSON.parse(rows[3].body);
    expect(stored.words).toMatchObject({ before: expect.stringContaining("Welcome home"), after: expect.stringContaining("Welcome back") });
    expect(stored.call.headers).toEqual({ "x-content-was": "v1" });
  });

  it("refuses money, secrets, erasure, invites and power changes at filing, and files nothing", async () => {
    const attempts: Array<[string, any]> = [
      ["/api/agent-proposals/setting", { target: "variable", key: "payments.cap", value: "999" }],
      ["/api/agent-proposals/setting", { target: "module", id: "stays", lifecycle: "public" }],
      ["/api/agent-proposals/page-copy", { section: "api-keys", content: { a: 1 } }],
      ["/api/agent-proposals/page-copy", { section: "erase-members", content: { a: 1 } }],
      ["/api/agent-proposals/page-copy", { section: "invites", content: { a: 1 } }],
      ["/api/agent-proposals/page-copy", { section: "capabilities", content: { a: 1 } }],
    ];
    for (const [path, body] of attempts) {
      const r = await call("POST", path, body, ANA.id);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.message.length).toBeGreaterThan(10);
    }
    expect((await q("SELECT COUNT(*) AS n FROM agent_proposals"))[0].n).toBe(0);
  });

  it("names every never-proposable category", () => {
    expect(NEVER_PROPOSE.map((r) => r.key).sort()).toEqual(["erasure", "invites", "money", "powers", "secrets"]);
  });

  it("refuses a page the page's own rules refuse, and an unknown block", async () => {
    expect((await call("POST", "/api/agent-proposals/page-copy", { section: "home", content: { headline: "" } }, ANA.id)).status).toBe(400);
    expect((await call("POST", "/api/agent-proposals/page-copy", { section: "nowhere", content: { headline: "x" } }, ANA.id)).status).toBe(400);
  });

  it("listing: files when the village has listing, and says so plainly when it does not", async () => {
    let listing = true;
    try {
      await q("SELECT listed FROM org_roles LIMIT 1");
    } catch {
      listing = false;
    }
    const r = await call("POST", "/api/agent-proposals/listing", { roleId: role, listed: false }, ANA.id);
    if (listing) {
      expect(r.status).toBe(200);
      expect(hits).toEqual([]);
    } else {
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/not available in this village yet/);
    }
  });

  it("a map publish with no draft of the proposer's is refused", async () => {
    const r = await call("POST", "/api/agent-proposals/map-publish", {}, ANA.id);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no map draft/);
  });

  it("only an admin or a holder of an inbox power opens it", async () => {
    await fileSetting();
    expect((await call("GET", "/api/approval-inbox", undefined, BEN.id)).status).toBe(401);
    expect((await call("GET", "/api/approval-inbox")).status).toBe(401);
    state.holders = [BEN.id];
    expect((await call("GET", "/api/approval-inbox", undefined, BEN.id)).status).toBe(200);
    const admin = await call("GET", "/api/approval-inbox", undefined, ADMIN.id);
    expect(admin.body.waiting).toHaveLength(1);
    expect(admin.body.waiting[0]).toMatchObject({ kind: "setting", by: "Ana", words: { what: "Start after open", before: "7", after: "14" } });
    expect(Date.parse(admin.body.waiting[0].expiresAt)).toBeGreaterThan(Date.parse(admin.body.waiting[0].at));
  });

  it("Approve runs the thing's own route AS THE APPROVER, and records who, when and what", async () => {
    const id = await fileSetting();
    const r = await call("POST", `/api/approval-inbox/${id}/approve`, {}, ADMIN.id);
    expect(r.status).toBe(200);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ method: "PUT", path: "/api/admin/variables/org.start_after_open", auth: `Bearer ${ADMIN.id}`, body: { value: "14" } });
    expect(hits[0].auth).not.toContain(ANA.id);
    const row = await proposalById(pool, id);
    expect(row?.status).toBe("approved");
    expect(row?.resolvedBy).toBe(ADMIN.id);
    expect(JSON.parse(row!.body!).decision).toMatchObject({ state: "approved", by: ADMIN.id });
    const inbox = await call("GET", "/api/approval-inbox", undefined, ADMIN.id);
    expect(inbox.body.waiting).toEqual([]);
    expect(inbox.body.decided[0]).toMatchObject({ state: "approved", canRevert: true });
    expect((await call("POST", `/api/approval-inbox/${id}/approve`, {}, ADMIN.id)).status).toBe(409);
    expect(hits).toHaveLength(1);
  });

  it("a route's refusal leaves the proposal waiting and says why", async () => {
    const id = await fileSetting();
    state.answer = 403;
    state.holders = [BEN.id];
    const r = await call("POST", `/api/approval-inbox/${id}/approve`, {}, BEN.id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/power you do not hold/);
    expect((await proposalById(pool, id))?.status).toBe("waiting");
  });

  it("reverts an approved proposal through the route's own put-back", async () => {
    const id = await fileSetting();
    await call("POST", `/api/approval-inbox/${id}/approve`, {}, ADMIN.id);
    hits.length = 0;
    const r = await call("POST", `/api/approval-inbox/${id}/revert`, {}, ADMIN.id);
    expect(r.status).toBe(200);
    expect(hits[0]).toMatchObject({ method: "PUT", path: "/api/admin/variables/org.start_after_open", body: { value: "7" } });
    expect((await proposalById(pool, id))?.status).toBe("reverted");
    expect((await call("POST", `/api/approval-inbox/${id}/revert`, {}, ADMIN.id)).status).toBe(409);
  });

  it("a map publish cannot be reverted from here", async () => {
    const id = await addProposal(pool, { kind: "map_publish", proposedBy: ANA.id, title: "Publish the map draft", body: JSON.stringify({ words: { what: "x", before: "", after: "" }, call: { method: "POST", path: "/api/x" }, revert: null }) });
    await q("UPDATE agent_proposals SET status = 'approved' WHERE id = ?", [id]);
    const r = await call("POST", `/api/approval-inbox/${id}/revert`, {}, ADMIN.id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/cannot be undone/);
  });

  it("Decline records who and runs nothing", async () => {
    const id = await fileSetting();
    const r = await call("POST", `/api/approval-inbox/${id}/decline`, {}, ADMIN.id);
    expect(r.status).toBe(200);
    expect(hits).toEqual([]);
    const row = await proposalById(pool, id);
    expect(row).toMatchObject({ status: "declined", resolvedBy: ADMIN.id });
  });

  it("a proposal lapses after seven days and can no longer be approved", async () => {
    const id = await fileSetting();
    await q("UPDATE agent_proposals SET created_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?", [id]);
    const r = await call("POST", `/api/approval-inbox/${id}/approve`, {}, ADMIN.id);
    expect(r.status).toBe(410);
    expect(hits).toEqual([]);
    const inbox = await call("GET", "/api/approval-inbox", undefined, ADMIN.id);
    expect(inbox.body.waiting).toEqual([]);
    expect((await proposalById(pool, id))?.status).toBe("expired");
  });

  it("a batch runs each one through its own route, and one refusal does not stop the rest", async () => {
    const a = await fileSetting();
    const b = (await call("POST", "/api/agent-proposals/page-copy", { section: "home", content: { headline: "Welcome back" } }, ANA.id)).body.id as string;
    const c = (await call("POST", "/api/agent-proposals/setting", { target: "open_proposals_term", term: "moon" }, ANA.id)).body.id as string;
    const r = await call("POST", "/api/approval-inbox/approve-batch", { ids: [a, b, c, "prop_nope"] }, ADMIN.id);
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.ok)).toEqual([true, true, true, false]);
    expect(hits.map((h) => h.path)).toEqual(["/api/admin/variables/org.start_after_open", "/api/admin/content/home", "/api/admin/open-proposals/settings"]);
    expect(hits[1].was).toBe("v1");
    for (const h of hits) expect(h.auth).toBe(`Bearer ${ADMIN.id}`);
  });

  it("a seating dated for later waits for that day, then seats through the holders route as the approver", async () => {
    const filed = await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-10", why: "Cal asked" }, ANA.id);
    expect(filed.status).toBe(200);
    state.holders = [BEN.id];
    const early = await call("POST", `/api/approval-inbox/${filed.body.id}/approve`, {}, ADMIN.id);
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/2026-12-10/);
    expect(hits).toEqual([]);
    state.day = "2026-12-10";
    const ok = await call("POST", `/api/approval-inbox/${filed.body.id}/approve`, {}, ADMIN.id);
    expect(ok.status).toBe(200);
    expect(hits[0]).toMatchObject({ method: "POST", path: `/api/admin/org/roles/${role}/holders`, auth: `Bearer ${ADMIN.id}`, body: { userId: CAL.id } });
    expect((await proposalById(pool, filed.body.id))?.status).toBe("approved");
  });

  it("a role change is an agent draft in the same inbox, published through the draft's own route", async () => {
    const filed = await call("POST", "/api/agent-proposals/role-change", { roleId: role, fields: { aim: "Tend the beds and the seed store." }, why: "The aim leaves the seed store out" }, ANA.id);
    expect(filed.status).toBe(200);
    const inbox = await call("GET", "/api/approval-inbox", undefined, ADMIN.id);
    const item = inbox.body.waiting.find((w: any) => w.kind === "role_change");
    expect(item.id).toBe(`draft:${filed.body.draftId}`);
    const r = await call("POST", `/api/approval-inbox/${item.id}/approve`, {}, ADMIN.id);
    expect(r.status).toBe(200);
    expect(hits[0]).toMatchObject({ method: "POST", path: `/api/org/drafts/${filed.body.draftId}/publish-by-power`, auth: `Bearer ${ADMIN.id}` });
    expect(hits[0].body.expectedChanges).toEqual([filed.body.changeId]);
    const after = await call("GET", "/api/approval-inbox", undefined, ADMIN.id);
    expect(after.body.decided[0]).toMatchObject({ kind: "role_change", state: "approved", canRevert: true });
  });
});
