/**
 * Every tension becomes an agenda item (sessions feature 2), against a real
 * schema: a tension named in a room is sent to a circle's agenda items.
 *
 * What each case holds: in an open room, whoever named a tension, the hosts
 * and admins may send it on, and nobody else; it becomes a waiting item for
 * the circle chosen, saying where it came from, and the same tension is never
 * sent twice; the room says where each one went; a tension from a closed
 * session goes on from "From last time" for anybody who was in that session,
 * and is offered there no more, while the closed record stays exactly as it
 * was. (A tension raised with a role and brought to its circle is in
 * server/roleTensions.db.test.ts.)
 *
 * The room's and the agenda library's route modules are registered on a fake
 * Express with the scratch schema's pool behind them. THE CASES RUN IN ORDER.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { LIBRARY_REFUSALS, LIBRARY_TENSION_API } from "../shared/sessionLibrary";

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

describe.skipIf(!configured)("every tension becomes an agenda item, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];
  let week1 = 0;
  let rota = 0;
  let shed = 0;
  let note = 0;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const room = (id: number) => ({ id: String(id) });
  const view = async (who: string, id: number) => (await as(who, "GET /api/sessions/:id", { params: room(id) })).body;
  const entry = async (who: string, id: number, kind: string, text: string) => {
    const out = await as(who, "POST /api/sessions/:id/entries", { params: room(id), body: { kind, text, itemId: null } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const send = async (who: string, body: Record<string, unknown>) => as(who, `POST ${LIBRARY_TENSION_API}`, { body });

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
    registerLibrary(c.app, deps);
    handlers = c.handlers;
    // The garden's first meeting: Ana opens it, Ben and Cai join.
    const opened = await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 1", circleId: "c-garden", durationMin: 60 } });
    week1 = Number(opened.body.id);
    for (const who of ["m-ben", "m-cai"]) expect((await as(who, "POST /api/sessions/:id/join", { params: room(week1) })).status).toBe(200);
    rota = await entry("m-ben", week1, "tension", "The water rota leaves Sundays to whoever notices.");
    shed = await entry("m-cai", week1, "tension", "The shed roof leaks onto the seed trays.");
    note = await entry("m-ana", week1, "note", "We start with the water.");
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets whoever named a tension, the hosts and admins send it on, and nobody else", async () => {
    // Dee is not in the room; Cai is in it but neither named the rota tension nor hosts.
    expect(await send("m-dee", { sessionId: week1, entryId: rota, circleId: "c-kitchen" })).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.tensionNotYours } });
    expect(await send("m-cai", { sessionId: week1, entryId: rota, circleId: "c-kitchen" })).toMatchObject({ status: 403 });
    // Only a tension goes on, and only to a live circle.
    expect(await send("m-ana", { sessionId: week1, entryId: note, circleId: "c-kitchen" })).toMatchObject({ status: 404, body: { error: LIBRARY_REFUSALS.tensionNotFound } });
    expect(await send("m-ana", { sessionId: week1, entryId: rota, circleId: "c-moon" })).toMatchObject({ status: 400, body: { error: LIBRARY_REFUSALS.circleGone } });
  });

  it("makes it a waiting item for the circle chosen, saying where it came from, once", async () => {
    const out = await send("m-ben", { sessionId: week1, entryId: rota, circleId: "c-kitchen" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.item).toMatchObject({
      title: "The water rota leaves Sundays to whoever notices.",
      circleId: "c-kitchen",
      status: "waiting",
      mine: true,
      source: { kind: "room_tension", label: "Garden circle" },
    });
    const items = await q("SELECT COUNT(*) AS n FROM `live_session_library`");
    expect(await send("m-ana", { sessionId: week1, entryId: rota, circleId: null })).toMatchObject({ status: 409, body: { error: LIBRARY_REFUSALS.alreadySent } });
    // The refusal is decided before anything is written: no second item, sourced or not.
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_library`")).toEqual(items);
  });

  it("says in the room where each tension went, and hands the circles only to the people in it", async () => {
    const ana = await view("m-ana", week1);
    expect(ana.sentTensions).toEqual({ [String(rota)]: { circleName: "Kitchen circle" } });
    expect(ana.circleOptions.map((c: any) => c.id)).toEqual(["c-garden", "c-kitchen"]);
    expect((await view("m-dee", week1)).circleOptions).toEqual([]);
  });

  it("lets a tension be sent again once its item was withdrawn, and the room says so", async () => {
    const [{ library_id: itemId }] = await q("SELECT `library_id` FROM `live_session_library_sources` WHERE `kind` = 'room_tension' AND `ref` = ?", [String(rota)]);
    expect((await as("m-ben", "DELETE /api/sessions/library/:itemId", { params: { itemId: String(itemId) } })).status).toBe(200);
    expect(await q("SELECT * FROM `live_session_library_sources` WHERE `library_id` = ?", [itemId])).toEqual([]);
    expect((await view("m-ana", week1)).sentTensions).toEqual({});
    const again = await send("m-ana", { sessionId: week1, entryId: rota, circleId: "c-kitchen" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await view("m-ana", week1)).sentTensions).toEqual({ [String(rota)]: { circleName: "Kitchen circle" } });
  });

  it("sends a closed session's tension on from From last time, and offers it there no more, leaving the record as it was", async () => {
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: room(week1) })).status).toBe(200);
    const record = await q("SELECT `id`, `kind`, `status`, `text` FROM `live_session_entries` WHERE `session_id` = ? ORDER BY `id`", [week1]);
    const opened = await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 2", circleId: "c-garden", durationMin: 60 } });
    const week2 = Number(opened.body.id);
    // The rota tension was sent already, so From last time offers only the shed.
    expect((await view("m-ana", week2)).carried.backlog.map((e: any) => e.id)).toEqual([shed]);
    // Dee was not in week 1, so it is not hers to see or send.
    expect(await send("m-dee", { sessionId: week1, entryId: shed, circleId: null })).toMatchObject({ status: 404 });
    // Ben was there: he sends the shed on, to no circle in particular.
    const out = await send("m-ben", { sessionId: week1, entryId: shed, circleId: null });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.item).toMatchObject({ circleId: null, source: { kind: "room_tension", label: "Garden circle" } });
    expect((await view("m-ana", week2)).carried?.backlog ?? []).toEqual([]);
    // The closed record is exactly as it was.
    expect(await q("SELECT `id`, `kind`, `status`, `text` FROM `live_session_entries` WHERE `session_id` = ? ORDER BY `id`", [week1])).toEqual(record);
  });
});
