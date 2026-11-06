/**
 * Meeting templates against a real schema: the three seeds, keeping the
 * templates behind the gate, the start door that links a session to its
 * template, and the series that makes Monday and Friday feed each other.
 *
 * The room's, the library's and the templates' route modules are registered
 * on a fake Express with the scratch schema's pool behind them, so every case
 * goes through the real doors. The gate is a stub that lets through whoever
 * the case says holds `session.template`.
 *
 * THE CASES RUN IN ORDER and share one story: a circle plans on Monday,
 * reads it back on Friday, and the next Monday takes up what Friday carried.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerTemplates } from "./routes/sessionTemplates";
import { forgetMemberSessions } from "./lib/liveSessions";
import { DEFAULT_TEMPLATES, TEMPLATE_REFUSALS, type SessionTemplate, type TemplateRoomView } from "../shared/sessionTemplates";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", email: "ana@village.example.test" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", email: "ben@village.example.test" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", email: "cai@village.example.test" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("meeting templates against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  /** Who the stub gate lets keep the templates. */
  const keepers = new Set(["m-ana", "m-ben"]);
  const CIRCLES = [{ id: "c-core", name: "Core circle", status: "active" }];

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const list = async (who: string): Promise<{ templates: SessionTemplate[]; mayKeep: boolean }> => {
    const out = await as(who, "GET /api/session-templates");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const bySeedName = async (name: string) => (await list("m-ana")).templates.find((t) => t.name === name)!;
  const open = async (who: string, title: string, templateId?: number): Promise<number> => {
    const out = await as(who, "POST /api/sessions", { body: { title, circleId: "c-core", durationMin: 60, templateId } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const join = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/join", { params: { id: String(id) } })).status).toBe(200);
  const here = async (who: string, id: number) => as(who, "POST /api/sessions/:id/here", { params: { id: String(id) } });
  const close = async (who: string, id: number) => as(who, "POST /api/sessions/:id/close", { params: { id: String(id) } });
  const room = async (who: string, id: number): Promise<TemplateRoomView> => {
    const out = await as(who, "GET /api/session-templates/rooms/:sessionId", { params: { sessionId: String(id) } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const roomPost = async (who: string, id: number, tail: string, body: unknown, extra: Record<string, string> = {}) =>
    as(who, `POST /api/session-templates/rooms/:sessionId${tail}`, { params: { sessionId: String(id), ...extra }, body });
  const mark = async (who: string, id: number, pid: number, body: unknown) =>
    as(who, "PATCH /api/session-templates/rooms/:sessionId/priorities/:pid", { params: { sessionId: String(id), pid: String(pid) }, body });

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
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
      mayAct: async (_req: any, cap: string) => ({ ok: cap === "session.template" && keepers.has(whoami ?? "") }),
      guardCapability: async (_req: any, res: any, cap: string, refusal?: { status: number; body: Record<string, unknown> }) => {
        if (cap === "session.template" && keepers.has(whoami ?? "")) return true;
        res.status(refusal?.status ?? 403).json(refusal?.body ?? { error: "forbidden" });
        return false;
      },
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

  it("seeds the three templates once, linked Monday to Friday and back", async () => {
    const first = await list("m-cai");
    expect(first.mayKeep).toBe(false);
    expect(first.templates.map((t) => t.name).sort()).toEqual(DEFAULT_TEMPLATES.map((s) => s.name).sort());
    const again = await list("m-ana");
    expect(again.mayKeep).toBe(true);
    expect(again.templates).toHaveLength(DEFAULT_TEMPLATES.length);
    const monday = again.templates.find((t) => t.name === "Monday planning")!;
    const friday = again.templates.find((t) => t.name === "Friday check-in")!;
    const heart = again.templates.find((t) => t.name === "Heart share")!;
    expect(friday.feedsFromId).toBe(monday.id);
    expect(monday.feedsFromId).toBe(friday.id);
    expect(heart.flow.some((s) => s.kind === "talking_stick")).toBe(true);
    expect(monday.category).toBe(friday.category);
    // Monday sorts first in its category.
    expect(monday.position).toBeLessThan(friday.position);
  });

  it("keeps templates behind the gate: make, change, duplicate, order, archive", async () => {
    const refused = await as("m-cai", "POST /api/session-templates", { body: { name: "Mine", category: "Other", flow: [] } });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(TEMPLATE_REFUSALS.mayNotKeep);

    const bad = await as("m-ana", "POST /api/session-templates", { body: { name: "Odd", category: "Other", flow: [{ kind: "dance", title: "x", minutes: 5 }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe(TEMPLATE_REFUSALS.kindUnknown);

    const made = await as("m-ana", "POST /api/session-templates", {
      body: { name: "Season close", category: "Heart share", flow: [{ kind: "round", title: "Looking back", prompt: "What did the season teach you?", minutes: 20 }] },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.template.id as number;

    const changed = await as("m-ben", "PATCH /api/session-templates/:id", { params: { id: String(id) }, body: { durationMin: 90, flow: [{ kind: "talking_stick", title: "Around the circle", minutes: 30 }] } });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.template.durationMin).toBe(90);
    expect(changed.body.template.flow[0].kind).toBe("talking_stick");
    expect(changed.body.template.name).toBe("Season close");

    const copy = await as("m-ana", "POST /api/session-templates/:id/duplicate", { params: { id: String(id) } });
    expect(copy.body.template.name).toBe("Season close (copy)");

    const heart = await bySeedName("Heart share");
    const moved = await as("m-ana", "POST /api/session-templates/:id/move", { params: { id: String(id) }, body: { direction: "up" } });
    const order = (moved.body.templates as SessionTemplate[]).filter((t) => t.category === "Heart share").sort((a, b) => a.position - b.position).map((t) => t.id);
    expect(order.indexOf(id)).toBeLessThan(order.indexOf(heart.id));

    const archived = await as("m-ana", "POST /api/session-templates/:id/archive", { params: { id: String(copy.body.template.id) }, body: { archived: true } });
    expect(archived.body.template.status).toBe("archived");
    const start = await as("m-ana", "POST /api/sessions", { body: { title: "From an archived one", templateId: copy.body.template.id } });
    expect(start.status).toBe(400);
    expect(start.body.error).toBe(TEMPLATE_REFUSALS.archived);
  });

  let monday1 = 0;
  let friday1 = 0;

  it("Monday keeps its priorities, and Friday reads them back as Last Monday's priorities", async () => {
    const monday = await bySeedName("Monday planning");
    const friday = await bySeedName("Friday check-in");
    monday1 = await open("m-ana", "Monday, week 1", monday.id);
    await join("m-ben", monday1);
    // Nothing to carry on the first Monday.
    expect((await room("m-ana", monday1)).carried).toBeNull();
    for (const text of ["Fix the water line", "Plan the harvest", "Write the welcome guide"]) {
      const out = await roomPost("m-ana", monday1, "/priorities", { text });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
    }
    // Only a host sets priorities.
    expect((await roomPost("m-ben", monday1, "/priorities", { text: "Mine" })).status).toBe(403);
    expect((await room("m-ben", monday1)).priorities.map((p) => p.text)).toEqual(["Fix the water line", "Plan the harvest", "Write the welcome guide"]);
    expect((await close("m-ana", monday1)).status).toBe(200);

    friday1 = await open("m-ben", "Friday, week 1", friday.id);
    const view = await room("m-ben", friday1);
    expect(view.template?.flow.find((s) => s.kind === "priorities_review")?.title).toBe("Last Monday's priorities");
    expect(view.review?.sessionId).toBe(monday1);
    expect(view.review?.rows.map((p) => p.text)).toEqual(["Fix the water line", "Plan the harvest", "Write the welcome guide"]);
    const [water, harvest, guide] = view.review!.rows;
    expect((await mark("m-ben", friday1, water.id, { outcome: "done" })).status).toBe(200);
    expect((await mark("m-ben", friday1, harvest.id, { outcome: "partly" })).status).toBe(200);
    const last = await mark("m-ben", friday1, guide.id, { outcome: "carried" });
    expect(last.body.review.rows.map((p: any) => p.outcome)).toEqual(["done", "partly", "carried"]);
    // Friday may not rewrite Monday's words.
    expect((await mark("m-ben", friday1, water.id, { text: "Something else" })).status).toBe(400);
    expect((await close("m-ben", friday1)).status).toBe(200);
  });

  it("the next Monday reads Carried over from Friday and takes it up again", async () => {
    const monday = await bySeedName("Monday planning");
    const monday2 = await open("m-ana", "Monday, week 2", monday.id);
    const view = await room("m-ana", monday2);
    expect(view.carried?.sessionId).toBe(friday1);
    expect(view.carried?.rows.map((p) => p.text)).toEqual(["Plan the harvest", "Write the welcome guide"]);
    const taken = await roomPost("m-ana", monday2, "/priorities", { fromCarried: view.carried!.rows[0].id });
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect(taken.body.priorities.map((p: any) => p.text)).toEqual(["Plan the harvest"]);
    // Taken up once, it leaves the carried list.
    expect(taken.body.carried.rows.map((p: any) => p.text)).toEqual(["Write the welcome guide"]);
  });

  it("Heart share passes a visible talking stick and its captures go to a later session", async () => {
    const heart = await bySeedName("Heart share");
    const id = await open("m-ana", "Heart share, autumn", heart.id);
    await join("m-ben", id);
    await join("m-cai", id);
    for (const who of ["m-ana", "m-ben", "m-cai"]) await here(who, id);
    const before = await room("m-cai", id);
    expect(before.stick).toBeNull();
    expect(before.here).toHaveLength(3);
    // Only a host moves the stick.
    expect((await roomPost("m-cai", id, "/stick", { move: "start", order: before.here.map((p) => p.no) })).status).toBe(403);
    const started = await roomPost("m-ana", id, "/stick", { move: "start", order: before.here.map((p) => p.no) });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const anaNo = before.here.find((p) => p.name === "Ana Reyes")!.no;
    const benNo = before.here.find((p) => p.name === "Ben Ortiz")!.no;
    expect(started.body.stick.holder).toBe(anaNo);
    expect(started.body.stick.next).toBe(benNo);
    const passed = await roomPost("m-ana", id, "/stick", { move: "pass" });
    expect(passed.body.stick.holder).toBe(benNo);

    // Anyone in the room captures; the speaker is whoever holds the stick.
    const shared = await roomPost("m-cai", id, "/shares", { kind: "tension", text: "We never decide who waters on weekends" });
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(shared.body.shares[0].speaker).toBe("Ben Ortiz");
    const shareId = shared.body.shares[0].id as number;
    const brought = await roomPost("m-cai", id, "/shares/:shareId/bring", {}, { shareId: String(shareId) });
    expect(brought.status, JSON.stringify(brought.body)).toBe(200);
    expect(brought.body.shares[0].broughtAs).toBeGreaterThan(0);
    const again = await roomPost("m-cai", id, "/shares/:shareId/bring", {}, { shareId: String(shareId) });
    expect(again.status).toBe(409);
    // It is waiting in the agenda library for the circle's next session.
    const lib = await as("m-cai", "GET /api/sessions");
    expect(lib.body.library.items.some((i: any) => i.title === "We never decide who waters on weekends" && i.aim === "explore")).toBe(true);
  });

  it("a member who leaves takes their shares with them", async () => {
    await forgetMemberSessions(pool as any, "m-cai", async (uid) => PEOPLE[uid] ?? null);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `live_session_shares`"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
    expect(Number(rows[0].n)).toBe(0);
  });
});
