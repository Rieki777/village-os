/**
 * The season so far against a real schema (0292): weekly priorities and wins
 * naming the season priority they serve, the season view's tallies and its
 * weeks, and Heart share tensions that come back, whose words stay with the
 * people who were there.
 *
 * The room's, the library's and the templates' route modules are registered
 * on a fake Express with the scratch schema's pool behind them. The season
 * document is a stub `seasonState`, with one season that started a month ago
 * and runs on.
 *
 * THE CASES RUN IN ORDER and share one story: a Monday, a Friday, two Heart
 * shares, then the season view.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerTemplates } from "./routes/sessionTemplates";
import { TEMPLATE_REFUSALS, type SeasonView, type SessionTemplate, type TemplateRoomView } from "../shared/sessionTemplates";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz" },
  "m-dee": { id: "m-dee", name: "Dee Lund" },
};

const WATER = "Water the land";
const WELCOME = "Welcome new members";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const configured = testDbConfigured();

describe.skipIf(!configured)("the season so far against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const SEASON = { id: "season-autumn", name: "Autumn", focus: "Roots before branches", startsOn: day(-30), endsOn: null, goals: [{ text: WATER, done: false }, { text: WELCOME, done: true }] };
  const PREVIOUS = { id: "season-summer", name: "Summer", focus: "", startsOn: day(-120), endsOn: day(-30), goals: [] };
  const seasonState = () => ({ ...SEASON, current: SEASON, seasons: [PREVIOUS, SEASON], timezone: "UTC" });

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const template = async (name: string): Promise<SessionTemplate> =>
    ((await as("m-ana", "GET /api/session-templates")).body.templates as SessionTemplate[]).find((t) => t.name === name)!;
  const open = async (who: string, title: string, templateId: number) => {
    const out = await as(who, "POST /api/sessions", { body: { title, durationMin: 60, templateId } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const join = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/join", { params: { id: String(id) } })).status).toBe(200);
  const room = async (who: string, id: number): Promise<TemplateRoomView> => (await as(who, "GET /api/session-templates/rooms/:sessionId", { params: { sessionId: String(id) } })).body;
  const post = (who: string, id: number, tail: string, body: unknown, extra: Record<string, string> = {}) =>
    as(who, `POST /api/session-templates/rooms/:sessionId${tail}`, { params: { sessionId: String(id), ...extra }, body });
  const patch = (who: string, id: number, tail: string, body: unknown, extra: Record<string, string>) =>
    as(who, `PATCH /api/session-templates/rooms/:sessionId${tail}`, { params: { sessionId: String(id), ...extra }, body });
  const season = async (who: string, id?: string): Promise<SeasonView> => {
    const out = await as(who, "GET /api/session-templates/season", { query: id ? { season: id } : {} });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body.view;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const c = collect();
    const deps = {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami, stage: "member" } : null),
      isAdmin: async () => false,
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [] },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      seasonState,
      mayAct: async () => ({ ok: true }),
      guardCapability: async () => true,
    } as any;
    registerRoom(c.app, deps);
    registerLibrary(c.app, deps);
    registerTemplates(c.app, deps);
    handlers = c.handlers;
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  let monday = 0;
  let friday = 0;

  it("a Monday's priorities each name the season priority they serve, and nothing else", async () => {
    monday = await open("m-ana", "Monday", (await template("Monday planning")).id);
    const view = await room("m-ana", monday);
    expect(view.season?.goals).toEqual([WATER, WELCOME]);
    expect(view.template?.flow.some((s) => s.kind === "season_priorities")).toBe(true);
    const refused = await post("m-ana", monday, "/priorities", { text: "Fix the tank", servesGoal: "Grow mushrooms" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(TEMPLATE_REFUSALS.goalUnknown);
    await post("m-ana", monday, "/priorities", { text: "Fix the water tank", servesGoal: WATER });
    await post("m-ana", monday, "/priorities", { text: "Mulch the orchard", servesGoal: WATER });
    await post("m-ana", monday, "/priorities", { text: "Write the welcome guide", servesGoal: WELCOME });
    const last = await post("m-ana", monday, "/priorities", { text: "Sort the tool shed" });
    expect(last.body.priorities.map((p: any) => p.servesGoal)).toEqual([WATER, WATER, WELCOME, null]);
    // Linked later, and cleared again.
    const shed = last.body.priorities[3].id;
    expect((await patch("m-ana", monday, "/priorities/:pid", { servesGoal: WELCOME }, { pid: String(shed) })).body.priorities[3].servesGoal).toBe(WELCOME);
    expect((await patch("m-ana", monday, "/priorities/:pid", { servesGoal: null }, { pid: String(shed) })).body.priorities[3].servesGoal).toBeNull();
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(monday) } })).status).toBe(200);
  });

  it("Friday reads the links back, marks the priorities, and shares wins for the season", async () => {
    friday = await open("m-ana", "Friday", (await template("Friday check-in")).id);
    await join("m-ben", friday);
    const view = await room("m-ben", friday);
    expect(view.review?.rows.map((p) => p.servesGoal)).toEqual([WATER, WATER, WELCOME, null]);
    const [tank, mulch, guide] = view.review!.rows;
    await patch("m-ana", friday, "/priorities/:pid", { outcome: "done" }, { pid: String(tank.id) });
    await patch("m-ana", friday, "/priorities/:pid", { outcome: "partly" }, { pid: String(mulch.id) });
    await patch("m-ana", friday, "/priorities/:pid", { outcome: "done" }, { pid: String(guide.id) });
    const win = await post("m-ben", friday, "/shares", { kind: "win", text: "The tank holds water again", servesGoal: WATER });
    expect(win.status, JSON.stringify(win.body)).toBe(200);
    const plain = await post("m-ben", friday, "/shares", { kind: "win", text: "Two new neighbours came to lunch" });
    const second = plain.body.shares.find((s: any) => s.text.startsWith("Two new"));
    const linked = await patch("m-ben", friday, "/shares/:shareId", { servesGoal: WELCOME }, { shareId: String(second.id) });
    expect(linked.body.shares.find((s: any) => s.id === second.id).servesGoal).toBe(WELCOME);
    await post("m-ben", friday, "/shares", { kind: "win", text: "Cleared the path to the river" });
  });

  it("the next Monday takes a carried priority up still serving its season priority", async () => {
    const next = await open("m-ana", "Monday again", (await template("Monday planning")).id);
    const view = await room("m-ana", next);
    const mulch = view.carried!.rows.find((p) => p.text === "Mulch the orchard")!;
    const taken = await post("m-ana", next, "/priorities", { fromCarried: mulch.id });
    expect(taken.body.priorities[0].servesGoal).toBe(WATER);
  });

  it("Heart share tensions that come back are grouped, and their words stay with the people who were there", async () => {
    const heart = await template("Heart share");
    const first = await open("m-ana", "Heart share one", heart.id);
    await post("m-ana", first, "/shares", { kind: "tension", text: "Nobody knows who waters the nursery on weekends" });
    await post("m-ana", first, "/shares", { kind: "grateful", text: "The soup on Thursday" });
    const second = await open("m-ben", "Heart share two", heart.id);
    await post("m-ben", second, "/shares", { kind: "not_working", text: "Weekend watering of the nursery keeps falling through" });

    const ana = await season("m-ana");
    const recurring = ana.tensions.find((t) => t.sessions === 2)!;
    expect(recurring.text).toBe("Weekend watering of the nursery keeps falling through");
    expect(ana.tensions.some((t) => t.text === "The soup on Thursday")).toBe(false);

    // Dee was in neither Heart share: she reads that it came back, not what was said.
    const dee = await season("m-dee");
    expect(dee.tensions.map((t) => [t.sessions, t.text])).toEqual([[2, null]]);
  });

  it("the season view sets each season priority's weekly priorities against how they went, and counts wins over time", async () => {
    const v = await season("m-dee");
    expect(v.season).toMatchObject({ id: "season-autumn", name: "Autumn", focus: "Roots before branches" });
    expect(v.seasons.map((s) => s.id)).toEqual(["season-summer", "season-autumn"]);
    const water = v.goals.find((g) => g.text === WATER)!;
    expect(water.priorities.map((p) => [p.text, p.outcome])).toEqual([
      ["Fix the water tank", "done"],
      ["Mulch the orchard", "partly"],
      ["Mulch the orchard", null],
    ]);
    expect(water.wins.map((w) => w.text)).toEqual(["The tank holds water again"]);
    const welcome = v.goals.find((g) => g.text === WELCOME)!;
    expect(welcome.done).toBe(true);
    expect(welcome.priorities.map((p) => p.outcome)).toEqual(["done"]);
    expect(welcome.wins.map((w) => w.text)).toEqual(["Two new neighbours came to lunch"]);
    expect(v.unlinked.map((p) => p.text)).toEqual(["Sort the tool shed"]);
    expect(v.unlinkedWins.map((w) => w.text)).toEqual(["Cleared the path to the river"]);
    const weeks = v.weeks;
    expect(weeks.reduce((n, w) => n + w.wins.length, 0)).toBe(3);
    expect(weeks.reduce((n, w) => n + w.prioritiesSet, 0)).toBe(5);
    expect(weeks.reduce((n, w) => n + w.prioritiesDone, 0)).toBe(2);
  });

  it("an earlier season reads its own window, and an unknown one is refused", async () => {
    const summer = await season("m-ana", "season-summer");
    expect(summer.goals).toEqual([]);
    expect(summer.weeks).toEqual([]);
    expect(summer.tensions).toEqual([]);
    const out = await as("m-ana", "GET /api/session-templates/season", { query: { season: "season-none" } });
    expect(out.status).toBe(404);
    expect(out.body.error).toBe(TEMPLATE_REFUSALS.seasonUnknown);
  });
});
