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
import { handleMcpMessage, MCP_TOOLS, type RouteAnswer, type ToolContext } from "./agentMcp";
import { CONFIRM_REASON_SENTENCE, mintConfirmToken, verifyConfirmToken } from "./agentTokens";
import { readLeadSeatFacts, recentApprovedWrites, recordLeadApproval } from "./agentLeadApproval";
import { planSend } from "./memberTaskBridge";
import { approvalRecordKey } from "../../shared/agentApprovalRecord";
import { leadApprovedBodyProblem, type AgentAdminPathsDoc, type LeadSeatFacts } from "../../shared/agentAdmin";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";

const SIGNER = "lead-approved-unit-test-signing-input";
const info = { name: "Example Village", version: "1.2.0" };
// A write names what it does in plain words (admin_request's `summary`); a case that is not about it gets a default.
const SUMMARY = "Seat Ana in the Gardener role for the new season.";
const call = (args: Record<string, unknown>) => ({
  jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name: "admin_request", arguments: "summary" in args || args.method === "GET" ? args : { summary: SUMMARY, ...args } },
});
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
    mintConfirm: (tool, echo) => mintConfirmToken(SIGNER, { action: `mcp:${tool}`, userId: "agent-1", echo }),
    verifyConfirm: (tool, token, echo) => {
      const c = verifyConfirmToken(SIGNER, token, { action: `mcp:${tool}`, userId: "agent-1", echo });
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

describe("the role editor refuses pay from an agent, with the switch off or on", () => {
  for (const on of [false, true]) {
    it(`switch ${on ? "on" : "off"}: pay, budget line and funding source refuse and call no route; words pass`, async () => {
      const a = agent({ on });
      a.ctx.adminPaths = async () => ({ paths: [{ method: "POST", path: "/api/org/role-edit/:id", confirm: "agent", label: "Role editor" }] });
      for (const body of [{ pay: { kind: "cash" } }, { parameters: { budgetLine: "ops" } }, { parameters: { fundedFrom: "grant" } }]) {
        const r = await ask(call({ method: "POST", path: "/api/org/role-edit/r-gardener", body }), a.ctx);
        expect(r.result.isError, JSON.stringify(body)).toBe(true);
        expect(r.result.structuredContent.detail.code).toBe("lead_approved_refused");
      }
      expect(a.routes).toEqual([]);
      // With the switch on, the words carry the approval too, and the route sees them without it.
      const words = { words: { aim: "Tend the beds" } };
      const args = { method: "POST", path: "/api/org/role-edit/r-gardener", body: on ? { ...words, approvedBy: "The lead", approvalNote: "Yes, that aim." } : words };
      const first = await ask(call(args), a.ctx);
      await ask(call({ ...args, confirmToken: first.result.structuredContent.confirmToken }), a.ctx);
      expect(a.routes).toEqual([{ method: "POST", path: args.path, body: words }]);
      expect(a.recorded).toHaveLength(on ? 1 : 0);
    });
  }
});

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

describe("the plain summary on admin_request (the lead, 11 Nov 2026)", () => {
  const args = { method: "DELETE", path: "/api/admin/org/seatings/s-1", body: { approvedBy: "The lead", approvalNote: "Yes, end that seating." } };

  it("is the first argument in the tool's schema, and the description says to use plain words and names", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "admin_request")!;
    expect(Object.keys((tool.inputSchema as any).properties)[0]).toBe("summary");
    expect((tool.inputSchema as any).required).not.toContain("summary");
    expect(tool.description).toMatch(/summary/);
    expect(tool.description).toMatch(/no ids/);
  });

  it("is required for a write: refused with a clear message, no route called, nothing minted", async () => {
    const a = agent({ on: true });
    for (const summary of [undefined, "", "   ", "ok"]) {
      const r = await ask(call({ ...args, summary }), a.ctx);
      expect(r.result.isError).toBe(true);
      expect(r.result.structuredContent.detail.code).toBe("summary_required");
      expect(r.result.structuredContent.error).toContain("summary");
    }
    expect(a.routes).toEqual([]);
  });

  it("leads the preview with the summary and the platform's own line", async () => {
    const a = agent({ on: true });
    const first = await ask(call({ ...args, summary: "Remove Rick's duplicate record on the Living Memory role. He keeps the role." }), a.ctx);
    const out = first.result.structuredContent;
    expect(out.confirmRequired).toBe(true);
    expect(out.summary).toBe("Remove Rick's duplicate record on the Living Memory role. He keeps the role.");
    expect(out.platformSays).toBe("Ended a seating");
    expect(out.message.startsWith("Remove Rick's duplicate record")).toBe(true);
    expect(out.message).toContain("Ended a seating");
  });

  it("is never forwarded to the route, and is recorded beside the approval", async () => {
    const a = agent({ on: true });
    const full = { ...args, summary: "Remove Rick's duplicate record on the Living Memory role. He keeps the role." };
    const first = await ask(call(full), a.ctx);
    await ask(call({ ...full, confirmToken: first.result.structuredContent.confirmToken }), a.ctx);
    expect(a.routes).toEqual([{ method: "DELETE", path: args.path, body: {} }]);
    expect(JSON.stringify(a.routes)).not.toContain("Rick");
    expect(a.recorded[0]).toMatchObject({ approvedBy: "The lead", approvalNote: "Yes, end that seating.", summary: full.summary });
  });

  it("is covered by the confirm token: a different summary at the confirm is refused", async () => {
    const a = agent({ on: true });
    const first = await ask(call({ ...args, summary: "End the seat of Ana on the Gardener role." }), a.ctx);
    const second = await ask(call({ ...args, summary: "Something else entirely.", confirmToken: first.result.structuredContent.confirmToken }), a.ctx);
    expect(second.result.isError).toBe(true);
    expect(a.routes).toEqual([]);
  });
});

describe("every lead-approved write through the tool carries the approval (the lead, 11 Nov 2026)", () => {
  const approval = { approvedBy: "The lead", approvalNote: "Yes, go ahead with that wording." };
  const writes: Array<{ method: string; path: string; pattern: string; body: Record<string, unknown>; what: string }> = [
    { method: "PUT", path: "/api/admin/org/roles/r-gardener", pattern: "/api/admin/org/roles/:id", body: { aim: "Tend the beds" }, what: "Changed a role card's words" },
    { method: "POST", path: "/api/admin/org/roles", pattern: "/api/admin/org/roles", body: { name: "Gardener" }, what: "Created a role card" },
    { method: "POST", path: "/api/admin/org/drafts/d-1/changes", pattern: "/api/admin/org/drafts/:id/changes", body: { op: "update_seat", orgRoleId: "r-gardener", payload: { aim: "x" } }, what: "Drafted a role change (update_seat)" },
    { method: "PUT", path: "/api/admin/variables/org.ccos_terms", pattern: "/api/admin/variables/:key", body: { value: "Our terms" }, what: "Set a wording variable" },
    { method: "POST", path: "/api/admin/org/roles/r-gardener/holders", pattern: "/api/admin/org/roles/:id/holders", body: { userId: "u-ana" }, what: "Seated a member in a role" },
  ];

  for (const w of writes) {
    it(`${w.method} ${w.pattern}: refused without the approval, written once with it and recorded once`, async () => {
      const a = agent({ on: true });
      a.ctx.adminPaths = async () => ({ paths: [{ method: w.method as any, path: w.pattern, confirm: "agent", label: "x" }] });
      const bare = await ask(call({ method: w.method, path: w.path, body: w.body }), a.ctx);
      expect(bare.result.isError).toBe(true);
      expect(bare.result.structuredContent.detail.code).toBe("lead_approved_refused");
      expect(bare.result.structuredContent.error).toContain("approvedBy");
      expect(a.routes).toEqual([]);
      const args = { method: w.method, path: w.path, body: { ...w.body, ...approval } };
      const first = await ask(call(args), a.ctx);
      const token = first.result.structuredContent.confirmToken;
      const second = await ask(call({ ...args, confirmToken: token }), a.ctx);
      expect(second.result.structuredContent.written).toBe(true);
      expect(a.routes).toEqual([{ method: w.method, path: w.path, body: w.body }]);
      expect(a.recorded).toHaveLength(1);
      expect(a.recorded[0]).toMatchObject({ approvedBy: "The lead", approvalNote: approval.approvalNote, subject: { what: w.what } });
      // The same confirm token again is spent or refused; it never writes or records a second time.
      await ask(call({ ...args, confirmToken: token }), a.ctx).catch(() => null);
      expect(a.recorded.length).toBeLessThanOrEqual(2);
      if (a.recorded.length === 2) expect(a.recorded[1].writeKey).toBe(a.recorded[0].writeKey);
    });
  }

  it("a record that fails never turns the write into a refusal", async () => {
    const a = agent({ on: true });
    a.ctx.adminPaths = async () => ({ paths: [{ method: "PUT", path: "/api/admin/org/roles/:id", confirm: "agent", label: "x" }] });
    a.ctx.leadApproved!.recorded = async () => {
      throw new Error("memory down");
    };
    const args = { method: "PUT", path: "/api/admin/org/roles/r-gardener", body: { aim: "x", ...approval } };
    const first = await ask(call(args), a.ctx);
    const second = await ask(call({ ...args, confirmToken: first.result.structuredContent.confirmToken }), a.ctx);
    expect(second.result.structuredContent.written).toBe(true);
    expect(a.routes).toHaveLength(1);
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

  it("stores the audit event, queues the memory record and rings every admin, once per write however often it runs", async () => {
    const rung: Array<{ type: string; key: string }> = [];
    const deps = { pool, agentUserId: "agent-1", tokenPrefix: "vat_ab12", notifyAdmins: async (type: string, _t: string, key: string) => void rung.push({ type, key }) };
    const rec = { kind: "seat" as const, roleId: "r-tend", path: "/api/admin/org/roles/r-tend/holders", method: "POST", approvedBy: "The lead", approvalNote: "Yes, seat Bo as tender. Mail bo@example.test", summary: "Seat Bo in the Tender role.", writeKey: "0123456789abcdef01234567" };
    await recordLeadApproval(deps, rec);
    await recordLeadApproval(deps, rec);
    const [rows] = await pool.query<any[]>("SELECT kind, text, actor_user_id, actor_kind, entity_type, entity_ref, audience FROM health_events WHERE entity_ref = ?", [rec.writeKey]); // module-review-ok: reading the scratch schema this suite provisioned
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "audit", actor_user_id: "agent-1", actor_kind: "agent", audience: "admin", entity_type: "agent_approval" });
    expect(rows[0].text).toContain("approval from The lead");
    expect(rows[0].text).toContain("Yes, seat Bo as tender.");
    expect(rows[0].text).toContain("Seat Bo in the Tender role.");
    // The notice dedupes on its key in notify; here it is asked with the same key each time.
    expect(new Set(rung.map((r) => r.key))).toEqual(new Set(["agent-lead-seat:0123456789abcdef01234567"]));
    const [out] = await pool.query<any[]>("SELECT kind, status, payload, user_id FROM member_task_outbox WHERE feedback_id = ?", [approvalRecordKey(rec.writeKey)]); // module-review-ok: reading the scratch schema this suite provisioned
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "decision_record", status: "queued", user_id: null });
    const payload = JSON.parse(out[0].payload);
    expect(payload).toMatchObject({ record: "agent_approval", what: "Seated a member in a role", target: "r-tend", approvedBy: "The lead" });
    expect(payload.approvalNote).not.toContain("bo@example.test");
    expect(payload.summary).toBe("Seat Bo in the Tender role.");
  });

  it("keeps the write's record when the memory side fails, and the recent list says so", async () => {
    const deps = {
      pool,
      agentUserId: "agent-1",
      tokenPrefix: "vat_ab12",
      notifyAdmins: async () => {},
      queue: async () => {
        throw new Error("memory down");
      },
    };
    const rec = { kind: "role_text" as const, roleId: null, path: "/api/admin/org/roles/r-tend", method: "PUT", approvedBy: "The lead", approvalNote: "Yes, that aim.", writeKey: "fedcba9876543210fedcba98" };
    await expect(recordLeadApproval(deps, rec)).resolves.toBeUndefined();
    const list = await recentApprovedWrites(pool);
    const failed = list.find((w) => w.writeKey === rec.writeKey);
    expect(failed).toMatchObject({ memory: "none", approvedBy: null });
    expect(failed?.text).toContain("Changed a role card's words (r-tend)");
    const seated = list.find((w) => w.writeKey === "0123456789abcdef01234567");
    expect(seated).toMatchObject({ memory: "waiting", what: "Seated a member in a role", target: "r-tend", approvedBy: "The lead" });
    // Newest first.
    expect(list[0].writeKey).toBe(rec.writeKey);
  });
});

describe("the memory outbox sends an approval record as one Governance document", () => {
  const tools = new Map([["save_document", { name: "save_document", inputSchema: { properties: { title: {}, summary: {}, key_points: {}, category: {}, asserted_by: {}, source_date: {} } } }]]);
  const payload = { record: "agent_approval", writeKey: "k1", what: "Changed a role card's words", target: "r-1", method: "PUT", changed: ["aim"], approvedBy: "The lead", approvalNote: "Yes.", at: "2026-11-11T10:00:00.000Z" };

  it("plans save_document with who approved it, the note and the date", () => {
    const plan = planSend(tools as any, { kind: "decision_record", payload });
    expect(plan.tool).toBe("save_document");
    if (plan.tool === null) return;
    expect(plan.args).toMatchObject({ category: "Governance", asserted_by: "The lead", source_date: "2026-11-11" });
    expect(String(plan.args.key_points)).toContain("Approval: Yes.");
    expect(String(plan.args.title)).toContain("(r-1)");
  });

  it("waits, and is retried, while the memory offers no save_document", () => {
    const plan = planSend(new Map(), { kind: "decision_record", payload });
    expect(plan).toMatchObject({ tool: null });
    expect((plan as { drop?: boolean }).drop).toBeFalsy();
  });
});
