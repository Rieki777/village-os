/**
 * The task board against a real schema: a session closes, its actions become
 * tasks, and they are answered weeks later through the real doors.
 *
 * Both route modules are registered on the fake Express
 * server/liveSessions.db.test.ts uses, with the scratch schema's pool behind
 * them, so the room is opened, filled and closed through its own doors and
 * every task door runs its real handler. The people are a stub member list;
 * the notices are recorded where they would have been sent. The task emails
 * are server/sessionTaskMail.db.test.ts.
 *
 * THE CASES RUN IN ORDER and share one story: a garden circle meets, closes,
 * and meets again while its tasks are answered.
 *
 * WHAT THIS PROVES THAT THE PURE TESTS CANNOT: that both closes seed the
 * state rows in their own transaction, that an answer lands on a closed
 * session and moves the circle's open room, that a stale version is refused
 * with the card as it is now, that the board reads live seats and leaves a
 * lapsed term out, and that no payload carries a member's id, an email, or a
 * count about a person.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { MIGRATIONS_DIR, splitStatements } from "./db/migrate";
import { closeStaleRooms } from "./lib/liveSessions";
import { lastTimeIn } from "./lib/circleStanding";
import { lastMeetingInCircle, lastMeetingPerCircle } from "./repos/liveSessions";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerTasks } from "./routes/sessionTasks";
import { TASK_REFUSALS, type TaskCard, type TaskCountPayload } from "../shared/sessionTasks";

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
  "m-fay": { id: "m-fay", name: "Fay Holm", handle: "fay", email: "fay@village.example.test" },
  "m-gil": { id: "m-gil", name: "Gil Varga", handle: "gil", email: "gil@village.example.test" },
  "m-hal": { id: "m-hal", name: "Hal Brook", handle: "hal", email: "hal@village.example.test" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

/** Keys whose numbers are about a task or the board, never about a person. */
const NUMBER_KEYS = new Set(["entryId", "sessionId", "version", "earlierCount", "sendNo", "queued"]);

/**
 * Walk a payload and say what it must never carry: a member's own id, an
 * email address, a number under any key but a task's own, or a key that
 * reads like a tally of somebody.
 */
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
        if (/count|total|streak|tally/i.test(k) && k !== "earlierCount") problems.push(`${at}.${k} reads like a tally`);
        if (typeof x === "number" && !NUMBER_KEYS.has(k)) problems.push(`${at}.${k} is a number`);
        walk(x, `${at}.${k}`);
      }
    }
  };
  walk(payload, "$");
  return problems;
}

const configured = testDbConfigured();

describe.skipIf(!configured)("the task board against a real schema", () => {
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
  const board = async (who: string, query: Record<string, string> = {}) => as(who, "GET /api/sessions/tasks/mine", { query });
  const answer = async (who: string, entryId: number, body: Record<string, unknown>) =>
    as(who, "PATCH /api/sessions/tasks/:entryId", { params: { entryId: String(entryId) }, body });
  const record = async (who: string, id: number) => as(who, "GET /api/sessions/:id/task-record", { params: { id: String(id) } });
  const count = async (who: string | null) => as(who, "GET /api/sessions/tasks/count");
  const markDone = async (who: string, entryId: number) => as(who, "POST /api/sessions/tasks/:entryId/done", { params: { entryId: String(entryId) } });
  const taskState = async (entryId: number) => (await q("SELECT `status`, `version` FROM `live_session_task_state` WHERE `entry_id` = ?", [entryId]))[0];
  const eventCount = async (entryId: number) => Number((await q("SELECT COUNT(*) AS `n` FROM `live_session_task_events` WHERE `entry_id` = ?", [entryId]))[0].n);
  const ids = (cards: TaskCard[]) => cards.map((c) => c.entryId);

  /** A room opened, joined and filled through its own doors. */
  const open = async (who: string, title: string, circleId: string): Promise<number> => {
    const out = await as(who, "POST /api/sessions", { body: { title, circleId, durationMin: 45 } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const join = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/join", { params: { id: String(id) } })).status).toBe(200);
  const add = async (who: string, id: number, body: Record<string, unknown>): Promise<number> => {
    const out = await as(who, "POST /api/sessions/:id/entries", { params: { id: String(id) }, body: { kind: "action", ...body } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const claim = async (who: string, id: number, entryId: number) =>
    expect((await as(who, "PATCH /api/sessions/:id/entries/:entryId", { params: { id: String(id), entryId: String(entryId) }, body: { claim: true } })).status).toBe(200);
  const close = async (who: string, id: number) => as(who, "POST /api/sessions/:id/close", { params: { id: String(id) } });
  /** Rooms a case opened only to look through, gone again so the story's later cases read as before. */
  const forget = async (sessionIds: number[]) => {
    await q("DELETE FROM `live_session_people` WHERE `session_id` IN (?)", [sessionIds]);
    await q("DELETE FROM `live_sessions` WHERE `id` IN (?)", [sessionIds]);
  };
  const stateRows = async (sessionId: number) =>
    q("SELECT `entry_id`, `status`, `owner_no`, `owner_seat_id`, `latest_kind`, `changed_by_no`, `version`, `changed_at` FROM `live_session_task_state` WHERE `session_id` = ? ORDER BY `entry_id`", [sessionId]);

  // The story's ids.
  let s1 = 0;
  let s3 = 0;
  let seed = 0;
  let tank = 0;
  let bees = 0;
  let tools = 0;
  let hens = 0;
  let soup = 0;
  let pots = 0;

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
    handlers = c.handlers;
    // Two live seats in the garden circle. Cai sits in the water seat and has
    // never joined a session; Dee's term in the bee seat ran out last year.
    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES " +
        "('seat-water', 'c-garden', 'Water keeper', 1, 0), ('seat-bees', 'c-garden', 'Bee keeper', 1, 0)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL), ('ora-dee', 'seat-bees', 'member', 'm-dee', 'm-dee', '2025-01-01 00:00:00')",
    );
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("seeds a task for every held action when the room closes, and nothing while the close is refused", async () => {
    s1 = await open("m-ana", "Garden circle, week 1", "c-garden");
    await join("m-ben", s1);
    seed = await add("m-ana", s1, { text: "Order the seed", dueOn: "2099-03-01" });
    tank = await add("m-ana", s1, { text: "Fix the water tank", ownerSeatId: "seat-water" });
    bees = await add("m-ana", s1, { text: "Feed the bees", ownerSeatId: "seat-bees" });
    tools = await add("m-ana", s1, { text: "Count the tools" });

    // Two actions nobody holds yet: the close is refused and writes no task.
    expect((await close("m-ana", s1)).status).toBe(409);
    expect(await stateRows(s1)).toEqual([]);

    await claim("m-ben", s1, seed);
    await claim("m-ana", s1, tools);
    expect((await close("m-ana", s1)).status).toBe(200);
    const rows = await stateRows(s1);
    expect(rows.map((r: any) => Number(r.entry_id))).toEqual([seed, tank, bees, tools]);
    for (const r of rows) expect(r).toMatchObject({ status: "open", latest_kind: "closed", changed_by_no: 0, version: 1 });
    // Written in the close's own transaction: each row carries the close's instant.
    const [s] = await q("SELECT `closed_at` FROM `live_sessions` WHERE `id` = ?", [s1]);
    for (const r of rows) expect(new Date(r.changed_at).toISOString()).toBe(new Date(s.closed_at).toISOString());
  });

  it("seeds a quiet room's tasks too, when it closes itself", async () => {
    const quiet = await open("m-ana", "Kitchen circle", "c-kitchen");
    soup = await add("m-ana", quiet, { text: "Make the soup" });
    await claim("m-ana", quiet, soup);
    const longAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await q("UPDATE `live_sessions` SET `created_at` = ? WHERE `id` = ?", [longAgo, quiet]);
    await q("UPDATE `live_session_people` SET `last_seen_at` = ? WHERE `session_id` = ?", [longAgo, quiet]);
    const closed = await closeStaleRooms(pool, { lookup: async (id) => PEOPLE[id] ?? null, circleName: () => "Kitchen circle" }, { notify: async () => undefined, notifyAdmins: async () => undefined }, new Date(), quiet);
    expect(closed).toEqual([quiet]);
    expect((await stateRows(quiet)).map((r: any) => Number(r.entry_id))).toEqual([soup]);
  });

  it("changes nothing when the migration's backfill meets rows a close already seeded", async () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, "0255_a_task_keeps_going_after_the_call.sql"), "utf8");
    const [insert] = splitStatements(sql).filter((st) => /^INSERT IGNORE/i.test(st));
    for (let run = 0; run < 2; run++) {
      const [r] = await pool.query<any>(insert); // module-review-ok: the migration's own statement, run again against the scratch schema
      expect(Number(r.affectedRows), `run ${run + 1}`).toBe(0);
    }
  });

  it("lists your tasks and your live seats' tasks, and leaves a lapsed term's seat out", async () => {
    const ben = await board("m-ben");
    expect(ben.status).toBe(200);
    expect(ids(ben.body.holding)).toEqual([seed]);
    expect(ben.body.holding[0]).toMatchObject({ heldAs: "you", holderName: "Ben Ortiz", circleName: "Garden circle", canAnswer: true, recordLink: true, version: 1 });
    expect(ben.body.seatsHold).toEqual([]);
    // Cai never joined a session, and still reads what the water seat holds, with no record link.
    const cai = await board("m-cai");
    expect(ids(cai.body.holding)).toEqual([]);
    expect(ids(cai.body.seatsHold)).toEqual([tank]);
    // First names only, for "Held by Water keeper (Cai)" (Rye, 2026-10-30): the surname is never sent.
    expect(cai.body.seatsHold[0]).toMatchObject({ heldAs: "seat", seat: { id: "seat-water", name: "Water keeper", holders: ["Cai"] }, canAnswer: true, recordLink: false });
    expect(JSON.stringify(cai.body)).not.toContain("Moreno");
    // Dee's term ran out: the bee seat's task is not on her board.
    const dee = await board("m-dee");
    expect(dee.body).toMatchObject({ holding: [], seatsHold: [], finished: [], earlierCount: 0 });
    expect(dee.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Somebody who holds nothing reads an empty board.
    expect((await board("m-eve")).body).toMatchObject({ holding: [], seatsHold: [], finished: [] });
  });

  it("answers on a closed session, appends one event, and moves the circle's open room", async () => {
    s3 = await open("m-ana", "Garden circle, week 2", "c-garden");
    const [{ version: before }] = await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [s3]);
    const out = await answer("m-ben", seed, { op: "not_yet", version: 1, dueOn: "2099-04-01", note: "The catalogue is late" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.task).toMatchObject({ entryId: seed, status: "open", dueOn: "2099-04-01", version: 2, latest: { kind: "not_yet", note: "The catalogue is late", byName: "Ben Ortiz" } });
    expect(await q("SELECT `kind`, `note` FROM `live_session_task_events` WHERE `entry_id` = ?", [seed])).toEqual([{ kind: "not_yet", note: "The catalogue is late" }]);
    const [{ version: after }] = await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [s3]);
    expect(Number(after)).toBe(Number(before) + 1);
    // The record never changed: the entry still says what the room said.
    expect(await q("SELECT DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on` FROM `live_session_entries` WHERE `id` = ?", [seed])).toEqual([{ due_on: "2099-03-01" }]);
  });

  it("refuses a version that moved, and hands back the card as it stands now", async () => {
    const out = await answer("m-ben", seed, { op: "done", version: 1 });
    expect(out.status).toBe(409);
    expect(out.body.error).toBe(TASK_REFUSALS.moved);
    expect(out.body.task).toMatchObject({ entryId: seed, version: 2, dueOn: "2099-04-01" });
    expect(await q("SELECT COUNT(*) AS `n` FROM `live_session_task_events` WHERE `entry_id` = ?", [seed])).toEqual([{ n: 1 }]);
  });

  it("answers 404 to somebody who may not see the task, and lets a seat holder answer through the seat", async () => {
    for (const who of ["m-eve", "m-dee"]) {
      const out = await answer(who, seed, { op: "done", version: 2 });
      expect(out, who).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    }
    // A lapsed term answers nothing through its old seat.
    expect((await answer("m-dee", bees, { op: "done", version: 1 })).status).toBe(404);
    // Cai answers through the water seat, and gets a number to sign it with.
    const out = await answer("m-cai", tank, { op: "done", version: 1, note: "New float valve" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.task).toMatchObject({ status: "done", heldAs: "seat", canReopen: true, latest: { kind: "done", byName: "Cai Moreno" } });
    const cai = await board("m-cai");
    expect(ids(cai.body.finished)).toEqual([tank]);
    // A let go needs its sentence.
    expect(await answer("m-ana", tools, { op: "let_go", version: 1 })).toMatchObject({ status: 400, body: { error: TASK_REFUSALS.needSentence } });
  });

  it("hands a task back to the circle, tells the facilitator, and another member takes it", async () => {
    notices.length = 0;
    const back = await answer("m-ben", seed, { op: "handed_back", version: 2, note: "I am away in March" });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.task).toMatchObject({ heldAs: "circle", holderName: null, status: "open", version: 3 });
    expect(notices).toEqual([
      expect.objectContaining({ userId: "m-ana", type: "session_task_back", link: `/sessions/${s1}`, dedupeKey: expect.stringMatching(new RegExp(`^session-task-back:${seed}:\\d+$`)) }),
    ]);
    // Ben handed it back and holds nothing now.
    expect((await board("m-ben")).body.holding).toEqual([]);
    const taken = await answer("m-ana", seed, { op: "taken", version: 3 });
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect(taken.body.task).toMatchObject({ heldAs: "you", holderName: "Ana Reyes", version: 4 });
    expect(ids((await board("m-ana")).body.holding)).toEqual(expect.arrayContaining([seed, tools]));
  });

  it("shows an action still in an open session read-only, and answers it nowhere but the room", async () => {
    await join("m-ben", s3);
    hens = await add("m-ana", s3, { text: "Count the hens", dueOn: "2099-05-01" });
    await claim("m-ben", s3, hens);
    const ben = await board("m-ben");
    const card = ben.body.holding.find((c: TaskCard) => c.entryId === hens);
    expect(card).toMatchObject({ inSessionNow: true, canAnswer: false, canReopen: false, canTake: false, latest: null, version: 0, heldAs: "you" });
    expect(await answer("m-ben", hens, { op: "done", version: 0 })).toMatchObject({ status: 400 });
    expect(await answer("m-ben", hens, { op: "done", version: 1 })).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
  });

  it("brings the circle's tasks into its next room, for the people who may read them", async () => {
    const view = async (who: string) => {
      const out = await as(who, "GET /api/sessions/:id", { params: { id: String(s3) } });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      return out.body.circleTasks as TaskCard[];
    };
    // The circle met a while ago. A timestamp keeps whole seconds, so without
    // this an answer given in the same second as the close would read as
    // "before the circle last met".
    await q("UPDATE `live_sessions` SET `closed_at` = `closed_at` - INTERVAL 1 HOUR WHERE `id` = ?", [s1]);
    // The facilitator of the open room reads every one, the done one included
    // because it was answered after the circle last met.
    expect(ids(await view("m-ana")).sort((a, b) => a - b)).toEqual([seed, tank, bees, tools]);
    // Ben was in the room they came from.
    expect(ids(await view("m-ben")).sort((a, b) => a - b)).toEqual([seed, tank, bees, tools]);
    // Eve joins the new room and was never in the old one: she reads none of them.
    await join("m-eve", s3);
    expect(await view("m-eve")).toEqual([]);
  });

  it("gives a host a circle's tasks only where they have standing", async () => {
    const roomView = async (who: string, id: number) => {
      const out = await as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      return out.body;
    };
    // Eve was never in the garden circle's last call and sits in none of its
    // seats. Opening a room of her own there makes her its host, and nothing more.
    const evesRoom = await open("m-eve", "Garden circle, a room of my own", "c-garden");
    expect(await roomView("m-eve", evesRoom)).toMatchObject({ circleTasks: [], circleLastMetAt: null });
    const [{ version }] = await q("SELECT `version` FROM `live_session_task_state` WHERE `entry_id` = ?", [tools]);
    for (const body of [
      { op: "let_go", version: Number(version), note: "Nobody needs a count" },
      { op: "handed_back", version: Number(version) },
      { op: "not_yet", version: Number(version), dueOn: "2099-07-01" },
    ]) {
      expect(await answer("m-eve", tools, body), body.op).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    }
    expect(await q("SELECT `version`, `owner_no` IS NOT NULL AS `held` FROM `live_session_task_state` WHERE `entry_id` = ?", [tools])).toEqual([{ version, held: 1 }]);
    // Cai sits in the water seat of the garden circle: hosting a room there, he reads every task of it.
    const caisRoom = await open("m-cai", "Garden circle, the water", "c-garden");
    const cai = await roomView("m-cai", caisRoom);
    expect(ids(cai.circleTasks).sort((a: number, b: number) => a - b)).toEqual([seed, tank, bees, tools]);
    expect(Date.parse(cai.circleLastMetAt)).toBeGreaterThan(0);
    await forget([evesRoom, caisRoom]);
  });

  it("brings an action nobody held at close into the circle's next room, back with the circle", async () => {
    // A kitchen call closed before the task layer, and the person who took its
    // one action has since left the village: the backfill finds it unheld.
    const k1 = await open("m-ana", "Kitchen circle, week 2", "c-kitchen");
    pots = await add("m-ana", k1, { text: "Scrub the big pots" });
    await claim("m-ana", k1, pots);
    expect((await close("m-ana", k1)).status).toBe(200);
    await q("DELETE FROM `live_session_task_state` WHERE `entry_id` = ?", [pots]);
    await q("UPDATE `live_session_entries` SET `owner_no` = NULL WHERE `id` = ?", [pots]);
    await q("UPDATE `live_sessions` SET `closed_at` = `closed_at` - INTERVAL 1 HOUR WHERE `id` = ?", [k1]);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, "0255_a_task_keeps_going_after_the_call.sql"), "utf8");
    const [insert] = splitStatements(sql).filter((st) => /^INSERT IGNORE/i.test(st));
    const [r] = await pool.query<any>(insert); // module-review-ok: the migration's own statement, run again against the scratch schema
    expect(Number(r.affectedRows)).toBe(1);

    const k2 = await open("m-ana", "Kitchen circle, week 3", "c-kitchen");
    const out = await as("m-ana", "GET /api/sessions/:id", { params: { id: String(k2) } });
    const card = (out.body.circleTasks as TaskCard[]).find((c) => c.entryId === pots);
    expect(card).toMatchObject({ status: "open", heldAs: "circle", holderName: null, canTake: true });
    await forget([k2]);
  });

  it("serves a session's tasks to its people and admins, and the send button to its facilitator", async () => {
    const ana = await record("m-ana", s1);
    expect(ana.status).toBe(200);
    expect(ids(ana.body.tasks)).toEqual([seed, tank, bees, tools]);
    expect(ana.body.mail).toEqual({ canSend: true, lastSend: null });
    expect((await record("m-ben", s1)).body.mail.canSend).toBe(false);
    expect((await record("m-founder", s1)).body.mail.canSend).toBe(true);
    expect((await record("m-eve", s1)).status).toBe(403);
    // Cai sits in the circle's water seat: he reads the circle's cards, and nothing of the record around them.
    expect(await record("m-cai", s1)).toMatchObject({ status: 200, body: { mail: { canSend: false, lastSend: null } } });
    // An open session has no tasks yet and nothing to send.
    expect((await record("m-ana", s3)).body).toEqual({ tasks: [], mail: { canSend: false, lastSend: null } });
    // The last send says how many emails it put on their way: none, when the village's email is not set up.
    const sql = "INSERT INTO `live_session_task_sends` (`session_id`, `send_no`, `sent_by_no`, `counts`) VALUES (?, 1, 0, ?)";
    await q(sql, [s1, JSON.stringify({ people: 3, queued: 0, skipped: { no_api_key: 3 } })]);
    expect((await record("m-ana", s1)).body.mail.lastSend).toMatchObject({ sendNo: 1, byName: null, queued: 0 });
    // A send still going out has no counts yet.
    await q("UPDATE `live_session_task_sends` SET `counts` = '{}' WHERE `session_id` = ?", [s1]);
    expect((await record("m-ana", s1)).body.mail.lastSend).toMatchObject({ sendNo: 1, queued: null });
    await q("DELETE FROM `live_session_task_sends` WHERE `session_id` = ?", [s1]);
  });

  it("lets the whole circle read its task cards and take what came back, and nothing more (Rye, 2026-10-21)", async () => {
    const roomAs = async (who: string, id: number) => as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
    const minutesAs = async (who: string, id: number) => as(who, "GET /api/sessions/:id/minutes.md", { params: { id: String(id) } });
    const garden = [seed, tank, bees, tools];

    // FAY sits in the garden circle's compost seat, which holds nothing, and
    // has never joined a session: standing through her seat, and nothing else.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-compost', 'c-garden', 'Compost keeper', 1, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-fay', 'seat-compost', 'member', 'm-fay', 'm-fay', NULL)",
    );
    const fay = await record("m-fay", s1);
    expect(fay.status, JSON.stringify(fay.body)).toBe(200);
    expect(ids(fay.body.tasks)).toEqual(garden);
    expect(fay.body.mail).toEqual({ canSend: false, lastSend: null });
    for (const c of fay.body.tasks as TaskCard[]) expect(c, String(c.entryId)).toMatchObject({ recordLink: false, canAnswer: false, canReopen: false, canTake: false });
    // The cards are the circle's. The record and its minutes stay with the people who were in the room.
    expect((await roomAs("m-fay", s1)).status).toBe(403);
    expect((await minutesAs("m-fay", s1)).status).toBe(403);
    // Reading a card is not answering it: not yet, it's done, open it again.
    const seedNow = await taskState(seed);
    expect(await answer("m-fay", seed, { op: "not_yet", version: Number(seedNow.version), dueOn: "2099-08-01" })).toMatchObject({
      status: 403,
      body: { error: TASK_REFUSALS.notYours },
    });
    expect(await markDone("m-fay", tools)).toMatchObject({ status: 403, body: { error: TASK_REFUSALS.notYours } });
    const tankNow = await taskState(tank);
    expect(await answer("m-fay", tank, { op: "reopened", version: Number(tankNow.version) })).toMatchObject({ status: 403 });
    expect(await taskState(seed)).toEqual(seedNow);
    expect(await taskState(tank)).toEqual(tankNow);
    // Her own board and her own count hold nothing of the circle's: nothing of it is hers.
    expect((await board("m-fay")).body).toMatchObject({ holding: [], seatsHold: [], circleBack: [], finished: [] });
    expect((await count("m-fay")).body).toEqual({ waiting: 0, nextDue: null });

    // GIL was in the kitchen circle's last call, which took on nothing. He was
    // never in the rooms the soup and the pots came from, and hosts nothing.
    const kx = await open("m-ana", "Kitchen circle, week 4", "c-kitchen");
    await join("m-gil", kx);
    expect((await close("m-ana", kx)).status).toBe(200);
    const kOpen = await open("m-ana", "Kitchen circle, week 5", "c-kitchen");
    const gilRoom = await roomAs("m-gil", kOpen);
    expect(gilRoom.status, JSON.stringify(gilRoom.body)).toBe(200);
    const gilCards = gilRoom.body.circleTasks as TaskCard[];
    expect(ids(gilCards).sort((a, b) => a - b)).toEqual([soup, pots].sort((a, b) => a - b));
    expect(gilCards.find((c) => c.entryId === pots)).toMatchObject({ heldAs: "circle", canTake: true, canAnswer: false, recordLink: false });
    expect(gilCards.find((c) => c.entryId === soup)).toMatchObject({ heldAs: "person", holderName: "Ana Reyes", canTake: false, canAnswer: false, recordLink: false });
    // The kitchen call the pots came from, which Gil was never in.
    const [{ session_id: k1 }] = await q("SELECT `session_id` FROM `live_session_task_state` WHERE `entry_id` = ?", [pots]);
    expect((await roomAs("m-gil", Number(k1))).status).toBe(403);
    expect(await record("m-gil", Number(k1))).toMatchObject({
      status: 200,
      body: { tasks: [{ entryId: pots, heldAs: "circle", canTake: true, recordLink: false }], mail: { canSend: false, lastSend: null } },
    });
    // His board puts the pots in front of him before the kitchen meets again, and never counts them as his.
    const gilBoard = (await board("m-gil")).body;
    expect(ids(gilBoard.circleBack)).toEqual([pots]);
    expect(gilBoard.holding).toEqual([]);
    expect((await count("m-gil")).body).toEqual({ waiting: 0, nextDue: null });

    // HAL sits in the kitchen's pantry seat and has never joined a session, so
    // he has no number yet. Fay holds a kitchen seat too, but the kitchen
    // rested it: a seat the circle no longer keeps gives no standing.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-pantry', 'c-kitchen', 'Pantry keeper', 1, 0), ('seat-oven', 'c-kitchen', 'Oven keeper', 0, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-hal', 'seat-pantry', 'member', 'm-hal', 'm-hal', NULL), ('ora-fay-oven', 'seat-oven', 'member', 'm-fay', 'm-fay', NULL)",
    );
    // Before he has joined anything, the open kitchen room already reads him the circle's cards.
    const halRoom = await roomAs("m-hal", kOpen);
    expect(halRoom.body.me.joined).toBe(false);
    expect(ids(halRoom.body.circleTasks).sort((a, b) => a - b)).toEqual([soup, pots].sort((a, b) => a - b));
    expect(ids((await board("m-hal")).body.circleBack)).toEqual([pots]);
    expect((await board("m-hal")).body.circleBack[0]).toMatchObject({ canTake: true, canAnswer: false, recordLink: false });

    // OUTSIDERS read none of it: Eve is in neither circle, Dee's garden term
    // ran out, and Fay's standing is in the garden, never the kitchen.
    for (const [who, sessionId] of [["m-eve", s1], ["m-dee", s1], ["m-eve", k1], ["m-fay", k1]] as const) {
      expect((await record(who, Number(sessionId))).status, `${who} on ${sessionId}`).toBe(403);
    }
    for (const who of ["m-eve", "m-fay"]) {
      expect((await roomAs(who, kOpen)).body.circleTasks, who).toEqual([]);
      expect((await board(who)).body.circleBack, who).toEqual([]);
      expect(await answer(who, pots, { op: "taken", version: Number((await taskState(pots)).version) }), who).toMatchObject({ status: 404 });
    }

    // Hal takes the pots, and is given his number for it. Nobody in the
    // circle hears about it from a notice, and it becomes his: on his board,
    // in his count, and gone from Gil's.
    notices.length = 0;
    const taken = await answer("m-hal", pots, { op: "taken", version: Number((await taskState(pots)).version) });
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect(taken.body.task).toMatchObject({ entryId: pots, heldAs: "you", holderName: "Hal Brook", canAnswer: true, recordLink: false });
    expect(notices).toEqual([]);
    expect(await q("SELECT COUNT(*) AS `n` FROM `live_session_members` WHERE `user_id` = 'm-hal'")).toEqual([{ n: 1 }]);
    const after = (await board("m-hal")).body;
    expect(ids(after.holding)).toEqual([pots]);
    expect(after.circleBack).toEqual([]);
    expect((await count("m-hal")).body).toEqual({ waiting: 1, nextDue: null });
    expect((await board("m-gil")).body.circleBack).toEqual([]);
    await forget([kOpen]);
  });

  it("counts only a meeting two or more people were in: a close made alone gives no standing and takes none (Rye, 2026-10-21)", async () => {
    const roomAs = async (who: string, id: number) => as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
    const addItem = async (who: string, id: number, title: string) => {
      const out = await as(who, "POST /api/sessions/:id/items", { params: { id: String(id) }, body: { title, aim: "explore", minutes: 10 } });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
    };
    const [{ session_id: k1 }] = await q("SELECT `session_id` FROM `live_session_task_state` WHERE `entry_id` = ?", [pots]);

    // A real kitchen meeting: Ana and Gil, with an agenda item it never reached.
    const km = await open("m-ana", "Kitchen circle, week 6", "c-kitchen");
    await join("m-gil", km);
    await addItem("m-ana", km, "Sharpen the knives");
    expect((await close("m-ana", km)).status).toBe(200);
    // Then Eve opens a kitchen room alone and closes it with nothing in it, the way a test room goes. It is the plain last close.
    const solo = await open("m-eve", "Eve, alone in the kitchen", "c-kitchen");
    expect((await close("m-eve", solo)).status).toBe(200);
    await q("UPDATE `live_sessions` SET `closed_at` = `closed_at` + INTERVAL 1 MINUTE WHERE `id` = ?", [solo]);

    // Her close gives her nothing in the kitchen.
    expect((await record("m-eve", Number(k1))).status).toBe(403);
    // It takes nothing from Gil, who was at the meeting, or from Hal, whose seat keeps him in without either.
    expect((await record("m-gil", Number(k1))).status).toBe(200);
    expect((await record("m-hal", Number(k1))).status).toBe(200);
    // Ben was in no kitchen meeting and sits in no kitchen seat.
    expect((await record("m-ben", Number(k1))).status).toBe(403);

    // The next kitchen room carries from the meeting: an empty room one person was in never stands in front of it.
    const kNext = await open("m-ana", "Kitchen circle, week 7", "c-kitchen");
    const ana = (await roomAs("m-ana", kNext)).body;
    const [{ closed_at: metAt }] = await q("SELECT `closed_at` FROM `live_sessions` WHERE `id` = ?", [km]);
    expect(ana.circleLastMetAt).toBe(new Date(metAt).toISOString());
    expect(ana.carried).toMatchObject({ sessionId: km });
    expect(ana.carried.parkedItems.map((i: { title: string }) => i.title)).toEqual(["Sharpen the knives"]);
    expect(ids((await roomAs("m-gil", kNext)).body.circleTasks)).toContain(pots);
    // Eve reads no card of the kitchen there, and nothing carried.
    const eve = (await roomAs("m-eve", kNext)).body;
    expect(eve.circleTasks).toEqual([]);
    expect(eve.carried).toBeNull();

    // A meeting stays a meeting when one of its people later leaves the village
    // and their row goes: the close kept its own count. Gil's row, gone a moment.
    const gilNo = Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-gil'"))[0].no);
    const [gilRow] = await q("SELECT * FROM `live_session_people` WHERE `session_id` = ? AND `member_no` = ?", [km, gilNo]);
    await q("DELETE FROM `live_session_people` WHERE `session_id` = ? AND `member_no` = ?", [km, gilNo]);
    expect(Number((await lastMeetingInCircle(pool, "c-kitchen", 0))[0].id)).toBe(km);
    expect((await lastMeetingPerCircle(pool, { circleIds: ["c-kitchen"] })).map((r: any) => Number(r.id))).toEqual([km]);
    expect(Number((await lastTimeIn(pool, "c-kitchen", kNext))?.id)).toBe(km);
    await q("INSERT INTO `live_session_people` SET ?", [gilRow]);
    await forget([kNext]);
  });

  it("keeps a one-person session that left something behind as last time, so nothing it parked is lost, and still gives it no standing", async () => {
    const roomAs = async (who: string, id: number) => as(who, "GET /api/sessions/:id", { params: { id: String(id) } });
    const [{ session_id: k1 }] = await q("SELECT `session_id` FROM `live_session_task_state` WHERE `entry_id` = ?", [pots]);
    // Ana works alone in the kitchen and parks one thing for next time.
    const alone = await open("m-ana", "Kitchen, Ana alone", "c-kitchen");
    const hinges = await as("m-ana", "POST /api/sessions/:id/items", { params: { id: String(alone) }, body: { title: "Oil the hinges", aim: "report", minutes: 5 } });
    expect(hinges.status, JSON.stringify(hinges.body)).toBe(200);
    expect((await close("m-ana", alone)).status).toBe(200);
    await q("UPDATE `live_sessions` SET `closed_at` = `closed_at` + INTERVAL 2 MINUTE WHERE `id` = ?", [alone]);

    // Her next room carries from it: what she parked is offered, and the check groups from its close.
    const next = await open("m-ana", "Kitchen circle, week 8", "c-kitchen");
    const ana = (await roomAs("m-ana", next)).body;
    const [{ closed_at: aloneAt }] = await q("SELECT `closed_at` FROM `live_sessions` WHERE `id` = ?", [alone]);
    expect(ana.carried).toMatchObject({ sessionId: alone });
    expect(ana.carried.parkedItems.map((i: { title: string }) => i.title)).toEqual(["Oil the hinges"]);
    expect(ana.circleLastMetAt).toBe(new Date(aloneAt).toISOString());
    // It is still no meeting: Gil keeps his standing from the last one, and Eve gains none.
    expect(Number((await lastMeetingInCircle(pool, "c-kitchen", next))[0].id)).not.toBe(alone);
    expect((await record("m-gil", Number(k1))).status).toBe(200);
    expect((await record("m-eve", Number(k1))).status).toBe(403);
    await forget([next]);
  });

  it("carries no member id, no email, and no count about a person, on any board, record or room", async () => {
    const payloads: [string, unknown][] = [];
    for (const who of Object.keys(PEOPLE)) {
      payloads.push([`board ${who}`, (await board(who)).body]);
      payloads.push([`earlier ${who}`, (await board(who, { earlier: "1" })).body]);
    }
    payloads.push(["record", (await record("m-ana", s1)).body]);
    payloads.push(["room", (await as("m-ana", "GET /api/sessions/:id", { params: { id: String(s3) } })).body.circleTasks]);
    payloads.push(["answer", (await answer("m-ana", seed, { op: "not_yet", version: 4, dueOn: "2099-06-01" })).body]);
    for (const [name, p] of payloads) expect(privacyProblems(p), name).toEqual([]);
    // The walk itself catches each thing it looks for: an id, an address, a
    // tally (which is also a stray number), and a stray number.
    expect(privacyProblems({ a: "m-ben", b: "x@y.z", c: { doneCount: 1 }, d: 3 })).toEqual([
      "$.a is a member id",
      "$.b reads like an email",
      "$.c.doneCount reads like a tally",
      "$.c.doneCount is a number",
      "$.d is a number",
    ]);
  });

  it("exports the tasks a member holds and the answers they gave, and only theirs", async () => {
    const ben = await exportMemberSessions(pool, "m-ben");
    // Ben handed the seed back, so he holds only the hens, which are still in the room.
    expect(ben.tasks).toEqual([]);
    expect(ben.taskAnswers.map((a: any) => [a.entryId, a.kind, a.note])).toEqual([
      [seed, "not_yet", "The catalogue is late"],
      [seed, "handed_back", "I am away in March"],
    ]);
    const ana = await exportMemberSessions(pool, "m-ana");
    expect(ana.tasks.map((t: any) => t.entryId).sort((a: number, b: number) => a - b)).toEqual([seed, tools, soup]);
    expect(ana.taskAnswers.map((a: any) => a.kind)).toEqual(["taken", "not_yet"]);
    // Nothing of Ben's words travels in Ana's export.
    expect(JSON.stringify(ana)).not.toContain("The catalogue is late");
  });

  // ── What waits on you, and It's done from the bell ───────────────────────

  it("counts what waits on each member, the same tasks their own board holds", async () => {
    for (const who of Object.keys(PEOPLE)) {
      const b = (await board(who)).body;
      const out = await count(who);
      expect(out.status, who).toBe(200);
      expect(out.headers["cache-control"], who).toBe("private, no-store");
      const waiting: TaskCard[] = [...b.holding, ...b.seatsHold];
      const dates = waiting.map((t) => t.dueOn).filter((d): d is string => !!d).sort();
      const expected: TaskCountPayload = { waiting: waiting.length, nextDue: dates[0] ?? null };
      expect(out.body, who).toEqual(expected);
    }
    // Ana holds the seed, the tools and the soup. Ben holds the hens, still in the room.
    expect((await count("m-ana")).body).toEqual({ waiting: 3, nextDue: "2099-06-01" });
    expect((await count("m-ben")).body).toEqual({ waiting: 1, nextDue: "2099-05-01" });
    // The water seat's task is done, Dee's term ran out, and Eve holds nothing.
    for (const who of ["m-cai", "m-dee", "m-eve"]) expect((await count(who)).body, who).toEqual({ waiting: 0, nextDue: null });
    expect(await count(null)).toMatchObject({ status: 401, body: { error: "auth_required" } });
  });

  it("marks a task done from the bell with the version it reads itself, and a second press changes nothing", async () => {
    const before = await taskState(tools);
    const events = await eventCount(tools);
    const out = await markDone("m-ana", tools);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.task).toMatchObject({
      entryId: tools,
      status: "done",
      version: Number(before.version) + 1,
      canReopen: true,
      latest: { kind: "done", note: null, byName: "Ana Reyes" },
    });
    expect(await eventCount(tools)).toBe(events + 1);
    expect((await count("m-ana")).body.waiting).toBe(2);
    // Pressed again, from another tab: the same card, no event, no new version.
    const again = await markDone("m-ana", tools);
    expect(again).toMatchObject({ status: 200, body: { task: out.body.task } });
    expect(await eventCount(tools)).toBe(events + 1);
    expect(await taskState(tools)).toEqual({ status: "done", version: Number(before.version) + 1 });
    // Open it again: the PATCH's reopen, with the version the bell was handed.
    const undo = await answer("m-ana", tools, { op: "reopened", version: out.body.task.version });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.task).toMatchObject({ status: "open", canAnswer: true });
    expect((await count("m-ana")).body.waiting).toBe(3);
  });

  it("refuses It's done to somebody who may not see the task, and to somebody who may only read it", async () => {
    const seedBefore = await taskState(seed);
    // Eve never saw the seed, Dee's lapsed term reaches nothing, and the hens are answered in the room.
    expect(await markDone("m-eve", seed)).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    expect(await markDone("m-dee", bees)).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    expect(await markDone("m-ben", hens)).toMatchObject({ status: 404, body: { error: TASK_REFUSALS.notFound } });
    // Ben was in the room the seed came from, so he reads it, and he holds it no longer.
    expect(await markDone("m-ben", seed)).toMatchObject({ status: 403, body: { error: TASK_REFUSALS.notYours } });
    expect(await taskState(seed)).toEqual(seedBefore);
  });

  it("answers a task that was let go with its own sentence, and leaves it let go", async () => {
    const { version } = await taskState(soup);
    const letGo = await answer("m-ana", soup, { op: "let_go", version: Number(version), note: "The kitchen makes its own soup now" });
    expect(letGo.status, JSON.stringify(letGo.body)).toBe(200);
    const after = await taskState(soup);
    const events = await eventCount(soup);
    const out = await markDone("m-ana", soup);
    expect(out).toMatchObject({ status: 409, body: { error: TASK_REFUSALS.letGoNotDone, task: { entryId: soup, status: "let_go" } } });
    expect(await taskState(soup)).toEqual(after);
    expect(await eventCount(soup)).toBe(events);
  });

  it("lets somebody who sits in the holding seat mark its task done from the bell", async () => {
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-eve', 'seat-bees', 'member', 'm-eve', 'm-eve', NULL)",
    );
    expect((await count("m-eve")).body).toEqual({ waiting: 1, nextDue: null });
    const out = await markDone("m-eve", bees);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.task).toMatchObject({ entryId: bees, status: "done", heldAs: "seat", latest: { kind: "done", byName: "Eve Strand" } });
    expect((await count("m-eve")).body).toEqual({ waiting: 0, nextDue: null });
    expect(privacyProblems(out.body)).toEqual([]);
  });
});
