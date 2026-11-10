/**
 * The connector's tier B tools (role journey L13): propose only.
 *
 *   - every tool appears only under its own scope
 *   - every write asks first: the first call writes nothing, the second writes once
 *   - propose_seating never seats and refuses a seating for the token's own holder
 *   - the applicant-data tools stay closed while the village setting is off
 *   - tier C stays refused forever, even when someone adds those paths to the allow-list
 *   - no AI in selection: nothing in the table scores, ranks or summarises a candidate
 */
import { describe, expect, it } from "vitest";
import { handleMcpMessage, MCP_TOOLS, toolsFor, type RouteAnswer, type ToolContext } from "./agentMcp";
import { CONFIRM_REASON_SENTENCE, mintConfirmToken, verifyConfirmToken, type AgentScope } from "./agentTokens";
import { adminRequestDecision, parseAgentAdminPaths, alwaysAPerson, type AgentAdminPathsDoc } from "../../shared/agentAdmin";
import {
  EMPTY_AI_APPROVAL, TIER_C, TIER_C_PATHS, approvalProblem, cardCompleteness, parseAiApproval, parseLetter, parseRoleChange, parseSeating, projectChart,
} from "../../shared/agentProposals";

const SIGNER = "unit-test-signing-input";
const ME = "u-me";
const info = { name: "Example Village", version: "1.2.0" };

const rpc = (name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

/** A holder whose routes are recorded. `approved` is the village's setting for AI agents. */
function holder(opts: { approved?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const dispatch: ToolContext["dispatch"] = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path === "/api/org") {
      return {
        status: 200,
        body: {
          circles: [{ id: "c1", name: "Care" }],
          roles: [
            {
              id: "r1", name: "Gardener", circleId: "c1", aim: "Tend the beds", domain: "the beds", whyItMatters: "Food", accountabilities: ["a", "b", "c"], bringMe: "x", notMine: "y", timeCommitment: "4h",
              seats: 2, holderCount: 1, recruiting: true, listed: false,
              holders: [{ name: "Ana Reed", userId: "u-ana", email: "ana@example.test" }],
              pay: { valueMinor: 90000 }, termsOffer: { cash: 1 },
            },
            { id: "r2", name: "Cook", circleId: "c1", seats: 1, holderCount: 0, recruiting: false, holders: [] },
          ],
        },
      };
    }
    if (path.startsWith("/api/agent-proposals/letters")) {
      if (opts.approved === false) return { status: 403, body: { error: "ai_agents_not_approved", message: "off" } };
      return { status: 200, body: { letters: [], success: true, id: "prop_1" } };
    }
    if (path === "/api/agent-proposals/conversations") {
      if (opts.approved === false) return { status: 403, body: { error: "ai_agents_not_approved" } };
      return { status: 200, body: { conversations: [{ applicationRef: "ref-1", asRole: "Cook", position: 1, minutes: 20, final: false, state: "open", waitingSince: null, booked: false }] } };
    }
    if (method === "POST" && path.startsWith("/api/agent-proposals/")) return { status: 200, body: { success: true, id: "prop_1" } };
    if (method === "GET" && path === "/api/onboarding/me") return { status: 200, body: { paths: [{ id: "p1", items: [{ key: "intro", done: false }] }] } };
    if (method === "POST" && path === "/api/onboarding/paths/p1/items/intro/done") return { status: 200, body: { ok: true } };
    return { status: 404, body: { error: "Not found" } } as RouteAnswer;
  };
  const ctx: ToolContext = {
    dispatch,
    holderId: ME,
    mintConfirm: (tool, echo) => mintConfirmToken(SIGNER, { action: `mcp:${tool}`, userId: ME, echo }),
    verifyConfirm: (tool, token, echo) => {
      const c = verifyConfirmToken(SIGNER, token, { action: `mcp:${tool}`, userId: ME, echo });
      return c.ok ? { ok: true } : { ok: false, reason: c.reason, sentence: CONFIRM_REASON_SENTENCE[c.reason] };
    },
  };
  return { calls, ctx };
}

const ask = (message: unknown, scopes: AgentScope[], ctx: ToolContext) => handleMcpMessage(message, { scopes, info, ctx }) as Promise<any>;
const payload = (r: any) => JSON.parse(r.result.content[0].text);

const TIER_B: Array<{ tool: string; scope: AgentScope }> = [
  { tool: "get_roles", scope: "roles.read" },
  { tool: "propose_role_change", scope: "roles.propose" },
  { tool: "propose_seating", scope: "roles.propose" },
  { tool: "draft_letter", scope: "letters.draft" },
  { tool: "my_conversations", scope: "applicants.read" },
  { tool: "my_onboarding_path", scope: "onboarding.write" },
];

describe("every tier B tool appears only under its scope", () => {
  for (const { tool, scope } of TIER_B) {
    it(`${tool} is listed for ${scope} and for no other scope`, () => {
      expect(toolsFor([scope]).map((t) => t.name)).toContain(tool);
      const others = (["moon.read", "tasks.write", "moon.write", "moon.review", "admin", "sera.undoable", "roles.read", "roles.propose", "letters.draft", "applicants.read", "onboarding.write"] as AgentScope[]).filter((s) => s !== scope);
      for (const s of others) expect(toolsFor([s]).map((t) => t.name)).not.toContain(tool);
    });
    it(`${tool} is refused to a token without ${scope}, and calls no route`, async () => {
      const h = holder();
      const r = await ask(rpc(tool, {}), ["moon.read"], h.ctx);
      expect(r.error?.message).toContain(scope);
      expect(h.calls).toEqual([]);
    });
  }
});

describe("every write asks first", () => {
  const writes: Array<{ tool: string; scope: AgentScope; args: Record<string, unknown>; path: string }> = [
    { tool: "propose_role_change", scope: "roles.propose", args: { roleId: "r1", fields: { aim: "Tend the beds and the seed store" }, why: "The aim is too narrow" }, path: "/api/agent-proposals/role-change" },
    { tool: "propose_seating", scope: "roles.propose", args: { roleId: "r1", memberId: "u-ana", from: "2026-12-01", why: "She asked" }, path: "/api/agent-proposals/seating" },
    { tool: "draft_letter", scope: "letters.draft", args: { applicationRef: "ref-1", kind: "first_reply", subject: "Thank you", body: "Thank you for applying. We will be in touch soon about next steps." }, path: "/api/agent-proposals/letters" },
    { tool: "my_onboarding_path", scope: "onboarding.write", args: { pathId: "p1", itemKey: "intro" }, path: "/api/onboarding/paths/p1/items/intro/done" },
  ];
  for (const w of writes) {
    it(`${w.tool}: nothing is written without a confirm token, then exactly once on the matching confirm`, async () => {
      const h = holder();
      const first = payload(await ask(rpc(w.tool, w.args), [w.scope], h.ctx));
      expect(first.confirmRequired).toBe(true);
      expect(first.confirmToken).toBeTruthy();
      expect(h.calls.filter((c) => c.method !== "GET")).toEqual([]);
      const second = payload(await ask(rpc(w.tool, { ...w.args, confirmToken: first.confirmToken }), [w.scope], h.ctx));
      expect(second.written).toBe(true);
      const posts = h.calls.filter((c) => c.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe(w.path);
    });
    it(`${w.tool}: a token made for other arguments is refused and writes nothing`, async () => {
      const h = holder();
      const first = payload(await ask(rpc(w.tool, w.args), [w.scope], h.ctx));
      const other = { ...w.args, ...(w.tool === "propose_seating" ? { from: "2027-01-01" } : w.tool === "my_onboarding_path" ? { itemKey: "other" } : w.tool === "draft_letter" ? { subject: "Another" } : { why: "A different reason" }) };
      const r = await ask(rpc(w.tool, { ...other, confirmToken: first.confirmToken }), [w.scope], h.ctx);
      expect(r.result.isError).toBe(true);
      expect(h.calls.filter((c) => c.method === "POST")).toEqual([]);
    });
  }

  it("every tier B write tool is a write the rate bucket counts", () => {
    for (const name of ["propose_role_change", "propose_seating", "draft_letter"]) {
      const t = MCP_TOOLS.find((x) => x.name === name)!;
      expect(t.kind).toBe("write");
    }
  });
});

describe("propose_seating", () => {
  it("refuses a seating for the token's own holder and calls no route", async () => {
    const h = holder();
    const r = await ask(rpc("propose_seating", { roleId: "r1", memberId: ME, from: "2026-12-01" }), ["roles.propose"], h.ctx);
    expect(r.result.isError).toBe(true);
    expect(payload(r).error).toMatch(/never proposed into a role by their own agent/);
    expect(h.calls).toEqual([]);
  });

  it("refuses a self-seating even with a confirm token minted for it", async () => {
    const h = holder();
    const echo = { method: "POST", path: "/api/agent-proposals/seating", body: { roleId: "r1", memberId: ME, from: "2026-12-01", why: "" } };
    const { token } = h.ctx.mintConfirm("propose_seating", echo);
    const r = await ask(rpc("propose_seating", { roleId: "r1", memberId: ME, from: "2026-12-01", confirmToken: token }), ["roles.propose"], h.ctx);
    expect(r.result.isError).toBe(true);
    expect(h.calls).toEqual([]);
  });

  it("only ever calls its proposals route: never a seating, claim, draft publish or admin path", async () => {
    const h = holder();
    const args = { roleId: "r1", memberId: "u-ana", from: "2026-12-01" };
    const first = payload(await ask(rpc("propose_seating", args), ["roles.propose"], h.ctx));
    await ask(rpc("propose_seating", { ...args, confirmToken: first.confirmToken }), ["roles.propose"], h.ctx);
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/agent-proposals/seating"]);
  });

  it("asks for a real date", () => {
    expect(parseSeating({ roleId: "r", memberId: "m", from: "tomorrow" }, ME).ok).toBe(false);
    expect(parseSeating({ roleId: "r", memberId: "m", from: "2026-13-45" }, ME).ok).toBe(false);
    expect(parseSeating({ roleId: "r", memberId: "m", from: "2026-12-01" }, ME).ok).toBe(true);
  });
});

describe("tools 4 and 5 stay closed until the Anchor records its approval", () => {
  it("draft_letter writes nothing, not even an echo, while the setting is off", async () => {
    const h = holder({ approved: false });
    const args = { applicationRef: "ref-1", kind: "decision", subject: "Your application", body: "Thank you for the time you gave us in the conversations." };
    const r = await ask(rpc("draft_letter", args), ["letters.draft"], h.ctx);
    expect(r.result.isError).toBe(true);
    expect(payload(r).detail.code).toBe("ai_agents_not_approved");
    expect(h.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("my_conversations answers in words while the setting is off, and lists the waiting applicants when it is on", async () => {
    const off = holder({ approved: false });
    const closed = await ask(rpc("my_conversations", {}), ["applicants.read"], off.ctx);
    expect(closed.result.isError).toBe(true);
    expect(payload(closed).error).toMatch(/Anchor records its approval/);
    const on = holder({ approved: true });
    const open = payload(await ask(rpc("my_conversations", {}), ["applicants.read"], on.ctx));
    expect(open.conversations).toHaveLength(1);
  });

  it("the setting starts off, and an approval needs who and when", () => {
    expect(parseAiApproval(undefined)).toEqual(EMPTY_AI_APPROVAL);
    expect(parseAiApproval({ approved: true }).approved).toBe(false);
    expect(parseAiApproval({ approved: true, by: { userId: "u1", name: "Fern" } }).approved).toBe(false);
    const ok = parseAiApproval({ approved: true, by: { userId: "u1", name: "Fern" }, at: "2026-11-10T10:00:00.000Z", note: "Anchor thread 10 Nov" });
    expect(ok.approved).toBe(true);
    expect(ok.by?.userId).toBe("u1");
    expect(approvalProblem({ approved: true })).toMatch(/where the Anchor decided/);
    expect(approvalProblem({ approved: true, note: "Anchor thread 10 Nov" })).toBeNull();
    expect(approvalProblem({ approved: false })).toBeNull();
  });
});

describe("tier C stays refused forever", () => {
  /** An allow-list that names a path, with the ids as :id holes. */
  const listing = (method: string, path: string): AgentAdminPathsDoc => ({
    paths: [{ method: method as any, path: path.replace(/\/[a-z]\d(?=\/|$)/g, "/:id"), confirm: "agent", label: "Someone added this" }],
  });

  it("names every tier C act", () => {
    for (const act of TIER_C) expect(TIER_C_PATHS.some((p) => p.act === act)).toBe(true);
  });

  for (const p of TIER_C_PATHS) {
    it(`${p.act}: ${p.method} ${p.path} is refused even when it is on the allow-list`, () => {
      expect(alwaysAPerson(p.method, p.path)).not.toBeNull();
      const doc = listing(p.method, p.path);
      const d = adminRequestDecision(p.method, p.path, doc);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe("always_a_person");
    });
    it(`${p.act}: ${p.method} ${p.path} cannot be saved on the allow-list`, () => {
      const saved = parseAgentAdminPaths(listing(p.method, p.path));
      expect(saved.ok).toBe(false);
    });
  }

  it("the approval setting and the proposals routes are not reachable through admin_request", () => {
    for (const path of ["/api/admin/ai-agents-approval", "/api/agent-proposals/seating", "/api/agent-proposals/p1/resolve"]) {
      const d = adminRequestDecision("PUT", path, { paths: [{ method: "PUT", path: path.replace("/p1/", "/:id/"), confirm: "agent", label: "x" }] });
      expect(d.ok).toBe(false);
    }
  });

  it("no tier B tool names a tier C route", () => {
    for (const t of TIER_B.map((x) => MCP_TOOLS.find((m) => m.name === x.tool)!)) {
      for (const r of t.routes) {
        const [method, path] = r.split(" ");
        // The proposals routes are the connector's own, so they are the one prefix the person list names for the admin tool.
        if (path.startsWith("/api/agent-proposals")) continue;
        expect(alwaysAPerson(method, path.replace(/:[a-z]+/g, "x"))).toBeNull();
      }
    }
  });
});

describe("no AI in selection", () => {
  it("no tier B tool or description offers to score, rank or summarise a candidate", () => {
    for (const { tool } of TIER_B) {
      const t = MCP_TOOLS.find((m) => m.name === tool)!;
      const props = Object.keys((t.inputSchema as any).properties ?? {});
      for (const bad of ["score", "scores", "rank", "ranking", "summary", "rating", "verdict"]) expect(props).not.toContain(bad);
    }
  });

  it("my_conversations carries no contact detail through the redaction", async () => {
    const h = holder({ approved: true });
    const text = JSON.stringify(payload(await ask(rpc("my_conversations", {}), ["applicants.read"], h.ctx)));
    expect(text).not.toMatch(/email|phone|@|timezone|score/i);
  });
});

describe("get_roles", () => {
  it("answers public facts only: first names, listing, open places and card completeness", async () => {
    const h = holder();
    const out = payload(await ask(rpc("get_roles", {}), ["roles.read"], h.ctx));
    const gardener = out.roles.find((r: any) => r.id === "r1");
    expect(gardener).toMatchObject({ listed: false, openPlaces: 1, holders: ["Ana"], recruiting: true });
    expect(gardener.card).toMatchObject({ filled: 7, of: 7, missing: [] });
    const cook = out.roles.find((r: any) => r.id === "r2");
    expect(cook.listed).toBe(true);
    expect(cook.card.missing).toContain("aim");
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/u-ana|ana@example|valueMinor|90000|termsOffer|pay/);
  });

  it("counts an accountability list of fewer than three as missing", () => {
    expect(cardCompleteness({ accountabilities: ["a", "b"] }).missing).toContain("accountabilities");
    expect(projectChart(null)).toEqual({ roles: [], circles: [] });
  });
});

describe("propose_role_change", () => {
  it("carries card words and parameters, and refuses anything else, pay included", () => {
    expect(parseRoleChange({ roleId: "r1", fields: { aim: "x" }, why: "A clear reason" }).ok).toBe(true);
    for (const k of ["valueMinor", "cashMinor", "termsOffer", "circleId", "name"]) {
      const r = parseRoleChange({ roleId: "r1", fields: { [k]: 1 }, why: "A clear reason" });
      expect(r.ok).toBe(false);
    }
    expect(parseRoleChange({ roleId: "r1", why: "A clear reason" }).ok).toBe(false);
    expect(parseRoleChange({ roleId: "r1", listing: "list", why: "A clear reason" }).ok).toBe(true);
    expect(parseRoleChange({ roleId: "r1", listing: "publish", why: "A clear reason" }).ok).toBe(false);
  });

  it("calls only its own proposals route", async () => {
    const h = holder();
    const args = { roleId: "r1", fields: { aim: "A wider aim" }, listing: "list", payGroup: "Group B", why: "The card is ready" };
    const first = payload(await ask(rpc("propose_role_change", args), ["roles.propose"], h.ctx));
    await ask(rpc("propose_role_change", { ...args, confirmToken: first.confirmToken }), ["roles.propose"], h.ctx);
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/agent-proposals/role-change"]);
  });
});

describe("draft_letter", () => {
  it("needs a subject and a real letter", () => {
    expect(parseLetter({ applicationRef: "r", kind: "first_reply", subject: "", body: "short" }).ok).toBe(false);
    expect(parseLetter({ applicationRef: "r", kind: "reject", subject: "s", body: "x".repeat(40) }).ok).toBe(false);
    expect(parseLetter({ applicationRef: "r", kind: "decision", subject: "s", body: "x".repeat(40) }).ok).toBe(true);
  });
});

describe("admin_request reads of applicant data wait on the Anchor's switch", () => {
  const doc: AgentAdminPathsDoc = {
    paths: [
      { method: "GET", path: "/api/admin/open-proposals", confirm: "agent", label: "Open proposals" },
      { method: "GET", path: "/api/admin/org/drafts", confirm: "agent", label: "Org drafts" },
    ],
  };
  function admin(open: boolean) {
    const h = holder();
    const ctx: ToolContext = {
      ...h.ctx,
      adminPaths: async () => doc,
      applicantDataOpen: async () => open,
      recordAction: async () => undefined,
      dispatch: async (method, path, body) => {
        h.calls.push({ method, path, body });
        return { status: 200, body: { ok: true } };
      },
    };
    return { calls: h.calls, ctx };
  }

  it("refuses the GET while the switch is off, calling no route", async () => {
    const a = admin(false);
    const r = await ask(rpc("admin_request", { method: "GET", path: "/api/admin/open-proposals" }), ["admin"], a.ctx);
    expect(r.result.isError).toBe(true);
    expect(payload(r).detail.code).toBe("always_a_person");
    expect(a.calls).toEqual([]);
  });

  it("answers the same GET after the switch, and an org draft GET either way", async () => {
    const on = admin(true);
    const r = await ask(rpc("admin_request", { method: "GET", path: "/api/admin/open-proposals" }), ["admin"], on.ctx);
    expect(r.result.isError).toBe(false);
    expect(on.calls.map((c) => c.path)).toEqual(["/api/admin/open-proposals"]);
    const off = admin(false);
    const d = await ask(rpc("admin_request", { method: "GET", path: "/api/admin/org/drafts" }), ["admin"], off.ctx);
    expect(d.result.isError).toBe(false);
  });
});

describe("the approval inbox tools (part A)", () => {
  const INBOX: Array<{ tool: string; scope: AgentScope; args: Record<string, unknown>; path: string }> = [
    { tool: "propose_setting", scope: "settings.propose", args: { target: "variable", key: "org.start_after_open", value: "14" }, path: "/api/agent-proposals/setting" },
    { tool: "propose_listing", scope: "listing.propose", args: { only: ["r1"] }, path: "/api/agent-proposals/listing" },
    { tool: "propose_page_copy", scope: "pages.propose", args: { section: "home", content: { headline: "Welcome back" } }, path: "/api/agent-proposals/page-copy" },
    { tool: "propose_map_publish", scope: "map.propose", args: { note: "Added the orchard" }, path: "/api/agent-proposals/map-publish" },
  ];
  const ALL_SCOPES: AgentScope[] = ["moon.read", "tasks.write", "moon.write", "moon.review", "admin", "sera.undoable", "roles.read", "roles.propose", "letters.draft", "applicants.read", "onboarding.write", "settings.propose", "listing.propose", "pages.propose", "map.propose"];

  for (const w of INBOX) {
    it(`${w.tool} is listed only under ${w.scope}`, () => {
      expect(toolsFor([w.scope]).map((t) => t.name)).toEqual([w.tool]);
      for (const s of ALL_SCOPES.filter((x) => x !== w.scope)) expect(toolsFor([s]).map((t) => t.name)).not.toContain(w.tool);
    });
    it(`${w.tool} asks first, then files once through the proposals route and no other`, async () => {
      const h = holder();
      const first = payload(await ask(rpc(w.tool, w.args), [w.scope], h.ctx));
      expect(first.confirmRequired).toBe(true);
      expect(h.calls).toEqual([]);
      const second = payload(await ask(rpc(w.tool, { ...w.args, confirmToken: first.confirmToken }), [w.scope], h.ctx));
      expect(second.written).toBe(true);
      expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${w.path}`]);
    });
  }

  it("refuses money, secrets, erasure, invites and power at the tool, before any token or route", async () => {
    const bad: Array<[string, AgentScope, Record<string, unknown>]> = [
      ["propose_setting", "settings.propose", { target: "variable", key: "payments.purchase_limit", value: "9" }],
      ["propose_setting", "settings.propose", { target: "variable", key: "integration.api_key", value: "x" }],
      ["propose_setting", "settings.propose", { target: "variable", key: "membership.invite_only", value: "false" }],
      ["propose_setting", "settings.propose", { target: "module", id: "member-erasure", lifecycle: "public" }],
      ["propose_setting", "settings.propose", { target: "variable", key: "governance.steward_veto", value: "on" }],
      ["propose_page_copy", "pages.propose", { section: "treasury", content: { a: 1 } }],
    ];
    for (const [tool, scope, args] of bad) {
      const h = holder();
      const r = await ask(rpc(tool, args), [scope], h.ctx);
      expect(r.result.isError, JSON.stringify(args)).toBe(true);
      expect(payload(r).detail.code).toBe("never_proposable");
      expect(payload(r).confirmToken).toBeUndefined();
      expect(h.calls).toEqual([]);
    }
  });

  it("holds no tool that decides: the approval routes are not named by any tool, and admin_request cannot reach them", () => {
    for (const t of MCP_TOOLS) for (const r of t.routes) expect(r).not.toMatch(/approval-inbox/);
    for (const m of ["GET", "POST", "PUT"]) {
      for (const p of ["/api/approval-inbox", "/api/approval-inbox/prop_1/approve", "/api/approval-inbox/approve-batch"]) {
        const doc: AgentAdminPathsDoc = { paths: [{ method: m as any, path: p.replace("prop_1", ":id"), confirm: "agent", label: "x" }] };
        expect(adminRequestDecision(m, p, doc, "agent-1", { applicantDataOpen: true }), `${m} ${p}`).toMatchObject({ ok: false, code: "always_a_person" });
      }
    }
  });
});
