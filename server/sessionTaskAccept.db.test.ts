/**
 * Accept as accomplished against a real schema (PR 4 of the player role
 * card): a circle meets, its tasks are done, and a holder of the power that
 * seats people accepts the work, through the real doors.
 *
 * Same harness as server/sessionTasks.db.test.ts: both route modules on a fake
 * Express that collects the handlers, the scratch schema's pool behind them,
 * a stub member list, and `liveHoldersOf` as a list the cases move. THE CASES
 * RUN IN ORDER and share one story.
 *
 * WHAT THIS PROVES THAT THE PURE TESTS CANNOT: that the accept lands on a
 * closed session's task and appends one `accepted` event with its note, that
 * the door refuses a self-accept, a same-role accept and anybody without the
 * power, that a second press changes nothing, that Waiting on you lists only
 * work the reader may accept, that the Accomplished list follows a reopen,
 * and that erasing the acceptor takes their note off the event.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { forgetMemberSessions } from "./lib/liveSessions";
import { accomplishmentsOf, tasksToAccept } from "./lib/sessionTasks";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerTasks } from "./routes/sessionTasks";
import { ACCEPTING_POWER, TASK_REFUSALS, type TaskCard } from "../shared/sessionTasks";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", handle: "ana" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", handle: "ben" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", handle: "cai" },
  "m-dee": { id: "m-dee", name: "Dee Lund", handle: "dee" },
  "m-eve": { id: "m-eve", name: "Eve Strand", handle: "eve" },
  "m-gil": { id: "m-gil", name: "Gil Varga", handle: "gil" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("accept as accomplished against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  /** Who holds `org.seat` live, as the gate would count it. Cases move it. */
  let powerHolders: string[] = ["m-eve", "m-gil", "m-cai", "m-ben"];
  const asked: string[] = [];
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
  const answer = (who: string, entryId: number, body: Record<string, unknown>) =>
    as(who, "PATCH /api/sessions/tasks/:entryId", { params: { entryId: String(entryId) }, body });
  const accept = (who: string, entryId: number, body?: Record<string, unknown>) =>
    as(who, "POST /api/sessions/tasks/:entryId/accept", { params: { entryId: String(entryId) }, body });
  const board = (who: string) => as(who, "GET /api/sessions/tasks/mine");
  const events = (entryId: number) => q("SELECT `kind`, `by_no`, `status`, `note` FROM `live_session_task_events` WHERE `entry_id` = ? ORDER BY `id`", [entryId]);
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0]?.no ?? 0);
  const versionOf = async (entryId: number) => Number((await q("SELECT `version` FROM `live_session_task_state` WHERE `entry_id` = ?", [entryId]))[0].version);
  const lookup = async (id: string) => PEOPLE[id] ?? null;

  let session = 0;
  let seed = 0;
  let tank = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const c = collect();
    const deps = {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null),
      isAdmin: async () => false,
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => [{ id: "c-garden", name: "Garden circle", status: "active" }] },
      lapseContext: () => LAPSE,
      liveHoldersOf: async (capability: string) => {
        asked.push(capability);
        return powerHolders;
      },
    } as any;
    registerRoom(c.app, deps);
    registerTasks(c.app, deps);
    handlers = c.handlers;
    // The water role, held by Cai and Gil.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL), ('ora-gil', 'seat-water', 'member', 'm-gil', 'm-gil', NULL)",
    );

    const opened = await as("m-ana", "POST /api/sessions", { body: { title: "Garden circle, week 1", circleId: "c-garden", durationMin: 45 } });
    session = Number(opened.body.id);
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: { id: String(session) } })).status).toBe(200);
    const add = async (body: Record<string, unknown>) =>
      Number((await as("m-ana", "POST /api/sessions/:id/entries", { params: { id: String(session) }, body: { kind: "action", ...body } })).body.id);
    seed = await add({ text: "Order the seed" });
    tank = await add({ text: "Fix the water tank", ownerSeatId: "seat-water" });
    expect((await as("m-ben", "PATCH /api/sessions/:id/entries/:entryId", { params: { id: String(session), entryId: String(seed) }, body: { claim: true } })).status).toBe(200);
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(session) } })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses to accept a task that is not done yet, with the card", async () => {
    const out = await accept("m-eve", seed);
    // Eve is in no session and has no standing: an open task is not hers to read.
    expect(out).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    // Ana was in the room, so she reads the card: it is not done yet.
    expect(await accept("m-ana", seed)).toMatchObject({ status: 409, body: { error: TASK_REFUSALS.notDoneYet, task: { entryId: seed, status: "open" } } });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((c) => c === ACCEPTING_POWER)).toBe(true);
  });

  it("refuses a self-accept: the holder marked it done, and holds the power", async () => {
    const done = await answer("m-ben", seed, { op: "done", version: await versionOf(seed), note: "Ordered" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.task).toMatchObject({ status: "done", canAccept: false, waitingToBeAccepted: false, acceptedOn: null });
    expect(await accept("m-ben", seed)).toEqual({ status: 403, body: { error: TASK_REFUSALS.ownWork } });
    // The PATCH is the same door underneath, and says the same.
    expect(await answer("m-ben", seed, { op: "accepted", version: await versionOf(seed) })).toEqual({ status: 403, body: { error: TASK_REFUSALS.ownWork } });
    // Ana holds nothing and does not hold the power; Dee cannot even read it.
    expect(await accept("m-ana", seed)).toEqual({ status: 403, body: { error: TASK_REFUSALS.notAnAcceptor } });
    expect(await accept("m-dee", seed)).toEqual({ status: 404, body: { error: TASK_REFUSALS.notFound } });
  });

  it("refuses a same-role accept: Gil sits in the role that holds the task Cai did", async () => {
    const done = await answer("m-cai", tank, { op: "done", version: await versionOf(tank) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await accept("m-cai", tank)).toEqual({ status: 403, body: { error: TASK_REFUSALS.ownWork } });
    expect(await accept("m-gil", tank)).toEqual({ status: 403, body: { error: TASK_REFUSALS.ownWork } });
  });

  it("lists in Waiting on you only the work each holder may accept", async () => {
    const eve = await tasksToAccept(pool, "m-eve", { acceptors: powerHolders, lapseContext: () => LAPSE });
    expect(eve.map((t) => t.entryId).sort()).toEqual([seed, tank].sort());
    expect(eve.find((t) => t.entryId === tank)).toMatchObject({ text: "Fix the water tank", role: "Water keeper", circle: "Garden circle" });
    expect(eve.find((t) => t.entryId === tank)?.doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(eve)).not.toMatch(/Ben|Cai|Ortiz|Moreno|m-/);
    // Gil sits in the water role, so only the seed is his to accept; Ben's own seed is not Ben's.
    expect((await tasksToAccept(pool, "m-gil", { acceptors: powerHolders })).map((t) => t.entryId)).toEqual([seed]);
    expect((await tasksToAccept(pool, "m-ben", { acceptors: powerHolders })).map((t) => t.entryId)).toEqual([tank]);
    // Somebody without the power is asked nothing.
    expect(await tasksToAccept(pool, "m-dee", { acceptors: powerHolders })).toEqual([]);
  });

  it("refuses payment details in the note", async () => {
    expect(await accept("m-eve", seed, { note: "Paid to 4111 1111 1111 1111" })).toEqual({ status: 400, body: { error: TASK_REFUSALS.paymentDetails } });
    expect((await events(seed)).map((e: any) => e.kind)).toEqual(["done"]);
  });

  it("accepts the work, appends one accepted event with the note, and changes nothing on a second press", async () => {
    const out = await accept("m-eve", seed, { note: "  The seed came on time  " });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const card: TaskCard = out.body.task;
    expect(card).toMatchObject({ entryId: seed, status: "done", canAccept: false, latest: { kind: "accepted", note: "The seed came on time", byName: "Eve Strand" } });
    expect(card.acceptedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const eveNo = await noOf("m-eve");
    expect(eveNo).toBeGreaterThan(0);
    expect(await events(seed)).toEqual([
      { kind: "done", by_no: await noOf("m-ben"), status: "done", note: "Ordered" },
      { kind: "accepted", by_no: eveNo, status: "done", note: "The seed came on time" },
    ]);
    const again = await accept("m-eve", seed, { note: "Twice" });
    expect(again.status).toBe(200);
    expect((await events(seed)).length).toBe(2);
    // Ben's board shows it accepted, in Finished.
    const ben = await board("m-ben");
    expect(ben.body.finished.find((c: TaskCard) => c.entryId === seed)).toMatchObject({ status: "done", acceptedOn: card.acceptedOn, latest: { kind: "accepted" } });
    // It has left Waiting on you.
    expect((await tasksToAccept(pool, "m-eve", { acceptors: powerHolders })).map((t) => t.entryId)).toEqual([tank]);
  });

  it("reads Waiting to be accepted when every holder of the power holds the task or its role", async () => {
    powerHolders = ["m-cai", "m-gil"];
    const cai = await board("m-cai");
    expect(cai.body.finished.find((c: TaskCard) => c.entryId === tank)).toMatchObject({ status: "done", waitingToBeAccepted: true, canAccept: false });
    powerHolders = ["m-eve", "m-gil", "m-cai", "m-ben"];
    expect((await board("m-cai")).body.finished.find((c: TaskCard) => c.entryId === tank)).toMatchObject({ waitingToBeAccepted: false });
  });

  it("files the accepted work under its doer, by moon, for the player card", async () => {
    expect((await accept("m-eve", tank)).status).toBe(200);
    const ben = await accomplishmentsOf(pool, "m-ben", { lapseContext: () => LAPSE });
    expect(ben).toHaveLength(1);
    expect(ben[0].items).toMatchObject([{ entryId: seed, text: "Order the seed", note: "The seed came on time", roleId: null }]);
    expect(ben[0].id).toMatch(/^lunar-/);
    // A role's task counts for whoever in the role marked it done.
    expect((await accomplishmentsOf(pool, "m-cai", { lapseContext: () => LAPSE }))[0].items).toMatchObject([{ entryId: tank, roleId: "seat-water" }]);
    expect(await accomplishmentsOf(pool, "m-gil", { lapseContext: () => LAPSE })).toEqual([]);
    // Somebody with no standing in the circle reads none of the circle's tasks on a profile.
    expect(await accomplishmentsOf(pool, "m-ben", { lapseContext: () => LAPSE }, { viewer: { userId: "m-dee", admin: false } })).toEqual([]);
    expect(await accomplishmentsOf(pool, "m-ben", { lapseContext: () => LAPSE }, { viewer: { userId: "m-ana", admin: false } })).toHaveLength(1);
  });

  it("takes a reopened task out of Accomplished, and the history keeps the accept", async () => {
    const out = await answer("m-ben", seed, { op: "reopened", version: await versionOf(seed) });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.task).toMatchObject({ status: "open", acceptedOn: null });
    expect(await accomplishmentsOf(pool, "m-ben", { lapseContext: () => LAPSE })).toEqual([]);
    expect((await events(seed)).map((e: any) => e.kind)).toEqual(["done", "accepted", "reopened"]);
  });

  it("erasing the acceptor takes their name and their note off the accept", async () => {
    const eveNo = await noOf("m-eve");
    await forgetMemberSessions(pool, "m-eve", lookup);
    const rows = await q("SELECT `kind`, `by_no`, `note` FROM `live_session_task_events` WHERE `kind` = 'accepted' ORDER BY `id`");
    expect(rows).toEqual([
      { kind: "accepted", by_no: 0, note: null },
      { kind: "accepted", by_no: 0, note: null },
    ]);
    expect(await q("SELECT COUNT(*) AS `n` FROM `live_session_task_events` WHERE `by_no` = ?", [eveNo])).toEqual([{ n: 0 }]);
    expect(await q("SELECT `latest_kind`, `latest_note`, `changed_by_no` FROM `live_session_task_state` WHERE `entry_id` = ?", [tank])).toEqual([
      { latest_kind: "accepted", latest_note: null, changed_by_no: 0 },
    ]);
  });
});
