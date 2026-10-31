/**
 * A facilitator fills in for a member (0288), against a real schema, through
 * the real handlers (the harness server/liveSessions.db.test.ts uses).
 *
 * Rye, 2026-10-30: "Facilitator can fill other people's stuff out", live
 * sessions first, with a notice to the person. What this proves:
 *
 *   PERMISSION  only the person facilitating fills in, for somebody in the
 *               room; a member, the secretary and an admin are refused
 *   AUDIT       every fill-in is a row naming who wrote it and whose it is
 *   NOTICE      the person hears once, by the role and never by the
 *               facilitator's name
 *   UNDO        the person, or the facilitator, takes it back; a stranger
 *               cannot; the person's own change makes it theirs
 *   NO PROXY    no consent answer is ever given for somebody else
 *
 * THE CASES RUN IN ORDER and share one room. No TEST_DATABASE_URL and the
 * suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { exportMemberSessions, register } from "./routes/liveSessions";
import { forgetMemberSessions } from "./lib/liveSessions";
import { ON_BEHALF_COPY, ON_BEHALF_REFUSALS } from "../shared/sessionOnBehalf";

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

describe.skipIf(!testDbConfigured())("a facilitator fills in for a member", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const notices: any[] = [];

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const view = async (who: string) => (await as(who, "GET /api/sessions/:id", { params: { id: String(sid) } })).body;
  const room = (extra: Record<string, string> = {}) => ({ id: String(sid), ...extra });
  const fills = async () => q("SELECT * FROM `live_session_on_behalf` WHERE `session_id` = ? ORDER BY `id`", [sid]);
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0].no);
  const undo = (who: string, fillId: number) => as(who, "POST /api/sessions/:id/on-behalf/:fillId/undo", { params: room({ fillId: String(fillId) }) });

  let sid = 0;
  let ana = 0;
  let ben = 0;
  let cai = 0;

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
      notify: async (n: any) => {
        notices.push(n);
        return { inserted: true };
      },
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
    } as any);
    handlers = c.handlers;

    sid = (await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 4", circleId: "c-garden" } })).body.id;
    for (const w of ["m-ben", "m-cai", "m-founder"]) expect((await as(w, "POST /api/sessions/:id/join", { params: room() })).status).toBe(200);
    ana = await noOf("m-ana");
    ben = await noOf("m-ben");
    cai = await noOf("m-cai");
    // Cai takes notes, so the secretary's refusal below is about the secretary.
    expect((await as("m-ana", "POST /api/sessions/:id/hosts", { params: room(), body: { secretaryUserId: cai } })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets only the person facilitating fill in, and only for somebody in the room", async () => {
    const item = { title: "Compost rota", aim: "decide", minutes: 10 };
    for (const who of ["m-ben", "m-cai", "m-founder"]) {
      const out = await as(who, "POST /api/sessions/:id/items", { params: room(), body: { ...item, forUserId: ana } });
      expect(out.status, who).toBe(403);
      expect(out.body.error, who).toBe(ON_BEHALF_REFUSALS.facilitatorOnly);
    }
    // Dee never joined, so nothing can be filled in for her.
    const dee = (await as("m-dee", "GET /api/sessions/:id", { params: room() })).body.me.userId;
    const notHere = await as("m-ana", "POST /api/sessions/:id/items", { params: room(), body: { ...item, forUserId: dee || 99999 } });
    expect(notHere.status).toBe(400);
    expect(notHere.body.error).toBe(ON_BEHALF_REFUSALS.personNotHere);
    expect(await fills()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("records the arrival it gives for somebody, names both people, and tells only them, by the role", async () => {
    const out = await as("m-ana", "POST /api/sessions/:id/arrival", { params: room(), body: { score: 7, wish: "Shorter agenda", forUserId: ben } });
    expect(out.status).toBe(200);
    const [row] = await fills();
    expect(row).toMatchObject({ actor_no: ana, person_no: ben, target: "arrival", target_id: ben, act: "added", before_json: null });
    expect(row.noticed_at).not.toBeNull();
    // Ben's number and words; Ana's own arrival is untouched.
    const people = await q("SELECT `member_no`, `arrival_score`, `arrival_wish` FROM `live_session_people` WHERE `session_id` = ? ORDER BY `member_no`", [sid]);
    expect(people.find((p: any) => p.member_no === ben)).toMatchObject({ arrival_score: 7, arrival_wish: "Shorter agenda" });
    expect(people.find((p: any) => p.member_no === ana)).toMatchObject({ arrival_score: null });

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: "m-ben", type: "session_filled_in", dedupeKey: `session-filled-in:${row.id}`, link: `/sessions/${sid}` });
    expect(notices[0].title).toBe('The Facilitator filled in your arrival in "Garden circle, week 4"');
    expect(JSON.stringify(notices[0])).not.toContain("Ana");

    // Everyone in the room sees the mark; only Ben and Ana may undo it.
    const benView = (await view("m-ben")).people.find((p: any) => p.userId === ben);
    expect(benView.arrivalFilledIn).toMatchObject({ id: row.id, personUserId: ben, act: "added", canUndo: true });
    const caiView = (await view("m-cai")).people.find((p: any) => p.userId === ben);
    expect(caiView.arrivalFilledIn).toMatchObject({ id: row.id, canUndo: false });
    expect(ON_BEHALF_COPY.filledInBy()).toBe("Filled in by the Facilitator");

    // A second write with no new fill-in sends nothing again.
    await as("m-ana", "POST /api/sessions/:id/arrival", { params: room(), body: { score: 9 } });
    expect(notices).toHaveLength(1);
  });

  it("writes an agenda item and a tension in the person's name, and the person's own edit makes it theirs", async () => {
    const item = await as("m-ana", "POST /api/sessions/:id/items", { params: room(), body: { title: "Water tank", aim: "explore", minutes: 10, forUserId: cai } });
    expect(item.status).toBe(200);
    expect(await q("SELECT `added_by_no` FROM `live_session_items` WHERE `id` = ?", [item.body.id])).toEqual([{ added_by_no: cai }]);

    const tension = await as("m-ana", "POST /api/sessions/:id/entries", { params: room(), body: { kind: "tension", text: "The tank leaks", forUserId: ben } });
    expect(tension.status).toBe(200);
    expect(await q("SELECT `author_no` FROM `live_session_entries` WHERE `id` = ?", [tension.body.id])).toEqual([{ author_no: ben }]);
    expect(notices.slice(-2).map((n) => [n.userId, n.title])).toEqual([
      ["m-cai", 'The Facilitator filled in an agenda item for you in "Garden circle, week 4"'],
      ["m-ben", 'The Facilitator filled in a tension for you in "Garden circle, week 4"'],
    ]);
    let v = await view("m-ben");
    expect(v.entries.find((e: any) => e.id === tension.body.id).filledIn).toMatchObject({ personUserId: ben, act: "added", canUndo: true });
    expect(v.items.find((i: any) => i.id === item.body.id).filledIn).toMatchObject({ personUserId: cai, canUndo: false });

    // Ben rewrites his tension himself: it is his now, and no longer marked or undone from here.
    expect((await as("m-ben", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId: String(tension.body.id) }), body: { text: "The tank leaks at the tap" } })).status).toBe(200);
    v = await view("m-ben");
    expect(v.entries.find((e: any) => e.id === tension.body.id).filledIn).toBeNull();
    const kept = (await fills()).find((f: any) => f.target === "entry" && f.target_id === tension.body.id);
    expect(kept.kept_at).not.toBeNull();
    expect((await undo("m-ben", kept.id)).body.error).toBe(ON_BEHALF_REFUSALS.pastUndoing);
  });

  it("lets the person undo what was added for them, refuses anybody else, and refuses it twice", async () => {
    const item = await as("m-ana", "POST /api/sessions/:id/items", { params: room(), body: { title: "Seed swap", aim: "report", minutes: 5, forUserId: cai } });
    const fill = (await fills()).find((f: any) => f.target === "item" && f.target_id === item.body.id);
    const stranger = await undo("m-ben", fill.id);
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe(ON_BEHALF_REFUSALS.undoNotYours);

    expect((await undo("m-cai", fill.id)).status).toBe(200);
    expect(await q("SELECT `id` FROM `live_session_items` WHERE `id` = ?", [item.body.id])).toEqual([]);
    const after = (await fills()).find((f: any) => f.id === fill.id);
    expect(after.undone_at).not.toBeNull();
    // The row stays as history, naming both people.
    expect(after).toMatchObject({ actor_no: ana, person_no: cai });
    const again = await undo("m-cai", fill.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe(ON_BEHALF_REFUSALS.undoneAlready);
  });

  it("changes a member's own words on their behalf, keeps what was there, and an undo puts it back", async () => {
    const own = await as("m-cai", "POST /api/sessions/:id/items", { params: room(), body: { title: "Bees", aim: "report", minutes: 5 } });
    expect((await fills()).some((f: any) => f.target_id === own.body.id)).toBe(false);
    const before = notices.length;
    expect((await as("m-ana", "PATCH /api/sessions/:id/items/:itemId", { params: room({ itemId: String(own.body.id) }), body: { title: "Bees and the hives", minutes: 8 } })).status).toBe(200);
    const fill = (await fills()).find((f: any) => f.target === "item" && f.target_id === own.body.id);
    expect(fill).toMatchObject({ actor_no: ana, person_no: cai, act: "changed" });
    expect(JSON.parse(fill.before_json)).toMatchObject({ title: "Bees", minutes: 5 });
    expect(notices.slice(before).map((n) => [n.userId, n.title])).toEqual([["m-cai", 'The Facilitator changed your agenda item in "Garden circle, week 4"']]);

    expect((await undo("m-cai", fill.id)).status).toBe(200);
    expect(await q("SELECT `title`, `minutes` FROM `live_session_items` WHERE `id` = ?", [own.body.id])).toEqual([{ title: "Bees", minutes: 5 }]);
  });

  it("hands an action to somebody in the room and fills in its date, and the holder can undo the latest", async () => {
    const action = await as("m-ana", "POST /api/sessions/:id/entries", { params: room(), body: { kind: "action", text: "Patch the tank" } });
    const entryId = String(action.body.id);
    // A member cannot hand an action to somebody else.
    const notHers = await as("m-cai", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId }), body: { ownerUserId: ben } });
    expect(notHers.status).toBe(403);
    expect(notHers.body.error).toBe(ON_BEHALF_REFUSALS.facilitatorOnly);

    expect((await as("m-ana", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId }), body: { ownerUserId: ben } })).status).toBe(200);
    expect(await q("SELECT `owner_no` FROM `live_session_entries` WHERE `id` = ?", [action.body.id])).toEqual([{ owner_no: ben }]);
    expect(notices.at(-1)).toMatchObject({ userId: "m-ben", title: 'The Facilitator changed your action in "Garden circle, week 4"' });

    expect((await as("m-ana", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId }), body: { dueOn: "2026-11-06" } })).status).toBe(200);
    const mine = (await fills()).filter((f: any) => f.target === "entry" && f.target_id === action.body.id);
    expect(mine.map((f: any) => [f.person_no, f.act])).toEqual([
      [ben, "changed"],
      [ben, "changed"],
    ]);
    // Only the latest one standing comes back first.
    expect((await undo("m-ben", mine[0].id)).body.error).toBe(ON_BEHALF_REFUSALS.pastUndoing);
    expect((await undo("m-ben", mine[1].id)).status).toBe(200);
    expect(await q("SELECT `owner_no`, DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due` FROM `live_session_entries` WHERE `id` = ?", [action.body.id])).toEqual([{ owner_no: ben, due: null }]);
    // Then the hand-over itself, by the facilitator who made it.
    expect((await undo("m-ana", mine[0].id)).status).toBe(200);
    expect(await q("SELECT `owner_no` FROM `live_session_entries` WHERE `id` = ?", [action.body.id])).toEqual([{ owner_no: null }]);
  });

  it("never gives a consent answer for anybody, the facilitator included", async () => {
    const proposal = await as("m-ana", "POST /api/sessions/:id/entries", { params: room(), body: { kind: "decision", text: "We fix the tank on Saturday", forUserId: ben } });
    expect(proposal.status).toBe(200);
    const target = `decision:${proposal.body.id}`;
    for (const [who, forUserId] of [["m-ana", ben], ["m-ben", ana], ["m-founder", cai], ["m-cai", ben]] as const) {
      for (const body of [{ target, value: "consent" }, { target, value: "object", text: "Not Saturday" }, { target: "agenda", value: "consent" }, { target: "word", value: "Grateful" }]) {
        const out = await as(who, "POST /api/sessions/:id/respond", { params: room(), body: { ...body, forUserId } });
        expect(out.status, `${who} for ${forUserId} ${body.target}`).toBe(403);
        expect(out.body.error).toBe(ON_BEHALF_REFUSALS.ownAnswer);
      }
    }
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_responses` WHERE `session_id` = ?", [sid])).toEqual([{ n: 0 }]);
    // Naming yourself is only your own answer.
    expect((await as("m-ben", "POST /api/sessions/:id/respond", { params: room(), body: { target, value: "consent", forUserId: ben } })).status).toBe(200);
    expect(await q("SELECT `member_no`, `value` FROM `live_session_responses` WHERE `session_id` = ?", [sid])).toEqual([{ member_no: ben, value: "consent" }]);
    // And no fill-in row is ever an answer.
    expect((await fills()).every((f: any) => ["arrival", "item", "entry"].includes(f.target))).toBe(true);
  });

  it("exports what was filled in for and by a member, and the erasure takes theirs", async () => {
    const benOut = (await exportMemberSessions(pool, "m-ben")).filledIn;
    expect(benOut.length).toBeGreaterThan(0);
    expect(benOut.every((f: any) => f.forYou && !f.byYou)).toBe(true);
    // Nobody else's number travels with it: the row says whose and by whom only as yes or no.
    for (const f of benOut) expect(Object.keys(f).sort()).toEqual(["act", "at", "byYou", "forYou", "sessionId", "target", "undoneAt"]);
    const anaOut = (await exportMemberSessions(pool, "m-ana")).filledIn;
    expect(anaOut.every((f: any) => f.byYou)).toBe(true);

    await forgetMemberSessions(pool, "m-ben", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_on_behalf` WHERE `person_no` = ?", [ben])).toEqual([{ n: 0 }]);
  });

  it("empties what an undo would put back at the close, and refuses an undo after it", async () => {
    // Ben has gone; the room still holds actions nobody holds, so park them before closing.
    for (const e of await q("SELECT `id` FROM `live_session_entries` WHERE `session_id` = ? AND `kind` = 'action' AND `owner_no` IS NULL", [sid])) {
      await as("m-ana", "PATCH /api/sessions/:id/entries/:entryId", { params: room({ entryId: String(e.id) }), body: { status: "parked" } });
    }
    const closed = await as("m-ana", "POST /api/sessions/:id/close", { params: room() });
    expect(closed.status).toBe(200);
    const rows = await fills();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((f: any) => f.before_json === null)).toBe(true);
    expect((await undo("m-cai", rows[0].id)).status).toBe(409);
  });
});
