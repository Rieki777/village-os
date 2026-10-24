/**
 * The advice process, against a real schema: who is asked, who reads a
 * request, advice given and changed, the decision and the withdrawal, the
 * bells, the cap on open requests, and what the export and the erasure do.
 *
 * The room's and the advice process's route modules are registered on a fake
 * Express with the scratch schema's pool behind them. THE CASES RUN IN ORDER:
 * Ana and Ben met in the garden in week 1 and Cai holds a garden role, so all
 * three have standing there; Dee has none anywhere. Ana asks the garden.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { forgetMemberSessions } from "./lib/liveSessions";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerAdvice } from "./routes/sessionAdvice";
import { ADVICE_LIMITS, ADVICE_NOTICES, ADVICE_REFUSALS, type AdvicePayload } from "../shared/sessionAdvice";
import { addDaysTo } from "../shared/sessionDecisions";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => undefined },
    handlers,
  };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string> } = { status: 200, body: undefined, headers: {} };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    send() {
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", email: "ana@village.example.test", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", email: "ben@village.example.test", membershipGranted: true },
  "m-cai": { id: "m-cai", name: "Cai Moreno", email: "cai@village.example.test", membershipGranted: true },
  "m-dee": { id: "m-dee", name: "Dee Lund", email: "dee@village.example.test", membershipGranted: true },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("the advice process, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const bells: any[] = [];
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = addDaysTo(today, 7);
  let tanks = 0;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const list = async (who: string) => (await as(who, "GET /api/sessions/advice/requests")).body as AdvicePayload;
  const ask = (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/advice/requests", { body: { circleId: "c-garden", decideBy: inAWeek, ...body } });
  const give = (who: string, id: number, advice: unknown) => as(who, "PUT /api/sessions/advice/requests/:id/advice", { params: { id: String(id) }, body: { advice } });
  const decide = (who: string, id: number, decision: unknown) => as(who, "POST /api/sessions/advice/requests/:id/decide", { params: { id: String(id) }, body: { decision } });
  const withdraw = (who: string, id: number) => as(who, "POST /api/sessions/advice/requests/:id/withdraw", { params: { id: String(id) } });
  const ofType = (type: string) => bells.filter((b) => b.type === type);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const c = collect();
    const deps = {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null),
      isAdmin: async () => whoami === "m-founder",
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async (n: any) => {
        bells.push(n);
        return { fresh: true };
      },
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    } as any;
    registerRoom(c.app, deps);
    registerAdvice(c.app, deps);
    handlers = c.handlers;
    // Cai holds the garden's water role and was never in a session.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q("INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL)");
    // Week 1: Ana and Ben meet in the garden.
    const week1 = Number((await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 1", circleId: "c-garden", durationMin: 60 } })).body.id);
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: { id: String(week1) } })).status).toBe(200);
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(week1) } })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("asks everybody with standing in the circle, the asker aside, and rings each of them", async () => {
    expect(await ask("m-ana", { circleId: "c-moon", intent: "x" })).toMatchObject({ status: 400, body: { error: ADVICE_REFUSALS.circleUnknown } });
    expect(await ask("m-ana", { intent: "x", decideBy: today })).toMatchObject({ status: 400, body: { error: ADVICE_REFUSALS.pastDate } });
    // Nobody has standing in the kitchen.
    expect(await ask("m-ana", { circleId: "c-kitchen", intent: "Paint the kitchen door." })).toMatchObject({ status: 409, body: { error: ADVICE_REFUSALS.nobodyToAsk } });
    const out = await ask("m-ana", { intent: "We fill the tanks on Mondays.", context: "Sunday's rain fills them anyway." });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    tanks = out.body.request.id;
    expect(out.body.request).toMatchObject({ circleName: "Garden circle", askerName: "Ana Reyes", mine: true, askedCount: 2, canDecide: true, canAdvise: false, status: "open", decideBy: inAWeek });
    expect(ofType("session_advice_asked").map((b) => b.userId).sort()).toEqual(["m-ben", "m-cai"]);
    expect(ofType("session_advice_asked")[0]).toMatchObject({ title: ADVICE_NOTICES.asked("Ana Reyes", "Garden circle"), body: "We fill the tanks on Mondays.", link: `/sessions#advice-${tanks}` });
  });

  it("shows a request to whoever asked and the people asked, and to nobody else", async () => {
    expect((await list("m-ana")).mine.map((r) => r.id)).toEqual([tanks]);
    const ben = await list("m-ben");
    expect(ben.askedOfMe).toEqual([expect.objectContaining({ id: tanks, canAdvise: true, myAdvice: null, mine: false })]);
    expect(ben.mine).toEqual([]);
    expect(await list("m-dee")).toMatchObject({ askedOfMe: [], mine: [] });
    expect(await give("m-dee", tanks, "No.")).toMatchObject({ status: 404, body: { error: ADVICE_REFUSALS.notFound } });
    expect(await decide("m-dee", tanks, "Mine now.")).toMatchObject({ status: 404, body: { error: ADVICE_REFUSALS.notFound } });
    expect(await give("m-ben", 999_999, "No.")).toMatchObject({ status: 404, body: { error: ADVICE_REFUSALS.notFound } });
  });

  it("takes advice from the people asked, open to all of them, and rings the asker once per person", async () => {
    expect(await give("m-ana", tanks, "I agree with myself.")).toMatchObject({ status: 403, body: { error: ADVICE_REFUSALS.notAsked } });
    expect(await give("m-ben", tanks, "  ")).toMatchObject({ status: 400, body: { error: ADVICE_REFUSALS.adviceNeeded } });
    expect((await give("m-ben", tanks, "Mondays clash with the market.")).body.request.myAdvice).toBe("Mondays clash with the market.");
    expect((await give("m-ben", tanks, "Tuesdays, the market is on Mondays.")).status).toBe(200);
    expect((await give("m-cai", tanks, "The pump needs a day's notice.")).status).toBe(200);
    const given = ofType("session_advice_given");
    expect(given.map((b) => b.dedupeKey)).toEqual([`session-advice-given:${tanks}:m-ben`, `session-advice-given:${tanks}:m-ben`, `session-advice-given:${tanks}:m-cai`]);
    expect(given[0]).toMatchObject({ userId: "m-ana", title: ADVICE_NOTICES.given("Ben Ortiz") });
    // Cai reads Ben's advice too.
    const cai = (await list("m-cai")).askedOfMe[0];
    expect(cai.advice.map((a) => [a.by, a.words, a.mine])).toEqual([
      ["Ben Ortiz", "Tuesdays, the market is on Mondays.", false],
      ["Cai Moreno", "The pump needs a day's notice.", true],
    ]);
  });

  it("lets only the asker decide, rings the people asked, and closes the request to advice", async () => {
    expect(await decide("m-cai", tanks, "Tuesdays.")).toMatchObject({ status: 403, body: { error: ADVICE_REFUSALS.notYours } });
    expect(await decide("m-ana", tanks, " ")).toMatchObject({ status: 400, body: { error: ADVICE_REFUSALS.decisionNeeded } });
    const out = await decide("m-ana", tanks, "We fill the tanks on Tuesdays, with a day's notice to the pump keeper.");
    expect(out.body.request).toMatchObject({ status: "decided", canDecide: false, decision: "We fill the tanks on Tuesdays, with a day's notice to the pump keeper.", settledOn: today });
    expect(ofType("session_advice_decided").map((b) => b.userId).sort()).toEqual(["m-ben", "m-cai"]);
    expect(await give("m-ben", tanks, "Too late?")).toMatchObject({ status: 409, body: { error: ADVICE_REFUSALS.settled } });
    expect(await decide("m-ana", tanks, "Again.")).toMatchObject({ status: 409, body: { error: ADVICE_REFUSALS.settled } });
    expect((await list("m-ben")).askedOfMe[0]).toMatchObject({ status: "decided", canAdvise: false });
  });

  it("withdraws a request without a bell, and caps how many one member keeps open", async () => {
    const before = bells.length;
    const out = await ask("m-ben", { intent: "Move the compost bays." });
    const asked = bells.length - before;
    expect(asked).toBe(2);
    expect((await withdraw("m-ana", out.body.request.id)).status).toBe(403);
    expect((await withdraw("m-ben", out.body.request.id)).body.request).toMatchObject({ status: "withdrawn", settledOn: today });
    expect(bells.length - before).toBe(asked);
    for (let i = 0; i < ADVICE_LIMITS.openPerAsker; i += 1) expect((await ask("m-ben", { intent: `Idea ${i}.` })).status).toBe(200);
    expect(await ask("m-ben", { intent: "One more." })).toMatchObject({ status: 409, body: { error: ADVICE_REFUSALS.tooManyOpen } });
  });

  it("exports a member's requests and their advice, and forgets both when they leave", async () => {
    const ana = await exportMemberSessions(pool, "m-ana");
    expect(ana.adviceAsked).toEqual([expect.objectContaining({ id: tanks, status: "decided", intent: "We fill the tanks on Mondays." })]);
    expect((await exportMemberSessions(pool, "m-cai")).adviceGiven).toEqual([expect.objectContaining({ requestId: tanks, advice: "The pump needs a day's notice." })]);
    // Cai leaves: her advice goes, and Ana's request stays with Ben's.
    await forgetMemberSessions(pool, "m-cai", async (id) => PEOPLE[id] ?? null);
    expect((await list("m-ana")).mine[0].advice.map((a) => a.by)).toEqual(["Ben Ortiz"]);
    // Ben leaves: every request he made goes, with everything asked on them.
    const benRequests = (await q("SELECT `id` FROM `live_session_advice_requests` WHERE `asker_no` = (SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-ben')")).map((r: any) => Number(r.id));
    expect(benRequests.length).toBeGreaterThan(0);
    await forgetMemberSessions(pool, "m-ben", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT COUNT(*) AS `n` FROM `live_session_advice_requests` WHERE `id` IN (?)", [benRequests])).toEqual([{ n: 0 }]);
    expect(await q("SELECT COUNT(*) AS `n` FROM `live_session_advice_asks` WHERE `request_id` IN (?)", [benRequests])).toEqual([{ n: 0 }]);
    expect((await list("m-ana")).mine[0].advice).toEqual([]);
  });
});
