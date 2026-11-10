/**
 * WHAT THE CONNECTOR PROPOSES, over real HTTP and the scratch schema (role journey L13).
 *
 *   - a role change is an OPEN org draft by an agent source, never published
 *   - a seating proposal is a waiting row, never a seating; a self-seat is refused
 *   - the applicant-data routes answer 403 until the Anchor records its approval,
 *     and the approval records who and when
 *   - the waiting list reaches only a holder of the power to decide or to fill roles
 *   - a letter is queued and never sent; the conversations list carries no contact detail
 *   - erasing the proposer or the member removes the rows
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { usersRepo } from "../repos/users";
import { forgetAgentForMember } from "../repos/memberAgent";
import { register } from "./agentProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[agentProposals] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ADMIN = { id: "u-admin", name: "Fern Oak", email: "fern@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const BEN = { id: "u-ben", name: "Ben Moss", email: "ben@example.test" };
const CAL = { id: "u-cal", name: "Cal Wren", email: "cal@example.test" };

describe.skipIf(!configured)("agent proposals, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let role = "";
  const state = { viewer: null as string | null, deciders: [] as string[], seaters: [] as string[] };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    const users = usersRepo(pool);
    for (const p of [ADMIN, ANA, BEN, CAL]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-care', 'Care Circle', '[]', 0)");
    role = await createOrgRole(pool, { id: "ap-role-gardener", name: "Gardener", seats: 2, circleId: "c-care", aim: "Tend the beds." });
    await seatHolder(pool, role, { userId: BEN.id, seasonId: "s-now", termEndsAt: new Date("2036-12-01T00:00:00Z") });

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null),
      getPool: () => pool,
      isAdmin: async () => state.viewer === ADMIN.id,
      overLimit: async () => false,
      members: usersRepo(pool),
      liveHoldersOf: async (cap: string) => (cap === "org.decide" ? state.deciders : cap === "org.seat" ? state.seaters : []),
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.viewer = null;
    state.deciders = [];
    state.seaters = [];
    await q("DELETE FROM agent_proposals");
    await q("DELETE FROM org_draft_changes");
    await q("DELETE FROM org_drafts");
    await q("DELETE FROM app_config WHERE `key` = 'ai-agents-approval'").catch(() => undefined);
  });

  const call = async (method: string, path: string, body?: unknown, as: string | null = state.viewer) => {
    const before = state.viewer;
    state.viewer = as;
    try {
      const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any };
    } finally {
      state.viewer = before;
    }
  };

  const approve = () => call("PUT", "/api/admin/ai-agents-approval", { approved: true, note: "Anchor thread, 10 Nov" }, ADMIN.id);

  it("a role change is an open agent draft that nobody has published", async () => {
    const r = await call("POST", "/api/agent-proposals/role-change", { roleId: role, fields: { aim: "Tend the beds and the seed store." }, listing: "list", payGroup: "Group B", why: "The aim leaves the seed store out" }, ANA.id);
    expect(r.status).toBe(200);
    expect(r.body.published).toBe(false);
    const [draft] = await q("SELECT status, source_kind, created_by, rationale FROM org_drafts WHERE id = ?", [r.body.draftId]);
    expect(draft).toMatchObject({ status: "open", source_kind: "agent", created_by: ANA.id });
    expect(draft.rationale).toContain("listed");
    expect(draft.rationale).toContain("Group B");
    const [live] = await q("SELECT aim FROM org_roles WHERE id = ?", [role]);
    expect(live.aim).toBe("Tend the beds.");
  });

  it("a role change refuses pay and an unknown role", async () => {
    const pay = await call("POST", "/api/agent-proposals/role-change", { roleId: role, fields: { valueMinor: 90000 }, why: "A clear reason" }, ANA.id);
    expect(pay.status).toBe(400);
    const none = await call("POST", "/api/agent-proposals/role-change", { roleId: "no-such-role", fields: { aim: "x" }, why: "A clear reason" }, ANA.id);
    expect(none.status).toBe(404);
  });

  it("a seating proposal waits and seats nobody; a self-seat is refused", async () => {
    const before = await q("SELECT COUNT(*) AS n FROM org_role_assignments WHERE org_role_id = ?", [role]);
    const r = await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-01", why: "Cal asked" }, ANA.id);
    expect(r.status).toBe(200);
    expect(r.body.seated).toBe(false);
    const after = await q("SELECT COUNT(*) AS n FROM org_role_assignments WHERE org_role_id = ?", [role]);
    expect(after[0].n).toBe(before[0].n);
    expect((await q("SELECT status FROM agent_proposals WHERE id = ?", [r.body.id]))[0].status).toBe("waiting");
    const self = await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: ANA.id, from: "2026-12-01" }, ANA.id);
    expect(self.status).toBe(400);
    expect(self.body.message).toMatch(/own agent/);
    const twice = await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-01" }, BEN.id);
    expect(twice.status).toBe(409);
  });

  it("the waiting list reaches only a holder of the power to decide or to fill roles", async () => {
    await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-01" }, ANA.id);
    await call("POST", "/api/agent-proposals/role-change", { roleId: role, fields: { aim: "A wider aim." }, why: "A clear reason" }, ANA.id);
    expect((await call("GET", "/api/agent-proposals/waiting", undefined, BEN.id)).status).toBe(401);
    state.seaters = [BEN.id];
    const seater = await call("GET", "/api/agent-proposals/waiting", undefined, BEN.id);
    expect(seater.body.seatings).toHaveLength(1);
    expect(seater.body.roleChanges).toEqual([]);
    state.seaters = [];
    state.deciders = [BEN.id];
    const decider = await call("GET", "/api/agent-proposals/waiting", undefined, BEN.id);
    expect(decider.body.roleChanges).toHaveLength(1);
    expect(decider.body.seatings).toEqual([]);
  });

  it("only a holder of the power to fill roles takes a seating off the list", async () => {
    const r = await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-01" }, ANA.id);
    expect((await call("POST", `/api/agent-proposals/${r.body.id}/resolve`, { status: "taken" }, ANA.id)).status).toBe(404);
    state.seaters = [BEN.id];
    expect((await call("POST", `/api/agent-proposals/${r.body.id}/resolve`, { status: "taken" }, BEN.id)).status).toBe(200);
    expect((await call("POST", `/api/agent-proposals/${r.body.id}/resolve`, { status: "taken" }, BEN.id)).status).toBe(409);
  });

  it("applicant data stays closed until the Anchor records its approval, with who and when", async () => {
    const letter = { applicationRef: "ref-1234", kind: "first_reply", subject: "Thank you", body: "Thank you for applying. We will be in touch soon about next steps." };
    for (const [m, p, b] of [["POST", "/api/agent-proposals/letters", letter], ["GET", "/api/agent-proposals/letters", undefined], ["GET", "/api/agent-proposals/conversations", undefined]] as const) {
      const r = await call(m, p, b, ANA.id);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("ai_agents_not_approved");
    }
    expect((await call("GET", "/api/admin/ai-agents-approval", undefined, ADMIN.id)).body.approved).toBe(false);
    expect((await call("PUT", "/api/admin/ai-agents-approval", { approved: true, note: "Anchor thread" }, ANA.id)).status).toBe(401);
    expect((await call("PUT", "/api/admin/ai-agents-approval", { approved: true }, ADMIN.id)).status).toBe(400);
    const on = await approve();
    expect(on.status).toBe(200);
    expect(on.body.approved).toBe(true);
    expect(on.body.by).toMatchObject({ userId: ADMIN.id, name: "Fern Oak" });
    expect(Date.parse(on.body.at)).toBeGreaterThan(0);
    const queued = await call("POST", "/api/agent-proposals/letters", letter, ANA.id);
    expect(queued.status).toBe(200);
    expect(queued.body.sent).toBe(false);
    const mine = await call("GET", "/api/agent-proposals/letters", undefined, ANA.id);
    expect(mine.body.letters).toHaveLength(1);
    expect((await call("GET", "/api/agent-proposals/letters", undefined, BEN.id)).body.letters).toEqual([]);
    await call("PUT", "/api/admin/ai-agents-approval", { approved: false, note: "paused" }, ADMIN.id);
    expect((await call("GET", "/api/agent-proposals/letters", undefined, ANA.id)).status).toBe(403);
  });

  it("the conversations list says so in words when the interview queue is not here, and carries no contact detail", async () => {
    await approve();
    const r = await call("GET", "/api/agent-proposals/conversations", undefined, BEN.id);
    if (r.status === 404) {
      expect(r.body.message).toMatch(/not open/);
    } else {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body.conversations)).not.toMatch(/email|phone|@|score/i);
    }
  });

  it("erasing the proposer or the member removes the rows", async () => {
    await call("POST", "/api/agent-proposals/seating", { roleId: role, memberId: CAL.id, from: "2026-12-01" }, ANA.id);
    expect((await q("SELECT COUNT(*) AS n FROM agent_proposals"))[0].n).toBe(1);
    await forgetAgentForMember(pool, CAL.id);
    expect((await q("SELECT COUNT(*) AS n FROM agent_proposals"))[0].n).toBe(0);
  });
});
