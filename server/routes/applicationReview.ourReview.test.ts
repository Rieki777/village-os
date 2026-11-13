/**
 * OUR REVIEW BEFORE THE CONVERSATIONS (Phase A, lane A2), over real HTTP and
 * the S5 scratch schema. Same harness as applicationReview.test.ts.
 *
 * Pinned, each with a control:
 *   - with `org.review_before_conversations` on, nothing opens and nobody is
 *     asked until a decider answers our review
 *   - an invitation opens the first conversation only and sends a letter that
 *     lists the role's own conversations in order (60, 30, 30 here)
 *   - the not-invited letter thanks, says it is not personal, points to the
 *     village's way to stay close, quests and events, and closes it
 *   - ONE answer per application; only a decider answers, never their own
 *   - the setting is kept per application; off, the older path is untouched
 *   - the clock asks for our review by name, and stops once answered
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
import { register } from "./openProposals";

const configured = testDbConfigured();
if (!configured) console.warn("[applicationReview.ourReview] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

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

describe.skipIf(!configured)("our review before the conversations, on a real schema", () => {
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

  const setVar = async (key: string, value: string) => {
    await q("INSERT INTO game_variables (config_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
    await loadVariables(pool);
  };
  const setting = async (on: boolean) => setVar("org.review_before_conversations", on ? "true" : "false");

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
    // The founding team's shape (lead, 11 Nov 2026): 60, then 30, then 30, the last the final approval. Data on the role, never in code.
    await q("UPDATE org_roles SET conversations = ?, selection_criteria = ? WHERE id = ?", [
      JSON.stringify([
        { roleId: roleA, minutes: 60, final: false },
        { roleId: roleB, minutes: 30, final: false },
        { roleId: roleC, minutes: 30, final: true },
      ]),
      JSON.stringify(["Reads a budget line by line"]),
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
    await setting(true);
    await setVar("org.stay_close_name", "Friends of the Village");
    await setVar("org.stay_close_link", "/resident");
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

  const statusOf = async (id: string) => {
    const mail = state.sent.find((m) => m.idempotencyKey.startsWith(`open-proposal-status:${id}`) || m.text.includes(`/application-status/${id}?token=`));
    const link = mail!.text.split(/\s+/).find((w) => w.includes(`/application-status/${id}?token=`))!;
    const token = new URL(link).searchParams.get("token")!;
    return call("GET", `/api/application-status/${id}?token=${encodeURIComponent(token)}`, undefined, null);
  };

  it("with our review first, NO conversation opens and nobody is asked to interview or consent until a decider invites", async () => {
    const { id } = await confirmed("review-first@example.test");
    expect((await interviews(id)).map((i: any) => i.state)).toEqual(["waiting", "waiting", "waiting"]);
    expect(state.notices.some((n) => n.type === "application_interview_turn")).toBe(false);
    expect(await asks(id)).toEqual([]);
    // The status page: received, our review (now), invitation, three conversations, decision, first cycle.
    const st = await statusOf(id);
    expect(st.status).toBe(200);
    expect(st.body.status.step).toBe("review");
    expect(st.body.status.reviewFirst).toBe(true);
    expect(st.body.status.path.map((p: any) => `${p.label}:${p.state}`)).toEqual([
      "Received:done",
      "Our review:now",
      "Invitation:later",
      "Conversation with Channel Role (60 minutes):later",
      "Conversation with Data Role (30 minutes):later",
      "Conversation with Build Role (30 minutes):later",
      "Decision:later",
      "First cycle:later",
    ]);
    // Before the invitation nothing is booked, so the booking line waits.
    expect(st.body.status.booking).toBeNull();
    // The decider page carries the review and the conversations in order; adopt and decline stand aside.
    const page = await call("GET", `/api/governance/open-proposals/${id}`, undefined, FOUNDER.id);
    expect(page.body.proposal.review).toEqual({ stage: "review", conversations: [{ role: "Channel Role", minutes: 60 }, { role: "Data Role", minutes: 30 }, { role: "Build Role", minutes: 30 }] });
    expect(page.body.proposal.you).toMatchObject({ mayReview: true, mayAdopt: false, mayDecline: false });
    // Adopt and decline are refused while our review waits.
    expect((await call("POST", `/api/governance/open-proposals/${id}/adopt`, {}, FOUNDER.id)).body.error).toBe("review_first");
    expect((await call("POST", `/api/governance/open-proposals/${id}/decline`, {}, FOUNDER.id)).body.error).toBe("review_first");
  });

  it("an invitation opens the FIRST conversation only, tells its holders, and sends the invitation letter listing the conversations in order", async () => {
    const { id } = await confirmed("invite@example.test");
    state.sent.length = 0;
    const out = await call("POST", `/api/governance/open-proposals/${id}/invite`, { note: "We loved your budget." }, FOUNDER.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.emailed).toBe(true);
    expect((await interviews(id)).map((i: any) => i.state)).toEqual(["open", "waiting", "waiting"]);
    expect(state.notices.filter((n) => n.type === "application_interview_turn").map((n) => n.userId)).toEqual([IA.id]);
    const letter = state.sent.find((m) => m.idempotencyKey === `open-proposal:${id}:invited`)!;
    expect(letter.subject).toBe("An invitation to talk with Test Village");
    const lines = letter.text.split("\n");
    expect(lines).toContain("1. Channel Role, 60 minutes");
    expect(lines).toContain("2. Data Role, 30 minutes");
    expect(lines).toContain("3. Build Role, 30 minutes");
    expect(letter.text).toContain("About 120 minutes in all.");
    expect(letter.text).toContain("We loved your budget.");
    // The second answer is refused: one answer per application.
    const again = await call("POST", `/api/governance/open-proposals/${id}/not-invited`, {}, FOUNDER.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_answered");
    const st = await statusOf(id);
    expect(st.body.status.step).toBe("interview");
    expect(st.body.status.path.slice(0, 4).map((p: any) => p.state)).toEqual(["done", "done", "done", "now"]);
  });

  it("the not-invited letter is warm, points to the village's way to stay close, quests and events, and closes the application", async () => {
    const { id } = await confirmed("not-invited@example.test");
    const out = await call("POST", `/api/governance/open-proposals/${id}/not-invited`, {}, FOUNDER.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const letter = state.sent.find((m) => m.idempotencyKey === `open-proposal:${id}:not-invited`)!;
    expect(letter.subject).toBe("Thank you for applying to Test Village");
    expect(letter.text).toContain("more closely matched to this role");
    expect(letter.text).toContain("Thank you for your time and interest.");
    expect(letter.text, "the lead cut the paragraph explaining it is not personal (12 Nov 2026)").not.toContain("it is not personal");
    expect(letter.text).toContain(`Friends of the Village: ${ORIGIN}/resident`);
    expect(letter.text).toContain(`Take a quest: ${ORIGIN}/quests`);
    const row = (await q("SELECT status FROM open_role_proposals WHERE id = ?", [id]))[0];
    expect(row.status).toBe("declined");
    // Nothing ever opened, and nobody was asked.
    expect((await interviews(id)).map((i: any) => i.state)).toEqual(["waiting", "waiting", "waiting"]);
    expect(await asks(id)).toEqual([]);
    const st = await statusOf(id);
    expect(st.body.status.notInvited).toBe(true);
    expect(st.body.status.stayClose).toEqual({ name: "Friends of the Village", href: "/resident" });
    expect(st.body.status.path.map((p: any) => p.label)).toEqual(["Received", "Our review"]);
    // CONTROL: an invitation after it is refused.
    expect((await call("POST", `/api/governance/open-proposals/${id}/invite`, {}, FOUNDER.id)).status).toBe(409);
  });

  it("only a holder of the power to place people answers our review, and never on their own application", async () => {
    const { id } = await confirmed("who@example.test");
    const outsider = await call("POST", `/api/governance/open-proposals/${id}/invite`, {}, OUTSIDER.id);
    expect(outsider.status).toBe(403);
    expect((await interviews(id)).map((i: any) => i.state)).toEqual(["waiting", "waiting", "waiting"]);
    const own = await confirmed(FOUNDER.email);
    expect((await call("POST", `/api/governance/open-proposals/${own.id}/invite`, {}, FOUNDER.id)).status).toBe(403);
  });

  it("CONTROL: with the setting off, the first conversation opens at confirm and the invite door has nothing to answer", async () => {
    await setting(false);
    const { id } = await confirmed("old-path@example.test");
    expect((await interviews(id)).map((i: any) => i.state)).toEqual(["open", "waiting", "waiting"]);
    const out = await call("POST", `/api/governance/open-proposals/${id}/invite`, {}, FOUNDER.id);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("no_review");
  });

  it("an application keeps the path it confirmed under when the setting changes later", async () => {
    const { id } = await confirmed("kept@example.test");
    await setting(false);
    const st = await statusOf(id);
    expect(st.body.status.step).toBe("review");
    expect((await call("POST", `/api/governance/open-proposals/${id}/invite`, {}, FOUNDER.id)).status).toBe(200);
  });

  it("the clock asks for our review by name and stops once it is answered", async () => {
    const { id } = await confirmed("clock@example.test");
    await q("UPDATE application_steps SET stamped_at = ? WHERE application_ref = ? AND kind = 'confirmed'", [new Date(Date.now() - 10 * 86_400_000), id]);
    const work: any = { getPool: () => pool, notify: async (n: any) => state.notices.push(n), notifyAdmins: async (type: string, title: string, key: string) => state.adminNotices.push({ type, title, key }), liveHoldersOf: async () => [], calendar, now: () => new Date(), members: usersRepo(pool) };
    await reviewClockTick(work);
    expect(state.adminNotices.some((n) => n.key === `app:${id}:reply-due` && n.title.includes("waits for our review"))).toBe(true);
    state.adminNotices.length = 0;
    await call("POST", `/api/governance/open-proposals/${id}/invite`, {}, FOUNDER.id);
    await reviewClockTick(work);
    expect(state.adminNotices.some((n) => n.key.startsWith(`app:${id}:reply`))).toBe(false);
  });
});
