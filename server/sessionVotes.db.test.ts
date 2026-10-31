/**
 * The room votes its agenda (0290), against a real schema, through the real
 * handlers (the harness server/sessionOnBehalf.db.test.ts uses).
 *
 * Rye, 2026-10-30: "In sessions this should be a vote (where we can crowd vote
 * ones up and down and together select the priority)". What this proves:
 *
 *   ONE VOTE    a person votes an item up or down once; voting again changes
 *               it, 0 takes it back, and the tally reads every vote
 *   THE ORDER   while the vote is open the agenda's positions are the score,
 *               ties keeping their order, a new item placed by its score
 *   SET         only the facilitator sets the order; the vote then closes
 *               and the order stands, and opening it again sorts once more
 *   OWN VOTE    nobody votes for anybody else, the facilitator included
 *   WAITING     an item already talked about is not voted on
 *   RECORD      a member's export carries their votes; erasure takes them
 *
 * THE CASES RUN IN ORDER and share one room. No TEST_DATABASE_URL and the
 * suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { exportMemberSessions, register } from "./routes/liveSessions";
import { forgetMemberSessions } from "./lib/liveSessions";
import { VOTE_REFUSALS } from "../shared/sessionVotes";
import { ON_BEHALF_REFUSALS } from "../shared/sessionOnBehalf";
import { SESSION_REFUSALS } from "../shared/sessions";

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

describe.skipIf(!testDbConfigured())("the room votes its agenda", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const room = (extra: Record<string, string> = {}) => ({ id: String(sid), ...extra });
  const view = async (who: string) => (await as(who, "GET /api/sessions/:id", { params: room() })).body;
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0].no);
  const vote = (who: string, itemId: number, v: unknown, extra: Record<string, unknown> = {}) =>
    as(who, "POST /api/sessions/:id/items/:itemId/vote", { params: room({ itemId: String(itemId) }), body: { vote: v, ...extra } });
  const setOrder = (who: string, set: unknown) => as(who, "POST /api/sessions/:id/agenda/order", { params: room(), body: { set } });
  const add = async (who: string, title: string) =>
    (await as(who, "POST /api/sessions/:id/items", { params: room(), body: { title, aim: "explore", minutes: 10 } })).body.id as number;
  const votesOn = async (who: string, itemId: number) => (await view(who)).items.find((i: any) => i.id === itemId).votes;
  /** The agenda's titles in the order the room reads it. */
  const order = async () =>
    (await view("m-ana")).items
      .filter((i: any) => i.status !== "parked")
      .sort((a: any, b: any) => a.position - b.position)
      .map((i: any) => i.title);

  let sid = 0;
  let ben = 0;
  let cai = 0;
  let tank = 0;
  let seeds = 0;
  let paths = 0;

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

    sid = (await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 5", circleId: "c-garden" } })).body.id;
    for (const w of ["m-ben", "m-cai", "m-founder"]) expect((await as(w, "POST /api/sessions/:id/join", { params: room() })).status).toBe(200);
    ben = await noOf("m-ben");
    cai = await noOf("m-cai");
    tank = await add("m-ana", "Water tank");
    seeds = await add("m-ben", "Seed swap");
    paths = await add("m-cai", "Paths");
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("starts with no votes and the order the items were added in", async () => {
    const v = await view("m-ben");
    expect(v.state.orderSet).toBe(false);
    for (const i of v.items) expect(i.votes).toEqual({ up: 0, down: 0, mine: 0 });
    expect(await order()).toEqual(["Water tank", "Seed swap", "Paths"]);
  });

  it("counts one vote per person, changes it, takes it back, and sorts the agenda by the score", async () => {
    expect((await vote("m-ben", paths, 1)).status).toBe(200);
    expect((await vote("m-cai", paths, 1)).status).toBe(200);
    expect(await order()).toEqual(["Paths", "Water tank", "Seed swap"]);

    // Voting twice the same way is still one vote; voting the other way changes it.
    await vote("m-ben", paths, 1);
    expect(await votesOn("m-ben", paths)).toEqual({ up: 2, down: 0, mine: 1 });
    await vote("m-ben", paths, -1);
    expect(await votesOn("m-ben", paths)).toEqual({ up: 1, down: 1, mine: -1 });
    // Ties keep the order they had: Paths and Water tank both score 0 now.
    expect(await order()).toEqual(["Paths", "Water tank", "Seed swap"]);

    await vote("m-ana", tank, -1);
    await vote("m-founder", seeds, 1);
    expect(await order()).toEqual(["Seed swap", "Paths", "Water tank"]);
    // Every tally is the room's; each viewer reads only their own vote as theirs.
    expect(await votesOn("m-cai", paths)).toEqual({ up: 1, down: 1, mine: 1 });
    expect(await votesOn("m-cai", tank)).toEqual({ up: 0, down: 1, mine: 0 });

    // 0 takes a vote back.
    await vote("m-ben", paths, 0);
    expect(await votesOn("m-ben", paths)).toEqual({ up: 1, down: 0, mine: 0 });
    const rows = await q("SELECT `item_id`, `member_no`, `vote` FROM `live_session_item_votes` WHERE `session_id` = ?", [sid]);
    expect(rows).toHaveLength(3);
    expect(rows.some((r: any) => r.member_no === ben)).toBe(false);
  });

  it("places a new item by its score, above an item the room voted down", async () => {
    await add("m-cai", "Tool shed");
    expect(await order()).toEqual(["Seed swap", "Paths", "Tool shed", "Water tank"]);
  });

  it("refuses a vote that is not 1, -1 or 0, and a vote for somebody else, the facilitator's included", async () => {
    for (const bad of [2, "up", null, true]) {
      const out = await vote("m-ben", seeds, bad);
      expect(out.status, String(bad)).toBe(400);
      expect(out.body.error).toBe(VOTE_REFUSALS.voteValue);
    }
    const proxy = await vote("m-ana", seeds, -1, { forUserId: ben });
    expect(proxy.status).toBe(403);
    expect(proxy.body.error).toBe(ON_BEHALF_REFUSALS.ownAnswer);
    // Dee never joined the room.
    expect((await vote("m-dee", seeds, 1)).status).toBe(403);
    expect(await votesOn("m-ana", seeds)).toEqual({ up: 1, down: 0, mine: 0 });
  });

  it("lets only whoever runs the room set the order, then closes the vote and keeps the order", async () => {
    // Whoever runs the room (the facilitator, the note taker, an admin in it) moves the agenda; a member does not.
    for (const who of ["m-ben", "m-cai"]) {
      const out = await setOrder(who, true);
      expect(out.status, who).toBe(403);
      expect(out.body.error).toBe(SESSION_REFUSALS.facilitatorOnly);
    }
    expect((await setOrder("m-ana", "yes")).status).toBe(400);
    const set = await setOrder("m-ana", true);
    expect(set.status).toBe(200);
    expect(set.body.state.orderSet).toBe(true);
    expect((await view("m-ben")).state.orderSet).toBe(true);

    const closed = await vote("m-cai", tank, 1);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe(VOTE_REFUSALS.voteClosed);
    // The arrows move items by hand now, and a new item goes to the end.
    expect((await as("m-ana", "PATCH /api/sessions/:id/items/:itemId", { params: room({ itemId: String(tank) }), body: { position: 1 } })).status).toBe(200);
    await add("m-ben", "Bees");
    expect(await order()).toEqual(["Water tank", "Seed swap", "Paths", "Tool shed", "Bees"]);
  });

  it("opens the vote again and sorts by the score once more", async () => {
    expect((await setOrder("m-ana", false)).body.state.orderSet).toBe(false);
    expect(await order()).toEqual(["Seed swap", "Paths", "Tool shed", "Bees", "Water tank"]);
  });

  it("refuses a vote on an item already talked about, which keeps its place at the top", async () => {
    expect((await as("m-ana", "POST /api/sessions/:id/act", { params: room(), body: { action: { type: "item", itemId: paths } } })).status).toBe(200);
    const out = await vote("m-ben", paths, 1);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe(VOTE_REFUSALS.waitingOnly);
    await vote("m-ben", tank, 1);
    await vote("m-cai", tank, 1);
    await vote("m-founder", tank, 1);
    expect(await order()).toEqual(["Paths", "Water tank", "Seed swap", "Tool shed", "Bees"]);
  });

  it("puts a member's votes in their export, and the erasure takes them", async () => {
    const out = await exportMemberSessions(pool, "m-cai");
    expect(out.agendaVotes.map((v: any) => v.itemId).sort((a: number, b: number) => a - b)).toEqual([tank, paths].sort((a, b) => a - b));
    for (const v of out.agendaVotes) expect(Object.keys(v).sort()).toEqual(["at", "itemId", "sessionId", "vote"]);
    expect(out.agendaVotes.every((v: any) => v.sessionId === sid && v.vote === 1)).toBe(true);

    await forgetMemberSessions(pool, "m-cai", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT * FROM `live_session_item_votes` WHERE `member_no` = ?", [cai])).toEqual([]);
    // Everybody else's votes stand.
    expect(await q("SELECT * FROM `live_session_item_votes` WHERE `session_id` = ?", [sid])).toHaveLength(4);
  });
});
