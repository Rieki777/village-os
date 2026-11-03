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
import { CONFIRM_REASON_SENTENCE, mintConfirmToken, verifyConfirmToken, type AgentScope } from "./agentTokens";

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

  it("redacts the pack's forbidden keys and the connector's own", () => {
    const out = redactToolResult({ ok: 1, nested: [{ currency: "USD", taxId: "x", legalName: "y", address: "z", route: "r", keep: true }] });
    expect(out).toEqual({ ok: 1, nested: [{ keep: true }] });
  });
});
