/**
 * A circle's season, against a real schema: which sessions count as the
 * circle meeting this season, the counts read from them, and who may read
 * them.
 *
 * The room's and the decisions' route modules are registered on a fake
 * Express with the scratch schema's pool behind them (the decisions module
 * registers the pulse's door). THE CASES RUN IN ORDER: the garden meets once
 * with Ana and Ben, decides one proposal, names one tension and leaves one
 * action with its water role; Ana also closes a session alone, and the
 * kitchen meets once. Dee has standing nowhere.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerDecisions } from "./routes/sessionDecisions";
import { PULSE_REFUSALS, type CirclePulse } from "../shared/sessionPulse";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", membershipGranted: true },
  "m-cai": { id: "m-cai", name: "Cai Moreno", membershipGranted: true },
  "m-dee": { id: "m-dee", name: "Dee Lund", membershipGranted: true },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("a circle's season, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const pulse = (who: string, circleId = "c-garden") => as(who, "GET /api/sessions/circles/:circleId/pulse", { params: { circleId } });
  const open = async (who: string, title: string, circleId: string) => Number((await as(who, "POST /api/sessions", { body: { title, circleId, durationMin: 60 } })).body.id);
  const at = (id: number) => ({ params: { id: String(id) } });

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
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    } as any;
    registerRoom(c.app, deps);
    registerDecisions(c.app, deps);
    handlers = c.handlers;
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");

    // The garden meets: Ana and Ben arrive at 6 and 8, decide one thing, name a tension, leave an action with the water role.
    const week1 = await open("m-ana", "Garden, week 1", "c-garden");
    expect((await as("m-ben", "POST /api/sessions/:id/join", at(week1))).status).toBe(200);
    await as("m-ana", "POST /api/sessions/:id/arrival", { ...at(week1), body: { score: 6 } });
    await as("m-ben", "POST /api/sessions/:id/arrival", { ...at(week1), body: { score: 8 } });
    const add = async (body: Record<string, unknown>) => Number((await as("m-ana", "POST /api/sessions/:id/entries", { ...at(week1), body: { itemId: null, ...body } })).body.id);
    const tanks = await add({ kind: "decision", text: "We fill the tanks on Mondays." });
    await add({ kind: "decision", text: "Paint the shed." });
    await add({ kind: "tension", text: "The hose leaks." });
    await add({ kind: "action", text: "Fix the hose", ownerSeatId: "seat-water" });
    await q("UPDATE `live_session_entries` SET `status` = 'done' WHERE `id` = ?", [tanks]);
    expect((await as("m-ana", "POST /api/sessions/:id/close", at(week1))).status).toBe(200);

    // Ana alone: not the circle meeting.
    const alone = await open("m-ana", "Garden, Ana's notes", "c-garden");
    await as("m-ana", "POST /api/sessions/:id/entries", { ...at(alone), body: { kind: "decision", text: "Mine alone.", itemId: null } });
    expect((await as("m-ana", "POST /api/sessions/:id/close", at(alone))).status).toBe(200);

    // The kitchen meets: not the garden's.
    const kitchen = await open("m-cai", "Kitchen, week 1", "c-kitchen");
    expect((await as("m-dee", "POST /api/sessions/:id/join", at(kitchen))).status).toBe(200);
    expect((await as("m-cai", "POST /api/sessions/:id/close", at(kitchen))).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("counts the circle meeting this season from what its sessions wrote down", async () => {
    const out = await pulse("m-ana");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const p = out.body as CirclePulse;
    expect(p).toMatchObject({ circleId: "c-garden", sessions: 1, people: 2, decisions: 1, tensions: 1, actions: { open: 1, done: 0, letGo: 0 }, arrival: 7 });
    expect(p.since).toBe(new Date().toISOString().slice(0, 10));
  });

  it("leaves out a session whose stamp names another season", async () => {
    const before = ((await pulse("m-ana")).body as CirclePulse).season;
    await q("UPDATE `live_sessions` SET `stamp` = JSON_SET(`stamp`, '$.season', 'a season long gone') WHERE `circle_id` = 'c-garden' AND `title` = 'Garden, week 1'");
    const after = (await pulse("m-ana")).body as CirclePulse;
    // This village has said nowhere where it is, so its season is the natural one by hemisphere, and named.
    expect(typeof before).toBe("string");
    expect(after).toMatchObject({ sessions: 0, decisions: 0, people: 0, arrival: null });
  });

  it("is read by the circle's members and admins, and by nobody else", async () => {
    expect((await pulse("m-ben")).status).toBe(200);
    expect((await pulse("m-founder")).status).toBe(200);
    expect(await pulse("m-dee")).toMatchObject({ status: 403, body: { error: PULSE_REFUSALS.notYours } });
    expect(await pulse("m-ana", "c-moon")).toMatchObject({ status: 404, body: { error: PULSE_REFUSALS.circleUnknown } });
  });
});
