/**
 * THE VILLAGE CONNECTOR, over HTTP (End of Moon addendum v6, B4).
 *
 *   POST   /api/agent/v1/mcp   one JSON-RPC message, answered as JSON
 *   GET    /api/agent/v1/mcp   405: this server opens no stream
 *   DELETE /api/agent/v1/mcp   405: it keeps no session to end
 *
 * Streamable HTTP, stateless. The protocol and the tool table are in
 * server/lib/agentMcp.ts; this file only resolves the token and runs each
 * tool's route AS THE HOLDER.
 *
 * ── AS THE HOLDER ─────────────────────────────────────────────────────────
 * The agent block's own resolver (`resolveAgent`, server/index.ts) turns the
 * `vat_` bearer into the holder's in-process session and puts it on the
 * request. A tool's route is then called over the loopback with that session,
 * so it passes through every middleware and gate the web passes through: the
 * vat_ fence, `requireModule`, the one capability gate, the route's own
 * checks. Nothing here decides whether the holder may do a thing. The session
 * never leaves this process: it rides one loopback request and is not in any
 * answer.
 *
 * ── ONCE, FROM WHERE IT SAYS ─────────────────────────────────────────────
 * A confirm token is spent the moment it verifies, so it writes once. A
 * request carrying an Origin header from any other site is refused, which is
 * the DNS-rebinding guard the MCP transport asks for; a connector calling
 * from a server sends none. The client address the loopback forwards is the
 * one the rate limits read (`clientIp`), never the raw header.
 *
 * ── RECORDED ──────────────────────────────────────────────────────────────
 * Every `tools/call` of a write tool writes one admin-audience event naming
 * the token prefix, the tool and whether it wrote, and a read writes none, as
 * the read map writes none.
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { type AgentScope, type AgentTokenRow, CONFIRM_REASON_SENTENCE, createConfirmSpendBook, echoHash, mintConfirmToken, verifyConfirmToken } from "../lib/agentTokens";
import { callsWriteTool, handleMcpMessage, MCP_TOOLS, RPC, toolsFor, type RouteAnswer, type ToolContext } from "../lib/agentMcp";
import { recordEvent } from "../lib/events";
import { recordAgentAction } from "../repos/agentAccounts";
import { readConfigDocument } from "../repos/appConfigDocs";
import { AGENT_ADMIN_PATHS_DOC, effectiveAgentAdminPaths } from "../../shared/agentAdmin";
import { PLATFORM_VERSION } from "../lib/identity";

export const MCP_PATH = "/api/agent/v1/mcp";

type Deps = Pick<AppDeps, "getPool"> & {
  /** The agent block's resolver. With `null` it asks for a live token and no particular scope. */
  resolveAgent: (
    req: express.Request,
    res: express.Response,
    scope: AgentScope | null,
    kind: "read" | "write",
  ) => Promise<{ row: AgentTokenRow; user: any } | null>;
  confirmSecret: string;
  /** The village's own name, from its brand setting. */
  villageName: () => string;
  /** The port this server listens on, for the loopback. */
  port: () => number;
  /** The caller's address as the rate limits read it, through the trusted proxies only. */
  clientIp: (req: express.Request) => string;
};

/** The origin this server answers at, from the configured address or the request's own host. */
const ownOrigin = (req: express.Request) => (process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

/** True when an Origin header names some other site. No Origin is a server-side client, and passes. */
function foreignOrigin(req: express.Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    const want = new URL(ownOrigin(req)).origin;
    const self = new URL(`${req.protocol}://${req.get("host")}`).origin;
    const got = new URL(origin).origin;
    return got !== want && got !== self;
  } catch {
    return true;
  }
}

/** The address a client of this process reaches it at. The holder's session goes nowhere else. */
const loopback = (port: number) => `http://127.0.0.1:${port}`;

/** Run one route as the holder, over the loopback, and read its JSON. */
async function asHolder(
  port: number,
  session: string,
  forwardedFor: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<RouteAnswer> {
  if (!path.startsWith("/api/") || path.startsWith("/api/agent/")) return { status: 400, body: { error: "not a route a tool may call" } };
  const r = await fetch(`${loopback(port)}${path}`, {
    method,
    headers: {
      authorization: session,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: "The route did not answer with JSON." };
  }
  return { status: r.status, body: parsed };
}

export function register(app: Express, deps: Deps): void {
  const { resolveAgent, confirmSecret, getPool, villageName, port, clientIp } = deps;
  const spendBook = createConfirmSpendBook();

  app.get("/api/agent/v1/mcp", (_req, res) => {
    res.set("Allow", "POST").status(405).json({ error: "This connector opens no stream. Send each message with POST." });
  });
  app.delete("/api/agent/v1/mcp", (_req, res) => { // limit-ok: answers 405 and touches nothing
    res.set("Allow", "POST").status(405).json({ error: "This connector keeps no session to end." });
  });

  app.post("/api/agent/v1/mcp", async (req, res, next) => {
    try {
      if (foreignOrigin(req)) return res.status(403).json({ error: "origin_refused", message: "This connector answers servers and its own site, never a page on another site." });
      const message = req.body;
      // The bucket follows the message: a write tool spends the write bucket.
      const resolved = await resolveAgent(req, res, null, callsWriteTool(message) ? "write" : "read");
      if (!resolved) return;
      const { row, user } = resolved;
      if (toolsFor(row.scopes).length === 0) {
        return res.status(403).json({
          error: "agent_scope_missing",
          message: `This token opens no connector tool. Mint one with ${Array.from(new Set(MCP_TOOLS.map((t) => t.scope))).join(" or ")}.`,
        });
      }
      const session = String(req.headers.authorization ?? "");
      const forwardedFor = clientIp(req);
      const userId = String(user.id);
      const ctx: ToolContext = {
        dispatch: (method, path, body) => asHolder(port(), session, forwardedFor, method, path, body),
        mintConfirm: (tool, echo) => mintConfirmToken(confirmSecret, { action: `mcp:${tool}`, userId, echo }),
        holderId: userId,
        adminPaths: async () => effectiveAgentAdminPaths(await readConfigDocument(getPool(), AGENT_ADMIN_PATHS_DOC)),
        recordAction: async (a) => {
          await recordAgentAction(getPool(), { ...a, tokenId: row.id, actorUserId: userId });
        },
        verifyConfirm: (tool, token, echo) => {
          const check = verifyConfirmToken(confirmSecret, token, { action: `mcp:${tool}`, userId, echo });
          if (check.ok) {
            if (!spendBook.spend(String(token))) return { ok: false, reason: "spent", sentence: CONFIRM_REASON_SENTENCE.spent };
            return { ok: true };
          }
          // The echo is rebuilt from the arguments and fresh state, so a mismatch means something moved since the first call.
          const sentence = check.reason === "echo_mismatch"
            ? "What this would write changed since the first call, or the arguments differ. Call again without confirmToken to see it as it is now. Nothing was written"
            : CONFIRM_REASON_SENTENCE[check.reason];
          return { ok: false, reason: check.reason, sentence };
        },
      };
      const reply = await handleMcpMessage(message, {
        scopes: row.scopes,
        info: { name: villageName(), version: PLATFORM_VERSION },
        ctx,
        onToolCall: async (tool, outcome, args) => {
          if (tool.kind !== "write") return;
          const confirming = args.confirmToken !== undefined || !!tool.writesAtOnce;
          const wrote = outcome.ok && (outcome.result as any)?.written === true;
          await recordEvent(getPool(), {
            kind: "agent_mcp",
            text: `${tool.name} through the connector (${row.prefix}...): ${wrote ? "written" : confirming ? "refused" : "asked"}, echo ${echoHash((outcome.ok ? (outcome.result as any)?.echo : null) ?? null).slice(0, 12)}`,
            actorUserId: userId,
            actorKind: "agent",
            entityType: "agent_token",
            entityRef: row.id,
            audience: "admin",
          });
        },
      });
      if (reply === null) return res.status(202).end();
      return res.json(reply);
    } catch (e) {
      return next(e);
    }
  });

  // A body that is not JSON never reaches the route: the parser fails first. Answer it as JSON-RPC does.
  app.use(MCP_PATH, (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: RPC.parseError, message: "That body is not JSON. Send one JSON-RPC 2.0 message." } });
    }
    return next(err);
  });
}
