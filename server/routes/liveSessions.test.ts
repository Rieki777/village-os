/**
 * The Live Sessions routes with no database: who may reach which door, the
 * module gate, the refusals that come before any work, the ETag's 304, and
 * the privacy line as the wire carries it.
 *
 * `register` runs against a fake Express that records handlers by method and
 * path, the shape server/routes/journal.test.ts uses, so what runs is the real
 * registration and the real handler bodies. The pool is a stand-in that
 * answers each SELECT by the table it reads, and records every statement, so
 * a case can say what a refused request never touched.
 *
 * A whole session against a real schema is server/liveSessions.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE_REFUSAL, SESSION_COPY, SESSION_REFUSALS } from "../../shared/sessions";
import { sessionEtag } from "../lib/liveSessions";
import { register } from "./liveSessions";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const DOORS = [
  "GET /api/sessions",
  "POST /api/sessions",
  "GET /api/sessions/:id",
  "POST /api/sessions/:id/join",
  "POST /api/sessions/:id/here",
  "POST /api/sessions/:id/arrival",
  "POST /api/sessions/:id/items",
  "PATCH /api/sessions/:id/items/:itemId",
  "POST /api/sessions/:id/entries",
  "PATCH /api/sessions/:id/entries/:entryId",
  "DELETE /api/sessions/:id/entries/:entryId",
  "POST /api/sessions/:id/respond",
  "POST /api/sessions/:id/act",
  "POST /api/sessions/:id/hosts",
  "POST /api/sessions/:id/close",
  "POST /api/sessions/:id/tool-feedback",
  "GET /api/sessions/:id/minutes.md",
];

function collect(): { app: any; handlers: Map<string, Handler>; mounts: string[]; gates: ((req: any, res: any, next: () => void) => unknown)[] } {
  const handlers = new Map<string, Handler>();
  const mounts: string[] = [];
  const gates: ((req: any, res: any, next: () => void) => unknown)[] = [];
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
      use: (p: string, gate: (req: any, res: any, next: () => void) => unknown) => {
        mounts.push(p);
        gates.push(gate);
      },
    },
    handlers,
    mounts,
    gates,
  };
}

function makeRes() {
  const out: { status: number; body: any; headers: Record<string, string>; text: string | null; ended: boolean } = {
    status: 200,
    body: undefined,
    headers: {},
    text: null,
    ended: false,
  };
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
    send(text: string) {
      out.text = text;
      return res;
    },
    end() {
      out.ended = true;
      return res;
    },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
  return out;
};

/**
 * A pool that answers a SELECT by the table after its FROM, through `answer`,
 * and a write with one affected row. Transactions run on the same answers.
 */
function stubPool(answer: (table: string, sql: string) => any[] = () => []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (!/^\s*SELECT/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }, []];
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1] ?? "";
    return [answer(table, sql), []];
  };
  const conn = {
    query,
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  };
  return { queries, pool: { query, getConnection: async () => conn } as any };
}

/**
 * The people, as `authedUser` hands back their member records. Ana and Ben
 * were admitted; the guest and the participant stand below Member; the
 * founder is an admin with no admission on record.
 */
const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben", membershipGranted: true },
  "m-placed": { id: "m-placed", name: "Pia Placed", handle: "pia", stageGranted: "member" },
  "m-guest": { id: "m-guest", name: "Gil Guest", handle: "gil" },
  "m-participant": { id: "m-participant", name: "Pat Trained", handle: "pat", stageGranted: "participant" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};
/** Each member's number in the stub's `live_session_members`. */
const NUMBERS: Record<string, number> = { "m-ana": 1, "m-ben": 2, "m-founder": 3 };

function deps(pool: any, who: () => string | null, extra: Partial<Record<string, unknown>> = {}) {
  return {
    authedUser: async () => {
      const id = who();
      return id ? { ...(PEOPLE[id] ?? { id }), id } : null;
    },
    isAdmin: async () => who() === "m-founder",
    getPool: () => pool,
    overLimit: async () => false,
    members: { byId: async (id: string) => PEOPLE[id] ?? null },
    notify: async () => ({ inserted: true }),
    notifyAdmins: async () => undefined,
    circlesRepo: {
      all: () => [
        { id: "c-garden", name: "Garden circle", status: "active" },
        { id: "c-resting", name: "Resting circle", status: "dormant" },
        { id: "c-example", name: "Example circle", status: "active", isExample: true },
      ],
    },
    ...extra,
  } as any;
}

const T0 = 1_900_000_000_000;

/** A session row as the driver hands it back. */
const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: 12,
  title: "Garden circle, week 2",
  circle_id: null,
  status: "open",
  facilitator_no: 1,
  secretary_no: null,
  created_by_no: 1,
  duration_min: 60,
  state: null,
  version: 4,
  stamp: JSON.stringify({ moonName: "Full moon", moonGlyph: "", moonOrdinal: null, season: "autumn", placeLine: null }),
  summary: null,
  created_at: new Date(T0 - 60_000),
  closed_at: null,
  ...over,
});

/**
 * A room: one session row, the people in it, and whatever else a case adds.
 * `me` is the member whose number the stub hands back.
 */
function roomPool(opts: {
  me: string;
  session?: Record<string, unknown>;
  people?: Record<string, unknown>[];
  entries?: Record<string, unknown>[];
  responses?: Record<string, unknown>[];
  facilitation?: Record<string, unknown>[];
  minutes?: Record<string, unknown>;
}) {
  const people = opts.people ?? [{ member_no: 1, joined_at: new Date(T0 - 50_000), last_seen_at: new Date(T0 - 1000), arrival_score: 8, arrival_wish: "more sleep" }];
  return stubPool((table, sql) => {
    switch (table) {
      case "live_session_members":
        if (sql.includes("`user_id` = ?")) return NUMBERS[opts.me] ? [{ no: NUMBERS[opts.me] }] : [];
        return Object.entries(NUMBERS).map(([user_id, no]) => ({ no, user_id }));
      case "live_sessions":
        if (sql.includes("`minutes_people`")) return [{ status: opts.session?.status ?? "open", ...(opts.minutes ?? {}) }];
        return [sessionRow(opts.session)];
      case "live_session_people":
        if (sql.includes("`member_no` = ?")) return people.filter((p) => p.member_no === NUMBERS[opts.me]);
        return people;
      case "live_session_entries":
        return opts.entries ?? [];
      case "live_session_responses":
        return sql.includes("`target` = 'facilitation'") ? (opts.facilitation ?? []) : (opts.responses ?? []);
      default:
        return [];
    }
  });
}

/* ========================================================================== *
 * The doors.
 * ========================================================================== */

describe("who may reach a live session", () => {
  it("registers exactly the contract's doors, behind the module gate and the members-only gate", () => {
    const { app, handlers, mounts } = collect();
    register(app, deps(stubPool().pool, () => "m-ana"));
    expect([...handlers.keys()].sort()).toEqual([...DOORS].sort());
    expect(mounts).toEqual(["/api/sessions", "/api/sessions"]);
  });

  it("mounts the module gate itself: a village with the module off hides every door", async () => {
    const { app, gates } = collect();
    register(app, deps(stubPool().pool, () => "m-ana"));
    expect(gates).toHaveLength(2);
    // No module settings are loaded in this file, so the stored lifecycle is "off".
    const { res, out } = makeRes();
    let passed = false;
    await gates[0]({ headers: {} }, res, () => {
      passed = true;
    });
    expect(passed, "an off module must not reach a door").toBe(false);
    expect(out).toMatchObject({ status: 404, body: { error: "module_disabled", module: "sessions" } });
  });

  describe("the members-only gate, mounted right after the module gate", () => {
    /** One pass through the second gate, as `who`. */
    const through = async (who: string | null) => {
      const { app, gates } = collect();
      const { pool, queries } = stubPool();
      register(app, deps(pool, () => who));
      const { res, out } = makeRes();
      let passed = false;
      await gates[1]({ headers: {} }, res, () => {
        passed = true;
      });
      return { passed, out, queries };
    };

    it("refuses a guest, an account the village has not admitted, with one sentence and no database", async () => {
      for (const who of ["m-guest", "m-participant"]) {
        const { passed, out, queries } = await through(who);
        expect(passed, who).toBe(false);
        expect(out).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.membersOnly } });
        expect(queries).toEqual([]);
      }
    });

    it("lets a member through, admitted by vouches or placed on the ladder by hand", async () => {
      for (const who of ["m-ana", "m-placed"]) {
        const { passed, out } = await through(who);
        expect(passed, who).toBe(true);
        expect(out.body).toBeUndefined();
      }
    });

    it("lets an admin through, admitted or not", async () => {
      expect((await through("m-founder")).passed).toBe(true);
    });

    it("leaves a stranger to the door, which answers 401 itself", async () => {
      expect((await through(null)).passed).toBe(true);
    });
  });

  it("registers no admin door and no door that names a member", () => {
    const { app, handlers } = collect();
    register(app, deps(stubPool().pool, () => "m-founder"));
    const doors = [...handlers.keys()];
    expect(doors.filter((d) => d.includes("/api/admin/"))).toEqual([]);
    expect(doors.filter((d) => /:userId|:user\b|:memberId/.test(d))).toEqual([]);
  });

  it.each(DOORS)("refuses a stranger on %s, and never touches the database", async (key) => {
    const { app, handlers } = collect();
    const { pool, queries } = stubPool();
    register(app, deps(pool, () => null));
    const out = await call(handlers, key, { params: { id: "12", itemId: "3", entryId: "4" }, body: { title: "x", text: "y" } });
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: "auth_required" });
    expect(queries, "a refused request must not reach the pool").toEqual([]);
  });

  it.each([
    ["POST /api/sessions", {}],
    ["POST /api/sessions/:id/join", { params: { id: "12" } }],
    ["POST /api/sessions/:id/here", { params: { id: "12" } }],
    ["POST /api/sessions/:id/items", { params: { id: "12" } }],
    ["POST /api/sessions/:id/entries", { params: { id: "12" } }],
    ["POST /api/sessions/:id/respond", { params: { id: "12" } }],
    ["POST /api/sessions/:id/tool-feedback", { params: { id: "12" }, body: { text: "More room for notes" } }],
  ])("bounds %s per member, before any work", async (key, req) => {
    const { app, handlers } = collect();
    const { pool, queries } = stubPool();
    const buckets: string[] = [];
    register(
      app,
      deps(pool, () => "m-ana", {
        overLimit: async (bucket: string) => {
          buckets.push(bucket);
          return true;
        },
      }),
    );
    const out = await call(handlers, key, req);
    expect(out.status).toBe(429);
    expect(out.body).toEqual({ error: SESSION_REFUSALS.slowDown });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatch(/^sessions-[a-z]+:m-ana$/);
    expect(queries).toEqual([]);
  });

  it("refuses a session with no title, and a circle the village does not have, before the pool", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = stubPool();
    register(app, deps(pool, () => "m-ana"));
    expect(await call(handlers, "POST /api/sessions", { body: { title: "  " } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.titleNeeded },
    });
    // A dormant circle and a standing example are not circles a session can meet in.
    for (const circleId of ["c-elsewhere", "c-resting", "c-example"]) {
      expect(await call(handlers, "POST /api/sessions", { body: { title: "Weekly", circleId } }), circleId).toMatchObject({
        status: 400,
        body: { error: SESSION_REFUSALS.circleUnknown },
      });
    }
    expect(queries).toEqual([]);
  });

  it("answers 404 to an id that is not a number, before the pool", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = stubPool();
    register(app, deps(pool, () => "m-ana"));
    for (const key of ["GET /api/sessions/:id", "POST /api/sessions/:id/join", "GET /api/sessions/:id/minutes.md"]) {
      const out = await call(handlers, key, { params: { id: "twelve" } });
      expect(out.status, key).toBe(404);
      expect(out.body).toEqual({ error: SESSION_REFUSALS.notFound });
    }
    expect(queries).toEqual([]);
  });

  it("refuses a write from somebody who never joined, and says the room is there", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = roomPool({ me: "m-stranger" });
    register(app, deps(pool, () => "m-stranger"));
    const out = await call(handlers, "POST /api/sessions/:id/entries", { params: { id: "12" }, body: { kind: "note", text: "hello" } });
    expect(out).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.joinFirst } });
    expect(queries.filter((q) => !/^\s*SELECT/i.test(q.sql))).toEqual([]);
  });

  it("refuses a move the room does not know", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = roomPool({ me: "m-ana" });
    register(app, deps(pool, () => "m-ana"));
    const out = await call(handlers, "POST /api/sessions/:id/act", { params: { id: "12" }, body: { action: { type: "fly" } } });
    expect(out).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.actionUnknown } });
    expect(queries.filter((q) => !/^\s*SELECT/i.test(q.sql))).toEqual([]);
  });

  it("refuses to close while an action has nobody holding it, names it, and writes nothing", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = roomPool({
      me: "m-ana",
      entries: [
        { id: 9, session_id: 12, item_id: null, kind: "action", text: "Order seed", status: "open", author_no: 1, owner_no: null, owner_seat_id: null, due_on: null, claimed_at: null, created_at: new Date(T0) },
        { id: 10, session_id: 12, item_id: null, kind: "action", text: "Mend gate", status: "open", author_no: 1, owner_no: 2, owner_seat_id: null, due_on: null, claimed_at: null, created_at: new Date(T0) },
      ],
    });
    register(app, deps(pool, () => "m-ana"));
    const out = await call(handlers, "POST /api/sessions/:id/close", { params: { id: "12" } });
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ error: CLOSE_REFUSAL, unowned: [9] });
    expect(queries.filter((q) => !/^\s*SELECT/i.test(q.sql))).toEqual([]);
  });

  it("closes only for the facilitator or an admin", async () => {
    const { app, handlers } = collect();
    const { pool } = roomPool({
      me: "m-ben",
      people: [
        { member_no: 1, joined_at: new Date(T0), last_seen_at: new Date(T0), arrival_score: null, arrival_wish: null },
        { member_no: 2, joined_at: new Date(T0), last_seen_at: new Date(T0), arrival_score: null, arrival_wish: null },
      ],
    });
    register(app, deps(pool, () => "m-ben"));
    const out = await call(handlers, "POST /api/sessions/:id/close", { params: { id: "12" } });
    expect(out).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
  });
});

/* ========================================================================== *
 * The view: the ETag, and the privacy line on the wire.
 * ========================================================================== */

describe("the room's view", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends an ETag and answers 304 while nothing moved, before building anything", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = roomPool({ me: "m-ana" });
    register(app, deps(pool, () => "m-ana"));

    const first = await call(handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBe(sessionEtag({ id: 12, version: 4, status: "open" }, { no: 1, admin: false }, T0));
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    expect(first.headers.vary).toBe("Authorization");
    expect(first.body.version).toBe(4);
    expect(first.body.me).toEqual({ userId: 1, joined: true, facilitates: true, secretary: false, admin: false });

    queries.length = 0;
    const again = await call(handlers, "GET /api/sessions/:id", { params: { id: "12" }, headers: { "if-none-match": first.headers.etag } });
    expect(again.status).toBe(304);
    expect(again.ended).toBe(true);
    expect(again.body).toBeUndefined();
    expect(queries.some((q) => q.sql.includes("live_session_items")), "a 304 builds no view").toBe(false);

    const weak = await call(handlers, "GET /api/sessions/:id", { params: { id: "12" }, headers: { "if-none-match": `W/${first.headers.etag}` } });
    expect(weak.status).toBe(304);
  });

  it("answers in full once the presence bucket turns, so who is here refreshes", async () => {
    const { app, handlers } = collect();
    register(app, deps(roomPool({ me: "m-ana" }).pool, () => "m-ana"));
    const first = await call(handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    vi.setSystemTime(T0 + 20_000);
    const later = await call(handlers, "GET /api/sessions/:id", { params: { id: "12" }, headers: { "if-none-match": first.headers.etag } });
    expect(later.status).toBe(200);
    expect(later.headers.etag).not.toBe(first.headers.etag);
  });

  it("lets the people in the room hear the arrival round, and nobody outside it", async () => {
    const people = [
      { member_no: 1, joined_at: new Date(T0), last_seen_at: new Date(T0 - 1000), arrival_score: 8, arrival_wish: "more sleep" },
      { member_no: 2, joined_at: new Date(T0), last_seen_at: new Date(T0 - 1000), arrival_score: 4, arrival_wish: "a quiet morning" },
    ];
    const responses = [{ target: "word", member_no: 2, value: "grateful", text: null }];

    const inside = collect();
    register(inside.app, deps(roomPool({ me: "m-ben", people, responses }).pool, () => "m-ben"));
    const heard = await call(inside.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(heard.body.people.map((p: any) => [p.userId, p.arrival, p.wish, p.present])).toEqual([
      [1, 8, "more sleep", true],
      [2, 4, "a quiet morning", true],
    ]);
    expect(heard.body.responses).toEqual([{ target: "word", userId: 2, value: "grateful", text: null }]);

    // The founder is an admin and is not in this room.
    const outside = collect();
    register(outside.app, deps(roomPool({ me: "m-founder", people, responses }).pool, () => "m-founder"));
    const seen = await call(outside.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(seen.status).toBe(200);
    expect(seen.body.me.joined).toBe(false);
    expect(seen.body.people.map((p: any) => [p.arrival, p.wish])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(JSON.stringify(seen.body)).not.toContain("more sleep");
    expect(JSON.stringify(seen.body)).not.toContain("a quiet morning");
  });

  it("hands feedback on the facilitation to the facilitator unsigned, once closed, and to nobody else in the room", async () => {
    const people = [
      { member_no: 1, joined_at: new Date(T0), last_seen_at: new Date(T0), arrival_score: null, arrival_wish: null },
      { member_no: 2, joined_at: new Date(T0), last_seen_at: new Date(T0), arrival_score: null, arrival_wish: null },
    ];
    // Even if a row arrived carrying its member, the wire must not.
    const facilitation = [{ value: "mixed", text: "Keep the breath, shorten the reports", member_no: 2 }];
    const responses = [{ target: "facilitation", member_no: 2, value: "mixed", text: "Keep the breath, shorten the reports" }];
    const closed = { status: "closed", closed_at: new Date(T0) };

    // While the room is open, an answer arriving on the next poll would say who sent it.
    const open = collect();
    const openPool = roomPool({ me: "m-ana", people, facilitation, responses });
    register(open.app, deps(openPool.pool, () => "m-ana"));
    const live = await call(open.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(live.body.facilitation).toBeNull();
    expect(JSON.stringify(live.body)).not.toContain("shorten the reports");
    expect(openPool.queries.some((q) => q.sql.includes("`target` = 'facilitation'")), "an open room never reads the feedback").toBe(false);

    const facilitator = collect();
    register(facilitator.app, deps(roomPool({ me: "m-ana", session: closed, people, facilitation, responses }).pool, () => "m-ana"));
    const mine = await call(facilitator.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(mine.body.facilitation).toEqual([{ value: "mixed", text: "Keep the breath, shorten the reports" }]);
    expect(mine.body.responses).toEqual([]);

    const member = collect();
    register(member.app, deps(roomPool({ me: "m-ben", session: closed, people, facilitation, responses }).pool, () => "m-ben"));
    const theirs = await call(member.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(theirs.status).toBe(200);
    expect(theirs.body.facilitation).toBeNull();
    expect(JSON.stringify(theirs.body)).not.toContain("shorten the reports");
  });

  it("keeps a closed record from anybody who was not in it, and opens it to an admin", async () => {
    const closed = { status: "closed", closed_at: new Date(T0), summary: JSON.stringify({ arrival: { count: 2, median: 6, low: 4, high: 8 } }) };
    const outsider = collect();
    register(outsider.app, deps(roomPool({ me: "m-ben", session: closed, people: [] }).pool, () => "m-ben"));
    expect(await call(outsider.handlers, "GET /api/sessions/:id", { params: { id: "12" } })).toMatchObject({
      status: 403,
      body: { error: SESSION_COPY.closedNoAccess },
    });
    expect(await call(outsider.handlers, "GET /api/sessions/:id/minutes.md", { params: { id: "12" } })).toMatchObject({
      status: 403,
      body: { error: SESSION_COPY.closedNoAccess },
    });

    const admin = collect();
    register(admin.app, deps(roomPool({ me: "m-founder", session: closed, people: [] }).pool, () => "m-founder"));
    const read = await call(admin.handlers, "GET /api/sessions/:id", { params: { id: "12" } });
    expect(read.status).toBe(200);
    expect(read.body.arrival).toEqual({ count: 2, median: 6, low: 4, high: 8 });
  });

  it("serves the minutes as markdown once closed, in the audience asked for", async () => {
    const closed = { status: "closed", closed_at: new Date(T0) };
    const { app, handlers } = collect();
    register(
      app,
      deps(roomPool({ me: "m-ana", session: closed, minutes: { minutes_people: "# For the people\n", minutes_shareable: "# For anyone\n" } }).pool, () => "m-ana"),
    );
    const people = await call(handlers, "GET /api/sessions/:id/minutes.md", { params: { id: "12" } });
    expect(people.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(people.text).toBe("# For the people\n");
    const shareable = await call(handlers, "GET /api/sessions/:id/minutes.md", { params: { id: "12" }, query: { for: "shareable" } });
    expect(shareable.text).toBe("# For anyone\n");

    const open = collect();
    register(open.app, deps(roomPool({ me: "m-ana" }).pool, () => "m-ana"));
    expect(await call(open.handlers, "GET /api/sessions/:id/minutes.md", { params: { id: "12" } })).toMatchObject({
      status: 409,
      body: { error: SESSION_REFUSALS.notClosedYet },
    });
  });
});

describe("an idea for the tool", () => {
  it("lands in the village's feedback inbox as an idea that stays home", async () => {
    const { app, handlers } = collect();
    const { pool, queries } = roomPool({ me: "m-ana" });
    register(app, deps(pool, () => "m-ana"));
    const out = await call(handlers, "POST /api/sessions/:id/tool-feedback", { params: { id: "12" }, body: { text: "  Let the timer chime softer.  " } });
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    const insert = queries.find((q) => q.sql.includes("INSERT INTO feedback_items"));
    expect(insert, "the idea must reach the inbox").toBeTruthy();
    const [, kind, title, detail, pageUrl, submittedBy, , mayRelay] = insert!.params as unknown[];
    expect(kind).toBe("idea");
    expect(title).toBe(`${SESSION_COPY.listTitle}: Let the timer chime softer.`);
    expect(detail).toBe("Let the timer chime softer.");
    expect(pageUrl).toBe("/sessions/12");
    expect(submittedBy).toBe("m-ana");
    expect(mayRelay).toBe(0);
  });

  it("refuses an empty idea, and an idea from outside the room", async () => {
    const { app, handlers } = collect();
    register(app, deps(roomPool({ me: "m-ana" }).pool, () => "m-ana"));
    expect(await call(handlers, "POST /api/sessions/:id/tool-feedback", { params: { id: "12" }, body: { text: " " } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.textNeeded },
    });
    const outside = collect();
    register(outside.app, deps(roomPool({ me: "m-ben" }).pool, () => "m-ben"));
    expect(await call(outside.handlers, "POST /api/sessions/:id/tool-feedback", { params: { id: "12" }, body: { text: "Hello there" } })).toMatchObject({
      status: 403,
      body: { error: SESSION_REFUSALS.joinFirst },
    });
  });
});
