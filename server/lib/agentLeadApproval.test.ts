/**
 * The lead-approved writes through the connector's `admin_request` (the lead's ruling of 10 and 11 Nov 2026).
 *
 *   tool      with the opt-in off a seating is refused before any route; on, it asks first, then seats once,
 *             with the approval taken out of the body the route sees, and leaves one record and one notice
 *   approval  a seating without approvedBy or approvalNote calls no route
 *   facts     a veto seat read from the real tables refuses, a plain seat passes (database)
 *   record    the audit event is stored, admin-audience, naming the approver and quoting the approval (database)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { handleMcpMessage, type RouteAnswer, type ToolContext } from "./agentMcp";
import { CONFIRM_REASON_SENTENCE, mintConfirmToken, verifyConfirmToken } from "./agentTokens";
import { readLeadSeatFacts, recordLeadApproval } from "./agentLeadApproval";
import { leadApprovedBodyProblem, type AgentAdminPathsDoc, type LeadSeatFacts } from "../../shared/agentAdmin";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";

const SECRET = "lead-approved-test-secret";
const info = { name: "Example Village", version: "1.2.0" };
const call = (args: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "admin_request", arguments: args } });
const ask = (message: unknown, ctx: ToolContext) => handleMcpMessage(message, { scopes: ["admin"], info, ctx }) as Promise<any>;

const LIST: AgentAdminPathsDoc = {
  paths: [
    { method: "POST", path: "/api/admin/org/roles/:id/holders", confirm: "agent", label: "Seat a person" },
    { method: "DELETE", path: "/api/admin/org/seatings/:id", confirm: "agent", label: "End a seating" },
  ],
};

function agent(opts: { on: boolean; seat?: Partial<LeadSeatFacts> }) {
  const routes: Array<{ method: string; path: string; body?: unknown }> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const ctx: ToolContext = {
    holderId: "agent-1",
    dispatch: async (method, path, body) => {
      routes.push({ method, path, body });
      return { status: 200, body: { success: true } } as RouteAnswer;
    },
    mintConfirm: (tool, echo) => mintConfirmToken(SECRET, { action: `mcp:${tool}`, userId: "agent-1", echo }),
    verifyConfirm: (tool, token, echo) => {
      const c = verifyConfirmToken(SECRET, token, { action: `mcp:${tool}`, userId: "agent-1", echo });
      return c.ok ? { ok: true } : { ok: false, reason: c.reason, sentence: CONFIRM_REASON_SENTENCE[c.reason] };
    },
    adminPaths: async () => LIST,
    recordAction: async () => {},
    leadApproved: {
      on: async () => opts.on,
      seat: async () => ({ found: true, roleId: "r-gardener", isExample: false, capabilities: ["quest.consent"], grantsAdmin: false, seatingUserId: "u-ana", ...opts.seat }),
      recorded: async (a) => {
        recorded.push(a);
      },
    },
  };
  return { ctx, routes, recorded };
}

const SEAT = { method: "POST", path: "/api/admin/org/roles/r-gardener/holders", body: { userId: "u-ana", approvedBy: "The lead", approvalNote: "Yes, seat Ana as Gardener from today." } };

describe("admin_request under the lead-approved writes", () => {
  it("with the opt-in off, refuses a seating as always a person and calls no route", async () => {
    const a = agent({ on: false });
    const r = await ask(call(SEAT), a.ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.detail.code).toBe("always_a_person");
    expect(a.routes).toEqual([]);
  });

  it("with it on, asks first, then seats once with the approval out of the route's body, and records it once", async () => {
    const a = agent({ on: true });
    const first = await ask(call(SEAT), a.ctx);
    expect(first.result.structuredContent.confirmRequired).toBe(true);
    expect(a.routes).toEqual([]);
    const token = first.result.structuredContent.confirmToken;
    const second = await ask(call({ ...SEAT, confirmToken: token }), a.ctx);
    expect(second.result.structuredContent.written).toBe(true);
    expect(a.routes).toEqual([{ method: "POST", path: SEAT.path, body: { userId: "u-ana" } }]);
    expect(a.recorded).toHaveLength(1);
    expect(a.recorded[0]).toMatchObject({ kind: "seat", roleId: "r-gardener", approvedBy: "The lead", approvalNote: "Yes, seat Ana as Gardener from today." });
    expect(String(a.recorded[0].writeKey)).toMatch(/^[0-9a-f]{24}$/);
  });

  it("refuses a seating with no approval, calling no route and recording nothing", async () => {
    const a = agent({ on: true });
    const r = await ask(call({ ...SEAT, body: { userId: "u-ana" } }), a.ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.detail.code).toBe("lead_approved_refused");
    expect(a.routes).toEqual([]);
    expect(a.recorded).toEqual([]);
  });

  it("refuses the veto seat at the confirm too, when the seat gained the veto between the two calls", async () => {
    const plain = agent({ on: true });
    const first = await ask(call(SEAT), plain.ctx);
    const vetoed = agent({ on: true, seat: { capabilities: ["steward.veto"] } });
    const second = await ask(call({ ...SEAT, confirmToken: first.result.structuredContent.confirmToken }), vetoed.ctx);
    expect(second.result.isError).toBe(true);
    expect(vetoed.routes).toEqual([]);
  });

  it("unseats with the approval and records it", async () => {
    const a = agent({ on: true });
    const args = { method: "DELETE", path: "/api/admin/org/seatings/s-1", body: { approvedBy: "The lead", approvalNote: "Yes, end that seating.", reason: "handover" } };
    const first = await ask(call(args), a.ctx);
    await ask(call({ ...args, confirmToken: first.result.structuredContent.confirmToken }), a.ctx);
    expect(a.routes).toEqual([{ method: "DELETE", path: args.path, body: { reason: "handover" } }]);
    expect(a.recorded).toHaveLength(1);
    expect(a.recorded[0]).toMatchObject({ kind: "unseat", roleId: "r-gardener" });
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the seat's facts and the record, on the real tables", () => {
  let db: TestDb;
  let pool: Pool;
  const groups = [
    { id: "g-steward", capabilities: ["steward.veto", "ballot.vote"], grantsAdmin: false },
    { id: "g-tend", capabilities: ["quest.consent"], grantsAdmin: false },
    { id: "g-panel", capabilities: [], grantsAdmin: true },
  ];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const id of ["r-steward", "r-tend", "r-panel"]) {
      await pool.query("INSERT INTO org_roles (id, name, seats) VALUES (?, ?, 1)", [id, id]); // module-review-ok: a fixture on the scratch schema this suite provisioned
    }
    for (const [seat, group] of [["r-steward", "g-steward"], ["r-tend", "g-tend"], ["r-panel", "g-panel"]]) {
      await pool.query("INSERT INTO org_role_power_groups (org_role_id, role_id) VALUES (?, ?)", [seat, group]); // module-review-ok: a fixture on the scratch schema this suite provisioned
    }
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) VALUES ('s-steward', 'r-steward', 'member', 'u-ana', 'u-ana'), ('s-tend', 'r-tend', 'member', 'u-ana', 'u-ana')",
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads the veto off the steward seat, by role and by seating, and refuses both", async () => {
    const approval = { approvedBy: "The lead", approvalNote: "Yes." + " Seat her." };
    const byRole = await readLeadSeatFacts(pool, () => groups, { roleId: "r-steward" });
    expect(byRole.capabilities).toContain("steward.veto");
    expect(leadApprovedBodyProblem("seat", "/api/admin/org/roles/r-steward/holders", { userId: "u-bo", ...approval }, { holderId: "agent-1", seat: byRole })).toContain("badge may never carry");
    const bySeating = await readLeadSeatFacts(pool, () => groups, { seatingId: "s-steward" });
    expect(bySeating).toMatchObject({ found: true, roleId: "r-steward", seatingUserId: "u-ana", seatingIsAgent: false });
    expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-steward", approval, { holderId: "agent-1", seat: bySeating })).toContain("badge may never carry");
    const panel = await readLeadSeatFacts(pool, () => groups, { roleId: "r-panel" });
    expect(panel.grantsAdmin).toBe(true);
    const tend = await readLeadSeatFacts(pool, () => groups, { seatingId: "s-tend" });
    expect(leadApprovedBodyProblem("unseat", "/api/admin/org/seatings/s-tend", approval, { holderId: "agent-1", seat: tend })).toBeNull();
    expect((await readLeadSeatFacts(pool, () => groups, { seatingId: "s-none" })).found).toBe(false);
    // A link to a group nobody can read counts as the most it could carry.
    expect((await readLeadSeatFacts(pool, () => [], { roleId: "r-tend" })).grantsAdmin).toBe(true);
  });

  it("stores the audit event and rings every admin once, on one stable key", async () => {
    const rung: Array<{ type: string; key: string }> = [];
    const deps = { pool, agentUserId: "agent-1", tokenPrefix: "vat_ab12", notifyAdmins: async (type: string, _t: string, key: string) => void rung.push({ type, key }) };
    const rec = { kind: "seat" as const, roleId: "r-tend", path: "/api/admin/org/roles/r-tend/holders", approvedBy: "The lead", approvalNote: "Yes, seat Bo as tender.", writeKey: "0123456789abcdef01234567" };
    await recordLeadApproval(deps, rec);
    const [rows] = await pool.query<any[]>("SELECT kind, text, actor_user_id, actor_kind, entity_ref, audience FROM health_events WHERE entity_ref = 'r-tend'"); // module-review-ok: reading the scratch schema this suite provisioned
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "audit", actor_user_id: "agent-1", actor_kind: "agent", audience: "admin" });
    expect(rows[0].text).toContain("approval from The lead");
    expect(rows[0].text).toContain("Yes, seat Bo as tender.");
    expect(rung).toEqual([{ type: "governance", key: "agent-lead-seat:0123456789abcdef01234567" }]);
  });
});
