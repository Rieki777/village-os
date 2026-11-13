/**
 * Goal threads on the quest routes (Phase C, decision 5): every quest carries
 * the season goal it grows and its place, `/api/quests/goals` answers the
 * village's count of open quests per goal, and only an admin sets a thread,
 * only to a goal this season holds. The pool here is a small fake that keeps
 * `app_config` in memory, so the document's round trip is real.
 */
import { describe, expect, it } from "vitest";
import { register } from "./quests";
import { QUEST_THREADS_KEY } from "../../shared/questThreads";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const QUESTS = [
  { id: "q-well", title: "Dig the well", gratitude: "", status: "Open", tags: [], order: 1, circle: "Land" },
  { id: "q-tank", title: "Clean the tank", gratitude: "", status: "Open", tags: [], order: 2, circle: "Land" },
  { id: "q-shut", title: "Old work", gratitude: "", status: "Closed", tags: [], order: 3, circle: "Land" },
  { id: "q-ex", title: "An example", gratitude: "", status: "Open", tags: [], order: 4, isExample: true },
];

function mount({ admin = true, goals = [{ id: "gwater", text: "Clean water all year", done: false }] } = {}) {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => handlers.set(`${method} ${path}`, handler);
  const app: any = { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") };
  const config = new Map<string, string>();
  const pool: any = {
    async query(sql: string, params: any[] = []) {
      if (sql.startsWith("SELECT value FROM app_config")) {
        const v = config.get(params[0]);
        return [v === undefined ? [] : [{ value: v }], []];
      }
      if (sql.startsWith("INSERT INTO app_config")) {
        config.set(params[0], params[1]);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("is_example")) {
        const q = QUESTS.find((x) => x.id === params[0]);
        return [[{ is_example: q?.isExample ? 1 : 0 }], []];
      }
      // Pay rules, badge boosts and the audit row: nothing to read here.
      return [[], []];
    },
  };
  register(app, {
    isAdmin: async () => admin,
    authedUser: async () => null,
    adminActor: () => ({ id: "u-admin" }),
    getPool: () => pool,
    uploadsDir: "/tmp/not-used-here",
    members: { byId: async () => null },
    questsRepo: { byId: async (id: string) => QUESTS.find((q) => q.id === id) ?? null, all: async () => QUESTS },
    claimsRepo: {},
    crewsRepo: {},
    firstName: (n: string) => n,
    notify: async () => {},
    stageOf: async () => "member",
    loadRoles: () => [],
    roleIdsFor: () => [],
    currentPatternId: () => null,
    questConsentRecipients: async () => [],
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    projectCurrency: () => "USD",
    seasonState: () => ({ current: { goals }, seasons: [], timezone: "UTC" }),
  } as any);
  const call = async (key: string, req: any = {}) => {
    const h = handlers.get(key);
    if (!h) throw new Error(`no handler for ${key}`);
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status(c: number) { out.status = c; return res; },
      json(b: unknown) { out.body = b; return res; },
      type: () => res, set: () => res, send: () => res,
    };
    await h({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  return { call, config };
}

const SET = "PUT /api/admin/quests/:id/thread";

describe("goal threads on the quest routes", () => {
  it("an admin threads a quest to a season goal and a place; the board then carries both", async () => {
    const { call, config } = mount();
    const put = await call(SET, { params: { id: "q-well" }, body: { goalId: "gwater", place: "land" } });
    expect(put).toEqual({ status: 200, body: { id: "q-well", goalId: "gwater", place: "land" } });
    expect(JSON.parse(config.get(QUEST_THREADS_KEY)!)).toEqual({ v: 1, quests: { "q-well": { goalId: "gwater", place: "land" } } });
    const board = await call("GET /api/quests");
    const well = board.body.find((q: any) => q.id === "q-well");
    const tank = board.body.find((q: any) => q.id === "q-tank");
    expect(well).toMatchObject({ goalId: "gwater", place: "land" });
    expect(tank).toMatchObject({ goalId: null, place: null });
  });

  it("counts the open quests that grow each goal: closed work and examples never count", async () => {
    const { call, config } = mount();
    config.set(
      QUEST_THREADS_KEY,
      JSON.stringify({ v: 1, quests: { "q-well": { goalId: "gwater" }, "q-tank": { goalId: "gwater" }, "q-shut": { goalId: "gwater" }, "q-ex": { goalId: "gwater" } } }),
    );
    const out = await call("GET /api/quests/goals");
    expect(out.body).toEqual({ goals: [{ id: "gwater", text: "Clean water all year", done: false, openQuests: 2 }] });
  });

  it("refuses a goal the season does not hold, and writes nothing", async () => {
    const { call, config } = mount();
    const out = await call(SET, { params: { id: "q-well" }, body: { goalId: "gelsewhere" } });
    expect(out.status).toBe(400);
    expect(out.body.field).toBe("goalId");
    expect(config.has(QUEST_THREADS_KEY)).toBe(false);
  });

  it("only an admin sets a thread", async () => {
    const { call, config } = mount({ admin: false });
    expect((await call(SET, { params: { id: "q-well" }, body: { goalId: "gwater" } })).status).toBe(401);
    expect(config.has(QUEST_THREADS_KEY)).toBe(false);
  });

  it("a standing example takes no thread", async () => {
    const { call } = mount();
    expect((await call(SET, { params: { id: "q-ex" }, body: { goalId: "gwater" } })).status).toBe(409);
  });

  it("with no current season there are no goals to count, and no goal to thread to", async () => {
    const { call } = mount({ goals: [] });
    expect((await call("GET /api/quests/goals")).body).toEqual({ goals: [] });
    expect((await call(SET, { params: { id: "q-well" }, body: { goalId: "gwater" } })).status).toBe(400);
  });
});
