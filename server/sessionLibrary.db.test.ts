/**
 * The agenda library against a real schema: members bring items for a
 * circle's next session, a session takes them up, and the close settles them.
 *
 * The room's, the tasks' and the library's route modules are registered on a
 * fake Express, with the scratch schema's pool behind them, so every case goes
 * through the real doors. The people are a stub member list; the notices are
 * recorded where they would have been sent.
 *
 * THE CASES RUN IN ORDER and share one story: a garden circle meets, members
 * bring what needs its time, and it meets again.
 *
 * WHAT THIS PROVES THAT THE PURE TESTS CANNOT: who may add, change, withdraw
 * and take an item, measured through the real standing rule (the circle's last
 * closed session, or a live seat now); that a member with no standing in a
 * circle can neither read nor take its items, and that a refusal never says an
 * item exists; that opening a room with items is all or none and leaves no room
 * behind when it refuses; that both closes settle what they took; that a
 * discard, a deleted record and a session an older release closed each leave
 * the library whole; and that no payload carries a member's id or an email.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { forgetMemberSessions } from "./lib/liveSessions";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerTasks } from "./routes/sessionTasks";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { lastClosedInCircle } from "./repos/liveSessions";
import { lastClosedPerCircle } from "./repos/sessionLibrary";
import { SESSION_LIMITS, SESSION_REFUSALS } from "../shared/sessions";
import { LIBRARY_NOTICES, LIBRARY_REFUSALS, type LibraryCard } from "../shared/sessionLibrary";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana", email: "ana@village.example.test" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben", email: "ben@village.example.test" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", handle: "cai", email: "cai@village.example.test" },
  "m-dee": { id: "m-dee", name: "Dee Lund", handle: "dee", email: "dee@village.example.test" },
  "m-eve": { id: "m-eve", name: "Eve Strand", handle: "eve", email: "eve@village.example.test" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

/** Walk a library payload and say what it must never carry: a member's own id, or an email address. */
function privacyProblems(payload: unknown): string[] {
  const problems: string[] = [];
  const ids = new Set(Object.keys(PEOPLE));
  const walk = (v: unknown, at: string) => {
    if (typeof v === "string") {
      if (ids.has(v)) problems.push(`${at} is a member id`);
      if (v.includes("@")) problems.push(`${at} reads like an email`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (/_no$|^no$|ByNo$/i.test(k)) problems.push(`${at}.${k} names a member's number`);
        if (typeof x === "number" && k !== "id") problems.push(`${at}.${k} is a number`);
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(payload, "$");
  return problems;
}

const configured = testDbConfigured();

describe.skipIf(!configured)("the agenda library against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const notices: any[] = [];
  const LAPSE = { currentSeasonId: null, cadence: "never" };

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };

  // ── The doors, by name ────────────────────────────────────────────────────
  const list = async (who: string) => {
    const out = await as(who, "GET /api/sessions");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const cards = async (who: string): Promise<LibraryCard[]> => (await list(who)).library.items;
  const titles = async (who: string) => (await cards(who)).map((c) => c.title).sort();
  const card = async (who: string, id: number) => (await cards(who)).find((c) => c.id === id);
  const bring = async (who: string, body: Record<string, unknown>) => as(who, "POST /api/sessions/library", { body });
  const brought = async (who: string, body: Record<string, unknown>): Promise<number> => {
    const out = await bring(who, body);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.item.id);
  };
  const change = async (who: string, id: number, body: Record<string, unknown>) =>
    as(who, "PATCH /api/sessions/library/:itemId", { params: { itemId: String(id) }, body });
  const withdraw = async (who: string, id: number) => as(who, "DELETE /api/sessions/library/:itemId", { params: { itemId: String(id) } });
  const again = async (who: string, id: number) => as(who, "POST /api/sessions/library/:itemId/again", { params: { itemId: String(id) } });
  const roomList = async (who: string, sessionId: number) =>
    as(who, "GET /api/sessions/:id/library", { params: { id: String(sessionId) } });
  const pull = async (who: string, sessionId: number, ids: unknown) =>
    as(who, "POST /api/sessions/:id/library", { params: { id: String(sessionId) }, body: { ids } });
  const openRoom = async (who: string, title: string, circleId: string | null, libraryIds?: unknown) =>
    as(who, "POST /api/sessions", { body: { title, circleId: circleId ?? undefined, durationMin: 60, ...(libraryIds === undefined ? {} : { libraryIds }) } });
  const opened = async (who: string, title: string, circleId: string | null, libraryIds?: unknown): Promise<number> => {
    const out = await openRoom(who, title, circleId, libraryIds);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const view = async (who: string, id: number) => {
    const out = await as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const join = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/join", { params: { id: String(id) } })).status).toBe(200);
  const setItem = async (who: string, id: number, itemId: number, body: Record<string, unknown>) =>
    expect((await as(who, "PATCH /api/sessions/:id/items/:itemId", { params: { id: String(id), itemId: String(itemId) }, body })).status).toBe(200);
  const addItem = async (who: string, id: number, title: string) => {
    const out = await as(who, "POST /api/sessions/:id/items", { params: { id: String(id) }, body: { title, aim: "report", minutes: 5 } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const close = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/close", { params: { id: String(id) } })).status).toBe(200);
  const discard = async (who: string, id: number) => expect((await as(who, "DELETE /api/sessions/:id", { params: { id: String(id) } })).status).toBe(200);
  const sessionCount = async () => Number((await q("SELECT COUNT(*) AS `n` FROM `live_sessions`"))[0].n);
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0]?.no ?? 0);
  const row = async (id: number) => (await q("SELECT `status`, `session_id`, `session_item_id`, `edited_by_no` FROM `live_session_library` WHERE `id` = ?", [id]))[0];
  const takes = async (id: number) => q("SELECT `session_id`, `outcome` FROM `live_session_library_takes` WHERE `library_id` = ? ORDER BY `id`", [id]);
  const noticesOf = (userId: string, type: string) => notices.filter((n) => n.userId === userId && n.type === type);

  // The story's ids.
  let week1 = 0;
  let week2 = 0;
  let shed = 0;
  let picnic = 0;
  let compost = 0;
  let seed = 0;
  let lock = 0;

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
      notify: async (n: any) => {
        notices.push(n);
        return { fresh: true };
      },
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }, { id: "c-kitchen", name: "Kitchen circle", status: "active" }] },
      lapseContext: () => LAPSE,
    } as any;
    registerRoom(c.app, deps);
    registerTasks(c.app, deps);
    registerLibrary(c.app, deps);
    handlers = c.handlers;
    // Cai sits in the garden's water seat and has never joined a session.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL)",
    );
    // The garden's first call: Ana and Ben were in it, so both have standing in the garden.
    week1 = await opened("m-ana", "Garden, week 1", "c-garden");
    await join("m-ben", week1);
    await close("m-ana", week1);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets any member bring an item, for a circle or for none, and refuses one that does not read", async () => {
    // Dee has no standing in the garden, and may still bring it something.
    shed = await brought("m-dee", { title: "Shed roof", aim: "decide", note: "We need a builder by spring.", circleId: "c-garden" });
    picnic = await brought("m-dee", { title: "Village picnic", circleId: null });
    compost = await brought("m-eve", { title: "Compost rota", aim: "report", circleId: "c-kitchen" });
    seed = await brought("m-ana", { title: "Seed order", circleId: "c-garden" });
    const mine = await card("m-dee", shed);
    expect(mine).toMatchObject({ title: "Shed roof", aim: "decide", mine: true, broughtBy: "Dee Lund", status: "waiting", circleName: "Garden circle", canEdit: true, canWithdraw: true });

    expect((await bring("m-dee", { title: "   " })).body.error).toBe(SESSION_REFUSALS.itemTitleNeeded);
    expect((await bring("m-dee", { title: "Moon garden", circleId: "c-moon" })).status).toBe(400);
    expect((await bring(null as any, { title: "Nobody" })).status).toBe(401);
  });

  it("shows a circle's items to the people with standing in it, the bringer and admins, and to nobody else", async () => {
    // Eve: no standing anywhere. Her own item, and the one for no circle.
    expect(await titles("m-eve")).toEqual(["Compost rota", "Village picnic"]);
    // Ben was in the garden's last closed session.
    expect(await titles("m-ben")).toEqual(["Seed order", "Shed roof", "Village picnic"]);
    // Cai sits in a garden seat and has never joined a session.
    const cai = await list("m-cai");
    expect(cai.library.items.map((c: LibraryCard) => c.title).sort()).toEqual(["Seed order", "Shed roof", "Village picnic"]);
    expect(cai.library.myCircleIds).toEqual(["c-garden"]);
    // Dee sees what she brought to the garden, and not what Ana brought there.
    expect(await titles("m-dee")).toEqual(["Shed roof", "Village picnic"]);
    expect(await titles("m-founder")).toEqual(["Compost rota", "Seed order", "Shed roof", "Village picnic"]);
    for (const who of Object.keys(PEOPLE)) expect(privacyProblems((await list(who)).library), who).toEqual([]);
  });

  it("answers an item somebody may not see the same as a missing one, and gives the rest only their own rights", async () => {
    expect(await change("m-eve", shed, { title: "Mine now" })).toMatchObject({ status: 404, body: { error: LIBRARY_REFUSALS.notFound } });
    expect(await withdraw("m-eve", shed)).toMatchObject({ status: 404, body: { error: LIBRARY_REFUSALS.notFound } });
    expect(await change("m-eve", 999_999, { title: "Nothing" })).toMatchObject({ status: 404, body: { error: LIBRARY_REFUSALS.notFound } });
    // Ben sees it, and does not host the circle's open session: no right to its words.
    expect(await change("m-ben", shed, { title: "Ben's roof" })).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.wordsNotYours } });
    expect(await withdraw("m-ben", shed)).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.withdrawNotYours } });

    expect((await change("m-dee", shed, { title: "Shed roof repair" })).body.item).toMatchObject({ title: "Shed roof repair", changedBy: null });
    const byAdmin = await change("m-founder", shed, { note: "We need a builder before the rains." });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.item).toMatchObject({ note: "We need a builder before the rains.", changedBy: "Founding Admin" });
    // A change that moves nothing is a quiet yes.
    expect((await change("m-ben", shed, { title: "Shed roof repair" })).status).toBe(200);
  });

  it("lets the facilitator of the circle's open session reword its items, never move their circle, and never touch an item for no circle", async () => {
    const room = await opened("m-ana", "Garden, a quick word", "c-garden");
    const out = await change("m-ana", shed, { title: "Shed roof, phase one" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.item).toMatchObject({ title: "Shed roof, phase one", changedBy: "Ana Reyes", canMoveCircle: false, canWithdraw: false });
    expect(await change("m-ana", shed, { circleId: "c-kitchen" })).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.circleNotYours } });
    expect(await change("m-ana", picnic, { title: "Ana's picnic" })).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.wordsNotYours } });
    // Hosting a garden room without standing gives Eve nothing: she still cannot see its items.
    const eveRoom = await opened("m-eve", "Eve's garden room", "c-garden");
    expect((await change("m-eve", shed, { title: "Eve's roof" })).status).toBe(404);
    await discard("m-eve", eveRoom);
    await discard("m-ana", room);
    // The room's host lost the right the moment the room went.
    expect((await change("m-ana", shed, { title: "Shed roof again" })).status).toBe(403);
  });

  it("refuses to open a room with an item its opener may not take, and leaves no room behind", async () => {
    const before = await sessionCount();
    expect(await openRoom("m-eve", "Eve takes the garden", "c-garden", [shed])).toMatchObject({ status: 409, body: { error: LIBRARY_REFUSALS.moved } });
    // A circle's item never goes into a session for another circle, or for none.
    expect((await openRoom("m-ana", "Kitchen", "c-kitchen", [shed])).status).toBe(409);
    expect((await openRoom("m-ana", "No circle", null, [shed])).status).toBe(409);
    expect((await openRoom("m-ana", "Bad list", "c-garden", "shed")).status).toBe(400);
    expect(await sessionCount()).toBe(before);
    expect((await row(shed)).status).toBe("waiting");
  });

  it("gives no standing for a session somebody opened and closed alone, and takes none from the circle", async () => {
    const solo = await opened("m-eve", "Eve, alone in the garden", "c-garden");
    await close("m-eve", solo);
    // The room's own rule now reads Eve's session as the garden's last; the library reads the last real meeting.
    expect(Number((await lastClosedInCircle(pool, "c-garden", 0))[0].id)).toBe(solo);
    expect(await titles("m-eve")).toEqual(["Compost rota", "Village picnic"]);
    expect((await change("m-eve", shed, { title: "Eve's roof" })).status).toBe(404);
    expect(await titles("m-ben")).toEqual(["Seed order", "Shed roof, phase one", "Village picnic"]);
    expect((await lastClosedPerCircle(pool)).map((r: any) => [r.circle_id, Number(r.id)])).toEqual([["c-garden", week1]]);
    // Opening a second room after it changes nothing either: she still may not take the garden's items.
    expect((await openRoom("m-eve", "Eve takes the garden", "c-garden", [shed])).status).toBe(409);
  });

  it("opens a room with the ticked items on its agenda, in order, keeping who brought each", async () => {
    notices.length = 0;
    week2 = await opened("m-ana", "Garden, week 2", "c-garden", [seed, shed, picnic]);
    const v = await view("m-ana", week2);
    const ana = await noOf("m-ana");
    const dee = await noOf("m-dee");
    expect(v.items.map((i: any) => [i.title, i.aim, i.minutes, i.position, i.broughtBy])).toEqual([
      ["Seed order", "explore", 10, 1, "Ana Reyes"],
      ["Shed roof, phase one", "decide", 15, 2, "Dee Lund"],
      ["Village picnic", "explore", 10, 3, "Dee Lund"],
    ]);
    // Added by whoever put it on this agenda; presented by whoever brought it only when they are in the room.
    for (const i of v.items) expect(i.addedBy).toBe(ana);
    expect(v.items.map((i: any) => i.presenterUserId)).toEqual([ana, null, null]);
    expect(v.items.map((i: any) => i.libraryId)).toEqual([seed, shed, picnic]);
    // The note lands as the item's first note, written by whoever wrote it: the admin rewrote Dee's.
    const shedItem = v.items[1].id;
    expect(v.entries.filter((e: any) => e.itemId === shedItem).map((e: any) => [e.kind, e.text, e.authorUserId])).toEqual([
      ["note", "We need a builder before the rains.", await noOf("m-founder")],
    ]);
    expect(dee).toBeGreaterThan(0);
    for (const id of [seed, shed, picnic]) expect(await row(id)).toMatchObject({ status: "on_agenda", session_id: week2 });
    expect((await card("m-ben", shed))?.session).toEqual({ id: week2, title: "Garden, week 2", open: true });

    // Dee hears twice, once per item, at the item's own card; Ana took her own and hears nothing.
    expect(noticesOf("m-dee", "session_item_taken").map((n) => [n.title, n.body, n.link])).toEqual([
      [LIBRARY_NOTICES.taken("Garden, week 2"), "Shed roof, phase one", `/sessions#brought-${shed}`],
      [LIBRARY_NOTICES.taken("Garden, week 2"), "Village picnic", `/sessions#brought-${picnic}`],
    ]);
    expect(noticesOf("m-ana", "session_item_taken")).toEqual([]);
    expect(new Set(notices.map((n) => n.dedupeKey)).size).toBe(notices.length);

    // Already on an agenda: a second room cannot take it.
    expect((await openRoom("m-ana", "Garden, twice", "c-garden", [shed])).status).toBe(409);
  });

  it("lets anyone in the room bring one more item they may see, and nobody one they may not", async () => {
    notices.length = 0;
    lock = await brought("m-dee", { title: "Tool shed lock", aim: "report", circleId: "c-garden" });
    await join("m-eve", week2);
    // Eve is in the room and has no standing in the garden: its items are not hers to read or take.
    expect((await roomList("m-eve", week2)).body.items).toEqual([]);
    expect(await pull("m-eve", week2, [lock])).toMatchObject({ status: 409, body: { error: LIBRARY_REFUSALS.moved } });
    // Cai has standing through his seat, and has not joined.
    expect((await roomList("m-cai", week2)).body.items.map((c: LibraryCard) => c.title)).toEqual(["Tool shed lock"]);
    expect((await pull("m-cai", week2, [lock])).status).toBe(403);

    await join("m-ben", week2);
    const out = await pull("m-ben", week2, [lock]);
    expect(out).toMatchObject({ status: 200, body: { ids: [lock] } });
    // A second tap moves nothing and refuses nothing.
    expect(await pull("m-ben", week2, [lock])).toMatchObject({ status: 200, body: { ids: [] } });
    expect((await pull("m-ben", week2, [])).status).toBe(400);
    const v = await view("m-ben", week2);
    expect(v.items.find((i: any) => i.libraryId === lock)).toMatchObject({ position: 4, addedBy: await noOf("m-ben"), presenterUserId: null, broughtBy: "Dee Lund" });
    expect(noticesOf("m-dee", "session_item_taken").map((n) => n.body)).toEqual(["Tool shed lock"]);
  });

  it("refuses a batch the agenda has no room for, and writes none of it", async () => {
    const room = await opened("m-ana", "Garden, a long one", "c-garden");
    for (let i = 1; i < SESSION_LIMITS.maxAgenda; i += 1) await addItem("m-ana", room, `Item ${i}`);
    const a = await brought("m-ana", { title: "One more", circleId: "c-garden" });
    const b = await brought("m-ana", { title: "And another", circleId: "c-garden" });
    expect(await pull("m-ana", room, [a, b])).toMatchObject({ status: 409, body: { error: SESSION_REFUSALS.agendaFull } });
    expect((await view("m-ana", room)).items).toHaveLength(SESSION_LIMITS.maxAgenda - 1);
    expect([(await row(a)).status, (await row(b)).status]).toEqual(["waiting", "waiting"]);
    await discard("m-ana", room);
    await withdraw("m-ana", a);
    await withdraw("m-ana", b);
  });

  it("takes up what the room finished at close, sends the rest back to wait, and tells whoever was not there", async () => {
    notices.length = 0;
    const v = await view("m-ana", week2);
    const itemOf = (id: number) => v.items.find((i: any) => i.libraryId === id).id;
    const fence = await addItem("m-ana", week2, "Fence");
    await setItem("m-ana", week2, itemOf(seed), { status: "done" });
    await setItem("m-ana", week2, itemOf(lock), { status: "done" });
    await setItem("m-ana", week2, itemOf(picnic), { status: "parked" });
    await setItem("m-ana", week2, fence, { status: "parked" });
    await close("m-ana", week2);

    expect(await row(seed)).toMatchObject({ status: "taken_up", session_id: week2 });
    expect(await row(lock)).toMatchObject({ status: "taken_up", session_id: week2 });
    expect(await row(shed)).toMatchObject({ status: "waiting", session_id: null, session_item_id: null });
    expect(await row(picnic)).toMatchObject({ status: "waiting", session_id: null });
    expect((await takes(shed)).map((t: any) => t.outcome)).toEqual(["back"]);
    expect((await takes(seed)).map((t: any) => t.outcome)).toEqual(["taken_up"]);

    // Dee was not in the room: she hears how each of hers left. Ana was, and hears nothing.
    expect(noticesOf("m-dee", "session_item_settled").map((n) => [n.title, n.body])).toEqual(
      expect.arrayContaining([
        [LIBRARY_NOTICES.back, "Shed roof, phase one"],
        [LIBRARY_NOTICES.back, "Village picnic"],
        [LIBRARY_NOTICES.takenUp, "Tool shed lock"],
      ]),
    );
    expect(noticesOf("m-ana", "session_item_settled")).toEqual([]);
    // The closed session's title never rides on that notice.
    for (const n of noticesOf("m-dee", "session_item_settled")) expect(n.title).not.toContain("week 2");

    // A taken-up card names the record only to its people and admins.
    expect((await card("m-ben", lock))?.session).toMatchObject({ id: week2, open: false });
    expect((await card("m-dee", lock))?.session).toBeNull();
    expect((await card("m-dee", shed))?.backAt).toBeTruthy();
    // What a session took up reaches its people, its bringer and admins, through every door: Cai has
    // standing in the garden through his seat and was not in week 2, so an empty change finds nothing.
    expect((await change("m-cai", seed, {})).status).toBe(404);
    expect((await change("m-ben", seed, {})).status).toBe(200);
    expect((await card("m-cai", seed))).toBeUndefined();

    // From last time offers the plain parked item, and leaves the library's to the library.
    const week3 = await opened("m-ana", "Garden, week 3", "c-garden");
    expect((await view("m-ana", week3)).carried?.parkedItems.map((p: any) => p.title)).toEqual(["Fence"]);
    await discard("m-ana", week3);
  });

  it("lets whoever brought a taken-up item bring it again, and nobody else", async () => {
    expect(await again("m-ben", seed)).toMatchObject({ status: 403, body: { error: LIBRARY_REFUSALS.againNotYours } });
    expect((await again("m-ana", seed)).body.item).toMatchObject({ status: "waiting", session: null, backAt: null });
    expect(await again("m-ana", seed)).toMatchObject({ status: 409, body: { error: LIBRARY_REFUSALS.notTakenUp } });
  });

  it("withdraws an item for whoever brought it, even from an open agenda, and the room keeps its agenda item", async () => {
    const room = await opened("m-ana", "Garden, week 4", "c-garden", [picnic]);
    expect((await withdraw("m-dee", picnic)).status).toBe(200);
    expect(await row(picnic)).toBeUndefined();
    // Its takes stay: they hold no words, and they keep "From last time" from offering week 2's copy again.
    expect((await takes(picnic)).map((t: any) => [t.session_id, t.outcome])).toEqual([
      [week2, "back"],
      [room, null],
    ]);
    const v = await view("m-ana", room);
    expect(v.items.map((i: any) => [i.title, i.libraryId])).toEqual([["Village picnic", null]]);
    await discard("m-ana", room);
    const week5 = await opened("m-ana", "Garden, after the picnic went", "c-garden");
    expect((await view("m-ana", week5)).carried?.parkedItems.map((p: any) => p.title)).toEqual(["Fence"]);
    await discard("m-ana", week5);
  });

  it("sends a discarded room's items back to wait, and keeps a deleted record's taken-up items without their link", async () => {
    const room = await opened("m-ana", "Garden, by mistake", "c-garden", [seed]);
    expect((await row(seed)).status).toBe("on_agenda");
    await discard("m-ana", room);
    expect(await row(seed)).toMatchObject({ status: "waiting", session_id: null, session_item_id: null });
    expect((await takes(seed)).map((t: any) => t.session_id)).toEqual([week2]);

    // Only an admin deletes a closed record; what it took up stays taken up.
    await discard("m-founder", week2);
    expect(await row(lock)).toMatchObject({ status: "taken_up", session_id: null, session_item_id: null });
    expect(await takes(lock)).toEqual([]);
    expect((await card("m-founder", lock))?.session).toBeNull();
  });

  it("mends an item a session left on its agenda without settling, the next time the list is read", async () => {
    // An older release closes a room without knowing the library exists.
    const closedByOld = await opened("m-ana", "Garden, older release", "c-garden", [shed]);
    await q("UPDATE `live_sessions` SET `status` = 'closed', `closed_at` = NOW() WHERE `id` = ?", [closedByOld]);
    // And deletes another one outright.
    const deletedByOld = await opened("m-ana", "Garden, deleted by an older release", "c-garden", [seed]);
    await q("DELETE FROM `live_sessions` WHERE `id` = ?", [deletedByOld]);

    await list("m-ana");
    // Week 2's record was deleted above, and its takes went with it: what is left is the older release's.
    expect(await row(shed)).toMatchObject({ status: "waiting", session_id: null });
    expect((await takes(shed)).map((t: any) => [t.session_id, t.outcome])).toEqual([[closedByOld, "back"]]);
    // A take that names a session that no longer exists goes with the mend.
    expect(await row(seed)).toMatchObject({ status: "waiting", session_id: null });
    expect(await takes(seed)).toEqual([]);
  });

  it("reads each circle's last closed session the way the room does, when anybody but one was in it", async () => {
    // With no floor it is the room's own reading, circle by circle.
    const per = await lastClosedPerCircle(pool, 0);
    for (const circleId of ["c-garden", "c-kitchen"]) {
      const one = await lastClosedInCircle(pool, circleId, 0);
      expect(per.filter((r: any) => r.circle_id === circleId).map((r: any) => Number(r.id))).toEqual(one.map((r: any) => Number(r.id)));
    }
    // With the library's floor of two, the solo and older-release closes above are passed over.
    expect((await lastClosedPerCircle(pool)).map((r: any) => [r.circle_id, Number(r.id)])).toEqual([["c-garden", week1]]);
  });

  it("exports what a member brought, and takes it with them when they leave", async () => {
    const exported = await exportMemberSessions(pool, "m-dee");
    expect(exported.library.map((r: any) => r.title).sort()).toEqual(["Shed roof, phase one", "Tool shed lock"]);
    // She was in no session, so no session id travels with hers.
    for (const r of exported.library) expect(r.sessionId).toBeNull();
    const benTakes = (await exportMemberSessions(pool, "m-ben")).libraryTakes;
    expect(benTakes.map((t: any) => t.libraryId)).toEqual([]);

    // A note a member wrote on somebody else's item is theirs to take with them.
    expect((await change("m-founder", seed, { note: "Order before the frost." })).status).toBe(200);
    expect((await exportMemberSessions(pool, "m-founder")).libraryNotes).toEqual([
      { libraryId: shed, note: "We need a builder before the rains." },
      { libraryId: seed, note: "Order before the frost." },
    ]);

    const dee = await noOf("m-dee");
    await forgetMemberSessions(pool, "m-dee", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT `id` FROM `live_session_library` WHERE `brought_by_no` = ?", [dee])).toEqual([]);
    // Their takes stay, and hold no words.
    expect((await q("SELECT `outcome` FROM `live_session_library_takes` WHERE `library_id` = ?", [shed])).map((t: any) => t.outcome)).toEqual(["back"]);
    expect(await titles("m-founder")).toEqual(["Compost rota", "Seed order"]);
    await forgetMemberSessions(pool, "m-founder", async (id) => PEOPLE[id] ?? null);
    expect(await row(seed)).toMatchObject({ edited_by_no: null });
    expect((await q("SELECT `note`, `note_by_no` FROM `live_session_library` WHERE `id` = ?", [seed]))[0]).toEqual({ note: null, note_by_no: null });
  });
});
