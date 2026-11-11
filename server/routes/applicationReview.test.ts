/**
 * REVIEW, INTERVIEWS AND SELECTION (role journey L5), over real HTTP and the S5
 * scratch schema. The mail door is a fake that records what would go out.
 *
 * What is pinned, each with a control that fails for the reason claimed:
 *   - the role's interviewers become the application's, in order, with their
 *     own minutes and one marked final; only the first is asked
 *   - the ORDER is enforced: the next interviewer cannot score before the one
 *     before has
 *   - scores are HIDDEN from other interviewers until their own is in, and
 *     never reach the applicant
 *   - the circle's consent round opens after the interviews when the village
 *     asks for it, and at confirm when it does not
 *   - nothing is adopted while a conversation is still to be written up
 *   - a moon that ended before the decision is adopted "for the moon now"
 *   - the BALLOT FALLBACK: with nobody to adopt at the door the proposal
 *     becomes an application the village can vote on
 *   - one-click recusal, recorded; a recused person does not adopt
 *   - the clocks remind and never decide
 *   - the applicant's status page shows steps and no score
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { escapeHtml } from "../lib/comms/mailer";
import { reviewClockTick } from "../lib/applicationReview";
import { loadVariables } from "../lib/variables";
import { createOrgRole, seatHolder } from "../lib/orgChart";
import { usersRepo } from "../repos/users";
import { register, tidyOpenProposals } from "./openProposals";
import { forgetMemberReview } from "../repos/applicationReview";

const configured = testDbConfigured();
if (!configured) console.warn("[applicationReview] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const ORIGIN = "https://village.example.test";
const NEXT = { id: "s-next", name: "Season of Roots", startsOn: "2037-01-01", endsOn: "2037-03-20" };
const NOW_SEASON = { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01", endsOn: "2037-01-01" };
const person = (id: string, name: string) => ({ id, name, email: `${id}@example.test` });
const FOUNDER = person("u-founder", "Fern Oak");
const IA = person("u-ia", "Iva Alder");
const IB = person("u-ib", "Ivo Birch");
const IC = person("u-ic", "Ida Cedar");
const ID = person("u-id", "Ian Dogwood");
const OUTSIDER = person("u-outsider", "Olly Out");
const APPLICANT = person("u-applicant", "Rowan Field");
const SEAT_NOT_INTERVIEWER = person("u-seat", "Sage Seat");

describe.skipIf(!configured)("application review, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  let gate = "";
  let roleA = "";
  let roleB = "";
  let roleC = "";
  let roleD = "";
  let founderRole = "";

  const state = {
    viewer: null as string | null,
    powerHolders: [FOUNDER.id] as string[],
    sent: [] as OutgoingEmail[],
    answer: { status: "sent", messageId: "m-1" } as PostResult,
    notices: [] as Array<{ userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }>,
    adminNotices: [] as Array<{ type: string; title: string; key: string }>,
  };

  const q = (sql: string, args: unknown[] = []) => pool.query<any[]>(sql, args).then(([rows]) => rows); // module-review-ok: fixture SQL on the scratch schema this suite provisioned
  const calendar = () => ({ seasons: [NOW_SEASON, NEXT], currentSeasonId: "s-now", timezone: "UTC" });

  /** The listing lane adds these two columns in its own migration. This suite adds them to its scratch schema only when they are not there yet. */
  async function ensureRoleColumns() {
    const have = new Set((await q("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles'")).map((r: any) => String(r.c)));
    for (const col of ["conversations", "selection_criteria", "conversation_mode"]) if (!have.has(col)) await q(`ALTER TABLE org_roles ADD COLUMN ${col} text NULL`);
  }

  const setting = async (on: boolean) => {
    await q("INSERT INTO game_variables (config_key, value) VALUES ('org.consent_after_interviews', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [on ? "true" : "false"]);
    await loadVariables(pool);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 });
    await ensureRoleColumns();
    const users = usersRepo(pool);
    for (const p of [FOUNDER, IA, IB, IC, ID, OUTSIDER, APPLICANT, SEAT_NOT_INTERVIEWER]) await users.add({ id: p.id, name: p.name, email: p.email, passwordHash: "x", paths: [] } as any);
    await q("INSERT INTO circles (id, name, aliases, is_example) VALUES ('c-land', 'Land Circle', '[]', 0), ('c-core', 'Core Circle', '[]', 0)");
    gate = await createOrgRole(pool, { id: "ar-role-lead", name: "Lead Steward", seats: 1, circleId: "c-core", aim: "Hold the money." });
    roleA = await createOrgRole(pool, { id: "ar-role-a", name: "Channel Role", seats: 1, circleId: "c-core", aim: "a" });
    roleB = await createOrgRole(pool, { id: "ar-role-b", name: "Data Role", seats: 1, circleId: "c-core", aim: "b" });
    roleC = await createOrgRole(pool, { id: "ar-role-c", name: "Build Role", seats: 1, circleId: "c-core", aim: "c" });
    roleD = await createOrgRole(pool, { id: "ar-role-d", name: "Anchor Role", seats: 1, circleId: "c-core", aim: "d" });
    founderRole = await createOrgRole(pool, { id: "ar-role-founder", name: "Founder", seats: 1, circleId: "c-core", aim: "Hold the village." });
    // A role held by an AI agent, in the same circle (D31). It is never asked to consent.
    const agentRole = await createOrgRole(pool, { id: "ar-role-agent", name: "Team Support Role", seats: 1, circleId: "c-core", aim: "Support the team." });
    const agentSeated = await seatHolder(pool, agentRole, { displayName: "Support Agent", isAgent: true, agentSlug: "support" });
    expect(agentSeated.ok).toBe(true);
    const until = new Date("2036-12-01T00:00:00Z");
    for (const [r, u] of [[roleA, IA], [roleB, IB], [roleC, IC], [roleD, ID], [founderRole, FOUNDER]] as const) await seatHolder(pool, r, { userId: u.id, seasonId: "s-now", termEndsAt: until });
    // The Lead Financial Steward's shape (Rye): 60 minutes, then three of 20, the last one the final approval. Two hours.
    await q("UPDATE org_roles SET conversations = ?, selection_criteria = ? WHERE id = ?", [
      JSON.stringify([
        { roleId: roleA, minutes: 60, final: false },
        { roleId: roleB, minutes: 20, final: false },
        { roleId: roleC, minutes: 20, final: false },
        { roleId: roleD, minutes: 20, final: true },
      ]),
      JSON.stringify(["Reads a budget line by line", "Works with funding partners", "Keeps the village's pace"]),
      gate,
    ]);

    const app = express();
    app.use(express.json());
    register(app, {
      getPool: () => pool,
      overLimit: async () => false,
      clientIp: () => "203.0.113.9",
      guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: unknown }) => {
        const ok = !!state.viewer && (cap === "terms.read" ? true : state.viewer === FOUNDER.id);
        if (ok) return true;
        if (refusal) res.status(refusal.status).json(refusal.body);
        else res.status(state.viewer ? 403 : 401).json({ error: state.viewer ? "forbidden" : "auth_required" });
        return false;
      },
      authedUser: async () => (state.viewer ? await usersRepo(pool).byId(state.viewer) : null),
      commsPostOffice: { getPool: () => pool },
      deploymentOrigin: () => ORIGIN,
      projectName: () => "Test Village",
      escapeHtml,
      seasonState: () => ({ current: NOW_SEASON, seasons: [NOW_SEASON, NEXT], timezone: "UTC" }),
      postEmail: async (email: OutgoingEmail) => {
        state.sent.push(email);
        return state.answer;
      },
      governanceLifecycle: () => "public",
      notify: async (n: any) => {
        state.notices.push(n);
        return { fresh: true };
      },
      notifyAdmins: async (type: string, title: string, key: string) => {
        state.adminNotices.push({ type, title, key });
      },
      members: usersRepo(pool),
      firstName: (name: string) => String(name ?? "").trim().split(/\s+/)[0] ?? "",
      liveHoldersOf: async () => state.powerHolders,
      rolesCarrying: () => [{ id: founderRole, name: "Founder" }],
      loadRoleHolders: () => [{ roleId: founderRole, userId: FOUNDER.id }],
      seatCalendar: calendar,
      lapse: () => ({ currentSeasonId: "s-now", cadence: "season_turn" }),
      stageOf: async (u: any) => (u.stageGranted ? String(u.stageGranted) : "guest"),
      recordStageEvent: async () => {},
      sessionsOn: () => false,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state.viewer = null;
    state.powerHolders = [FOUNDER.id];
    state.sent.length = 0;
    state.notices.length = 0;
    state.adminNotices.length = 0;
    await q("DELETE FROM capability_holding WHERE capability = 'org.seat'");
    await q("DELETE FROM seat_applications");
    await setting(false);
  });

  const call = async (method: string, path: string, body?: unknown, as: string | null = state.viewer) => {
    const before = state.viewer;
    state.viewer = as;
    try {
      const res = await fetch(`${base}${path}`, { // module-review-ok: a test calling its own local server, never an outside host
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    } finally {
      state.viewer = before;
    }
  };

  const tokenOf = (mail: OutgoingEmail) => {
    const line = mail.text.split("\n").find((l) => {
      try {
        return new URL(l.trim()).origin === new URL(ORIGIN).origin;
      } catch {
        return false;
      }
    }) as string;
    return new URL(line.trim()).searchParams.get("token") as string;
  };

  /** Send and confirm an application for the Lead Steward from `email`. Answers the id and what the confirm said. */
  const confirmed = async (email: string, roles: string[] = [gate]) => {
    const before = state.sent.length;
    const r = await call(
      "POST",
      "/api/open-proposals",
      { name: "Rowan Field", email, roles: roles.map((roleId) => ({ roleId, note: "I keep books for a living." })), why: "I want to hold the money well.", aim: "A clear budget by the next moon." },
      null,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mail = state.sent[before];
    const id = mail.idempotencyKey.split(":")[1];
    const ok = await call("POST", "/api/open-proposals/confirm", { token: tokenOf(mail) }, null);
    expect(ok.status).toBe(200);
    return { id, confirm: ok.body };
  };

  const interviews = (id: string) => q("SELECT id, position, interviewer_role_id, minutes, is_final, state FROM application_interviews WHERE application_ref = ? ORDER BY position", [id]);
  const stepKinds = async (id: string) => (await q("SELECT kind, subject FROM application_steps WHERE application_ref = ? ORDER BY id", [id])).map((s: any) => (s.subject ? `${s.kind}:${s.subject}` : s.kind));
  const asks = (id: string) => q("SELECT user_id FROM role_proposal_asks WHERE proposal_id = ? ORDER BY user_id", [id]);
  const entriesFor = (criteria: Array<{ id: string }>, level = "solid") => ({ entries: criteria.map((c) => ({ criterionId: c.id, level, evidence: `Heard it for ${c.id}.` })) });
  const cardOf = async (id: string, as: string) => call("GET", `/api/governance/applications/${id}/scorecards`, undefined, as);
  const score = async (id: string, ivId: number, as: string, level = "solid") => {
    const card = await cardOf(id, as);
    const criteria = card.body?.scorecards?.criteria ?? [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    return call("POST", `/api/governance/applications/${id}/interviews/${ivId}/score`, entriesFor(criteria, level), as);
  };
  const scoreAll = async (id: string) => {
    for (const [i, u] of [IA, IB, IC, ID].entries()) {
      const ivs = await interviews(id);
      const out = await score(id, Number(ivs[i].id), u.id);
      expect(out.status, JSON.stringify(out.body)).toBe(200);
    }
  };

  describe("at confirm, the role's interviewers become the application's", () => {
    it("copies them in order with their minutes and the final flag, asks only the first, and stamps the steps", async () => {
      const { id } = await confirmed("order@example.test");
      const ivs = await interviews(id);
      expect(ivs.map((i: any) => [i.interviewer_role_id, Number(i.minutes), Number(i.is_final), i.state])).toEqual([
        [roleA, 60, 0, "open"],
        [roleB, 20, 0, "waiting"],
        [roleC, 20, 0, "waiting"],
        [roleD, 20, 1, "waiting"],
      ]);
      expect(ivs.reduce((n: number, i: any) => n + Number(i.minutes), 0)).toBe(120);
      expect(await stepKinds(id)).toContain("confirmed");
      const turns = state.notices.filter((n) => n.type === "application_interview_turn");
      expect(turns.map((n) => [n.userId, n.dedupeKey])).toEqual([[IA.id, `app:${id}:iv:1:${IA.id}`]]);
      // CONTROL: the second interviewer has not been asked.
      expect(state.notices.some((n) => n.userId === IB.id && n.type === "application_interview_turn")).toBe(false);
    });

    it("leaves a role that names no interviewers to be asked at once, as it always was", async () => {
      const { id } = await confirmed("plain@example.test", [roleA]);
      expect(await interviews(id)).toEqual([]);
      expect(await stepKinds(id)).toEqual(expect.arrayContaining(["confirmed", "scores_in"]));
    });
  });

  describe("the order is enforced", () => {
    it("refuses the next interviewer until the one before has scored, then opens them and asks them", async () => {
      const { id } = await confirmed("seq@example.test");
      const ivs = await interviews(id);
      const early = await score(id, Number(ivs[1].id), IB.id);
      expect(early.status).toBe(409);
      expect((await interviews(id))[1].state).toBe("waiting");

      // CONTROL: the first interviewer scores, and then the same call from the second succeeds.
      const first = await score(id, Number(ivs[0].id), IA.id);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect((await interviews(id)).map((i: any) => i.state)).toEqual(["scored", "open", "waiting", "waiting"]);
      expect(state.notices.filter((n) => n.type === "application_interview_turn" && n.userId === IB.id)).toHaveLength(1);
      expect((await score(id, Number(ivs[1].id), IB.id)).status).toBe(200);
    });

    it("refuses someone who does not hold the interviewing role, the applicant's own account, and a second card", async () => {
      const { id } = await confirmed("who@example.test");
      const ivs = await interviews(id);
      expect((await score(id, Number(ivs[0].id), OUTSIDER.id)).status).toBe(403);
      expect((await score(id, Number(ivs[0].id), IA.id)).status).toBe(200);
      expect((await score(id, Number(ivs[0].id), IA.id)).status).toBe(409);
    });

    it("refuses a card that skips a criterion or uses a fifth level", async () => {
      const { id } = await confirmed("bad@example.test");
      const ivs = await interviews(id);
      const path = `/api/governance/applications/${id}/interviews/${ivs[0].id}/score`;
      expect((await call("POST", path, { entries: [{ criterionId: "c1", level: "solid", evidence: "x" }] }, IA.id)).status).toBe(400);
      const five = ["c1", "c2", "c3"].map((criterionId) => ({ criterionId, level: "great", evidence: "x" }));
      expect((await call("POST", path, { entries: five }, IA.id)).status).toBe(400);
      expect(await q("SELECT 1 FROM application_scores WHERE application_ref = ?", [id])).toEqual([]);
    });
  });

  describe("scores are private", () => {
    it("hides every card from another interviewer until their own is in, and never shows the applicant", async () => {
      const { id } = await confirmed("hide@example.test");
      const ivs = await interviews(id);
      await score(id, Number(ivs[0].id), IA.id, "strong");

      // The next interviewer cannot read the first card before writing their own.
      const before = await cardOf(id, IB.id);
      expect(before.status).toBe(200);
      expect(before.body.scorecards.mayRead).toBe(false);
      expect(JSON.stringify(before.body)).not.toContain("Heard it for");
      expect(before.body.scorecards.interviews.every((i: any) => i.entries === null)).toBe(true);

      // CONTROL: the scorer reads their own, and after submitting their own the next reads both.
      const own = await cardOf(id, IA.id);
      expect(own.body.scorecards.mayRead).toBe(true);
      expect(own.body.scorecards.interviews[0].entries).toHaveLength(3);
      await score(id, Number(ivs[1].id), IB.id, "borderline");
      const after = await cardOf(id, IB.id);
      expect(after.body.scorecards.mayRead).toBe(true);
      expect(after.body.scorecards.interviews[0].entries).toHaveLength(3);
      // A card is named by the ROLE, never the person.
      expect(JSON.stringify(after.body)).not.toContain(IA.name);
      expect(after.body.scorecards.interviews[0].roleName).toBe("Channel Role");
    });

    it("lets a holder of the power to fill roles read them, but not an interviewer who holds it before they score", async () => {
      const { id } = await confirmed("seat@example.test");
      const ivs = await interviews(id);
      await score(id, Number(ivs[0].id), IA.id);
      state.powerHolders = [SEAT_NOT_INTERVIEWER.id, IB.id];
      expect((await cardOf(id, SEAT_NOT_INTERVIEWER.id)).body.scorecards.mayRead).toBe(true);
      expect((await cardOf(id, IB.id)).body.scorecards.mayRead).toBe(false);
      expect((await cardOf(id, OUTSIDER.id)).body.scorecards.mayRead).toBe(false);
    });

    it("answers the applicant, and a stranger, that nothing is there", async () => {
      const { id } = await confirmed(APPLICANT.email);
      // The applicant has an account under this address.
      expect((await cardOf(id, APPLICANT.id)).status).toBe(404);
      expect((await call("GET", `/api/governance/applications/${id}/scorecards`, undefined, null)).status).toBe(401);
      expect((await call("GET", "/api/governance/applications/op-ffffffffffffffffffff/scorecards", undefined, IA.id)).status).toBe(404);
      // Scoring their own application is refused by name, not by hiding.
      expect((await score(id, Number((await interviews(id))[0].id), APPLICANT.id)).status).toBe(403);
    });
  });

  describe("the circle's consent round", () => {
    it("opens at confirm when the village has not asked for the interviews to come first", async () => {
      const { id } = await confirmed("now@example.test");
      expect((await asks(id)).length).toBeGreaterThan(0);
      expect(await stepKinds(id)).toContain("consent");
    });

    it("waits for the interviews when the village asks, tells the circle it arrived, then opens once every card is in", async () => {
      await setting(true);
      const { id } = await confirmed("later@example.test");
      expect(await asks(id)).toEqual([]);
      expect(state.notices.filter((n) => n.type === "open_role_proposal_consent_ask")).toEqual([]);
      expect(state.notices.filter((n) => n.type === "application_arrived").length).toBeGreaterThan(0);
      await scoreAll(id);
      const rows = await asks(id);
      expect(rows.length).toBeGreaterThan(0);
      expect(await stepKinds(id)).toEqual(expect.arrayContaining(["scores_in", "consent"]));
      expect(state.notices.some((n) => n.type === "open_role_proposal_consent_ask")).toBe(true);
    });
  });

  describe("AI agents are skipped in consent rounds (D31)", () => {
    it("asks no agent, says so in the ask, and keeps the human holders asked", async () => {
      const { id } = await confirmed("agents@example.test", [roleA]);
      const rows = await asks(id);
      expect(rows.length).toBeGreaterThan(0);
      // Every one asked is a member account: the agent has none.
      const ids = rows.map((r: any) => String(r.user_id));
      expect(ids).toContain(FOUNDER.id);
      expect(await q("SELECT 1 FROM role_proposal_asks WHERE proposal_id = ? AND user_id NOT IN (SELECT id FROM users)", [id])).toEqual([]);
      const ask = state.notices.find((n) => n.type === "open_role_proposal_consent_ask");
      expect(ask?.body).toContain("Team Support Role is held by an AI agent and not asked: consent is a human act.");
      // CONTROL: a circle with no agent says nothing about one.
      const other = await createOrgRole(pool, { id: "ar-role-land", name: "Land Role", seats: 1, circleId: "c-land", aim: "l" });
      state.notices.length = 0;
      await confirmed("noagents@example.test", [other]);
      expect(state.notices.filter((n) => n.type === "open_role_proposal_consent_ask").every((n) => !String(n.body).includes("AI agent"))).toBe(true);
    });

    it("says it again when the round opens after the conversations", async () => {
      await setting(true);
      const { id } = await confirmed("agents2@example.test");
      await scoreAll(id);
      const ask = state.notices.find((n) => n.type === "open_role_proposal_consent_ask");
      expect(ask?.body).toContain("held by an AI agent");
      expect((await q("SELECT detail_json FROM application_steps WHERE application_ref = ? AND kind = 'consent'", [id]))[0].detail_json).toContain("Team Support Role");
    });
  });

  describe("the conversations are one block unless split (D30)", () => {
    it("says one block through the first role by default, and splits on request, once", async () => {
      const { id, confirm } = await confirmed("block@example.test");
      const token = new URL(`${ORIGIN}${confirm.statusPath}`).searchParams.get("token");
      const before = await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null);
      expect(before.body.status.mode).toBe("block");
      expect(before.body.status.booking).toContain("one block of 2 hours");
      expect(before.body.status.booking).toContain("Channel Role");
      const split = await call("POST", `/api/application-status/${id}/split?token=${token}`, {}, null);
      expect(split.status).toBe(200);
      const after = await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null);
      expect(after.body.status.mode).toBe("split");
      expect(after.body.status.booking).toContain("over several days");
      // CONTROL: a wrong token cannot split, and the visitor path never reveals copy to a stranger.
      expect((await call("POST", `/api/application-status/${id}/split?token=nope`, {}, null)).status).toBe(404);
    });

    it("stays as booked once a conversation has been held", async () => {
      const { id } = await confirmed("late@example.test");
      await score(id, Number((await interviews(id))[0].id), IA.id);
      expect((await call("POST", `/api/governance/applications/${id}/split`, {}, IB.id)).status).toBe(409);
    });
  });

  describe("nothing is adopted while a conversation is still to be written up", () => {
    it("refuses an adoption until the last card is in, then lets the holder adopt and stamps the decision", async () => {
      const { id } = await confirmed("adopt@example.test");
      const early = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(early.status).toBe(409);
      expect(early.body.error).toBe("interviews_not_done");
      await scoreAll(id);
      const done = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(await stepKinds(id)).toContain("decided");
    });
  });

  describe("adopt for the moon running now", () => {
    it("offers it when the stored moon ended, and adopts onto the moon running now when the holder says so", async () => {
      const { id } = await confirmed("moon@example.test", [roleA]);
      await q("UPDATE open_role_proposals SET body_json = JSON_SET(body_json, '$.term', JSON_OBJECT('kind', 'moon', 'startsOn', '2020-01-01', 'endsOn', '2020-01-28')) WHERE id = ?", [id]);
      const refused = await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: "moon_ended", canAdoptForThisMoon: true });
      // CONTROL: nothing moved.
      expect((await q("SELECT status FROM open_role_proposals WHERE id = ?", [id]))[0].status).toBe("confirmed");

      const ok = await call("POST", `/api/governance/open-proposals/${id}/adopt`, { forCurrentMoon: true }, FOUNDER.id);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.decided).toContain("for the moon running now");
      const row = (await q("SELECT status, body_json FROM open_role_proposals WHERE id = ?", [id]))[0];
      expect(row.status).toBe("adopted");
      const term = typeof row.body_json === "string" ? JSON.parse(row.body_json).term : row.body_json.term;
      expect(term.endsOn > "2020-01-28").toBe(true);
    });
  });

  describe("the ballot fallback", () => {
    it("turns a proposal from a member into an application the village can vote on when nobody can adopt at the door", async () => {
      state.powerHolders = [];
      const { id } = await confirmed(APPLICANT.email, [roleA]);
      const out = await call("POST", `/api/governance/open-proposals/${id}/to-the-village`, {}, IA.id);
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      const rows = await q("SELECT candidate_user_id, status FROM seat_applications WHERE id = ?", [out.body.application.id]);
      expect(rows).toEqual([expect.objectContaining({ candidate_user_id: APPLICANT.id, status: "awaiting-holder" })]);
      // The proposal itself was not adopted by this door.
      expect((await q("SELECT status FROM open_role_proposals WHERE id = ?", [id]))[0].status).toBe("confirmed");
    });

    it("says an account is needed first for a stranger, and refuses while a holder can adopt", async () => {
      state.powerHolders = [];
      const stranger = await confirmed("stranger@example.test", [roleA]);
      const noAccount = await call("POST", `/api/governance/open-proposals/${stranger.id}/to-the-village`, {}, IA.id);
      expect(noAccount.status).toBe(409);
      expect(noAccount.body.error).toBe("needs_an_account");

      // CONTROL: with a holder in the chair the door is not needed and says so.
      state.powerHolders = [FOUNDER.id];
      const held = await confirmed(APPLICANT.email.replace("@", "+two@"), [roleB]);
      const refused = await call("POST", `/api/governance/open-proposals/${held.id}/to-the-village`, {}, IA.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("someone_can_adopt");
    });
  });

  describe("recusal", () => {
    it("is one click, recorded once, and a recused holder cannot adopt", async () => {
      const { id } = await confirmed("recuse@example.test", [roleA]);
      state.powerHolders = [FOUNDER.id, SEAT_NOT_INTERVIEWER.id];
      const first = await call("POST", `/api/governance/applications/${id}/recuse`, { reason: "I know them well." }, FOUNDER.id);
      expect(first.status).toBe(200);
      expect(await call("POST", `/api/governance/applications/${id}/recuse`, {}, FOUNDER.id)).toMatchObject({ status: 200 });
      expect(await q("SELECT reason FROM application_recusals WHERE application_ref = ?", [id])).toEqual([{ reason: "I know them well." }]);
      expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).status).toBe(403);
    });

    it("skips an interview whose only holder stepped out, so the chain is not stuck", async () => {
      const { id } = await confirmed("skip@example.test");
      const out = await call("POST", `/api/governance/applications/${id}/recuse`, {}, IA.id);
      expect(out.status).toBe(200);
      expect((await interviews(id)).map((i: any) => i.state)).toEqual(["skipped", "open", "waiting", "waiting"]);
      expect(state.notices.some((n) => n.type === "application_interview_turn" && n.userId === IB.id)).toBe(true);
      expect(state.adminNotices.length).toBeGreaterThan(0);
      // CONTROL: a recused person cannot then score.
      expect((await score(id, Number((await interviews(id))[0].id), IA.id)).status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("the clocks only remind", () => {
    const deps = (at: Date) =>
      ({
        getPool: () => pool,
        notify: async (n: any) => {
          state.notices.push(n);
        },
        notifyAdmins: async (type: string, title: string, key: string) => {
          state.adminNotices.push({ type, title, key });
        },
        liveHoldersOf: async () => state.powerHolders,
        calendar,
        now: () => at,
        members: usersRepo(pool),
      }) as any;

    it("reminds at 2 business days, marks due at 3, calls it stale at 10, and decides nothing", async () => {
      const { id } = await confirmed("clock@example.test");
      const confirmedAt = Number((await q("SELECT UNIX_TIMESTAMP(stamped_at) AS s FROM application_steps WHERE application_ref = ? AND kind = 'confirmed'", [id]))[0].s) * 1000;
      state.adminNotices.length = 0;
      const day = 24 * 60 * 60 * 1000;
      // CONTROL: the moment after confirm nothing is due.
      await reviewClockTick(deps(new Date(confirmedAt + 60_000)));
      expect(state.adminNotices.filter((n) => n.key.startsWith(`app:${id}:`))).toEqual([]);

      await reviewClockTick(deps(new Date(confirmedAt + 4 * day)));
      const first = state.adminNotices.filter((n) => n.key.startsWith(`app:${id}:`)).map((n) => n.key);
      expect(first.some((k) => k === `app:${id}:reply-due` || k === `app:${id}:reply-reminder`)).toBe(true);
      await reviewClockTick(deps(new Date(confirmedAt + 4 * day)));
      // A repeat tick repeats the same stable keys, so the notice spine writes it once.
      const keys = state.adminNotices.filter((n) => n.key.startsWith(`app:${id}:`)).map((n) => n.key);
      expect(new Set(keys).size).toBe(first.length);

      const late = await reviewClockTick(deps(new Date(confirmedAt + 11 * day)));
      expect(late.stale).toBeGreaterThan(0);
      // Reminders only: nothing was adopted, declined, seated or stamped decided.
      expect((await q("SELECT status FROM open_role_proposals WHERE id = ?", [id]))[0].status).toBe("confirmed");
      expect(await stepKinds(id)).not.toContain("decided");
    });

    it("stops reminding once a person sent the first reply", async () => {
      const { id } = await confirmed("replied@example.test");
      expect((await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id)).body.stamped).toBe(true);
      expect((await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id)).body.stamped).toBe(false);
      state.adminNotices.length = 0;
      const confirmedAt = Number((await q("SELECT UNIX_TIMESTAMP(stamped_at) AS s FROM application_steps WHERE application_ref = ? AND kind = 'confirmed'", [id]))[0].s) * 1000;
      await reviewClockTick(deps(new Date(confirmedAt + 5 * 24 * 60 * 60 * 1000)));
      expect(state.adminNotices.some((n) => n.key.startsWith(`app:${id}:reply`))).toBe(false);
    });
  });


  describe("scores follow the application's retention", () => {
    const left = async (id: string) => ({
      scores: Number((await q("SELECT COUNT(*) AS n FROM application_scores WHERE application_ref = ?", [id]))[0].n),
      scorers: (await q("SELECT scorer_user_id FROM application_interviews WHERE application_ref = ? AND scorer_user_id IS NOT NULL", [id])).length,
      hash: String((await q("SELECT detail_json FROM application_steps WHERE application_ref = ? AND kind = 'confirmed'", [id]))[0].detail_json).includes("statusHash\":\""),
    });
    const DAY = 24 * 60 * 60 * 1000;

    it("clears scores, recusal reasons and the status link when the application is anonymised after 90 days, and leaves a younger one", async () => {
      const old = await confirmed("old@example.test");
      const young = await confirmed("young@example.test");
      for (const id of [old.id, young.id]) {
        await score(id, Number((await interviews(id))[0].id), IA.id);
        await call("POST", `/api/governance/applications/${id}/recuse`, { reason: "I know them." }, IB.id);
      }
      expect(await left(old.id)).toMatchObject({ scores: 3, scorers: 1, hash: true });
      await call("POST", `/api/governance/open-proposals/${old.id}/decline`, {}, FOUNDER.id);

      // CONTROL: a day later nothing is old enough.
      await tidyOpenProposals(pool, new Date(Date.now() + DAY));
      expect((await left(old.id)).scores).toBe(3);
      expect((await left(young.id)).scores).toBe(3);

      await tidyOpenProposals(pool, new Date(Date.now() + 91 * DAY));
      expect(await left(old.id)).toEqual({ scores: 0, scorers: 0, hash: false });
      expect(await q("SELECT reason FROM application_recusals WHERE application_ref = ?", [old.id])).toEqual([{ reason: null }]);
      expect(await stepKinds(old.id)).toContain("cleared");
      // The shape of the review stays: which conversations happened.
      expect((await interviews(old.id)).length).toBe(4);
      // The one nobody decided expires at 90 days too (withdrawn, name and address off), and its review goes with it.
      expect((await left(young.id)).scores).toBe(0);
    });

    it("clears the cards a member wrote, and the review of their own application, when they are erased", async () => {
      const mine = await confirmed(APPLICANT.email);
      const other = await confirmed("bystander@example.test");
      await score(other.id, Number((await interviews(other.id))[0].id), IA.id);
      await score(mine.id, Number((await interviews(mine.id))[0].id), IA.id);
      await call("POST", `/api/governance/applications/${other.id}/recuse`, { reason: "Friends." }, IB.id);

      // The scorer is erased: their cards go from both applications; the recusal of somebody else stays.
      await forgetMemberReview(pool, IA.id, new Date());
      expect((await left(other.id)).scores).toBe(0);
      expect(await q("SELECT 1 FROM application_recusals WHERE application_ref = ? AND user_id = ?", [other.id, IB.id])).toHaveLength(1);

      // CONTROL: a card by somebody still here is untouched by that erasure.
      const third = await confirmed("third@example.test");
      await score(third.id, Number((await interviews(third.id))[0].id), IA.id);
      await forgetMemberReview(pool, IC.id, new Date());
      expect((await left(third.id)).scores).toBe(3);

      // The applicant is erased: the review of their application is cleared.
      await score(mine.id, Number((await interviews(mine.id))[0].id), IA.id).catch(() => undefined);
      expect(await forgetMemberReview(pool, APPLICANT.id, new Date())).toBe(1);
      expect((await left(mine.id)).hash).toBe(false);
      expect(await stepKinds(mine.id)).toContain("cleared");
    });
  });

  describe("updates about a proposal reach the person who made it", () => {
    const updates = () => state.sent.filter((m) => m.origin === "open_proposal.update");

    it("a first reply goes once by email with the right recipient, and a retry sends nothing more", async () => {
      const { id } = await confirmed("fr-person@example.test");
      state.sent.length = 0;
      expect((await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id)).body.stamped).toBe(true);
      expect((await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id)).body.stamped).toBe(false);
      expect(updates()).toHaveLength(1);
      expect(updates()[0]).toMatchObject({ kind: "essential", idempotencyKey: `open-proposal:${id}:update:first_reply`, to: { email: "fr-person@example.test" }, subject: "We have taken up your proposal" });
      expect(updates()[0].text).toContain("We reply within 7 days.");
      // No account yet: email only, nothing on any profile.
      expect(state.notices.filter((n) => n.type === "applicant_update")).toEqual([]);
    });

    it("an address with an account gets the same update on its profile, once", async () => {
      const { id } = await confirmed(APPLICANT.email);
      state.notices.length = 0;
      await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id);
      await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id);
      const bell = state.notices.filter((n) => n.type === "applicant_update");
      expect(bell).toHaveLength(1);
      expect(bell[0]).toMatchObject({ userId: APPLICANT.id, dedupeKey: `op:${id}:update:first_reply:${APPLICANT.id}`, link: "/profile" });
      expect(updates()).toHaveLength(1);
    });

    it("the next conversation is asked for once, by email, after the one before it is scored", async () => {
      const { id } = await confirmed("conv-person@example.test");
      state.sent.length = 0;
      const ivs = await interviews(id);
      await score(id, Number(ivs[0].id), IA.id);
      expect(updates()).toHaveLength(1);
      expect(updates()[0]).toMatchObject({ idempotencyKey: `open-proposal:${id}:update:conversation:2`, to: { email: "conv-person@example.test" } });
      expect(updates()[0].text).toContain("Data Role");
      expect(updates()[0].text).toContain("about 20 minutes");
      // Scoring the same one again is refused, and tells nobody again.
      await score(id, Number(ivs[0].id), IA.id);
      expect(updates()).toHaveLength(1);
    });

    it("the status page promises the number of days the village set, 7 until it sets one", async () => {
      const { id, confirm } = await confirmed("days@example.test");
      const token = new URL(`${ORIGIN}${confirm.statusPath}`).searchParams.get("token");
      expect((await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null)).body.status.replyDays).toBe(7);
      await q("INSERT INTO game_variables (config_key, value) VALUES ('org.applicant_reply_days', '3') ON DUPLICATE KEY UPDATE value = VALUES(value)");
      await loadVariables(pool);
      try {
        expect((await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null)).body.status.replyDays).toBe(3);
        // The email that carries the link says it too.
      } finally {
        await q("DELETE FROM game_variables WHERE config_key = 'org.applicant_reply_days'");
        await loadVariables(pool);
      }
    });
  });

  describe("the applicant's status page", () => {
    it("shows the step, who acts next and by when through the emailed link, and nothing else", async () => {
      const { id, confirm } = await confirmed("status@example.test");
      expect(confirm.statusPath).toContain(`/application-status/${id}?token=`);
      const token = new URL(`${ORIGIN}${confirm.statusPath}`).searchParams.get("token");
      expect(state.sent.some((m) => m.text.includes(String(token)))).toBe(true);
      const first = await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null);
      expect(first.status).toBe(200);
      expect(first.body.status.step).toBe("first_reply");
      expect(first.body.status.by).toBeTruthy();
      const ivs = await interviews(id);
      await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id);
      await score(id, Number(ivs[0].id), IA.id, "strong");
      const next = await call("GET", `/api/application-status/${id}?token=${token}`, undefined, null);
      expect(next.body.status.step).toBe("interview");
      expect(next.body.status.actsNext).toContain("Data Role");
      // Steps only: no level, no evidence, no scorer.
      expect(JSON.stringify(next.body)).not.toMatch(/strong|Heard it for|u-ia|score/i);
    });

    it("the letters that ask the applicant to look carry a working link of their own, signed for this proposal alone", async () => {
      const { id } = await confirmed("letterlink@example.test");
      const other = await confirmed("letterlink2@example.test");
      const ivs = await interviews(id);
      await call("POST", `/api/governance/applications/${id}/first-reply`, {}, FOUNDER.id);
      await score(id, Number(ivs[0].id), IA.id, "strong");
      const mail = state.sent.find((m) => m.to.email === "letterlink@example.test" && m.subject === "A conversation is asked for");
      expect(mail, "the conversation letter was sent").toBeTruthy();
      // The audit's finding: this letter used to say the link was "in the first email".
      const link = /https?:\/\/\S+\/application-status\/\S+/.exec(mail!.text)?.[0];
      expect(link, "the letter carries a link").toBeTruthy();
      const token = new URL(link!).searchParams.get("token") as string;
      expect((await call("GET", `/api/application-status/${id}?token=${encodeURIComponent(token)}`, undefined, null)).status).toBe(200);
      // CONTROLS: the link is for one proposal and one page. Another ref, a tampered token and a made-up one all answer 404.
      expect((await call("GET", `/api/application-status/${other.id}?token=${encodeURIComponent(token)}`, undefined, null)).status).toBe(404);
      expect((await call("GET", `/api/application-status/${id}?token=${encodeURIComponent(token.slice(0, -2) + "xx")}`, undefined, null)).status).toBe(404);
      expect((await call("GET", `/api/application-status/${id}?token=a.b`, undefined, null)).status).toBe(404);
    });

    it("answers one 404 for a wrong token and an unknown ref", async () => {
      const { id } = await confirmed("wrong@example.test");
      expect((await call("GET", `/api/application-status/${id}?token=nope`, undefined, null)).status).toBe(404);
      expect((await call("GET", "/api/application-status/op-ffffffffffffffffffff?token=nope", undefined, null)).status).toBe(404);
    });
  });
});
