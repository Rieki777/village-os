/**
 * THE VILLAGE CONNECTOR: a remote MCP server on the member's own agent token
 * (End of Moon addendum v6, B4).
 *
 *   POST /api/agent/v1/mcp   Streamable HTTP, stateless, one JSON-RPC message
 *                            per request, answered as JSON
 *
 * This file is the protocol and the tool table, and nothing else. It makes no
 * database call and holds no permission of its own: every tool names the
 * holder's OWN route, and the HTTP wiring (server/routes/agentMcp.ts) runs
 * that route as the holder, so `authedUser`, the one capability gate and
 * `requireModule` answer exactly as they do on the web. A token only ever
 * narrows what its holder can do, the rule at the top of
 * server/lib/agentTokens.ts, and this surface must never grow a second
 * permission system.
 *
 * ── SCOPES ────────────────────────────────────────────────────────────────
 * `tools/list` shows only the tools the token's scopes open, and `tools/call`
 * refuses any other, so a token minted with `moon.read` alone lists no write
 * tool (check 31).
 *
 * ── WRITES: THE SAME TWO CALLS AS EVERY AGENT WRITE ──────────────────────
 * A write tool called without `confirmToken` writes nothing. It answers with
 * an echo of exactly what would be written, read fresh from the holder's own
 * route, and a confirm token bound to that echo, the holder and the tool
 * (`mintConfirmToken`). Called again with the same arguments and the token,
 * it reads the state again, rebuilds the echo, and writes only when the token
 * binds THAT echo. A token works once: the HTTP wiring spends it the moment
 * it verifies (`createConfirmSpendBook` in ./agentTokens), so the same token
 * sent again is refused even where the echo would still match, as it would
 * for an admin path or a moon write that leaves nothing versioned behind.
 *
 * ── SERA'S TOOLS WRITE AT ONCE, AND ARE UNDONE INSTEAD ───────────────────
 * The `sera.undoable` tools are the one exception to the two calls, and they
 * say so (`writesAtOnce`). Sera's agent acts for no single member who could
 * say yes, so each write lands at once, is recorded with what puts it back,
 * and can be undone for 30 days by the agent or a steward while nobody has
 * touched it (server/lib/seraAgent.ts). Check 31 covers the member's own
 * write tools; these are held instead by their undo.
 *
 * ── WHAT NO TOOL EVER DOES ───────────────────────────────────────────────
 * Send a recap or an invoice, take one back, issue, approve, return, mark
 * paid, or read or change a pay route. A person presses those in the app.
 * No tool in this table names a route that does any of them, and
 * server/lib/agentMcp.test.ts walks the table to hold that.
 *
 * ── REDACTION ─────────────────────────────────────────────────────────────
 * Every tool result passes through `redactToolResult`, which drops any key
 * matching the moon pack's forbidden list (`PACK_FORBIDDEN_KEY`) or naming a
 * pay route, a legal name or an address, at any depth. It runs for every
 * holder, a `cash.pay` holder included.
 */
import { adminRequestDecision, type AgentAdminPathsDoc } from "../../shared/agentAdmin";
import { MOON_ROUTES, PACK_FORBIDDEN_KEY } from "../../shared/moonRecap";
import { echoHash, type AgentScope } from "./agentTokens";

/** The protocol revisions this server speaks, newest first. */
// 2025-03-26 is not offered: it predates the resource metadata a 401 points at, which is how a connector finds the sign-in.
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

/** The JSON-RPC error codes this server answers with. */
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

// ── Redaction ────────────────────────────────────────────────────────────────

/** Keys a connector result never carries, beside the moon pack's own list. */
export const CONNECTOR_REDACTED_KEY = /route|legal_?name|address|private_?detail/i;

/** True when a key is one no connector result may carry. */
export function isRedactedKey(key: string): boolean {
  return PACK_FORBIDDEN_KEY.test(key) || CONNECTOR_REDACTED_KEY.test(key);
}

/** The value with every redacted key removed, at any depth. Arrays keep their order. */
export function redactToolResult(value: unknown, depth = 0): unknown {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map((v) => redactToolResult(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isRedactedKey(k)) continue;
      out[k] = redactToolResult(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── What a tool may ask of the server ────────────────────────────────────────

/** One call to the holder's own route, as the holder. */
export interface RouteAnswer {
  status: number;
  body: unknown;
}

export interface ToolContext {
  /** Runs `method path` as the holder and answers with the route's status and JSON. */
  dispatch: (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<RouteAnswer>;
  /** A confirm token bound to this tool, this holder and this echo. */
  mintConfirm: (tool: string, echo: unknown) => { token: string; expiresAt: string };
  /** Whether `token` binds this tool, this holder and this echo, and why not. */
  verifyConfirm: (tool: string, token: unknown, echo: unknown) => { ok: true } | { ok: false; reason: string; sentence: string };
  /** The token's holder. `admin_request` refuses any path naming them. */
  holderId?: string;
  /** The village's agent paths list (shared/agentAdmin.ts). Only `admin_request` reads it. */
  adminPaths?: () => Promise<AgentAdminPathsDoc>;
  /** Sera's undoable actions (server/lib/seraAgent.ts). Only the `sera.undoable` tools use it. */
  sera?: {
    run: (tool: "link_sera_person" | "suggest_task" | "set_board_access", args: Record<string, unknown>) => Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }>;
    undo: (actionId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  /** Writes one `agent_actions` row. Only the admin and Sera tools record through it. */
  recordAction?: (a: { scope: string; tool: string; method: string | null; path: string | null; echoHash: string; state: "done" | "refused" | "asked" }) => Promise<void>;
}

/** What a tool answers: a result to show, or a refusal in words. */
export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string; detail?: unknown };

export interface ToolDef {
  name: string;
  /** The scope a token must carry to list or call this tool. */
  scope: AgentScope;
  /** Writes go through the two calls; reads answer at once. */
  kind: "read" | "write";
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Every route this tool may call, as `METHOD /path` with `:param` holes. The table test reads these. */
  routes: readonly string[];
  /** For a tool that reads or writes by its arguments: whether THIS call writes. */
  writes?: (args: Record<string, unknown>) => boolean;
  /** A write that can change or remove what is there, for the client's own warning. */
  destructive?: boolean;
  /** A write that lands on the first call, held by its undo instead of a confirmToken (Sera's tools only). */
  writesAtOnce?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

/** A route's refusal, in the route's own words when it gave any. */
function refusal(what: string, a: RouteAnswer): ToolOutcome {
  const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
  const words = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : `status ${a.status}`;
  return { ok: false, error: `${what}: ${words}`, detail: { status: a.status } };
}

// ── The board, for mark_my_task ──────────────────────────────────────────────

/** The board actions an agent may press for its holder. Each is the board's own route. */
export const BOARD_ACTIONS = ["done", "remove", "undo"] as const;
export type BoardAction = (typeof BOARD_ACTIONS)[number];

interface BoardTask {
  id: string;
  title: string;
  status: string;
  version: number;
}

function boardTasks(body: unknown): BoardTask[] {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const all = [b.open, b.done, b.removed].flatMap((list) => (Array.isArray(list) ? list : []));
  return all
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({ id: String(t.id ?? ""), title: String(t.title ?? ""), status: String(t.status ?? ""), version: Number(t.version ?? 0) }));
}

/** Which statuses each action presses from. The board's own route still decides. */
const PRESSES_FROM: Record<BoardAction, readonly string[]> = {
  done: ["open"],
  remove: ["open"],
  undo: ["done", "removed"],
};

// ── The tool table ───────────────────────────────────────────────────────────

export const MCP_TOOLS: readonly ToolDef[] = [
  {
    name: "get_my_moon",
    scope: "moon.read",
    kind: "read",
    title: "My moon",
    description:
      "The holder's recap for the current moon, when the moon review is open in this village, and the holder's task board with each task's status and when it was done. Read only.",
    inputSchema: NO_ARGS,
    routes: [`GET ${MOON_ROUTES.myMoon}`, "GET /api/member-tasks/me"],
    async run(_args, ctx) {
      const [moon, board] = await Promise.all([ctx.dispatch("GET", MOON_ROUTES.myMoon), ctx.dispatch("GET", "/api/member-tasks/me")]);
      if (moon.status >= 500) return refusal("My moon could not be read", moon);
      if (board.status >= 500) return refusal("The task board could not be read", board);
      const b = (board.body && typeof board.body === "object" ? board.body : {}) as Record<string, unknown>;
      return {
        ok: true,
        result: {
          // 404 is the moon review being off, or not open yet: there is no recap to read.
          moon: moon.status === 200 ? moon.body : null,
          moonNote: moon.status === 200 ? null : "There is no recap to read here yet: the moon review is not open in this village.",
          board: board.status === 200 ? { open: b.open ?? [], done: b.done ?? [], removed: b.removed ?? [] } : null,
          boardNote: board.status === 200 ? null : "The task board is off for this member.",
        },
      };
    },
  },
  {
    name: "get_my_seats",
    scope: "moon.read",
    kind: "read",
    title: "My roles",
    description: "The roles the holder holds, with each role's purpose and accountabilities, from their own role card. Read only.",
    inputSchema: NO_ARGS,
    routes: ["GET /api/people/me/role-card"],
    async run(_args, ctx) {
      const a = await ctx.dispatch("GET", "/api/people/me/role-card");
      return a.status === 200 ? { ok: true, result: a.body } : refusal("The role card could not be read", a);
    },
  },
  {
    name: "get_season",
    scope: "moon.read",
    kind: "read",
    title: "The season",
    description: "The village's running season and its goals. Read only.",
    inputSchema: NO_ARGS,
    routes: ["GET /api/season"],
    async run(_args, ctx) {
      const a = await ctx.dispatch("GET", "/api/season");
      return a.status === 200 ? { ok: true, result: a.body } : refusal("The season could not be read", a);
    },
  },
  {
    name: "mark_my_task",
    scope: "tasks.write",
    kind: "write",
    title: "Mark a task on my board",
    description:
      "Presses Done, Let go (remove, with a reason) or Undo on one of the holder's own board tasks, exactly as a tap on the board does, so Sera hears it the same way. Call it first without confirmToken: it writes nothing and answers with what it would do and a confirmToken. Show that to the member, and after their yes call it again with the same arguments and the confirmToken.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The board task's id, from get_my_moon." },
        action: { type: "string", enum: [...BOARD_ACTIONS] },
        reason: { type: "string", description: "For remove: why the task goes. One of the board's own reasons." },
        note: { type: "string", description: "For remove: an optional note, with no email or phone number in it." },
        confirmToken: { type: "string", description: "From the first call. Leave it out to see what would be written." },
      },
      required: ["taskId", "action"],
      additionalProperties: false,
    },
    routes: ["GET /api/member-tasks/me", "POST /api/member-tasks/me/:id/done", "POST /api/member-tasks/me/:id/remove", "POST /api/member-tasks/me/:id/undo"],
    async run(args, ctx) {
      const taskId = typeof args.taskId === "string" ? args.taskId.slice(0, 64) : "";
      const action = String(args.action ?? "") as BoardAction;
      if (!taskId) return { ok: false, error: "Name the task: taskId, from get_my_moon." };
      if (!(BOARD_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: `action is one of ${BOARD_ACTIONS.join(", ")}.` };
      const reason = action === "remove" && typeof args.reason === "string" ? args.reason.slice(0, 40) : null;
      const note = action === "remove" && typeof args.note === "string" ? args.note.slice(0, 500) : null;

      const board = await ctx.dispatch("GET", "/api/member-tasks/me");
      if (board.status !== 200) return refusal("The task board could not be read", board);
      const task = boardTasks(board.body).find((t) => t.id === taskId);
      if (!task) return { ok: false, error: "That task is not on the holder's board." };
      if (!PRESSES_FROM[action].includes(task.status)) {
        return { ok: false, error: `That task is ${task.status}, so ${action} does not apply to it.` };
      }
      const echo = { taskId: task.id, title: task.title, from: task.status, action, reason, note, version: task.version };

      if (args.confirmToken === undefined) {
        const { token, expiresAt } = ctx.mintConfirm("mark_my_task", echo);
        return {
          ok: true,
          result: {
            confirmRequired: true,
            echo,
            confirmToken: token,
            expiresAt,
            message: "Nothing was written. Show this to the member, and after their yes call mark_my_task again with the same arguments and this confirmToken.",
          },
        };
      }
      const check = ctx.verifyConfirm("mark_my_task", args.confirmToken, echo);
      if (!check.ok) return { ok: false, error: check.sentence, detail: { reason: check.reason } };

      const body: Record<string, unknown> = { version: task.version, context: { surface: "assistant" } };
      if (reason) body.reason = reason;
      if (note) body.note = note;
      const done = await ctx.dispatch("POST", `/api/member-tasks/me/${encodeURIComponent(task.id)}/${action}`, body);
      if (done.status >= 300) return refusal("The board did not take that", done);
      return { ok: true, result: { written: true, echo, board: done.body } };
    },
  },
  {
    name: "admin_request",
    scope: "admin",
    kind: "write",
    title: "Call an admin path",
    description:
      "Calls one admin path the village has opened to agents, as the holder, with the holder's own admin checks. GET answers at once. A write answers first with what it would do and a confirmToken; call again with the same arguments and the token to make it. Some writes a person makes in the app, and the answer says so. Erasure, powers, money, secrets and the agent accounts are never reachable here.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", description: "The admin path, such as /api/admin/member-tasks/access. No query string." },
        body: { type: "object", description: "The JSON body for a write." },
        confirmToken: { type: "string", description: "From the first call of a write. Leave it out to see what would be written." },
      },
      required: ["method", "path"],
      additionalProperties: false,
    },
    // The routes this tool may reach are the village's list, not this table. "Always a person" is in shared/agentAdmin.ts.
    routes: [],
    destructive: true,
    writes: (args) => String(args.method ?? "").toUpperCase() !== "GET",
    async run(args, ctx) {
      if (!ctx.adminPaths || !ctx.recordAction) return { ok: false, error: "The admin tool is not open on this server." };
      const method = String(args.method ?? "").toUpperCase();
      const path = typeof args.path === "string" ? args.path : "";
      const body = args.body && typeof args.body === "object" && !Array.isArray(args.body) ? (args.body as Record<string, unknown>) : undefined;
      const echo = { method, path, body: body ?? null };
      const hash = echoHash(echo);
      const record = (state: "done" | "refused" | "asked") =>
        ctx.recordAction!({ scope: "admin", tool: "admin_request", method: method.slice(0, 8) || null, path: path.slice(0, 500) || null, echoHash: hash, state });

      const decision = adminRequestDecision(method, path, await ctx.adminPaths(), ctx.holderId ?? null);
      if (!decision.ok) {
        await record("refused");
        return { ok: false, error: decision.words, detail: { code: decision.code } };
      }
      if (!decision.write) {
        const a = await ctx.dispatch("GET", path);
        await record(a.status < 300 ? "done" : "refused");
        return a.status < 300 ? { ok: true, result: a.body } : refusal("The admin path refused", a);
      }
      if (decision.confirm === "person") {
        await record("refused");
        return {
          ok: false,
          error: `A person makes this change in the app: ${decision.entry.label}. Tell them what you would change, and they press it there.`,
          detail: { code: "person_confirms", echo },
        };
      }
      if (args.confirmToken === undefined) {
        const { token, expiresAt } = ctx.mintConfirm("admin_request", echo);
        await record("asked");
        return {
          ok: true,
          result: {
            confirmRequired: true,
            echo,
            confirmToken: token,
            expiresAt,
            message: "Nothing was written. Call admin_request again with the same arguments and this confirmToken to make it.",
          },
        };
      }
      const check = ctx.verifyConfirm("admin_request", args.confirmToken, echo);
      if (!check.ok) {
        await record("refused");
        return { ok: false, error: check.sentence, detail: { reason: check.reason } };
      }
      const a = await ctx.dispatch(method as "POST" | "PUT" | "PATCH" | "DELETE", path, body ?? {});
      await record(a.status < 300 ? "done" : "refused");
      if (a.status >= 300) return refusal("The admin path refused", a);
      return { ok: true, result: { written: true, echo, answer: a.body } };
    },
  },
  ...(["link_sera_person", "suggest_task", "set_board_access"] as const).map((name): ToolDef => ({
    name,
    scope: "sera.undoable",
    kind: "write",
    title: name === "link_sera_person" ? "Link a member to their Sera person" : name === "suggest_task" ? "Suggest a task on a member's board" : "Turn a member's task board on or off",
    description:
      name === "link_sera_person"
        ? "Links a member to their Sera owner id. Never replaces a link that exists, and never links one owner to two members or one member to two owners. Undoable for 30 days."
        : name === "suggest_task"
          ? "Puts a task on a member's board as a suggestion they keep or remove. Nobody is notified. Undoable for 30 days while the member has not touched it."
          : "Turns a member's task board on or off. Undoable for 30 days while nobody has switched it since.",
    inputSchema:
      name === "link_sera_person"
        ? { type: "object", properties: { userId: { type: "string" }, seraOwnerId: { type: "string" } }, required: ["userId", "seraOwnerId"], additionalProperties: false }
        : name === "suggest_task"
          ? {
              type: "object",
              properties: {
                userId: { type: "string" },
                title: { type: "string" },
                tier: { type: "string", enum: ["high", "priority", "not_yet"] },
                horizon: { type: "string", enum: ["today", "week", "later"] },
                dueOn: { type: "string", description: "YYYY-MM-DD" },
              },
              required: ["userId", "title"],
              additionalProperties: false,
            }
          : { type: "object", properties: { userId: { type: "string" }, on: { type: "boolean" } }, required: ["userId", "on"], additionalProperties: false },
    routes: [],
    writesAtOnce: true,
    destructive: name === "set_board_access",
    async run(args, ctx) {
      if (!ctx.sera) return { ok: false, error: "Sera's tools are not open on this server." };
      const out = await ctx.sera.run(name, args);
      return out.ok ? { ok: true, result: out.result } : { ok: false, error: out.error };
    },
  })),
  {
    name: "undo_sera_action",
    scope: "sera.undoable",
    kind: "write",
    writesAtOnce: true,
    destructive: true,
    title: "Undo one of Sera's actions",
    description: "Puts back one action this agent took, within 30 days, while nobody has touched what it wrote since. Answers why when it cannot.",
    inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"], additionalProperties: false },
    routes: [],
    async run(args, ctx) {
      if (!ctx.sera) return { ok: false, error: "Sera's tools are not open on this server." };
      const id = typeof args.actionId === "string" ? args.actionId.slice(0, 64) : "";
      if (!id) return { ok: false, error: "Name the action: actionId." };
      const out = await ctx.sera.undo(id);
      return out.ok ? { ok: true, result: { written: true, undone: true, actionId: id } } : { ok: false, error: out.error };
    },
  },
];

/** The tools a token with these scopes may list and call. */
export function toolsFor(scopes: readonly AgentScope[]): ToolDef[] {
  return MCP_TOOLS.filter((t) => scopes.includes(t.scope));
}

/** Whether this JSON-RPC message calls a write tool, for the rate bucket. */
export function callsWriteTool(message: unknown): boolean {
  const m = (message && typeof message === "object" ? message : {}) as Record<string, any>;
  if (m.method !== "tools/call") return false;
  const name = String(m.params?.name ?? "");
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool || tool.kind !== "write") return false;
  const args = (m.params?.arguments && typeof m.params.arguments === "object" ? m.params.arguments : {}) as Record<string, unknown>;
  return tool.writes ? tool.writes(args) : true;
}

// ── The protocol ─────────────────────────────────────────────────────────────

export interface McpServerInfo {
  /** The village's own name, from its brand setting. Never written in code. */
  name: string;
  version: string;
}

export interface McpCall {
  scopes: readonly AgentScope[];
  info: McpServerInfo;
  ctx: ToolContext;
  /** Told once per tools/call, after the tool ran, for the audit line. */
  onToolCall?: (tool: ToolDef, outcome: ToolOutcome, args: Record<string, unknown>) => Promise<void> | void;
}

/** One JSON-RPC answer, or null for a notification, which takes no answer. */
export type McpReply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } } | null;

const rpcError = (id: string | number | null, code: number, message: string, data?: unknown): McpReply => ({
  jsonrpc: "2.0",
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const INSTRUCTIONS =
  "This connector reads the member's own moon, roles and task board, and presses their own board for them. Every write asks first: call it without confirmToken, show the member what it would do, and call again with the token after their yes. It never sends, approves, issues or pays anything, and it never shows an amount or a pay route.";

/** Answer one JSON-RPC message. Never throws: a tool's failure is a result with isError. */
export async function handleMcpMessage(message: unknown, call: McpCall): Promise<McpReply> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, RPC.invalidRequest, "Send one JSON-RPC 2.0 message per request.");
  }
  const m = message as Record<string, any>;
  const isNotification = !("id" in m);
  const id: string | number | null = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return isNotification ? null : rpcError(id, RPC.invalidRequest, "Send a JSON-RPC 2.0 request with a method.");
  }
  if (isNotification) return null;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, any>;

  switch (m.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: call.info.name, version: call.info.version },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: toolsFor(call.scopes).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.kind === "read", destructiveHint: t.kind === "write" && !!t.destructive, idempotentHint: t.kind === "read", openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = String(params.name ?? "");
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, RPC.invalidParams, `There is no tool called ${name.slice(0, 60)}.`);
      if (!call.scopes.includes(tool.scope)) {
        return rpcError(id, RPC.invalidParams, `This token was not given the ${tool.scope} scope, so ${tool.name} is closed to it.`);
      }
      const args = (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>;
      let outcome: ToolOutcome;
      try {
        outcome = await tool.run(args, call.ctx);
      } catch (e) {
        outcome = { ok: false, error: "The tool could not finish. Nothing more was written." };
        console.warn(`[agent-mcp] ${tool.name} threw`, (e as Error)?.message);
      }
      if (call.onToolCall) {
        try {
          await call.onToolCall(tool, outcome, args);
        } catch (e) {
          console.warn("[agent-mcp] could not record the call", (e as Error)?.message);
        }
      }
      const payload = redactToolResult(outcome.ok ? outcome.result : { error: outcome.error, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { value: payload },
          isError: !outcome.ok,
        },
      };
    }
    default:
      return rpcError(id, RPC.methodNotFound, `This server does not answer ${String(m.method).slice(0, 60)}.`);
  }
}
