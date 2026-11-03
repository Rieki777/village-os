/**
 * YOUR LIST ROUTES: a member reaches only their own list, nothing changes
 * until a steward turns it on, a stale write answers 409, a removed task is a
 * tombstone that undo brings back, and erasure leaves nothing.
 *
 * The first block needs no database. The second runs against a real scratch
 * schema. Every person here is invented.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { forgetMemberTasks, setListOn, stewardView } from "../repos/memberTasks";
import { register } from "./memberTasks";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => {} } as any, handlers };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

const deps = (pool: any, who: () => string | null) => ({
  authedUser: async () => (who() ? { id: who() } : null),
  getPool: () => pool,
  overLimit: async () => false,
  timeZone: () => "America/Costa_Rica",
  isAdmin: async () => who() === "m-steward",
  adminActor: () => (who() === "m-steward" ? { id: "m-steward" } : null),
});

const ROUTES = [
  "GET /api/member-tasks/me",
  "POST /api/member-tasks/me",
  "PATCH /api/member-tasks/me/:id",
  "POST /api/member-tasks/me/:id/done",
  "POST /api/member-tasks/me/:id/remove",
  "POST /api/member-tasks/me/:id/undo",
  "POST /api/member-tasks/me/:id/not-now",
];

describe("your list routes without a database", () => {
  it("answers 401 at every door to a stranger", async () => {
    const c = collect();
    register(c.app, deps(null, () => null));
    for (const r of ROUTES) expect((await call(c.handlers, r, { params: { id: "x" } })).status, r).toBe(401);
  });
  it("keeps the switch to stewards", async () => {
    const c = collect();
    register(c.app, deps(null, () => "m-wren"));
    expect((await call(c.handlers, "GET /api/admin/member-tasks/access")).status).toBe(401);
    expect((await call(c.handlers, "PUT /api/admin/member-tasks/access/:userId", { params: { userId: "m-wren" }, body: { on: true } })).status).toBe(401);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("your list against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let whoami: string | null = null;
  let handlers: Map<string, Handler>;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q( // module-review-ok: fixture SQL against the S5 scratch schema
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `handle`) VALUES (?,?,?,'x',?)",
      ["m-wren", "Wren Alder", "wren@example.test", "wren"],
    );
    const c = collect();
    register(c.app, deps(pool, () => whoami));
    handlers = c.handlers;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    whoami = "m-wren";
    await q("DELETE FROM `member_tasks`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `member_task_events`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `member_task_access`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `member_task_import_queue`"); // module-review-ok: fixture SQL against the S5 scratch schema
    await q("DELETE FROM `sera_person_links`"); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  const IMPORT = "POST /api/admin/member-tasks/import";
  const answer = { tasks: [
    { id: "s-1", title: "Draft the season letter", priority: "High", status: "Open", owner_id: "own-wren" },
    { id: "s-2", title: "Call the plumber", priority: "Low", status: "Open", owner_id: "own-wren" },
    { id: "s-3", title: "Old thing", priority: "Medium", status: "Done", owner_id: "own-wren" },
    { id: "s-4", title: "Who takes the compost?", priority: "Medium", status: "Needs Owner" },
  ] };

  it("imports dry first, writes once, and a second run changes nothing", async () => {
    whoami = "m-steward";
    const dry = await call(handlers, IMPORT, { body: { userId: "m-wren", seraOwnerId: "own-wren", answer } });
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.counts).toMatchObject({ create: 2, skipped: 1, needsOwner: 1 });
    expect(await q("SELECT `id` FROM `member_tasks`")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
    const real = await call(handlers, IMPORT, { body: { userId: "m-wren", seraOwnerId: "own-wren", answer, dryRun: false } });
    expect(real.body).toMatchObject({ dryRun: false, created: 2, queued: 1 });
    const again = await call(handlers, IMPORT, { body: { userId: "m-wren", seraOwnerId: "own-wren", answer, dryRun: false } });
    expect(again.body).toMatchObject({ created: 0, updated: 0 });
    expect(again.body.counts.unchanged).toBe(2);
    expect(await q("SELECT `id` FROM `member_tasks` WHERE `user_id` = 'm-wren'")).toHaveLength(2); // module-review-ok: fixture SQL against the S5 scratch schema
    const undone = await call(handlers, "POST /api/admin/member-tasks/import/:batch/remove", { params: { batch: real.body.batch } });
    expect(undone.body.removed).toBe(2);
  });

  it("keeps a member's edit through a rerun", async () => {
    whoami = "m-steward";
    await call(handlers, IMPORT, { body: { userId: "m-wren", seraOwnerId: "own-wren", answer, dryRun: false } });
    await setListOn(pool, "m-wren", true, "m-steward");
    whoami = "m-wren";
    const list = (await call(handlers, "GET /api/member-tasks/me")).body;
    const t = list.open.find((x: any) => x.title === "Call the plumber");
    await call(handlers, "PATCH /api/member-tasks/me/:id", { params: { id: t.id }, body: { version: t.version, title: "Call Marco about the pipe" } });
    whoami = "m-steward";
    const again = await call(handlers, IMPORT, { body: { userId: "m-wren", seraOwnerId: "own-wren", answer, dryRun: false } });
    expect(again.body.counts.keptEdits).toBe(1);
    const [row] = await q("SELECT `title` FROM `member_tasks` WHERE `id` = ?", [t.id]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(row.title).toBe("Call Marco about the pipe");
  });

  it("says off and refuses writes until a steward turns the list on", async () => {
    expect((await call(handlers, "GET /api/member-tasks/me")).body).toEqual({ on: false });
    expect((await call(handlers, "POST /api/member-tasks/me", { body: { title: "Water the beds" } })).status).toBe(403);
    await setListOn(pool, "m-wren", true, "m-steward");
    const made = await call(handlers, "POST /api/member-tasks/me", { body: { title: "Water the beds", tier: "high" } });
    expect(made.status).toBe(201);
    const list = (await call(handlers, "GET /api/member-tasks/me")).body;
    expect(list.on).toBe(true);
    expect(list.open.map((t: any) => t.title)).toEqual(["Water the beds"]);
    expect(list.open[0].reasons).toContain("tier_high");
  });

  it("answers 409 with the latest task when the version moved on", async () => {
    await setListOn(pool, "m-wren", true, null);
    const { task } = (await call(handlers, "POST /api/member-tasks/me", { body: { title: "Fix the gate" } })).body;
    const ok = await call(handlers, "PATCH /api/member-tasks/me/:id", { params: { id: task.id }, body: { version: task.version, tier: "high" } });
    expect(ok.status).toBe(200);
    const stale = await call(handlers, "PATCH /api/member-tasks/me/:id", { params: { id: task.id }, body: { version: task.version, tier: "not_yet" } });
    expect(stale.status).toBe(409);
    expect(stale.body.task.tier).toBe("high");
  });

  it("keeps a removed task as a tombstone that undo brings back", async () => {
    await setListOn(pool, "m-wren", true, null);
    const { task } = (await call(handlers, "POST /api/member-tasks/me", { body: { title: "Old idea" } })).body;
    const gone = await call(handlers, "POST /api/member-tasks/me/:id/remove", { params: { id: task.id }, body: { version: task.version, reason: "not_relevant" } });
    expect(gone.body.task.status).toBe("removed");
    expect((await call(handlers, "GET /api/member-tasks/me")).body.removed).toHaveLength(1);
    const back = await call(handlers, "POST /api/member-tasks/me/:id/undo", { params: { id: task.id }, body: { version: gone.body.task.version } });
    expect(back.body.task.status).toBe("open");
  });

  it("never lets one member reach another's task", async () => {
    await setListOn(pool, "m-wren", true, null);
    await setListOn(pool, "m-kai", true, null);
    const { task } = (await call(handlers, "POST /api/member-tasks/me", { body: { title: "Mine" } })).body;
    whoami = "m-kai";
    expect((await call(handlers, "POST /api/member-tasks/me/:id/done", { params: { id: task.id }, body: { version: 1 } })).status).toBe(404);
    expect((await call(handlers, "GET /api/member-tasks/me")).body.open).toHaveLength(0);
  });

  it("keeps journal text private: the member reads it, the steward view does not", async () => {
    await setListOn(pool, "m-wren", true, null);
    await call(handlers, "POST /api/member-tasks/me", { body: { title: "Ask about the leak", source: "journal", privateDetail: "the leak is back" } });
    expect((await call(handlers, "GET /api/member-tasks/me")).body.open[0].privateDetail).toBe("the leak is back");
    const steward = await stewardView(pool, "m-wren");
    expect(steward).toHaveLength(1);
    expect(JSON.stringify(steward)).not.toContain("leak is back");
  });

  it("lets a steward turn a member's list on through the door", async () => {
    whoami = "m-steward";
    const put = await call(handlers, "PUT /api/admin/member-tasks/access/:userId", { params: { userId: "m-wren" }, body: { on: true } });
    expect(put.body).toEqual({ userId: "m-wren", on: true });
    expect((await call(handlers, "GET /api/admin/member-tasks/access")).body.on).toContain("m-wren");
    whoami = "m-wren";
    expect((await call(handlers, "GET /api/member-tasks/me")).body.on).toBe(true);
  });

  it("refuses a library source from a member's own hand", async () => {
    await setListOn(pool, "m-wren", true, null);
    expect((await call(handlers, "POST /api/member-tasks/me", { body: { title: "x", source: "sera" } })).status).toBe(400);
  });

  it("erasure leaves nothing of the member's list", async () => {
    await setListOn(pool, "m-wren", true, null);
    await call(handlers, "POST /api/member-tasks/me", { body: { title: "Mine" } });
    await forgetMemberTasks(pool, "m-wren");
    expect(await q("SELECT `id` FROM `member_tasks` WHERE `user_id` = 'm-wren'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(await q("SELECT `id` FROM `member_task_events` WHERE `user_id` = 'm-wren'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(await q("SELECT `user_id` FROM `member_task_access` WHERE `user_id` = 'm-wren'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
  });
});
