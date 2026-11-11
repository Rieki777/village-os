/**
 * HUMANS AND AGENTS FILL ROLES (0374), over real HTTP and the S5 scratch
 * schema: an agent proposed by its keeper through the member door, decided by
 * the circle on the decider page, and seated through the one agent seating
 * path. What is pinned:
 *
 *   - PROPOSING: a member who is a person, never signed out, never below the
 *     member rung, never an agent account; the keeper says they keep it and is
 *     recorded; a role whose card says "a person" refuses an agent.
 *   - THE SAME DECISION: the circle is asked, the keeper is not; the page shows
 *     what the agent is, who keeps it, its reach and how to switch it off, and
 *     none of a person's About-you parts.
 *   - DECIDING STAYS HUMAN: the keeper never adopts their own agent; an agent
 *     account never adopts; adoption needs `org.seatAgent` too, and seats the
 *     agent as a documented holder with no account and its keeper beside it.
 *   - NO PAY: the moon settlement's seat count does not move for it.
 *   - The card's word holds at the one seating write, both ways.
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { AGENT_PROPOSAL_WORDS, HELD_BY_REFUSAL } from "../../shared/agentHolders";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { ensureVoiceToken, mintView } from "../lib/economy";
import { loadTokenRegistry } from "../lib/ledger";
import { createOrgRole, listOrgAssignments, seatHolder } from "../lib/orgChart";
import { loadVariables } from "../lib/variables";
import { readOpenProposal } from "../repos/openProposals";
import { usersRepo } from "../repos/users";
import { register } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[agentRoleProposals] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2037-01-01", endsOn: "2037-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2037-01-01" };
const FOUNDER = { id: "u-founder", name: "Fern Oak", email: "founder@example.test" };
const ANA = { id: "u-ana", name: "Ana Reed", email: "ana@example.test" };
const KEEPER = { id: "u-keeper", name: "Kai Stone", email: "kai@example.test" };
const GUEST = { id: "u-guest", name: "Gil Way", email: "gil@example.test" };
const SCRIBE = { id: "u-scribe-agent", name: "Scribe", email: "scribe-agent@example.test" };
const OTHER_AGENT = { id: "u-other-agent", name: "Ledger Bot", email: "ledger-agent@example.test" };

describe.skipIf(!configured)("an agent proposed for a role by its keeper, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let secretary = "";
  let gate = "";
  let founderRole = "";

  const state = {
    viewer: null as string | null,
    guests: [GUEST.id] as string[],
    powerHolders: [FOUNDER.id] as string[],
    /** Who holds `org.seatAgent`. */
    seatAgent: [FOUNDER.id] as string[],
    notices: [] as Array<{ userId: string; type: string; title: string; dedupeKey: string }>,
  };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    const users = usersRepo(pool);
    for (const p of [FOUNDER, ANA, KEEPER, GUEST, SCRIBE, OTHER_AGENT]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("UPDATE users SET is_agent = 1 WHERE id IN (?)", [[SCRIBE.id, OTHER_AGENT.id]]);
    // The agent's reach is read from its live tokens, never typed.
    await q(
      "INSERT INTO agent_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at) VALUES ('tok-1', ?, 'scribe', ?, 'vat_abcdef', ?, DATE_ADD(NOW(), INTERVAL 30 DAY))",
      [SCRIBE.id, "a".repeat(64), JSON.stringify(["moon.read", "roles.read"])],
    );
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-core', 'Core Circle', '[]', 0)");
    secretary = await createOrgRole(pool, { id: "arp-role-secretary", name: "Secretary", seats: 2, circleId: "c-core", aim: "Keep the village's memory." });
    gate = await createOrgRole(pool, { id: "arp-role-gate", name: "Gate Keeper", seats: 2, circleId: "c-core", aim: "Open the gate at dawn." });
    founderRole = await createOrgRole(pool, { id: "arp-role-founder", name: "Founder", seats: 1, circleId: "c-core", aim: "Hold the village." });
    const until = new Date("2036-12-01T00:00:00Z");
    await seatHolder(pool, founderRole, { userId: FOUNDER.id, seasonId: "s-now", termEndsAt: until });
    await seatHolder(pool, gate, { userId: ANA.id, seasonId: "s-now", termEndsAt: until });
    await seatHolder(pool, gate, { userId: KEEPER.id, seasonId: "s-now", termEndsAt: until });

    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      overLimit: async () => false,
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: unknown }) => {
        const v = state.viewer;
        const ok = !!v && (cap === "terms.read" ? !state.guests.includes(v) : cap === "org.seatAgent" ? state.seatAgent.includes(v) : v === FOUNDER.id);
        if (ok) return true;
        if (refusal) res.status(refusal.status).json(refusal.body);
        else res.status(v ? 403 : 401).json({ error: v ? "forbidden" : "auth_required" });
        return false;
      },
      authedUser: async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null),
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => "https://village.example.test",
      projectName: () => "Test Village",
      escapeHtml,
      seasonState: () => ({ current: NOW_SEASON, seasons: [NOW_SEASON, NEXT], timezone: "UTC" }),
      postEmail: async (_email: OutgoingEmail) => ({ status: "sent", messageId: "m-1" }) as PostResult,
      governanceLifecycle: () => "public",
      notify: async (n: any) => {
        state.notices.push(n);
        return { fresh: true };
      },
      notifyAdmins: async () => undefined,
      members: usersRepo(pool),
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      liveHoldersOf: async () => state.powerHolders,
      rolesCarrying: () => [{ id: founderRole, name: "Founder" }],
      loadRoleHolders: () => [{ roleId: founderRole, userId: FOUNDER.id }],
      seatCalendar: () => ({ seasons: [NOW_SEASON, NEXT], currentSeasonId: "s-now", timezone: "UTC" }),
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async () => "member",
      recordStageEvent: async () => undefined,
      sessionsOn: () => false,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.viewer = null;
    state.guests = [GUEST.id];
    state.powerHolders = [FOUNDER.id];
    state.seatAgent = [FOUNDER.id];
    state.notices.length = 0;
    await q("UPDATE org_roles SET held_by = NULL");
    // Each case starts with no agent proposed and no agent seated, so one case's record of keeping is not the next one's.
    await q("DELETE FROM open_role_proposals");
    await q("UPDATE org_role_assignments SET ended_at = NOW(), ended_reason = 'test reset' WHERE is_agent = 1 AND ended_at IS NULL");
  });

  const call = async (method: string, path: string, body: unknown, as: string | null) => {
    state.viewer = as;
    const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const proposal = (over: Record<string, unknown> = {}) => ({
    agentUserId: SCRIBE.id,
    keeper: true,
    what: "A note-taking agent that keeps the minutes of every circle meeting.",
    switchOff: "Revoke its token in Admin, Agents, or tell me and I will turn it off within the hour.",
    why: "It already keeps our minutes and the circle wants it seated where everybody can see it.",
    roles: [{ roleId: secretary, note: "Minutes within a day of each meeting." }],
    ...over,
  });
  const propose = (over: Record<string, unknown> = {}, as: string | null = KEEPER.id) => call("POST", "/api/governance/agent-proposals", proposal(over), as);

  describe("proposing an agent", () => {
    it("is refused signed out, below the member rung, and from an agent account", async () => {
      expect((await propose({}, null)).status).toBe(401);
      const guest = await propose({}, GUEST.id);
      expect(guest.status).toBe(403);
      expect(guest.body.message).toBe(AGENT_PROPOSAL_WORDS.membersOnly);
      const byAgent = await propose({ agentUserId: OTHER_AGENT.id }, SCRIBE.id);
      expect(byAgent.status).toBe(403);
      expect(byAgent.body.message).toBe(AGENT_PROPOSAL_WORDS.notByAnAgent);
    });

    it("needs its keeper to say they keep it", async () => {
      const r = await propose({ keeper: undefined });
      expect(r.status).toBe(400);
      expect(r.body.field).toBe("keeper");
    });

    it("refuses a role whose card says a person holds it, and an account that is not an agent's", async () => {
      await q("UPDATE org_roles SET held_by = 'person' WHERE id = ?", [secretary]);
      const r = await propose();
      expect(r.status).toBe(409);
      expect(r.body.error).toBe(AGENT_PROPOSAL_WORDS.personOnly);
      await q("UPDATE org_roles SET held_by = NULL WHERE id = ?", [secretary]);
      const notAgent = await propose({ agentUserId: ANA.id });
      expect(notAgent.status).toBe(400);
      expect(notAgent.body.field).toBe("agent");
    });

    it("offers only roles an agent may hold, and the agents with their reach", async () => {
      await q("UPDATE org_roles SET held_by = 'person' WHERE id = ?", [gate]);
      const r = await call("GET", "/api/governance/agent-proposals/form", undefined, KEEPER.id);
      expect(r.status).toBe(200);
      const ids = r.body.roles.map((x: any) => x.id);
      expect(ids).toContain(secretary);
      expect(ids).not.toContain(gate);
      const scribe = r.body.agents.find((a: any) => a.id === SCRIBE.id);
      expect(scribe.reach.map((x: any) => x.scope)).toEqual(["moon.read", "roles.read"]);
    });

    it("records the keeper, asks the circle and never the keeper, and shows the agent's parts only", async () => {
      const r = await propose();
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const stored = await readOpenProposal(pool, r.body.id);
      expect(stored?.status).toBe("confirmed");
      expect(stored?.body.agent).toMatchObject({ agentUserId: SCRIBE.id, keeperUserId: KEEPER.id, name: SCRIBE.name });
      expect(stored?.email).toBeNull();
      const asked = (await q("SELECT user_id FROM role_proposal_asks WHERE proposal_id = ?", [r.body.id])).map((x: any) => x.user_id).sort();
      expect(asked).toEqual([ANA.id, FOUNDER.id].sort());
      expect(asked).not.toContain(KEEPER.id);
      const page = await call("GET", `/api/governance/open-proposals/${r.body.id}`, undefined, ANA.id);
      expect(page.status).toBe(200);
      expect(page.body.proposal.agent).toMatchObject({ name: SCRIBE.name, keeper: KEEPER.name, stillAnAgent: true });
      expect(page.body.proposal.agent.reach.map((x: any) => x.scope)).toEqual(["moon.read", "roles.read"]);
      expect(page.body.proposal.aboutYou).toBeNull();
      expect(page.body.proposal.membership).toBeNull();
    });
  });

  describe("the member door holds to the record (verify B153, B8)", () => {
    it("refuses the same agent for the same role while the first proposal waits, and for a role it already holds", async () => {
      expect((await propose()).status).toBe(200);
      const again = await propose();
      expect(again.status).toBe(409);
      expect(again.body.field).toBe("roles");
      expect(again.body.roles).toEqual([secretary]);
      expect(again.body.error).toBe(AGENT_PROPOSAL_WORDS.alreadyAsked("Secretary"));
      // A different role for the same agent is a new question for the circle.
      expect((await propose({ roles: [{ roleId: gate, note: "" }] })).status).toBe(200);
      // Seated already: refused for that role too.
      await q("DELETE FROM open_role_proposals");
      await seatHolder(pool, secretary, { isAgent: true, agentSlug: "scribe", displayName: SCRIBE.name, keeperUserId: KEEPER.id });
      const held = await propose();
      expect(held.status).toBe(409);
      expect(held.body.roles).toEqual([secretary]);
    });

    it("offers and accepts only an agent this member keeps, or one nobody is recorded as keeping", async () => {
      // Nobody keeps either agent on the record yet: both are offered to any member.
      const open = await call("GET", "/api/governance/agent-proposals/form", undefined, ANA.id);
      expect(open.body.agents.map((a: any) => a.id).sort()).toEqual([OTHER_AGENT.id, SCRIBE.id].sort());
      // Kai proposes Scribe: the record now says Kai keeps it.
      expect((await propose()).status).toBe(200);
      const ana = await call("GET", "/api/governance/agent-proposals/form", undefined, ANA.id);
      expect(ana.body.agents.map((a: any) => a.id)).toEqual([OTHER_AGENT.id]);
      const claim = await propose({ roles: [{ roleId: gate, note: "" }] }, ANA.id);
      expect(claim.status).toBe(403);
      expect(claim.body.error).toBe(AGENT_PROPOSAL_WORDS.keptByAnother);
      // Kai still may, for another role.
      const kai = await call("GET", "/api/governance/agent-proposals/form", undefined, KEEPER.id);
      expect(kai.body.agents.map((a: any) => a.id)).toContain(SCRIBE.id);
      // A seating that names its keeper is a record too.
      const seatedBot = await seatHolder(pool, secretary, { isAgent: true, agentSlug: "ledger-bot", displayName: OTHER_AGENT.name, keeperUserId: FOUNDER.id });
      expect(seatedBot.ok).toBe(true);
      const kaiNow = await call("GET", "/api/governance/agent-proposals/form", undefined, KEEPER.id);
      expect(kaiNow.body.agents.map((a: any) => a.id)).not.toContain(OTHER_AGENT.id);
      const seized = await propose({ agentUserId: OTHER_AGENT.id }, KEEPER.id);
      expect(seized.status).toBe(403);
      expect(seized.body.error).toBe(AGENT_PROPOSAL_WORDS.keptByAnother);
    });

    it("never shows a person's terms to the deciders, and refuses a counter-offer on an agent", async () => {
      const { body } = await propose();
      const page = await call("GET", `/api/governance/open-proposals/${body.id}`, undefined, FOUNDER.id);
      expect(page.status).toBe(200);
      expect(page.body.proposal.offer).toBeNull();
      expect(page.body.proposal.you.mayEditTerms).toBe(false);
      const counter = await call("POST", `/api/governance/open-proposals/${body.id}/terms`, { words: { allowance: "Paid for." }, commitmentPct: 50, expectedRevision: 0 }, FOUNDER.id);
      expect(counter.status).toBe(409);
      expect(counter.body.error).toBe("no_terms_for_an_agent");
    });
  });

  describe("adopting an agent", () => {
    it("is never the keeper's or an agent's, needs org.seatAgent, and seats the agent with its keeper and no account", async () => {
      const { body } = await propose();
      const id = body.id as string;
      // The keeper holds org.seat here too, and still never decides their own agent.
      state.powerHolders = [FOUNDER.id, KEEPER.id];
      const own = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, KEEPER.id);
      expect(own.status).toBe(403);
      expect(own.body.error).toBe("own_proposal");
      // An agent account holding the power still never adopts.
      state.powerHolders = [FOUNDER.id, OTHER_AGENT.id];
      state.seatAgent = [FOUNDER.id, OTHER_AGENT.id];
      const byAgent = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, OTHER_AGENT.id);
      expect(byAgent.status).toBe(403);
      expect(byAgent.body.message).toBe(AGENT_PROPOSAL_WORDS.agentNeverDecides);
      // Without org.seatAgent: refused, nothing written.
      state.seatAgent = [];
      const noPower = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(noPower.status).toBe(403);
      expect((await readOpenProposal(pool, id))?.status).toBe("confirmed");

      const seatsBefore = (await mintView(pool)).settlementPreview.seats;
      state.seatAgent = [FOUNDER.id];
      const ok = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: "adopted", agent: true, seated: 1 });
      const seating = (await listOrgAssignments(pool)).find((a) => a.orgRoleId === secretary && !a.endedAt);
      expect(seating).toMatchObject({ isAgent: true, holderKind: "documented", userId: null, keeperUserId: KEEPER.id, holderKey: "agent:scribe" });
      expect(state.notices.some((n) => n.userId === KEEPER.id && n.dedupeKey === `op:${id}:adopted:keeper`)).toBe(true);

      // NO PAY THROUGH THE MOON SETTLEMENT: the seats it would pay are the same before and after the agent sits.
      expect((await mintView(pool)).settlementPreview.seats).toBe(seatsBefore);
      const paid = await q(
        "SELECT a.id FROM org_role_assignments a WHERE a.active_holder_key IS NOT NULL AND a.holder_kind = 'member' AND a.user_id IS NOT NULL AND a.is_example = 0 AND a.org_role_id = ?",
        [secretary],
      );
      expect(paid).toEqual([]);
    });
  });

  describe("the card's word holds where every door seats", () => {
    it("refuses an agent on a person's role and a person on an agent's role, and an unsaid card takes either", async () => {
      await q("UPDATE org_roles SET held_by = 'person' WHERE id = ?", [gate]);
      const agentOnPerson = await seatHolder(pool, gate, { isAgent: true, agentSlug: "ledger-bot", displayName: "Ledger Bot" });
      expect(agentOnPerson).toEqual({ ok: false, reason: HELD_BY_REFUSAL.agent });
      await q("UPDATE org_roles SET held_by = 'agent' WHERE id = ?", [gate]);
      const personOnAgent = await seatHolder(pool, gate, { userId: FOUNDER.id });
      expect(personOnAgent).toEqual({ ok: false, reason: HELD_BY_REFUSAL.person });
      await q("UPDATE org_roles SET held_by = NULL WHERE id = ?", [gate]);
      const either = await seatHolder(pool, gate, { isAgent: true, agentSlug: "ledger-bot", displayName: "Ledger Bot" });
      expect(either.ok).toBe(true);
      // A keeper rides only on an agent's seating.
      const keeperOnPerson = await seatHolder(pool, gate, { userId: FOUNDER.id, keeperUserId: KEEPER.id });
      expect(keeperOnPerson.ok).toBe(false);
    });
  });
});
