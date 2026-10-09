/**
 * Live Sessions against a real schema: one whole session, from opening the
 * room to the record, through the real handlers.
 *
 * The routes are registered on the fake Express server/routes/journal.test.ts
 * uses, with the scratch schema's pool behind them, so every statement is the
 * real one against the tables 0232 creates. The people are a stub member
 * list, and the notices are recorded where they would have been sent.
 *
 * THE CASES RUN IN ORDER and share one story, the way a session does: the
 * close is only meaningful after the arrival round, the agenda, the consent
 * rounds and the claims that came before it. Each case says what it adds.
 *
 * WHAT THIS PROVES THAT THE ROUTE TESTS CANNOT: that the words and numbers of
 * the arrival round are really NULL in the table after the close, that the
 * stored minutes name people in one audience and nobody in the other, that a
 * closed record is refused to somebody who was not there, and that what a
 * closed session left behind carries into the next one in its circle.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { exportMemberSessions, register } from "./routes/liveSessions";
import { CLOSE_REFUSAL, SESSION_COPY, SESSION_REFUSALS, SESSION_SEASONS } from "../shared/sessions";

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
  const out: { status: number; body: any; headers: Record<string, string>; text: string | null } = { status: 200, body: undefined, headers: {}, text: null };
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
  "m-eve": { id: "m-eve", name: "Eve Strand", handle: "eve" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("a live session against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const notices: any[] = [];
  const adminNotices: any[] = [];

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  /** One request, as `who`. */
  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const view = async (who: string, id: number) => as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
  const room = (id: number, extra: Record<string, string> = {}) => ({ id: String(id), ...extra });
  /** Each page says it is still here, the beat a room in use sends every 20 seconds. */
  const beat = async (id: number, ...who: string[]) => {
    for (const w of who) expect((await as(w, "POST /api/sessions/:id/here", { params: room(id) })).status, w).toBe(200);
  };

  // The story's own ids, filled in as it goes.
  let sid = 0;
  let waterItem = 0;
  let seedItem = 0;
  let proposal = 0;
  let orderSeed = 0;
  let fixTank = 0;
  let keysTension = 0;
  let seedUsed = 0;

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
      notifyAdmins: async (type: string, title: string, dedupeKey: string, link?: string) => {
        adminNotices.push({ type, title, dedupeKey, link });
      },
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }, { id: "c-kitchen", name: "Kitchen circle", status: "active" }] },
    } as any);
    handlers = c.handlers;
    // The org chart: one live seat in the garden circle, held by Cai, one
    // retired seat, and one standing example seat that holds nothing real.
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES " +
        "('seat-water', 'c-garden', 'Water keeper', 1, 0), ('seat-old', 'c-garden', 'Old seat', 0, 0), ('seat-demo', 'c-garden', 'Example seat', 1, 1)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`) VALUES ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai')",
    );
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("opens a room: the opener facilitates, and the stamp names the moon and the season", async () => {
    const opened = await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 2", circleId: "c-garden", durationMin: 45 } });
    expect(opened.status).toBe(200);
    sid = opened.body.id;
    expect(sid).toBeGreaterThan(0);

    const v = await view("m-ana", sid);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ title: "Garden circle, week 2", circleId: "c-garden", circleName: "Garden circle", status: "open", durationMin: 45 });
    expect(v.body.me).toMatchObject({ joined: true, facilitates: true, admin: false });
    expect(v.body.facilitatorUserId).toBe(v.body.me.userId);
    expect(v.body.people).toEqual([expect.objectContaining({ name: "Ana Reyes", handle: "ana", present: true })]);
    expect(v.body.stamp.moonName).not.toBe("");
    expect(SESSION_SEASONS).toContain(v.body.stamp.season);
    expect(v.body.state.stage).toBe("dropin");
    // The garden circle's own seat comes first, and neither a retired seat nor an example seat is offered.
    expect(v.body.seats.map((s: any) => s.id)).toEqual(["seat-water"]);
  });

  it("lets members join, once each, and answers 304 until something moves", async () => {
    const outside = await view("m-ben", sid);
    expect(outside.body.me.joined).toBe(false);
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: room(sid) })).body).toEqual({ ok: true });
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: room(sid) })).body).toEqual({ ok: true });
    expect((await as("m-dee", "POST /api/sessions/:id/join", { params: room(sid) })).body).toEqual({ ok: true });
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_people` WHERE `session_id` = ?", [sid])).toEqual([{ n: 3 }]);

    const first = await view("m-ben", sid);
    expect(first.body.me.joined).toBe(true);
    const tag = first.headers.etag;
    const same = await as("m-ben", "GET /api/sessions/:id", { params: room(sid), headers: { "if-none-match": tag } });
    // The presence bucket may turn between two calls; a 200 then must carry a new tag.
    if (same.status === 200) expect(same.headers.etag).not.toBe(tag);
    else expect(same.status).toBe(304);
    // Presence moves no version.
    expect((await as("m-ben", "POST /api/sessions/:id/here", { params: room(sid) })).body).toEqual({ ok: true });
    const afterHere = await view("m-ben", sid);
    expect(afterHere.body.version).toBe(first.body.version);
    // A write does.
    await as("m-ana", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "go", stage: "arrival" } } });
    const moved = await as("m-ben", "GET /api/sessions/:id", { params: room(sid), headers: { "if-none-match": tag } });
    expect(moved.status).toBe(200);
    expect(moved.body.version).toBeGreaterThan(first.body.version);
    expect(moved.body.state.stage).toBe("arrival");
  });

  it("hears the arrival round inside the room, and keeps it from anybody outside", async () => {
    expect(await as("m-ana", "POST /api/sessions/:id/arrival", { params: room(sid), body: { score: 12 } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.arrivalScore },
    });
    await as("m-ana", "POST /api/sessions/:id/arrival", { params: room(sid), body: { score: 8, wish: "more sleep" } });
    await as("m-ben", "POST /api/sessions/:id/arrival", { params: room(sid), body: { score: 4, wish: "a quiet morning" } });
    await as("m-dee", "POST /api/sessions/:id/arrival", { params: room(sid), body: { score: 9 } });

    const inside = await view("m-dee", sid);
    const byName = Object.fromEntries(inside.body.people.map((p: any) => [p.name, [p.arrival, p.wish]]));
    expect(byName).toEqual({ "Ana Reyes": [8, "more sleep"], "Ben Ortiz": [4, "a quiet morning"], "Dee Lund": [9, null] });

    const outside = await view("m-eve", sid);
    expect(outside.status).toBe(200);
    expect(outside.body.people.every((p: any) => p.arrival === null && p.wish === null)).toBe(true);
    expect(JSON.stringify(outside.body)).not.toContain("a quiet morning");
  });

  it("builds the agenda together, and only the facilitator orders it", async () => {
    waterItem = (await as("m-ana", "POST /api/sessions/:id/items", { params: room(sid), body: { title: "Water rota", aim: "report", minutes: 10 } })).body.id;
    seedItem = (await as("m-ben", "POST /api/sessions/:id/items", { params: room(sid), body: { title: "Seed librery", aim: "decide", minutes: 20 } })).body.id;
    expect(await as("m-ben", "POST /api/sessions/:id/items", { params: room(sid), body: { title: "Bad", aim: "argue", minutes: 5 } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.aimNeeded },
    });
    // Ben rewords his own item while it waits, and may not order the agenda.
    expect((await as("m-ben", "PATCH /api/sessions/:id/items/:itemId", { params: room(sid, { itemId: String(seedItem) }), body: { title: "Seed library" } })).status).toBe(200);
    expect(await as("m-ben", "PATCH /api/sessions/:id/items/:itemId", { params: room(sid, { itemId: String(seedItem) }), body: { position: 1 } })).toMatchObject({
      status: 403,
      body: { error: SESSION_REFUSALS.facilitatorOnly },
    });
    expect(await as("m-dee", "PATCH /api/sessions/:id/items/:itemId", { params: room(sid, { itemId: String(seedItem) }), body: { minutes: 30 } })).toMatchObject({
      status: 403,
      body: { error: SESSION_REFUSALS.notesOnly },
    });
    expect((await as("m-ana", "PATCH /api/sessions/:id/items/:itemId", { params: room(sid, { itemId: String(seedItem) }), body: { position: 1 } })).status).toBe(200);
    const v = await view("m-ana", sid);
    expect(v.body.items.map((i: any) => [i.title, i.position])).toEqual([
      ["Seed library", 1],
      ["Water rota", 2],
    ]);

    // Consent to the agenda: a concern is said in words.
    expect(await as("m-ben", "POST /api/sessions/:id/respond", { params: room(sid), body: { target: "agenda", value: "concern" } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.consentWords },
    });
    const round: [string, string, string | undefined][] = [
      ["m-ana", "consent", undefined],
      ["m-ben", "concern", "It is a full hour"],
      ["m-dee", "consent", undefined],
    ];
    for (const [who, value, text] of round) {
      expect((await as(who, "POST /api/sessions/:id/respond", { params: room(sid), body: { target: "agenda", value, text } })).status).toBe(200);
    }
    const answers = (await view("m-ana", sid)).body.responses.filter((r: any) => r.target === "agenda");
    expect(answers.map((r: any) => r.value).sort()).toEqual(["concern", "consent", "consent"]);
  });

  it("runs each item on its own clock, and an item that stops is done", async () => {
    expect(await as("m-ben", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "go", stage: "items" } } })).toMatchObject({
      status: 403,
      body: { error: SESSION_REFUSALS.facilitatorOnly },
    });
    await as("m-ana", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "go", stage: "items" } } });
    const first = await as("m-ana", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "item", itemId: waterItem } } });
    expect(first.body).toMatchObject({ ok: true, state: { stage: "items", activeItemId: waterItem } });
    await as("m-ana", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "item", itemId: seedItem } } });
    const items = await q("SELECT `id`, `status`, `ended_at` FROM `live_session_items` WHERE `session_id` = ? ORDER BY `id`", [sid]);
    expect(items.map((i: any) => [i.id, i.status, i.ended_at != null])).toEqual([
      [waterItem, "done", true],
      [seedItem, "active", false],
    ]);
  });

  it("catches entries on the item they belong to, with seats and dates checked", async () => {
    const add = (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/:id/entries", { params: room(sid), body });
    proposal = (await add("m-ben", { kind: "decision", text: "We keep seed in the library", itemId: seedItem })).body.id;
    orderSeed = (await add("m-ana", { kind: "action", text: "Order seed for spring", itemId: seedItem })).body.id;
    fixTank = (await add("m-dee", { kind: "action", text: "Fix the water tank", itemId: waterItem, ownerSeatId: "seat-water", dueOn: "2026-10-31" })).body.id;
    keysTension = (await add("m-ben", { kind: "tension", text: "Who holds the shed keys?" })).body.id;
    await add("m-dee", { kind: "note", text: "Write to ana@example.org about the seed order" });
    expect(await add("m-dee", { kind: "action", text: "x", ownerSeatId: "seat-old" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.seatUnknown } });
    expect(await add("m-dee", { kind: "action", text: "x", ownerSeatId: "seat-demo" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.seatUnknown } });
    expect(await add("m-dee", { kind: "action", text: "x", dueOn: "2026-02-31" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.dueOn } });
    expect(await add("m-dee", { kind: "poem", text: "x" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.entryKind } });
    const v = await view("m-ana", sid);
    const tank = v.body.entries.find((e: any) => e.id === fixTank);
    expect(tank).toMatchObject({ itemId: waterItem, ownerSeatId: "seat-water", ownerSeatName: "Water keeper", dueOn: "2026-10-31", ownerUserId: null });
  });

  it("decides a proposal only once everyone here consents, and only the facilitator marks it", async () => {
    await beat(sid, "m-ana", "m-ben", "m-dee");
    const answer = (who: string, value: string, text?: string) =>
      as(who, "POST /api/sessions/:id/respond", { params: room(sid), body: { target: `decision:${proposal}`, value, text } });
    await answer("m-ana", "consent");
    await answer("m-ben", "consent");
    await answer("m-dee", "object", "Not until the shelves are dry");
    const mark = (who: string) => as(who, "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(proposal) }), body: { status: "done" } });
    expect(await mark("m-ana")).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionNotConsented } });
    await answer("m-dee", "consent");
    expect(await mark("m-ben")).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
    expect((await mark("m-ana")).status).toBe(200);
    expect(await answer("m-dee", "object", "Changed my mind")).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionClosed } });
  });

  it("never lets a consent from somebody who stepped away stand in for somebody here who has not answered", async () => {
    await beat(sid, "m-ana", "m-ben", "m-dee");
    const gate = (await as("m-dee", "POST /api/sessions/:id/entries", { params: room(sid), body: { kind: "decision", text: "We open the gate at dawn", itemId: seedItem } })).body.id;
    const answer = (who: string, value: string) => as(who, "POST /api/sessions/:id/respond", { params: room(sid), body: { target: `decision:${gate}`, value } });
    const mark = () => as("m-ana", "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(gate) }), body: { status: "done" } });
    expect((await answer("m-dee", "consent")).status).toBe(200);
    expect((await answer("m-ana", "consent")).status).toBe(200);

    // Dee steps away. Two answers against the two people here was "everyone" to
    // the old arithmetic, but Ben is here and has not been heard.
    const [{ no: deeNo }] = await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-dee'");
    const [{ last_seen_at: deeSeen }] = await q("SELECT `last_seen_at` FROM `live_session_people` WHERE `session_id` = ? AND `member_no` = ?", [sid, deeNo]);
    await q("UPDATE `live_session_people` SET `last_seen_at` = ? WHERE `session_id` = ? AND `member_no` = ?", [new Date(Date.now() - 10 * 60_000), sid, deeNo]);
    const here = (await view("m-ana", sid)).body.people.filter((p: any) => p.present).map((p: any) => p.name);
    expect(here.sort()).toEqual(["Ana Reyes", "Ben Ortiz"]);
    expect(await mark()).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionNotConsented } });
    await q("UPDATE `live_session_people` SET `last_seen_at` = ? WHERE `session_id` = ? AND `member_no` = ?", [deeSeen, sid, deeNo]);
    await beat(sid, "m-dee");

    // New words start a new round: the answers to the old words are gone, so it cannot be marked on them.
    expect((await answer("m-ben", "consent")).status).toBe(200);
    expect((await as("m-dee", "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(gate) }), body: { text: "We open the gate at seven" } })).status).toBe(200);
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_responses` WHERE `session_id` = ? AND `target` = ?", [sid, `decision:${gate}`])).toEqual([{ n: 0 }]);
    expect(await mark()).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionNotConsented } });
    // Unchanged words keep the round.
    expect((await answer("m-ben", "consent")).status).toBe(200);
    expect((await as("m-dee", "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(gate) }), body: { text: "We open the gate at seven" } })).status).toBe(200);
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_responses` WHERE `session_id` = ? AND `target` = ?", [sid, `decision:${gate}`])).toEqual([{ n: 1 }]);
    // Dee takes it back off the table, so the story's record stays as it was.
    expect((await as("m-dee", "DELETE /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(gate) }) })).status).toBe(200);
  });

  it("keeps a proposal decided by consent as it was decided", async () => {
    const patch = (who: string, body: Record<string, unknown>) =>
      as(who, "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(proposal) }), body });
    // Neither its author nor the facilitator can reword it.
    expect(await patch("m-ben", { text: "We keep seed in the shed" })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionFinal } });
    expect(await patch("m-ana", { text: "We keep seed in the shed" })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionFinal } });
    // Taking it out of "decided" is the facilitator's move, and even the facilitator cannot make it.
    expect(await patch("m-ben", { status: "open" })).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.facilitatorOnly } });
    expect(await patch("m-ana", { status: "open" })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionFinal } });
    expect(await patch("m-ana", { status: "parked" })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.decisionFinal } });
    expect(await as("m-ben", "DELETE /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(proposal) }) })).toMatchObject({
      status: 409,
      body: { error: SESSION_REFUSALS.decisionFinal },
    });
    // Sending the words it already has changes nothing, and is no refusal.
    expect((await patch("m-ben", { text: "We keep seed in the library" })).status).toBe(200);
    const [row] = await q("SELECT `text`, `status` FROM `live_session_entries` WHERE `id` = ?", [proposal]);
    expect(row).toEqual({ text: "We keep seed in the library", status: "done" });
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_responses` WHERE `session_id` = ? AND `target` = ?", [sid, `decision:${proposal}`])).toEqual([{ n: 3 }]);
  });

  it("refuses to close while an action has nobody holding it, then lets the room claim it", async () => {
    const close = await as("m-ana", "POST /api/sessions/:id/close", { params: room(sid) });
    expect(close.status).toBe(409);
    expect(close.body).toEqual({ error: CLOSE_REFUSAL, unowned: [orderSeed] });

    const patch = (who: string, body: Record<string, unknown>) =>
      as(who, "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(orderSeed) }), body });
    expect((await patch("m-dee", { claim: true })).status).toBe(200);
    expect(await patch("m-ben", { claim: true })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.heldAlready } });
    expect(await patch("m-ben", { release: true })).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.releaseNotYours } });
    expect((await patch("m-dee", { release: true })).status).toBe(200);
    expect((await patch("m-ben", { claim: true })).status).toBe(200);
    expect((await patch("m-ben", { dueOn: "2026-11-15" })).status).toBe(200);
    // Somebody else's words are theirs, until a host takes notes.
    expect(await patch("m-dee", { text: "Order seed now" })).toMatchObject({ status: 403, body: { error: SESSION_REFUSALS.notYours } });
    expect((await as("m-ana", "POST /api/sessions/:id/hosts", { params: room(sid), body: { secretaryUserId: (await view("m-ben", sid)).body.me.userId } })).status).toBe(200);
    expect((await as("m-ben", "PATCH /api/sessions/:id/entries/:entryId", { params: room(sid, { entryId: String(fixTank) }), body: { text: "Fix the water tank before the rains" } })).status).toBe(200);
    const v = await view("m-ana", sid);
    expect(v.body.entries.find((e: any) => e.id === orderSeed)).toMatchObject({ ownerName: "Ben Ortiz", dueOn: "2026-11-15" });
    expect(v.body.secretaryUserId).not.toBeNull();
  });

  it("gathers the close: feedback, one word, and an idea for the tool", async () => {
    const respond = (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/:id/respond", { params: room(sid), body });
    expect((await respond("m-ben", { target: "facilitation", value: "mixed", text: "Shorter reports, please" })).status).toBe(200);
    expect((await respond("m-dee", { target: "facilitation", value: "flowed" })).status).toBe(200);
    expect(await respond("m-dee", { target: "facilitation", value: "great" })).toMatchObject({ status: 400, body: { error: SESSION_REFUSALS.facilitationValue } });
    expect((await respond("m-ben", { target: "word", value: "grateful" })).status).toBe(200);
    // A second word replaces the first.
    expect((await respond("m-ben", { target: "word", value: "rested" })).status).toBe(200);

    // While the room is open the feedback is read by nobody: an answer turning
    // up on the facilitator's next poll would say who had just sent it.
    const facilitator = await view("m-ana", sid);
    expect(facilitator.body.facilitation).toBeNull();
    expect(JSON.stringify(facilitator.body)).not.toContain("Shorter reports");
    expect((await view("m-ben", sid)).body.facilitation).toBeNull();
    expect((await view("m-founder", sid)).body.facilitation).toBeNull();
    expect(facilitator.body.responses.filter((r: any) => r.target === "word").map((r: any) => r.value)).toEqual(["rested"]);

    const idea = await as("m-dee", "POST /api/sessions/:id/tool-feedback", { params: room(sid), body: { text: "Let the timer chime softer." } });
    expect(idea.status).toBe(200);
    expect(await q("SELECT `kind`, `page_url`, `submitted_by`, `may_relay` FROM `feedback_items` WHERE `page_url` = ?", [`/sessions/${sid}`])).toEqual([
      { kind: "idea", page_url: `/sessions/${sid}`, submitted_by: "m-dee", may_relay: 0 },
    ]);
  });

  it("stops the item on screen when the room goes on to the actions, the way wrapping it up does", async () => {
    const [before] = await q("SELECT `status`, `used_seconds`, `started_at` FROM `live_session_items` WHERE `id` = ?", [seedItem]);
    expect(before.status).toBe("active");
    // The seed library has been on screen for four minutes.
    const started = new Date(Math.floor(Date.now() / 1000) * 1000 - 4 * 60_000);
    await q("UPDATE `live_session_items` SET `started_at` = ? WHERE `id` = ?", [started, seedItem]);
    const moved = await as("m-ana", "POST /api/sessions/:id/act", { params: room(sid), body: { action: { type: "go", stage: "actions" } } });
    expect(moved.body).toMatchObject({ ok: true, state: { stage: "actions", activeItemId: null, itemStartedAt: null } });
    const [after] = await q("SELECT `status`, `used_seconds`, `ended_at` FROM `live_session_items` WHERE `id` = ?", [seedItem]);
    expect(after.status).toBe("done");
    expect(after.ended_at).not.toBeNull();
    expect(after.used_seconds).toBeGreaterThanOrEqual(Number(before.used_seconds) + 240);
    expect(after.used_seconds).toBeLessThan(Number(before.used_seconds) + 300);
    // The close that follows adds nothing for the time spent on the actions.
    seedUsed = Number(after.used_seconds);
  });

  it("closes: the record is kept, the arrival words are erased, and the people holding actions hear", async () => {
    await beat(sid, "m-ana", "m-ben", "m-dee");
    const closed = await as("m-ana", "POST /api/sessions/:id/close", { params: room(sid) });
    expect(closed).toMatchObject({ status: 200, body: { ok: true } });

    // The arrival round is gone from the table, numbers and words alike.
    expect(await q("SELECT `arrival_score`, `arrival_wish` FROM `live_session_people` WHERE `session_id` = ?", [sid])).toEqual([
      { arrival_score: null, arrival_wish: null },
      { arrival_score: null, arrival_wish: null },
      { arrival_score: null, arrival_wish: null },
    ]);
    const [row] = await q("SELECT `status`, `closed_at`, `summary`, `minutes_people`, `minutes_shareable` FROM `live_sessions` WHERE `id` = ?", [sid]);
    expect(row.status).toBe("closed");
    expect(row.closed_at).not.toBeNull();
    const summary = JSON.parse(row.summary);
    expect(summary.arrival).toEqual({ count: 3, median: 8, low: 4, high: 9 });
    expect(summary.tallies[proposal]).toMatchObject({ consent: 3, object: 0, consented: true });
    expect(row.summary).not.toContain("sleep");

    // The people's minutes name the people; the shareable ones name nobody.
    expect(row.minutes_people).toContain("Facilitated by Ana Reyes, notes by Ben Ortiz.");
    expect(row.minutes_people).toContain("Order seed for spring, held by Ben Ortiz, by 2026-11-15.");
    expect(row.minutes_people).toContain("Decided by consent:** We keep seed in the library");
    for (const name of ["Ana Reyes", "Ben Ortiz", "Dee Lund", "more sleep", "a quiet morning", "ana@example.org", "Shorter reports"]) {
      expect(row.minutes_shareable, name).not.toContain(name);
    }
    expect(row.minutes_shareable).toContain("Fix the water tank before the rains, held by Water keeper, by 2026-10-31.");
    expect(row.minutes_shareable).toContain("held by a member");
    expect(row.minutes_shareable).toContain("3 people took part.");

    // The item on screen stopped when the room went on to the actions, and the close added nothing.
    expect(await q("SELECT `status`, `used_seconds` FROM `live_session_items` WHERE `id` = ?", [seedItem])).toEqual([{ status: "done", used_seconds: seedUsed }]);

    // Every admin hears the record is ready; Ben holds an action and Cai sits in the seat that holds the other.
    // Cai was not in the room, and the record opens only to the people who were, so his notice carries no link.
    expect(adminNotices).toEqual([
      { type: "session_record_ready", title: 'The record of "Garden circle, week 2" is ready to read', dedupeKey: `session-record:${sid}`, link: `/sessions/${sid}` },
    ]);
    expect(notices.map((n) => [n.userId, n.type, n.dedupeKey, n.link]).sort()).toEqual(
      [
        ["m-ben", "session_action_held", `session-action:${orderSeed}:m-ben`, `/sessions/${sid}`],
        ["m-cai", "session_action_held", `session-action:${fixTank}:m-cai`, null],
      ].sort(),
    );
    expect(notices.find((n) => n.userId === "m-cai").body).toBe("Fix the water tank before the rains, by 2026-10-31.");
  });

  it("refuses every write to a closed session", async () => {
    expect(await as("m-ben", "POST /api/sessions/:id/entries", { params: room(sid), body: { kind: "note", text: "Late thought" } })).toMatchObject({
      status: 409,
      body: { error: SESSION_REFUSALS.closed },
    });
    expect(await as("m-eve", "POST /api/sessions/:id/join", { params: room(sid) })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.closed } });
    expect(await as("m-ana", "POST /api/sessions/:id/close", { params: room(sid) })).toMatchObject({ status: 409 });
  });

  it("keeps the record for its people and admins, and from everybody else", async () => {
    expect(await view("m-eve", sid)).toMatchObject({ status: 403, body: { error: SESSION_COPY.closedNoAccess } });
    expect(await as("m-eve", "GET /api/sessions/:id/minutes.md", { params: room(sid) })).toMatchObject({ status: 403 });

    const ben = await view("m-ben", sid);
    expect(ben.status).toBe(200);
    expect(ben.body.status).toBe("closed");
    expect(ben.body.arrival).toEqual({ count: 3, median: 8, low: 4, high: 9 });
    expect(ben.body.people.every((p: any) => p.arrival === null && p.wish === null && p.present === false)).toBe(true);
    expect(ben.body.facilitation).toBeNull();
    // Once closed, the facilitator and admins read the feedback as one sorted batch, with nobody on it.
    const sorted = [
      { value: "flowed", text: null },
      { value: "mixed", text: "Shorter reports, please" },
    ];
    expect((await view("m-ana", sid)).body.facilitation).toEqual(sorted);
    const founder = await view("m-founder", sid);
    expect(founder.status).toBe(200);
    expect(founder.body.facilitation).toEqual(sorted);

    const md = await as("m-ben", "GET /api/sessions/:id/minutes.md", { params: room(sid) });
    expect(md.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(md.text).toContain("Ben Ortiz");
    const shareable = await as("m-ben", "GET /api/sessions/:id/minutes.md", { params: room(sid), query: { for: "shareable" } });
    expect(shareable.text).not.toContain("Ben Ortiz");

    const benList = await as("m-ben", "GET /api/sessions");
    expect(benList.body.recent.map((r: any) => [r.id, r.joined])).toEqual([[sid, true]]);
    expect(benList.body.circles.map((c: any) => c.id)).toEqual(["c-garden", "c-kitchen"]);
    expect((await as("m-eve", "GET /api/sessions")).body.recent).toEqual([]);
    expect((await as("m-founder", "GET /api/sessions")).body.recent.map((r: any) => r.id)).toEqual([sid]);
  });

  it("exports a member's own rooms, entries and answers, with the arrival already erased", async () => {
    const ben = await exportMemberSessions(pool, "m-ben");
    expect(ben.sessions).toEqual([
      expect.objectContaining({ id: sid, title: "Garden circle, week 2", status: "closed", facilitated: false, tookNotes: true, arrival: null, wish: null }),
    ]);
    // What he wrote (the proposal and the tension) and what he holds (the seed order).
    expect(ben.entries.map((e: any) => [e.id, e.wrote, e.holds]).sort()).toEqual(
      [
        [proposal, true, false],
        [keysTension, true, false],
        [orderSeed, false, true],
      ].sort(),
    );
    // The agenda item he added, which he also presents, as he typed it.
    expect(ben.items).toEqual([
      expect.objectContaining({ sessionId: sid, id: seedItem, title: "Seed library", aim: "decide", minutes: 20, status: "done", added: true, presents: true }),
    ]);
    expect(JSON.stringify(ben.items)).not.toContain("Water rota");
    const ana = await exportMemberSessions(pool, "m-ana");
    expect(ana.items.map((i: any) => [i.id, i.added, i.presents])).toEqual([[waterItem, true, true]]);
    // His own answers, the unsigned feedback included, because it is his.
    expect(ben.responses.map((r: any) => [r.target, r.value]).sort()).toEqual(
      [
        ["agenda", "concern"],
        [`decision:${proposal}`, "consent"],
        ["facilitation", "mixed"],
        ["word", "rested"],
      ].sort(),
    );
    expect(JSON.stringify(ben)).not.toContain("Ana Reyes");
    // A member who never joined a room exports four empty lists.
    expect(await exportMemberSessions(pool, "m-never")).toEqual({ sessions: [], items: [], entries: [], responses: [] });
  });

  it("carries what the circle left open into its next session, for the people who may read it", async () => {
    const next = (await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 3", circleId: "c-garden" } })).body.id;
    expect(next).toBeGreaterThan(sid);
    const v = await view("m-ana", next);
    expect(v.body.durationMin).toBe(60);
    expect(v.body.carried).toMatchObject({ sessionId: sid, title: "Garden circle, week 2" });
    expect(v.body.carried.actions.map((e: any) => e.id).sort()).toEqual([orderSeed, fixTank].sort());
    expect(v.body.carried.backlog.map((e: any) => e.id)).toEqual([keysTension]);
    expect(v.body.carried.parkedItems).toEqual([]);

    // Eve was not in the earlier session, so its record does not reach her through this one.
    expect((await view("m-eve", next)).body.carried).toBeNull();

    // An item comes over from the earlier session, and only from a closed one of this circle.
    expect((await as("m-ana", "POST /api/sessions/:id/items", { params: room(next), body: { title: "Shed keys", aim: "explore", minutes: 10, fromSessionId: sid } })).status).toBe(200);
    expect(await as("m-ana", "POST /api/sessions/:id/items", { params: room(next), body: { title: "Shed keys", aim: "explore", minutes: 10, fromSessionId: next } })).toMatchObject({
      status: 400,
      body: { error: SESSION_REFUSALS.fromSession },
    });
    const items = (await view("m-ana", next)).body.items;
    expect(items).toEqual([expect.objectContaining({ title: "Shed keys", fromSessionId: sid, position: 1 })]);

    // A second copy of something already brought over is refused, however it is spelled.
    for (const title of ["Shed keys", "shed KEYS"]) {
      expect(await as("m-ana", "POST /api/sessions/:id/items", { params: room(next), body: { title, aim: "explore", minutes: 10, fromSessionId: sid } }), title).toMatchObject({
        status: 409,
        body: { error: SESSION_REFUSALS.alreadyOnAgenda },
      });
    }
    // The same title typed fresh, from no earlier session, is the room's own business.
    expect((await as("m-ana", "POST /api/sessions/:id/items", { params: room(next), body: { title: "Shed keys", aim: "report", minutes: 5 } })).status).toBe(200);

    // Brought over, the tension is offered no more: the room matches the title the text became.
    expect((await as("m-ana", "POST /api/sessions/:id/items", { params: room(next), body: { title: "Who holds the shed keys?", aim: "explore", minutes: 15, fromSessionId: sid } })).status).toBe(200);
    const after = (await view("m-ana", next)).body.carried;
    expect(after.backlog).toEqual([]);
    expect(after.actions.map((e: any) => e.id).sort()).toEqual([orderSeed, fixTank].sort());
  });

  it("closes a room nobody closed once it has gone quiet, the way a facilitator closes it, and only once", async () => {
    const HOUR = 60 * 60_000;
    const base = Math.floor(Date.now() / 1000) * 1000;
    const open = async (who: string, title: string, durationMin: number) =>
      (await as(who, "POST /api/sessions", { body: { title, durationMin } })).body.id as number;
    /** Wind a room's clock back: opened `openedAgo`, everybody last seen `seenAgo`. */
    const age = async (id: number, openedAgo: number, seenAgo: number) => {
      await q("UPDATE `live_sessions` SET `created_at` = ? WHERE `id` = ?", [new Date(base - openedAgo), id]);
      await q("UPDATE `live_session_people` SET `joined_at` = ?, `last_seen_at` = ? WHERE `session_id` = ?", [new Date(base - openedAgo), new Date(base - seenAgo), id]);
    };

    // Eve opens a room, gives her number, starts an item, leaves an action with nobody on it, and goes.
    const shed = await open("m-eve", "Tool shed sort-out", 60);
    await as("m-eve", "POST /api/sessions/:id/arrival", { params: room(shed), body: { score: 3, wish: "a long nap" } });
    const tools = (await as("m-eve", "POST /api/sessions/:id/items", { params: room(shed), body: { title: "Sort the tools", aim: "report", minutes: 10 } })).body.id;
    await as("m-eve", "POST /api/sessions/:id/act", { params: room(shed), body: { action: { type: "item", itemId: tools } } });
    const sweep = (await as("m-eve", "POST /api/sessions/:id/entries", { params: room(shed), body: { kind: "action", text: "Sweep the floor" } })).body.id;
    await age(shed, 7 * HOUR, 7 * HOUR - 10 * 60_000);
    // The item was on screen for its first five minutes, until the room went quiet.
    await q("UPDATE `live_session_items` SET `started_at` = ? WHERE `id` = ?", [new Date(base - 7 * HOUR + 5 * 60_000), tools]);

    // Two rooms that are not quiet for good: a long session still inside its
    // own ten hours, and an old room somebody is still in.
    const long = await open("m-dee", "Long planning day", 480);
    await age(long, 9 * HOUR, 9 * HOUR);
    const talking = await open("m-ana", "Still talking", 60);
    await age(talking, 7 * HOUR, 0);
    const versionOf = async (id: number) => Number((await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [id]))[0].version);
    const versions = [await versionOf(long), await versionOf(talking)];
    const readyBefore = adminNotices.length;

    // Reading the list is what closes it.
    const list = await as("m-ben", "GET /api/sessions");
    expect(list.status).toBe(200);
    const openIds = list.body.open.map((r: any) => r.id);
    expect(openIds).not.toContain(shed);
    expect(openIds).toEqual(expect.arrayContaining([long, talking]));
    expect([await versionOf(long), await versionOf(talking)]).toEqual(versions);

    const [row] = await q("SELECT `status`, `closed_at`, `summary`, `minutes_people`, `minutes_shareable` FROM `live_sessions` WHERE `id` = ?", [shed]);
    expect(row.status).toBe("closed");
    expect(row.closed_at).not.toBeNull();
    // The same close: the spread kept, the number and the words erased, both minutes written.
    expect(JSON.parse(row.summary).arrival).toEqual({ count: 1, median: 3, low: 3, high: 3 });
    expect(await q("SELECT `arrival_score`, `arrival_wish` FROM `live_session_people` WHERE `session_id` = ?", [shed])).toEqual([
      { arrival_score: null, arrival_wish: null },
    ]);
    for (const minutes of [row.minutes_people, row.minutes_shareable]) {
      expect(minutes).toContain("Tool shed sort-out");
      expect(minutes).not.toContain("a long nap");
    }
    // Nobody was there to claim the action, so it went to the backlog first.
    expect(await q("SELECT `status` FROM `live_session_entries` WHERE `id` = ?", [sweep])).toEqual([{ status: "parked" }]);
    // The item's clock stopped when the room went quiet, not hours later.
    expect(await q("SELECT `status`, `used_seconds` FROM `live_session_items` WHERE `id` = ?", [tools])).toEqual([{ status: "done", used_seconds: 300 }]);
    expect(adminNotices.slice(readyBefore)).toEqual([
      { type: "session_record_ready", title: 'The record of "Tool shed sort-out" is ready to read', dedupeKey: `session-record:${shed}`, link: `/sessions/${shed}` },
    ]);

    // Only once: the next read finds nothing to close.
    const closedVersion = await versionOf(shed);
    await as("m-ana", "GET /api/sessions");
    expect(await versionOf(shed)).toBe(closedVersion);
    expect(adminNotices).toHaveLength(readyBefore + 1);
    // Eve was in it, so the record is hers to read.
    expect((await view("m-eve", shed)).body).toMatchObject({ status: "closed", arrival: { count: 1, median: 3 } });

    // Joining a room that went quiet closes it first, so nobody joins to read its arrival round.
    const porch = await open("m-ben", "Porch check-in", 30);
    await as("m-ben", "POST /api/sessions/:id/arrival", { params: room(porch), body: { score: 6, wish: "tea" } });
    await age(porch, 8 * HOUR, 8 * HOUR);
    expect(await as("m-eve", "POST /api/sessions/:id/join", { params: room(porch) })).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.closed } });
    expect(await q("SELECT `status` FROM `live_sessions` WHERE `id` = ?", [porch])).toEqual([{ status: "closed" }]);
    expect(await q("SELECT `arrival_wish` FROM `live_session_people` WHERE `session_id` = ?", [porch])).toEqual([{ arrival_wish: null }]);

    // Reading one closes it too, and the poll of a room in use is left alone.
    const gateRota = await open("m-dee", "Gate rota", 45);
    await age(gateRota, 7 * HOUR, 7 * HOUR);
    expect((await view("m-dee", gateRota)).body.status).toBe("closed");
    expect((await view("m-ana", talking)).body.status).toBe("open");
  });
});
