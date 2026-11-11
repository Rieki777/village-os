/**
 * AN AGENT PROPOSED FOR A ROLE BY ITS KEEPER, the member door's agent side
 * (0374; the lead, 11 Nov 2026: humans AND agents can apply for and fill
 * roles). Registered by server/routes/openProposals.ts, so server/index.ts
 * keeps one line for the whole feature, and mounted under /api/governance,
 * behind `requireModule("governance")`.
 *
 *   GET  /api/governance/agent-proposals/form   the roles an agent may hold, and the agents to pick
 *   POST /api/governance/agent-proposals        the keeper proposes their agent; the circle is asked
 *
 * WHO. A signed-in member at the member rung (`terms.read`, as the member
 * door asks) who is a person. An agent account is refused: an agent never
 * proposes on its own say. The keeper says "I keep this agent", and is
 * recorded on the proposal as its keeper.
 *
 * WHAT IT SKIPS. References, the background check, the confidentiality
 * signature, the character picker and personal details are a person's. An
 * agent's proposal carries what it is, who keeps it, what it can reach (read
 * from its live tokens, never typed) and how to switch it off.
 *
 * THEN. It is an ordinary open proposal, confirmed at once (the keeper is
 * signed in), so `confirmAndAsk` asks the circle and `tellTheCircle` tells the
 * holders of the power that seats people. The decision is the decider page's
 * (server/routes/openProposalDecide.ts). No AI selects, ranks or scores it.
 */
import crypto from "node:crypto";
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { AGENT_PROPOSAL_WORDS as W, mayHold, parseAgentProposal, scopeWords } from "../../shared/agentHolders";
import { OPEN_AIM_MAX, OPEN_NAME_MAX, OPEN_NOTE_MAX, OPEN_PROPOSAL_MAX_ROLES, OPEN_WHY_MAX } from "../../shared/openProposals";
import { openProposalHref } from "../../shared/openProposalDecide";
import type { OpenProposalTerm } from "../../shared/openProposalTerm";
import type { AppDeps } from "../lib/appDeps";
import { confirmAndAsk, tellTheCircle } from "../lib/openProposalDecide";
import { listOrgRoles } from "../lib/orgChart";
import { agentsWithReach, isAgentAccount } from "../repos/agentAccounts";
import * as store from "../repos/openProposals";

const BASE = "/api/governance/agent-proposals";
const MEMBERS_ONLY = { error: "members_only", message: W.membersOnly };

export interface AgentProposalHelpers {
  /** What a proposal sent now is for, the open form's own target. */
  target(): Promise<{ season: { id: string; name: string | null; startsOn: string }; term: OpenProposalTerm | null } | null>;
  /** The roles the village fills now, the open form's own list. */
  offered(): Promise<Array<{ id: string; name: string; circle: string; aim: string | null }>>;
  /** The decision's work, as the confirm step hands it to `confirmAndAsk` and `tellTheCircle`. */
  decide: Parameters<typeof confirmAndAsk>[0] & Parameters<typeof tellTheCircle>[0];
  now(): Date;
}

type Deps = Pick<AppDeps, "getPool" | "authedUser" | "guardCapability" | "overLimit">;

export function registerAgentProposals(app: Express, deps: Deps, h: AgentProposalHelpers): void {
  const { getPool, authedUser, guardCapability, overLimit } = deps;

  /** A signed-in member who is a person, or null after answering. */
  async function keeper(req: any, res: any): Promise<any | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: W.signIn });
      return null;
    }
    if (!(await guardCapability(req, res, "terms.read", { status: 403, body: MEMBERS_ONLY }))) return null;
    if (await isAgentAccount(getPool(), String(user.id))) {
      res.status(403).json({ error: "person_only", message: W.notByAnAgent });
      return null;
    }
    return user;
  }

  /** The roles on offer with what each card says about who may hold it. */
  async function rolesForAgents(pool: Pool) {
    const offered = await h.offered();
    const heldBy = new Map((await listOrgRoles(pool)).map((r) => [r.id, r.heldBy ?? null]));
    return offered.map((r) => ({ ...r, heldBy: heldBy.get(r.id) ?? null, agentMayHold: mayHold(heldBy.get(r.id) ?? null, "agent") }));
  }

  app.get(`${BASE}/form`, async (req, res) => {
    const user = await keeper(req, res);
    if (!user) return;
    const pool = getPool();
    const t = await h.target();
    const roles = (await rolesForAgents(pool)).filter((r) => r.agentMayHold);
    const agents = (await agentsWithReach(pool)).map((a) => ({ id: a.id, name: a.name, reach: a.scopes.map((s) => ({ scope: s, words: scopeWords(s) })) }));
    res.set("Cache-Control", "no-store").json({
      season: t?.season ?? null,
      term: t?.term ?? null,
      roles: t ? roles.map((r) => ({ id: r.id, name: r.name, circle: r.circle, aim: r.aim })) : [],
      agents,
      keeper: { id: String(user.id), name: String(user.name ?? "") },
      switchOffPlatform: W.switchOffPlatform,
      ...(t ? {} : { message: W.noSeason }),
      ...(agents.length ? {} : { noAgents: W.noAgents }),
    });
  });

  app.post(BASE, async (req, res) => {
    const user = await keeper(req, res);
    if (!user) return;
    const keeperId = String(user.id);
    if (await overLimit(`agent-proposal:${keeperId}`, 5, 60 * 60_000)) return res.status(429).json({ error: W.tooMany });
    const pool = getPool();
    const t = await h.target();
    if (!t) return res.status(409).json({ error: W.noSeason });
    const parsed = parseAgentProposal(req.body, {
      roles: await rolesForAgents(pool),
      maxRoles: OPEN_PROPOSAL_MAX_ROLES,
      noteMax: OPEN_NOTE_MAX,
      whyMax: OPEN_WHY_MAX,
      aimMax: OPEN_AIM_MAX,
    });
    if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error, field: parsed.field });
    const v = parsed.value;
    // The agent is an agent account here, read now; its name is the account's.
    const [agent] = await agentsWithReach(pool, v.agentUserId);
    if (!agent) return res.status(400).json({ error: W.notAnAgent, field: "agent" });
    const at = h.now();
    const id = `op-${crypto.randomBytes(10).toString("hex")}`;
    const confirmHash = crypto.createHash("sha256").update(crypto.randomBytes(24)).digest("hex");
    await store.insertOpenProposal(pool, {
      id,
      name: agent.name.slice(0, OPEN_NAME_MAX),
      email: null,
      emailKey: null,
      targetSeasonId: t.season.id,
      body: {
        roles: v.roles,
        why: v.why,
        aim: v.aim,
        ...(t.term ? { term: t.term } : {}),
        agent: { agentUserId: agent.id, name: agent.name, what: v.what, switchOff: v.switchOff, keeperUserId: keeperId },
      },
      confirmHash,
      linkId: null,
      now: at,
    });
    // Confirmed at once, and the circle asked in the same transaction, as a person's confirm link does.
    const confirmed = await confirmAndAsk(h.decide, confirmHash, new Date(at.getTime() - 60_000), at);
    if (!confirmed) {
      await store.deleteOpenProposal(pool, id);
      return res.status(409).json({ error: W.needAgent });
    }
    await tellTheCircle(h.decide, confirmed);
    res.json({ sent: true, id, href: openProposalHref(id), message: W.sent });
  });
}
