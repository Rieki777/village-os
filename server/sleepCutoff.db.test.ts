/**
 * "Sleep on it" with an answer-by time, against a real schema (0281; Rye,
 * 2026-10-23): a night names when it ends, at most a week ahead; a night that
 * outlives the call is answered from the record; a night left unanswered
 * counts as no objection; the facilitator hears once no night lasts, and
 * marks a round that consented decided.
 *
 * THE CASES RUN IN ORDER: Ana facilitates, Ben and Cai join, three proposals
 * go round, Ben sleeps on all three, and the session closes. Ben answers the
 * tanks from the record; the nights on the compost and the seeds simply end,
 * and one of them fails to settle once. Dee, who was never there, learns
 * nothing from the record's doors. Last, in week 2, Cai sleeps on a proposal
 * and leaves the village before the night ends.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { answerAfterNight, forgetMemberSessions, memberNo, settleNights } from "./lib/liveSessions";
import { register } from "./routes/liveSessions";
import { SESSION_COPY, SESSION_REFUSALS, SESSION_NOTICES, SLEEP_LIMITS } from "../shared/sessions";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", handle: "cai" },
  "m-dee": { id: "m-dee", name: "Dee Lund", handle: "dee" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};

/** The pool, with the first statement containing `marker` refused once, inside whichever transaction runs it. */
function failingOnce(pool: mysql.Pool, marker: string): mysql.Pool {
  let left = 1;
  const wrapConn = (c: any) =>
    new Proxy(c, {
      get(target, key) {
        if (key === "query") {
          return (sql: unknown, ...rest: unknown[]) => {
            if (left > 0 && String(sql).includes(marker)) {
              left -= 1;
              return Promise.reject(new Error("the record did not take the write"));
            }
            return target.query(sql, ...rest);
          };
        }
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  return new Proxy(pool, {
    get(target: any, key) {
      if (key === "getConnection") return async () => wrapConn(await target.getConnection());
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const configured = testDbConfigured();
const DAY = 86_400_000;

describe.skipIf(!configured)("Sleep on it with an answer-by time, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const bells: any[] = [];
  let sid = 0;
  let tanks = 0;
  let compost = 0;
  let seeds = 0;
  const benBy = new Date(Date.now() + DAY).toISOString();

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const room = () => ({ id: String(sid) });
  const view = async (who: string) => (await as(who, "GET /api/sessions/:id", { params: room() })).body;
  const respond = (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/:id/respond", { params: room(), body });
  const night = (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/:id/night", { params: room(), body });
  const decide = (who: string, entryId: number) => as(who, "POST /api/sessions/:id/entries/:entryId/decide", { params: { id: String(sid), entryId: String(entryId) } });
  const lookup = async (id: string) => PEOPLE[id] ?? null;
  const minutes = async () => String((await q("SELECT `minutes_people` FROM `live_sessions` WHERE `id` = ?", [sid]))[0].minutes_people);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const c = collect();
    register(c.app, {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null),
      isAdmin: async () => whoami === "m-founder",
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async (n: any) => {
        bells.push(n);
        return { inserted: true };
      },
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
    } as any);
    handlers = c.handlers;
    sid = Number((await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 1", circleId: "c-garden", durationMin: 60 } })).body.id);
    for (const who of ["m-ben", "m-cai"]) expect((await as(who, "POST /api/sessions/:id/join", { params: room() })).status).toBe(200);
    const propose = async (text: string) => Number((await as("m-ana", "POST /api/sessions/:id/entries", { params: room(), body: { kind: "decision", text, itemId: null } })).body.id);
    tanks = await propose("We fill the tanks on Mondays.");
    compost = await propose("Compost goes in the left bay first.");
    seeds = await propose("Seeds dry in the shed.");
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("asks a night for its answer-by time, inside a week, and keeps the round open meanwhile", async () => {
    for (const who of ["m-ana", "m-cai"]) {
      for (const d of [tanks, compost, seeds]) expect((await respond(who, { target: `decision:${d}`, value: "consent" })).status).toBe(200);
    }
    expect(await respond("m-ben", { target: `decision:${tanks}`, value: "sleep" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.answerByNeeded } });
    const tooFar = new Date(Date.now() + SLEEP_LIMITS.maxAheadMs + 60_000).toISOString();
    expect(await respond("m-ben", { target: `decision:${tanks}`, value: "sleep", answerBy: tooFar })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.answerByFar } });
    const tooSoon = new Date(Date.now() + 60_000).toISOString();
    expect(await respond("m-ben", { target: `decision:${tanks}`, value: "sleep", answerBy: tooSoon })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.answerBySoon } });
    for (const d of [tanks, compost, seeds]) expect((await respond("m-ben", { target: `decision:${d}`, value: "sleep", answerBy: benBy })).status).toBe(200);
    const ana = await view("m-ana");
    expect(ana.responses).toContainEqual(expect.objectContaining({ target: `decision:${tanks}`, value: "sleep", answerBy: benBy }));
    // Before the time, the round waits: the facilitator cannot mark it decided.
    expect(await as("m-ana", "PATCH /api/sessions/:id/entries/:entryId", { params: { id: String(sid), entryId: String(tanks) }, body: { status: "done" } })).toMatchObject({
      status: 409,
      body: { error: SESSION_REFUSALS.decisionNotConsented },
    });
    // Answering again with anything else lets the time go.
    expect((await respond("m-ben", { target: `decision:${compost}`, value: "consent" })).status).toBe(200);
    expect((await view("m-ana")).responses).toContainEqual(expect.objectContaining({ target: `decision:${compost}`, value: "consent", answerBy: null }));
    expect((await respond("m-ben", { target: `decision:${compost}`, value: "sleep", answerBy: benBy })).status).toBe(200);
  });

  it("keeps both rounds after the close, and tells Ben where to answer and by when", async () => {
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: room() })).status).toBe(200);
    const told = bells.filter((b) => b.type === "session_night_open");
    expect(told.map((b) => b.dedupeKey).sort()).toEqual([tanks, compost, seeds].map((d) => `session-night-open:${sid}:${d}:m-ben`).sort());
    expect(told[0]).toMatchObject({ userId: "m-ben", title: SESSION_NOTICES.nightOpen("Garden, week 1"), link: `/sessions/${sid}` });
    const ben = await view("m-ben");
    expect(ben.nights).toEqual([tanks, compost, seeds].map((entryId) => ({ entryId, open: true, consented: false, canAnswer: true, canDecide: false })));
    expect((await view("m-ana")).nights[0]).toMatchObject({ canAnswer: false, canDecide: false });
    expect(await minutes()).toContain("1 sleeping on it");
  });

  it("lets only Ben answer after the call, by his time, and tells Ana once the round settles", async () => {
    expect(await night("m-cai", { entryId: tanks, value: "consent" })).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.nightNotYours } });
    expect(await night("m-ben", { entryId: tanks, value: "sleep" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.nightValue } });
    expect(await night("m-ben", { entryId: tanks, value: "concern" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.consentWords } });
    expect(await decide("m-ana", tanks)).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionNotConsented } });
    expect((await night("m-ben", { entryId: tanks, value: "concern", text: "Mondays clash with the market." })).status).toBe(200);
    expect(bells.filter((b) => b.type === "session_night_settled")).toEqual([
      expect.objectContaining({ userId: "m-ana", title: SESSION_NOTICES.nightSettled("Garden, week 1", true), dedupeKey: `session-night:${sid}:${tanks}:m-ana` }),
    ]);
    expect((await view("m-ana")).nights).toContainEqual({ entryId: tanks, open: false, consented: true, canAnswer: false, canDecide: true });
    expect(await night("m-ben", { entryId: tanks, value: "consent" })).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.nightNotYours } });
  });

  it("marks a round that consented after the call decided, for the facilitator only", async () => {
    expect(await decide("m-cai", tanks)).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
    expect((await decide("m-ana", tanks)).status).toBe(200);
    const ana = await view("m-ana");
    expect(ana.entries.find((e: any) => e.id === tanks).status).toBe("done");
    expect(ana.nights.map((n: any) => n.entryId)).toEqual([compost, seeds]);
    expect(await minutes()).toContain("**Decided by consent:** We fill the tanks on Mondays. (2 consent, 1 with a concern, 0 objecting)");
    expect(await decide("m-ana", tanks)).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionFinal } });
  });

  it("counts a night left unanswered as no objection once it ends, settles each round once, and one that fails never holds up the rest", async () => {
    const deps = { notify: async (n: any) => void bells.push(n), lifecycle: () => "members" };
    expect(await settleNights(pool, lookup, deps)).toBe("0 round(s) settled after a night");
    const after = new Date(Date.parse(benBy) + 60_000);
    expect(await settleNights(pool, lookup, { ...deps, lifecycle: () => "preview" }, after)).toBe("the sessions module is not open to members");
    // The record refuses the first round's write: that round waits for the next run, and the other settles now, its facilitator told.
    expect(await settleNights(failingOnce(pool, "SET `summary`"), lookup, deps, after)).toBe("1 round(s) settled after a night");
    expect(bells.filter((b) => b.type === "session_night_settled")).toHaveLength(2);
    expect(await settleNights(pool, lookup, deps, after)).toBe("1 round(s) settled after a night");
    expect(await settleNights(pool, lookup, deps, after)).toBe("0 round(s) settled after a night");
    expect(bells.filter((b) => b.type === "session_night_settled").map((b) => b.dedupeKey)).toEqual(
      expect.arrayContaining([`session-night:${sid}:${compost}:m-ana`, `session-night:${sid}:${seeds}:m-ana`]),
    );
    expect(await minutes()).toContain("Compost goes in the left bay first. (2 consent, 0 with a concern, 0 objecting, 1 no objection by default)");
    // Ben's night is over, so it is no longer his to answer.
    const ben = { no: (await memberNo(pool, "m-ben"))!, admin: false };
    expect(await answerAfterNight(pool, sid, ben, { entryId: compost, value: "object", text: "Too late." }, lookup, after)).toMatchObject({
      ok: false,
      status: 409,
      error: SESSION_REFUSALS.nightOver,
    });
  });

  it("tells somebody who may not read the record nothing about what is in it, and only the facilitator anything about deciding", async () => {
    // Dee has a number from a room of her own, and was never in this one.
    expect((await as("m-dee", "POST /api/sessions", { body: { title: "Kitchen, week 1", circleId: "c-garden", durationMin: 30 } })).status).toBe(200);
    for (const entryId of [tanks, compost, 999_999]) {
      expect(await night("m-dee", { entryId, value: "consent" })).toMatchObject({ status: 403, body: { error: SESSION_COPY.closedNoAccess } });
      expect(await decide("m-dee", entryId)).toMatchObject({ status: 403, body: { error: SESSION_COPY.closedNoAccess } });
      // Cai was there, and still learns nothing about deciding from a door that is the facilitator's.
      expect(await decide("m-cai", entryId)).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
    }
  });

  it("settles a round when the member whose night held it leaves the village", async () => {
    const week2 = Number((await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 2", circleId: "c-garden", durationMin: 60 } })).body.id);
    const at2 = { params: { id: String(week2) } };
    expect((await as("m-cai", "POST /api/sessions/:id/join", at2)).status).toBe(200);
    const dusk = Number((await as("m-ana", "POST /api/sessions/:id/entries", { ...at2, body: { kind: "decision", text: "We water at dusk.", itemId: null } })).body.id);
    expect((await as("m-ana", "POST /api/sessions/:id/respond", { ...at2, body: { target: `decision:${dusk}`, value: "consent" } })).status).toBe(200);
    expect((await as("m-cai", "POST /api/sessions/:id/respond", { ...at2, body: { target: `decision:${dusk}`, value: "sleep", answerBy: benBy } })).status).toBe(200);
    expect((await as("m-ana", "POST /api/sessions/:id/close", at2)).status).toBe(200);
    expect((await as("m-ana", "GET /api/sessions/:id", at2)).body.nights).toEqual([{ entryId: dusk, open: true, consented: false, canAnswer: false, canDecide: false }]);
    await forgetMemberSessions(pool, "m-cai", lookup);
    expect((await as("m-ana", "GET /api/sessions/:id", at2)).body.nights).toEqual([{ entryId: dusk, open: false, consented: true, canAnswer: false, canDecide: true }]);
    const [row] = await q("SELECT `summary`, `minutes_people` FROM `live_sessions` WHERE `id` = ?", [week2]);
    expect(JSON.parse(String(row.summary)).nights[dusk]).toEqual({ waiting: 0, settled: true });
    expect(String(row.minutes_people)).not.toContain("sleeping on it");
  });
});
