/**
 * The season view's follow-ups against a real schema (0298):
 *
 *   1. A season goal keeps its name: links name a goal by id, survive a
 *      rewording, keep what they served when the goal is removed, tell two
 *      goals with the same words apart, and agree with the migration's
 *      backfill for links made by words before ids existed.
 *   2. Tensions that keep coming up: the same tension in other forms of its
 *      words groups, people who were there can join two or keep one apart,
 *      and a tension that only shares a word with another never groups.
 *   3. A win on an agenda item names the season priority it serves.
 *
 * The season document is a stub `seasonState` the cases rewrite as the
 * season editor would. No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerTemplates } from "./routes/sessionTemplates";
import { assignGoalIds, goalIdFor } from "./lib/seasonGoals";
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

const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz" },
  "m-dee": { id: "m-dee", name: "Dee Lund" },
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const configured = testDbConfigured();

describe.skipIf(!configured)("season goals keep their names, tensions are told apart, agenda wins serve the season", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  // The season document as the season editor leaves it: every goal with its id.
  let goals = assignGoalIds([
    { text: "Water the land", done: false },
    { text: "Welcome new members", done: false },
  ]);
  const season = () => ({ id: "season-autumn", name: "Autumn", focus: "", startsOn: day(-30), endsOn: null, goals });
  const seasonState = () => ({ ...season(), current: season(), seasons: [season()], timezone: "UTC" });

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
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
  const view = async (who: string): Promise<SeasonView> => {
    const out = await as(who, "GET /api/session-templates/season");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body.view;
  };
  const tension = (who: string, shareId: number, body: unknown) =>
    as(who, "POST /api/session-templates/season/tensions/:shareId", { params: { shareId: String(shareId) }, body });

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

  // ── 1. A season goal keeps its name ─────────────────────────────────────

  it("the migration's backfill derives the same id as the server, for any words", async () => {
    for (const text of ["Water the land", "  Welcome new members ", "Agua para todos 🌱", "Rest & repair: \"slowly\""]) {
      const [row] = await q("SELECT CONCAT('g', LEFT(LOWER(SHA1(TRIM(?))), 11)) AS id", [text]);
      expect(row.id, text).toBe(goalIdFor(text));
    }
  });

  let monday = 0;
  it("a priority names its goal by id, and the goal's new words reach every link", async () => {
    monday = await open("m-ana", "Monday", (await template("Monday planning")).id);
    const water = goals[0];
    expect((await room("m-ana", monday)).season?.goals).toEqual(goals.map((g) => ({ id: g.id, text: g.text })));
    const out = await post("m-ana", monday, "/priorities", { text: "Fix the tank", servesGoalId: water.id });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.priorities[0]).toMatchObject({ servesGoalId: water.id, servesGoal: "Water the land" });
    // Somebody refuses to name a goal the season does not hold.
    expect((await post("m-ana", monday, "/priorities", { text: "x", servesGoalId: "g000000000ff" })).body.error).toBe(TEMPLATE_REFUSALS.goalUnknown);

    // The season editor rewords the goal; its id stays.
    goals = goals.map((g) => (g.id === water.id ? { ...g, text: "Irrigate the land" } : g));
    expect((await room("m-ana", monday)).priorities[0]).toMatchObject({ servesGoalId: water.id, servesGoal: "Irrigate the land" });
    const v = await view("m-dee");
    expect(v.goals.find((g) => g.id === water.id)?.priorities.map((p) => p.text)).toEqual(["Fix the tank"]);
    expect(v.unlinked).toEqual([]);
  });

  it("a link made by words before ids existed lands on its goal once the backfill runs", async () => {
    const welcome = goals[1];
    // As the 0292 release wrote it: the words, no id.
    await q("INSERT INTO `live_session_priorities` (`session_id`, `position`, `text`, `author_no`, `serves_goal`) VALUES (?, 9, 'Write the guide', 0, ?)", [monday, welcome.text]);
    await q(
      "UPDATE `live_session_priorities` SET `serves_goal_id` = CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11)) WHERE `serves_goal_id` IS NULL AND `serves_goal` IS NOT NULL AND `serves_goal` <> ''",
    );
    const v = await view("m-dee");
    expect(v.goals.find((g) => g.id === welcome.id)?.priorities.map((p) => p.text)).toEqual(["Write the guide"]);
  });

  it("a goal removed from the season leaves its links saying what they served", async () => {
    const removed = goals[1];
    goals = goals.filter((g) => g.id !== removed.id);
    const v = await view("m-dee");
    expect(v.goals.map((g) => g.text)).toEqual(["Irrigate the land"]);
    expect(v.unlinked.map((p) => [p.text, p.servedGoal])).toEqual([["Write the guide", "Welcome new members"]]);
    // The room says the same, and a new link cannot name it.
    expect((await room("m-ana", monday)).priorities.find((p) => p.text === "Write the guide")).toMatchObject({ servesGoalId: removed.id, servesGoal: "Welcome new members" });
    expect((await post("m-ana", monday, "/priorities", { text: "y", servesGoalId: removed.id })).status).toBe(400);
  });

  it("two goals with the same words stay two goals", async () => {
    goals = assignGoalIds([...goals, { text: "Rest", done: false }, { text: "Rest", done: false }]);
    const [first, second] = goals.filter((g) => g.text === "Rest");
    expect(first.id).not.toBe(second.id);
    await post("m-ana", monday, "/priorities", { text: "Slow Sunday", servesGoalId: second.id });
    const v = await view("m-dee");
    expect(v.goals.filter((g) => g.text === "Rest").map((g) => [g.id, g.priorities.map((p) => p.text)])).toEqual([
      [first.id, []],
      [second.id, ["Slow Sunday"]],
    ]);
    // Naming by words, the way an older client does, finds the first.
    const byWords = await post("m-ana", monday, "/priorities", { text: "Nap", servesGoal: "Rest" });
    expect(byWords.body.priorities.find((p: any) => p.text === "Nap").servesGoalId).toBe(first.id);
  });

  // ── 2. Tensions that keep coming up ─────────────────────────────────────

  let shares: Record<string, number> = {};
  it("groups the same tension in other forms of its words, and never one that only shares a word", async () => {
    const heart = (await template("Heart share")).id;
    const one = await open("m-ana", "Heart share one", heart);
    await join("m-ben", one);
    const two = await open("m-ben", "Heart share two", heart);
    await join("m-ana", two);
    const add = async (who: string, sid: number, kind: string, text: string) => {
      const out = await post(who, sid, "/shares", { kind, text });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      shares[text] = out.body.shares.find((s: any) => s.text === text).id;
    };
    await add("m-ana", one, "tension", "Nobody waters the seedlings");
    await add("m-ana", one, "tension", "Meetings run too long");
    await add("m-ana", one, "tension", "The kitchen rota feels unfair");
    await add("m-ben", two, "not_working", "Seedling watering keeps slipping");
    await add("m-ben", two, "tension", "Our meeting ran over time again");
    await add("m-ben", two, "tension", "The kitchen garden needs compost");

    const v = await view("m-ana");
    const group = (text: string) => v.tensions.find((t) => t.members?.some((m) => m.text === text));
    expect(group("Nobody waters the seedlings")?.sessions).toBe(2);
    expect(group("Seedling watering keeps slipping")).toBe(group("Nobody waters the seedlings"));
    // Shares only "kitchen": two tensions.
    expect(group("The kitchen rota feels unfair")).not.toBe(group("The kitchen garden needs compost"));
    // A paraphrase no word list catches stays apart until people join it.
    expect(group("Meetings run too long")).not.toBe(group("Our meeting ran over time again"));
  });

  it("people who were in both Heart shares can say two tensions are the same, and keep one apart", async () => {
    const joined = await tension("m-ana", shares["Our meeting ran over time again"], { sameAsId: shares["Meetings run too long"] });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    let v = await view("m-ana");
    const meetings = v.tensions.find((t) => t.members?.some((m) => m.text === "Meetings run too long"))!;
    expect(meetings.sessions).toBe(2);
    expect(meetings.members?.map((m) => m.text).sort()).toEqual(["Meetings run too long", "Our meeting ran over time again"]);

    // The word guess put the seedlings together; Ben says his stands alone.
    expect((await tension("m-ben", shares["Seedling watering keeps slipping"], { standsAlone: true })).status).toBe(200);
    v = await view("m-ana");
    const seed = (text: string) => v.tensions.find((t) => t.members?.some((m) => m.text === text));
    expect(seed("Seedling watering keeps slipping")).not.toBe(seed("Nobody waters the seedlings"));
    // And back again.
    expect((await tension("m-ben", shares["Seedling watering keeps slipping"], { standsAlone: false })).status).toBe(200);
    v = await view("m-ana");
    expect(v.tensions.find((t) => t.members?.some((m) => m.text === "Nobody waters the seedlings"))?.sessions).toBe(2);
  });

  it("somebody who was in neither Heart share can neither read nor regroup the tensions", async () => {
    const v = await view("m-dee");
    expect(v.tensions.every((t) => t.text === null && t.members === null)).toBe(true);
    const refused = await tension("m-dee", shares["Meetings run too long"], { standsAlone: true });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(TEMPLATE_REFUSALS.tensionNotYours);
    // Joining needs both: Dee may not join two she never heard.
    expect((await tension("m-dee", shares["Nobody waters the seedlings"], { sameAsId: shares["Meetings run too long"] })).status).toBe(403);
  });

  // ── 3. A win on an agenda item serves the season ────────────────────────

  it("a win shared on an agenda item names the season priority it serves", async () => {
    const friday = await open("m-ana", "Friday", (await template("Friday check-in")).id);
    const item = await as("m-ana", "POST /api/sessions/:id/items", { params: { id: String(friday) }, body: { title: "The week", aim: "report", minutes: 10 } });
    expect(item.status, JSON.stringify(item.body)).toBe(200);
    const itemId = item.body.id;
    const win = await as("m-ana", "POST /api/sessions/:id/entries", { params: { id: String(friday) }, body: { kind: "win", text: "The tank holds water", itemId } });
    expect(win.status, JSON.stringify(win.body)).toBe(200);
    const note = await as("m-ana", "POST /api/sessions/:id/entries", { params: { id: String(friday) }, body: { kind: "note", text: "A note", itemId } });
    const water = goals[0];
    const linked = await as("m-ana", "PATCH /api/session-templates/rooms/:sessionId/entries/:entryId", {
      params: { sessionId: String(friday), entryId: String(win.body.id) },
      body: { servesGoalId: water.id },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.entryLinks).toEqual({ [win.body.id]: water.id });
    // Only a win serves the season.
    const refused = await as("m-ana", "PATCH /api/session-templates/rooms/:sessionId/entries/:entryId", {
      params: { sessionId: String(friday), entryId: String(note.body.id) },
      body: { servesGoalId: water.id },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(TEMPLATE_REFUSALS.onlyWins);
    // The room's own view carries the link on the entry.
    const roomView = await as("m-ana", "GET /api/sessions/:id", { params: { id: String(friday) }, headers: {} });
    expect(roomView.body.entries.find((e: any) => e.id === win.body.id).servesGoalId).toBe(water.id);

    const v = await view("m-dee");
    const wins = v.goals.find((g) => g.id === water.id)!.wins;
    expect(wins.map((w) => [w.text, w.source])).toEqual([["The tank holds water", "item"]]);
    expect(v.weeks.flatMap((w) => w.wins).some((w) => w.text === "The tank holds water")).toBe(true);
  });
});
