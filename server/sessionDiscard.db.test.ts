/**
 * Discarding a session and deleting a record, against a real schema: who may
 * use DELETE /api/sessions/:id, and that every row the session held is gone
 * afterwards, in all nine tables 0238 and 0255 made.
 *
 * The routes are registered on the fake Express server/liveSessions.db.test.ts
 * uses, with the scratch schema's pool behind them. The members-only gate the
 * routes mount runs in front of every door here (the module gate does not:
 * no module settings are loaded, so it would hide every door), so a guest is
 * refused the way the live server refuses one.
 *
 * WHAT THIS PROVES: the rights matrix (the facilitator discards an open
 * session and may not delete its closed record, a member may do neither, an
 * admin may do both whether or not they ever joined, a guest and a stranger
 * are refused), and that after a yes no row anywhere still names the session,
 * the task layer's included, while the room next door keeps everything.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/liveSessions";
import { SESSION_REFUSALS } from "../shared/sessions";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
type Gate = (req: any, res: any, next: () => void) => unknown;

function collect(): { app: any; handlers: Map<string, Handler>; gates: Gate[] } {
  const handlers = new Map<string, Handler>();
  const gates: Gate[] = [];
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: {
      get: record("GET"),
      post: record("POST"),
      put: record("PUT"),
      patch: record("PATCH"),
      delete: record("DELETE"),
      use: (_p: string, gate: Gate) => {
        gates.push(gate);
      },
    },
    handlers,
    gates,
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

/** Ana opens rooms, Ben and Cai are members, Gil is a guest, the founder is an admin who never joins anything. */
const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben", membershipGranted: true },
  "m-cai": { id: "m-cai", name: "Cai Moreno", handle: "cai", membershipGranted: true },
  "m-guest": { id: "m-guest", name: "Gil Guest", handle: "gil" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};

/** Every table that holds a session's rows, and the column that names the session. */
const KEYED: [string, string][] = [
  ["live_sessions", "id"],
  ["live_session_people", "session_id"],
  ["live_session_items", "session_id"],
  ["live_session_entries", "session_id"],
  ["live_session_responses", "session_id"],
  ["live_session_task_state", "session_id"],
  ["live_session_task_events", "session_id"],
  ["live_session_task_sends", "session_id"],
];

const configured = testDbConfigured();

describe.skipIf(!configured)("discarding a session and deleting a record, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let gates: Gate[];
  let whoami: string | null = null;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the scratch schema this suite provisioned, never a production table

  /** One request as `who`, through the members-only gate first, the way the live server runs it. */
  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const full = { params: {}, body: {}, query: {}, headers: {}, ...req };
    const { res, out } = makeRes();
    let passed = false;
    await gates[1](full, res, () => {
      passed = true;
    });
    if (!passed) return out;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    await handler(full, res);
    return out;
  };
  const room = (id: number) => ({ id: String(id) });
  const discard = (who: string | null, id: number) => as(who, "DELETE /api/sessions/:id", { params: room(id) });

  /** How many rows each table still holds for this session, by table. */
  const leftFor = async (id: number): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const [table, col] of KEYED) out[table] = Number((await q(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` = ?`, [id]))[0].n);
    return out;
  };
  const none = Object.fromEntries(KEYED.map(([t]) => [t, 0]));

  /** A room with something in every one of its tables: people, an item, entries, an answer and an arrival. */
  const fullRoom = async (title: string): Promise<{ id: number; action: number }> => {
    const opened = await as("m-ana", "POST /api/sessions", { body: { title, circleId: "c-garden", durationMin: 45 } });
    expect(opened.status).toBe(200);
    const id = opened.body.id as number;
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: room(id) })).status).toBe(200);
    expect((await as("m-ana", "POST /api/sessions/:id/arrival", { params: room(id), body: { score: 8, wish: "more sleep" } })).status).toBe(200);
    const item = await as("m-ana", "POST /api/sessions/:id/items", { params: room(id), body: { title: "Water", aim: "decide", minutes: 10 } });
    expect(item.status).toBe(200);
    expect((await as("m-ben", "POST /api/sessions/:id/entries", { params: room(id), body: { kind: "note", text: "The tank leaks", itemId: item.body.id } })).status).toBe(200);
    const action = await as("m-ben", "POST /api/sessions/:id/entries", { params: room(id), body: { kind: "action", text: "Fix the tank", itemId: item.body.id } });
    expect(action.status).toBe(200);
    expect((await as("m-ben", "PATCH /api/sessions/:id/entries/:entryId", { params: { id: String(id), entryId: String(action.body.id) }, body: { claim: true } })).status).toBe(200);
    expect((await as("m-ben", "POST /api/sessions/:id/respond", { params: room(id), body: { target: "agenda", value: "consent" } })).status).toBe(200);
    return { id, action: action.body.id };
  };

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
      notify: async () => ({ inserted: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
    } as any);
    handlers = c.handlers;
    gates = c.gates;
    expect(gates).toHaveLength(2);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses a stranger and a guest before the door, and a member who does not facilitate at the door", async () => {
    const { id } = await fullRoom("Somebody else's test");
    const before = await leftFor(id);
    expect(await discard(null, id)).toEqual({ status: 401, body: { error: "auth_required" } });
    expect(await discard("m-guest", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.membersOnly } });
    // Ben is in the room and holds an action in it, and still may not discard it.
    expect(await discard("m-ben", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.discardNotYours } });
    // Cai never joined it.
    expect(await discard("m-cai", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.discardNotYours } });
    expect(await leftFor(id)).toEqual(before);
    expect(before.live_sessions).toBe(1);
  });

  it("lets the facilitator discard an open session, and leaves no row of it anywhere", async () => {
    const { id } = await fullRoom("love");
    const neighbour = await fullRoom("The room next door");
    const before = await leftFor(id);
    // Something really is in every 0238 table before the discard, so the zeros after it mean something.
    expect(before).toMatchObject({ live_sessions: 1, live_session_people: 2, live_session_items: 1, live_session_entries: 2, live_session_responses: 1 });

    expect(await discard("m-ana", id)).toEqual({ status: 200, body: { ok: true } });
    expect(await leftFor(id)).toEqual(none);
    // The room next door keeps every row it had.
    expect(await leftFor(neighbour.id)).toMatchObject({ live_sessions: 1, live_session_people: 2, live_session_items: 1, live_session_entries: 2, live_session_responses: 1 });

    // Everybody else's next poll finds it gone, and the list no longer offers it.
    expect(await as("m-ben", "GET /api/sessions/:id", { params: room(id) })).toMatchObject({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
    const list = await as("m-ben", "GET /api/sessions");
    expect(list.status).toBe(200);
    expect(list.body.open.map((r: any) => r.id)).not.toContain(id);
    expect(list.body.open.map((r: any) => r.id)).toContain(neighbour.id);
    // A write that was on its way lands on nothing, and a second discard finds nothing to discard.
    expect(await as("m-ben", "POST /api/sessions/:id/entries", { params: room(id), body: { kind: "note", text: "Late" } })).toMatchObject({ status: 404 });
    expect(await discard("m-ana", id)).toEqual({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
  });

  it("lets an admin discard an open session they never joined, holding no number at all", async () => {
    const { id } = await fullRoom("Opened by mistake");
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_members` WHERE `user_id` = 'm-founder'")).toEqual([{ n: 0 }]);
    expect(await discard("m-founder", id)).toEqual({ status: 200, body: { ok: true } });
    expect(await leftFor(id)).toEqual(none);
    // The discard handed out no number either.
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_members` WHERE `user_id` = 'm-founder'")).toEqual([{ n: 0 }]);
  });

  it("keeps a closed record from its facilitator and its people, and lets an admin delete it with its tasks", async () => {
    const { id, action } = await fullRoom("Garden circle, week 3");
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: room(id) })).status).toBe(200);
    // The close wrote the task layer's state row. An answer and a send are added the way their doors write them.
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_task_state` WHERE `entry_id` = ?", [action])).toEqual([{ n: 1 }]);
    await q(
      "INSERT INTO `live_session_task_events` (`entry_id`, `session_id`, `kind`, `by_no`, `status`, `note`) VALUES (?, ?, 'not_yet', 1, 'open', 'Waiting on parts')",
      [action, id],
    );
    await q("INSERT INTO `live_session_task_sends` (`session_id`, `send_no`, `sent_by_no`, `counts`) VALUES (?, 1, 0, '{}')", [id]);

    // A later session of the same circle brought an item over from this record.
    const later = await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 4", circleId: "c-garden" } });
    const carried = await as("m-ana", "POST /api/sessions/:id/items", { params: room(later.body.id), body: { title: "Water", aim: "report", minutes: 5, fromSessionId: id } });
    expect(carried.status).toBe(200);

    const before = await leftFor(id);
    expect(before).toMatchObject({ live_sessions: 1, live_session_task_state: 1, live_session_task_events: 1, live_session_task_sends: 1 });
    expect(await discard("m-ana", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.recordAdminOnly } });
    expect(await discard("m-ben", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.recordAdminOnly } });
    expect(await discard("m-guest", id)).toEqual({ status: 403, body: { error: SESSION_REFUSALS.membersOnly } });
    expect(await leftFor(id)).toEqual(before);

    expect(await discard("m-founder", id)).toEqual({ status: 200, body: { ok: true } });
    expect(await leftFor(id)).toEqual(none);
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_task_events` WHERE `entry_id` = ?", [action])).toEqual([{ n: 0 }]);
    // The record is gone for the people who were in it, and from the admin's list.
    expect(await as("m-ben", "GET /api/sessions/:id", { params: room(id) })).toMatchObject({ status: 404 });
    expect((await as("m-founder", "GET /api/sessions")).body.recent.map((r: any) => r.id)).not.toContain(id);
    // The item brought over keeps its words and loses the link to a session that no longer exists.
    expect(await q("SELECT `title`, `from_session_id` FROM `live_session_items` WHERE `id` = ?", [carried.body.id])).toEqual([{ title: "Water", from_session_id: null }]);
  });

  it("answers a session that was never there with the not-found sentence", async () => {
    expect(await discard("m-founder", 999_999)).toEqual({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
    expect(await as("m-founder", "DELETE /api/sessions/:id", { params: { id: "not-a-number" } })).toEqual({ status: 404, body: { error: SESSION_REFUSALS.notFound } });
  });
});
