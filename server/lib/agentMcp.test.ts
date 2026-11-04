/**
 * The connector's protocol and tool table, against a fake holder's routes
 * (addendum v6, B4). What each case pins:
 *
 *   check 31  a moon.read token lists no write tool, and a write tool is
 *             refused to a token without its scope
 *   check 31  a write answers the echo first and writes only on the
 *             matching confirm; a replay after its own write is refused
 *   check 32  no tool names a route that sends, approves, issues, pays or
 *             touches a pay route, and no result carries a redacted key
 *   protocol  initialize names the village, notifications take no answer,
 *             an unknown method is an error
 */
import { describe, expect, it } from "vitest";
import { handleMcpMessage, MCP_TOOLS, redactToolResult, toolsFor, type RouteAnswer, type ToolContext } from "./agentMcp";
import { CONFIRM_REASON_SENTENCE, CONFIRM_TTL_MS, createConfirmSpendBook, mintConfirmToken, verifyConfirmToken, type AgentScope } from "./agentTokens";
import { DEFAULT_AGENT_ADMIN_PATHS } from "../../shared/agentAdmin";

const SECRET = "test-secret-for-confirm-tokens";

/** A holder with a board of one open task, whose routes are recorded. */
function holder(initial: { status?: string; version?: number } = {}) {
  const task = { id: "t-1", title: "Water the seedlings", status: initial.status ?? "open", version: initial.version ?? 3 };
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const dispatch: ToolContext["dispatch"] = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path === "/api/member-tasks/me") {
      const list = { open: task.status === "open" ? [task] : [], done: task.status === "done" ? [task] : [], removed: task.status === "removed" ? [task] : [] };
      return { status: 200, body: { on: true, ...list } };
    }
    if (method === "POST" && path === `/api/member-tasks/me/${task.id}/done`) {
      if ((body as { version?: number } | undefined)?.version !== task.version) return { status: 409, body: { error: "version_conflict" } };
      task.status = "done";
      task.version += 1;
      return { status: 200, body: { task } };
    }
    if (method === "GET" && path === "/api/me/moon") {
      return { status: 200, body: { recap: { id: "r-1", amountMinor: 120000, payRoute: "local_contractor", items: [{ text: "Fixed the pump", legal_name: "X", billingAddress: "Y", minutes: 30 }] } } };
    }
    return { status: 404, body: { error: "Not found" } } as RouteAnswer;
  };
  const ctx: ToolContext = {
    dispatch,
    mintConfirm: (tool, echo) => mintConfirmToken(SECRET, { action: `mcp:${tool}`, userId: "u-1", echo }),
    verifyConfirm: (tool, token, echo) => {
      const c = verifyConfirmToken(SECRET, token, { action: `mcp:${tool}`, userId: "u-1", echo });
      return c.ok ? { ok: true } : { ok: false, reason: c.reason, sentence: CONFIRM_REASON_SENTENCE[c.reason] };
    },
  };
  return { task, calls, ctx };
}

const info = { name: "Example Village", version: "1.2.0" };
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });
const callTool = (name: string, args: Record<string, unknown>) => rpc("tools/call", { name, arguments: args });

async function ask(message: unknown, scopes: AgentScope[], ctx: ToolContext) {
  return handleMcpMessage(message, { scopes, info, ctx }) as Promise<any>;
}

describe("the connector protocol", () => {
  it("initializes with the village's own name and the version the client asked for", async () => {
    const { ctx } = holder();
    const r = await ask(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } }), ["moon.read"], ctx);
    expect(r.result.serverInfo).toEqual(info);
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities.tools).toBeTruthy();
    const unknown = await ask(rpc("initialize", { protocolVersion: "1999-01-01" }), ["moon.read"], ctx);
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
    // The revision before resource metadata is not offered back.
    const old = await ask(rpc("initialize", { protocolVersion: "2025-03-26" }), ["moon.read"], ctx);
    expect(old.result.protocolVersion).toBe("2025-11-25");
  });

  it("takes a notification without an answer and refuses an unknown method", async () => {
    const { ctx } = holder();
    expect(await ask(rpc("notifications/initialized", undefined, null), ["moon.read"], ctx)).toBeNull();
    const r = await ask(rpc("resources/list"), ["moon.read"], ctx);
    expect(r.error.code).toBe(-32601);
    const bad = await ask([rpc("ping")], ["moon.read"], ctx);
    expect(bad.error.code).toBe(-32600);
  });
});

describe("scopes decide the tools (check 31)", () => {
  it("lists no write tool for a token with only moon.read", async () => {
    const { ctx } = holder();
    const r = await ask(rpc("tools/list"), ["moon.read"], ctx);
    const names = r.result.tools.map((t: any) => t.name);
    expect(names).toEqual(["get_my_moon", "get_my_seats", "get_season"]);
    for (const t of r.result.tools) expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("refuses a write tool to a token without tasks.write, and calls no route", async () => {
    const { ctx, calls } = holder();
    const r = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done" }), ["moon.read"], ctx);
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toContain("tasks.write");
    expect(calls).toEqual([]);
  });

  it("lists the board tool for tasks.write", () => {
    expect(toolsFor(["tasks.write"]).map((t) => t.name)).toEqual(["mark_my_task"]);
  });
});

describe("a write answers the echo first (check 31)", () => {
  it("writes nothing without a confirm token, then exactly once on the matching confirm", async () => {
    const h = holder();
    const first = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done" }), ["tasks.write"], h.ctx);
    const asked = first.result.structuredContent;
    expect(first.result.isError).toBe(false);
    expect(asked.confirmRequired).toBe(true);
    expect(asked.echo).toEqual({ taskId: "t-1", title: "Water the seedlings", from: "open", action: "done", reason: null, note: null, version: 3 });
    expect(h.calls.filter((c) => c.method === "POST")).toEqual([]);

    const second = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done", confirmToken: asked.confirmToken }), ["tasks.write"], h.ctx);
    expect(second.result.isError).toBe(false);
    expect(second.result.structuredContent.written).toBe(true);
    const posts = h.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ path: "/api/member-tasks/me/t-1/done", body: { version: 3, context: { surface: "assistant" } } });

    // The same token again: the task is done and its version moved, so nothing writes.
    const replay = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done", confirmToken: asked.confirmToken }), ["tasks.write"], h.ctx);
    expect(replay.result.isError).toBe(true);
    expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("refuses a token minted for different arguments", async () => {
    const h = holder();
    const first = await ask(callTool("mark_my_task", { taskId: "t-1", action: "remove", reason: "done_elsewhere" }), ["tasks.write"], h.ctx);
    const token = first.result.structuredContent.confirmToken;
    const other = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done", confirmToken: token }), ["tasks.write"], h.ctx);
    expect(other.result.isError).toBe(true);
    expect(other.result.structuredContent.detail.reason).toBe("echo_mismatch");
    expect(h.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("refuses a token that is not this server's", async () => {
    const h = holder();
    const r = await ask(callTool("mark_my_task", { taskId: "t-1", action: "done", confirmToken: "forged.token" }), ["tasks.write"], h.ctx);
    expect(r.result.isError).toBe(true);
    expect(h.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("says when the action does not apply to the task's status", async () => {
    const h = holder({ status: "open" });
    const r = await ask(callTool("mark_my_task", { taskId: "t-1", action: "undo" }), ["tasks.write"], h.ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.error).toContain("open");
  });
});

describe("no tool sends, approves, issues, pays or touches a pay route (check 32)", () => {
  const NEVER = /send|approve|issue|pay|invoice|return|take-?back|mark-?paid|pay-?route|routes\/|settle|cash/i;

  it("names no such route anywhere in the table", () => {
    for (const t of MCP_TOOLS) {
      for (const r of t.routes) expect(r, `${t.name} names ${r}`).not.toMatch(NEVER);
      expect(t.name).not.toMatch(NEVER);
    }
  });

  it("carries no redacted key in a result, at any depth", async () => {
    const { ctx } = holder();
    const r = await ask(callTool("get_my_moon", {}), ["moon.read"], ctx);
    const text = r.result.content[0].text as string;
    for (const k of ["amountMinor", "payRoute", "legal_name", "billingAddress"]) expect(text).not.toContain(k);
    expect(r.result.structuredContent.moon.recap.items[0]).toEqual({ text: "Fixed the pump", minutes: 30 });
  });

  it("never carries a member's private detail", () => {
    expect(redactToolResult({ tasks: [{ title: "Call the vet", privateDetail: "her number", private_detail: "x" }] })).toEqual({ tasks: [{ title: "Call the vet" }] });
  });

  it("redacts the pack's forbidden keys and the connector's own", () => {
    const out = redactToolResult({ ok: 1, nested: [{ currency: "USD", taxId: "x", legalName: "y", address: "z", route: "r", keep: true }] });
    expect(out).toEqual({ ok: 1, nested: [{ keep: true }] });
  });
});

describe("admin_request (check 52)", () => {
  function admin() {
    const h = holder();
    const actions: Array<{ state: string; method: string | null; path: string | null }> = [];
    const routeCalls: Array<{ method: string; path: string; body?: unknown }> = [];
    const ctx: ToolContext = {
      ...h.ctx,
      holderId: "agent-1",
      adminPaths: async () => DEFAULT_AGENT_ADMIN_PATHS,
      recordAction: async (a) => {
        actions.push({ state: a.state, method: a.method, path: a.path });
      },
      dispatch: async (method, path, body) => {
        routeCalls.push({ method, path, body });
        if (method === "GET" && path === "/api/admin/member-tasks/access") return { status: 200, body: { on: ["u-1"] } };
        if (method === "PUT" && path === "/api/admin/member-tasks/access/u-2") return { status: 200, body: { userId: "u-2", on: true } };
        return { status: 404, body: { error: "Not found" } };
      },
    };
    return { ctx, actions, routeCalls };
  }

  it("is listed only for the admin scope", () => {
    expect(toolsFor(["moon.read", "tasks.write"]).map((t) => t.name)).not.toContain("admin_request");
    expect(toolsFor(["admin"]).map((t) => t.name)).toEqual(["admin_request"]);
  });

  it("reads an allowed path at once and records the call", async () => {
    const a = admin();
    const r = await ask(callTool("admin_request", { method: "GET", path: "/api/admin/member-tasks/access" }), ["admin"], a.ctx);
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent).toEqual({ on: ["u-1"] });
    expect(a.actions).toEqual([{ state: "done", method: "GET", path: "/api/admin/member-tasks/access" }]);
  });

  it("writes nothing without the confirm token, then once on the confirm, recording each call", async () => {
    const a = admin();
    const args = { method: "PUT", path: "/api/admin/member-tasks/access/u-2", body: { on: true } };
    const first = await ask(callTool("admin_request", args), ["admin"], a.ctx);
    expect(first.result.structuredContent.confirmRequired).toBe(true);
    expect(a.routeCalls).toEqual([]);
    const second = await ask(callTool("admin_request", { ...args, confirmToken: first.result.structuredContent.confirmToken }), ["admin"], a.ctx);
    expect(second.result.structuredContent.written).toBe(true);
    expect(a.routeCalls).toEqual([{ method: "PUT", path: "/api/admin/member-tasks/access/u-2", body: { on: true } }]);
    const changed = await ask(callTool("admin_request", { ...args, body: { on: false }, confirmToken: first.result.structuredContent.confirmToken }), ["admin"], a.ctx);
    expect(changed.result.isError).toBe(true);
    expect(a.routeCalls).toHaveLength(1);
    expect(a.actions.map((x) => x.state)).toEqual(["asked", "done", "refused"]);
  });

  it("refuses a path a person must take, and one not on the list, calling no route", async () => {
    const a = admin();
    const erase = await ask(callTool("admin_request", { method: "DELETE", path: "/api/admin/players/u-9" }), ["admin"], a.ctx);
    expect(erase.result.isError).toBe(true);
    expect(erase.result.structuredContent.detail.code).toBe("always_a_person");
    const fresh = await ask(callTool("admin_request", { method: "POST", path: "/api/admin/events", body: {} }), ["admin"], a.ctx);
    expect(fresh.result.structuredContent.detail.code).toBe("not_allowed");
    expect(a.routeCalls).toEqual([]);
    expect(a.actions.map((x) => x.state)).toEqual(["refused", "refused"]);
  });

  it("leaves a write marked for a person to a person", async () => {
    const a = admin();
    a.ctx.adminPaths = async () => ({ paths: [{ method: "POST", path: "/api/admin/events", confirm: "person", label: "Put a gathering on the calendar" }] });
    const r = await ask(callTool("admin_request", { method: "POST", path: "/api/admin/events", body: { title: "x" } }), ["admin"], a.ctx);
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.detail.code).toBe("person_confirms");
    expect(a.routeCalls).toEqual([]);
  });
});

describe("the confirm spend book", () => {
  it("spends a token once, and forgets it only after it would have expired anyway", () => {
    let now = 1_000_000;
    const book = createConfirmSpendBook(() => now);
    const { token } = mintConfirmToken(SECRET, { action: "mcp:x", userId: "u-1", echo: { a: 1 } }, now);
    expect(book.spend(token)).toBe(true);
    expect(book.spend(token)).toBe(false);
    now += CONFIRM_TTL_MS - 1;
    expect(book.spend(token)).toBe(false);
    now += 2;
    // Past its expiry the token fails verification first, so the book may drop it.
    expect(verifyConfirmToken(SECRET, token, { action: "mcp:x", userId: "u-1", echo: { a: 1 } }, now)).toMatchObject({ ok: false, reason: "expired" });
    book.spend("other.token");
    expect(book.size()).toBe(1);
  });
});
