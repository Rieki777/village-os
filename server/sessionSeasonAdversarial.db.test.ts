/**
 * An adversarial pass on the season-view follow-ups (0298): the cases that
 * try to break goal ids, tension grouping and agenda wins, each asserting
 * what the code does and saying why that is the answer we want.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerTemplates } from "./routes/sessionTemplates";
import { refreshLinkedGoalWords } from "./lib/sessionTemplates";
import { assignGoalIds, goalIdFor } from "./lib/seasonGoals";
import { TEMPLATE_REFUSALS, type SeasonView, type SessionTemplate } from "../shared/sessionTemplates";

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
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader() {},
    send() {
      return res;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

const PEOPLE: Record<string, any> = { "m-ana": { id: "m-ana", name: "Ana Reyes" }, "m-ben": { id: "m-ben", name: "Ben Ortiz" } };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const configured = testDbConfigured();

describe.skipIf(!configured)("season follow-ups, attacked", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  let goals = assignGoalIds([{ text: "Water the land", done: false }]);
  const season = () => ({ id: "s-a", name: "Autumn", focus: "", startsOn: day(-30), endsOn: null, goals });
  const seasonState = () => ({ ...season(), current: season(), seasons: [season()], timezone: "UTC" });

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
  const open = async (who: string, title: string, templateId: number) => Number((await as(who, "POST /api/sessions", { body: { title, durationMin: 60, templateId } })).body.id);
  const post = (who: string, id: number, tail: string, body: unknown) => as(who, `POST /api/session-templates/rooms/:sessionId${tail}`, { params: { sessionId: String(id) }, body });
  const view = async (who: string): Promise<SeasonView> => (await as(who, "GET /api/session-templates/season")).body.view;
  const tension = (who: string, shareId: number, body: unknown) => as(who, "POST /api/session-templates/season/tensions/:shareId", { params: { shareId: String(shareId) }, body });
  const shareId = (out: any, text: string) => out.body.shares.find((s: any) => s.text === text).id as number;

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

  it("a goal renamed with links, then a NEW goal given its old words: the links stay with the renamed one", async () => {
    monday = await open("m-ana", "Monday", (await template("Monday planning")).id);
    const water = goals[0];
    await post("m-ana", monday, "/priorities", { text: "Fix the tank", servesGoalId: water.id });
    // Renamed, keeping its id; then a new goal says the old words, with no id of its own yet.
    goals = assignGoalIds([{ ...water, text: "Irrigate the land" }, { text: "Water the land", done: false }]);
    // What the season's save door runs after storing the document.
    await refreshLinkedGoalWords(pool as any, [season()]);
    const fresh = goals.find((g) => g.text === "Water the land")!;
    expect(fresh.id).toBe(`${goalIdFor("Water the land")}-2`);
    const v = await view("m-ana");
    expect(v.goals.map((g) => [g.text, g.priorities.map((p) => p.text)])).toEqual([
      ["Irrigate the land", ["Fix the tank"]],
      ["Water the land", []],
    ]);
    // An older client naming the goal by words finds the goal that says them now.
    const byWords = await post("m-ana", monday, "/priorities", { text: "Dig the swale", servesGoal: "Water the land" });
    expect(byWords.body.priorities.find((p: any) => p.text === "Dig the swale").servesGoalId).toBe(fresh.id);
  });

  it("a goal deleted, then typed again as a new goal, is a new goal: what served the old one keeps saying what it served", async () => {
    const irrigate = goals.find((g) => g.text === "Irrigate the land")!;
    goals = goals.filter((g) => g.id !== irrigate.id);
    expect((await view("m-ana")).unlinked.map((p) => [p.text, p.servedGoal])).toEqual([["Fix the tank", "Irrigate the land"]]);
    // Typed again in the season editor: a new row with no id, so it derives one from its words.
    // Its id came from "Water the land" when it was first written, so the new row does not take it back.
    goals = assignGoalIds([...goals.map((g) => ({ ...g })), { text: "Irrigate the land", done: false }]);
    const again = (await view("m-ana")).unlinked.map((p) => [p.text, p.servedGoal]);
    expect(again).toEqual([["Fix the tank", "Irrigate the land"]]);
  });

  it("two goals with the same words, the first deleted: what served the second stays, what served the first says so", async () => {
    goals = assignGoalIds([{ text: "Rest", done: false }, { text: "Rest", done: false }]);
    const [first, second] = goals;
    await post("m-ana", monday, "/priorities", { text: "Nap", servesGoalId: first.id });
    await post("m-ana", monday, "/priorities", { text: "Slow Sunday", servesGoalId: second.id });
    goals = goals.filter((g) => g.id !== first.id);
    const v = await view("m-ana");
    expect(v.goals.map((g) => [g.id, g.priorities.map((p) => p.text)])).toEqual([[second.id, ["Slow Sunday"]]]);
    expect(v.unlinked.find((p) => p.text === "Nap")?.servedGoal).toBe("Rest");
  });

  it("a season document with a forged id cannot borrow another goal's place", () => {
    const [a, b] = assignGoalIds([
      { id: goalIdFor("Water the land"), text: "Water the land", done: false },
      { id: goalIdFor("Water the land"), text: "Something else", done: false },
    ]);
    expect(a.id).not.toBe(b.id);
    expect(assignGoalIds([{ id: "g'; DROP TABLE x;--", text: "x", done: false }])[0].id).toBe(goalIdFor("x"));
  });

  let shares: Record<string, number> = {};
  it("paraphrases that should NOT group stay apart; the one the word guess wrongly groups is kept apart by the people there", async () => {
    const heart = (await template("Heart share")).id;
    const one = await open("m-ana", "Heart share one", heart);
    const add = async (sid: number, text: string, kind = "tension") => (shares[text] = shareId(await post("m-ana", sid, "/shares", { kind, text }), text));
    await add(one, "Nobody waters the seedlings");
    await add(one, "Nobody tells newcomers about the seedling swap");
    await add(one, "The water tanks are empty again");
    await add(one, "The kitchen rota feels unfair");
    await add(one, "We need a rota for the kitchen garden");
    await add(one, "Everyone showed up for the compost day", "win");
    const group = (v: SeasonView, text: string) => v.tensions.find((t) => t.members?.some((m) => m.text === text));
    let v = await view("m-ana");
    // One shared word ("seedling", "water") never groups.
    expect(group(v, "Nobody waters the seedlings")).not.toBe(group(v, "Nobody tells newcomers about the seedling swap"));
    expect(group(v, "Nobody waters the seedlings")).not.toBe(group(v, "The water tanks are empty again"));
    // "kitchen" and "rota" both: the guess groups two different tensions. That is what the people's say is for.
    expect(group(v, "The kitchen rota feels unfair")).toBe(group(v, "We need a rota for the kitchen garden"));
    expect((await tension("m-ana", shares["We need a rota for the kitchen garden"], { standsAlone: true })).status).toBe(200);
    v = await view("m-ana");
    expect(group(v, "The kitchen rota feels unfair")).not.toBe(group(v, "We need a rota for the kitchen garden"));
  });

  it("regrouping refuses itself, a win, and a share that is not there; a cycle of 'same as' is one tension", async () => {
    const a = shares["Nobody waters the seedlings"];
    const b = shares["The water tanks are empty again"];
    expect((await tension("m-ana", a, { sameAsId: a })).status).toBe(404);
    expect((await tension("m-ana", shares["Everyone showed up for the compost day"], { standsAlone: true })).status).toBe(404);
    expect((await tension("m-ana", 999999, { standsAlone: true })).status).toBe(404);
    expect((await tension("m-ana", a, { sameAsId: b })).status).toBe(200);
    expect((await tension("m-ana", b, { sameAsId: a })).status).toBe(200);
    const v = await view("m-ana");
    const g = v.tensions.find((t) => t.members?.some((m) => m.shareId === a))!;
    expect(g.members?.map((m) => m.shareId).sort()).toEqual([a, b].sort());
  });

  it("a win's link refuses an entry of another session and a closed room", async () => {
    const friday = await open("m-ana", "Friday", (await template("Friday check-in")).id);
    const item = await as("m-ana", "POST /api/sessions/:id/items", { params: { id: String(friday) }, body: { title: "Week", aim: "report", minutes: 10 } });
    const win = await as("m-ana", "POST /api/sessions/:id/entries", { params: { id: String(friday) }, body: { kind: "win", text: "Rain barrel fixed", itemId: item.body.id } });
    const link = (sessionId: number) =>
      as("m-ana", "PATCH /api/session-templates/rooms/:sessionId/entries/:entryId", {
        params: { sessionId: String(sessionId), entryId: String(win.body.id) },
        body: { servesGoalId: goals[0].id },
      });
    const elsewhere = await link(monday);
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.error).toBe(TEMPLATE_REFUSALS.entryNotFound);
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(friday) } })).status).toBe(200);
    expect((await link(friday)).status).toBe(409);
  });
});
