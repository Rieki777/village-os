/**
 * AGENT ACCOUNTS AND THE PATHS OPEN TO THEM (End of Moon addendum v6, B6).
 *
 *   GET /api/admin/agent-accounts          the accounts marked as an agent's
 *   PUT /api/admin/players/:id/agent       mark an account as an agent's, or as a person's again
 *   GET /api/admin/agent-admin-paths       the paths `admin_request` may call, and what is always a person's
 *   PUT /api/admin/agent-admin-paths       change that list
 *   GET /api/admin/agent-actions           what agents did through the admin and Sera scopes, newest first
 *   POST /api/admin/agent-actions/:id/undo put back one of Sera's actions (B7), within 30 days
 *
 * Every route is an admin's, and the two writes are a PERSON's: an agent
 * account is refused them even with a session, and `admin_request` can never
 * reach them (`ALWAYS_A_PERSON`, shared/agentAdmin.ts), so no agent widens its
 * own reach or marks another account.
 *
 * An account is marked an agent's only while it holds no role, because an
 * agent account holds none (server/lib/orgChart.ts refuses the seating).
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { revokeAllTokens } from "../lib/agentTokens";
import { agentAccountIds, isAgentAccount, listAgentActions, liveRoleCount, setAgentAccount, namesOf } from "../repos/agentAccounts";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { undoSeraAction } from "../lib/seraAgent";
import { AGENT_ADMIN_PATHS_DOC, ALWAYS_A_PERSON, DEFAULT_AGENT_ADMIN_PATHS, effectiveAgentAdminPaths, parseAgentAdminPaths } from "../../shared/agentAdmin";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "isAdmin">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, isAdmin } = deps;

  /** An admin who is a person, or an answer and null. */
  const person = async (req: express.Request, res: express.Response): Promise<{ id: string } | null> => {
    if (!(await isAdmin(req))) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    if (await isAgentAccount(getPool(), String(user.id))) {
      res.status(403).json({ error: "person_only", message: "A person makes this change, never an agent account." });
      return null;
    }
    return { id: String(user.id) };
  };

  app.get("/api/admin/agent-accounts", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ agents: await agentAccountIds(getPool()) });
  });

  app.put("/api/admin/players/:id/agent", async (req, res) => {
    const actor = await person(req, res);
    if (!actor) return;
    const userId = String(req.params.id ?? "").slice(0, 64);
    const on = (req.body as { isAgent?: unknown } | undefined)?.isAgent === true;
    if (!userId) return res.status(400).json({ error: "Which account?" });
    if (userId === actor.id) return res.status(400).json({ error: "Mark another account, never your own." });
    if (on && (await liveRoleCount(getPool(), userId)) > 0) {
      return res.status(409).json({ error: "This account holds a role or a power. An agent account holds neither, so end them first." });
    }
    if (!(await setAgentAccount(getPool(), userId, on))) return res.status(404).json({ error: "Not found" });
    // A token never outlives what its account was when it was minted: both directions end every live token.
    const ended = await revokeAllTokens(getPool(), userId);
    await recordEvent(getPool(), {
      kind: "audit",
      text: `${on ? "marked an account as an agent's" : "marked an account as a person's"}, ending ${ended} agent token${ended === 1 ? "" : "s"}`,
      actorUserId: actor.id,
      entityType: "user",
      entityRef: userId,
      audience: "admin",
    });
    res.json({ userId, isAgent: on });
  });

  app.get("/api/admin/agent-admin-paths", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const stored = await readConfigDocument(getPool(), AGENT_ADMIN_PATHS_DOC);
    res.json({
      document: effectiveAgentAdminPaths(stored),
      shipped: DEFAULT_AGENT_ADMIN_PATHS,
      edited: stored !== null,
      alwaysAPerson: ALWAYS_A_PERSON.map((r) => ({ key: r.key, words: r.words })),
    });
  });

  app.put("/api/admin/agent-admin-paths", async (req, res) => {
    const actor = await person(req, res);
    if (!actor) return;
    const parsed = parseAgentAdminPaths((req.body as { document?: unknown } | undefined)?.document ?? req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    await writeConfigDocument(getPool(), AGENT_ADMIN_PATHS_DOC, parsed.value as unknown as Record<string, unknown>);
    await recordEvent(getPool(), {
      kind: "audit",
      text: `changed the agent paths list (${parsed.value.paths.length} paths)`,
      actorUserId: actor.id,
      entityType: "app_config",
      entityRef: AGENT_ADMIN_PATHS_DOC,
      audience: "admin",
    });
    res.json({ document: parsed.value });
  });

  app.get("/api/admin/agent-actions", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const scope = typeof req.query.scope === "string" ? req.query.scope.slice(0, 32) : undefined;
    const actions = await listAgentActions(getPool(), { scope, limit: Number(req.query.limit ?? 100) });
    // Which member each action touched, by name, so a steward sees whom an Undo is for.
    const names = await namesOf(getPool(), actions.map((a) => a.subjectUserId ?? ""));
    res.json({ actions: actions.map((a) => ({ ...a, subjectName: a.subjectUserId ? names[a.subjectUserId] ?? null : null })) });
  });

  app.post("/api/admin/agent-actions/:id/undo", async (req, res) => {
    const actor = await person(req, res);
    if (!actor) return;
    const out = await undoSeraAction(getPool(), String(req.params.id ?? "").slice(0, 64), actor.id, null);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ undone: true });
  });
}
