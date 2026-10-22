/**
 * A circle's rhythm against a real schema: who may set when a circle meets,
 * what "Coming up" shows each member, skipping and stopping, one circle's
 * sessions for its home page, and the day-before notice.
 *
 * The room's, the tasks', the agenda library's and the rhythm's route modules
 * are registered on a fake Express with the scratch schema's pool behind
 * them, so every case goes through the real doors. The people are a stub
 * member list; the notices are recorded where they would have been sent.
 *
 * THE CASES RUN IN ORDER and share one story: a garden circle meets once, then
 * sets a rhythm, and its members hear the day before.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { forgetMemberSessions } from "./lib/liveSessions";
import { runComingUpNotes } from "./lib/sessionRhythm";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerTasks } from "./routes/sessionTasks";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { liveCircles, register as registerRhythm } from "./routes/sessionRhythm";
import { RHYTHM_REFUSALS, type ComingUpPayload, type ComingUpRow } from "../shared/sessionRhythm";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", email: "ana@village.example.test" },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", email: "ben@village.example.test" },
  "m-cai": { id: "m-cai", name: "Cai Moreno", email: "cai@village.example.test" },
  "m-dee": { id: "m-dee", name: "Dee Lund", email: "dee@village.example.test" },
  "m-eve": { id: "m-eve", name: "Eve Strand", email: "eve@village.example.test" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

const DAY_MS = 86_400_000;
/** A village date this many days from now, YYYY-MM-DD (the village is UTC here). */
const dayFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

const configured = testDbConfigured();

describe.skipIf(!configured)("a circle's rhythm against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const notices: any[] = [];
  const LAPSE = { currentSeasonId: null, cadence: "never" };
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const comingUp = async (who: string): Promise<ComingUpPayload> => {
    const out = await as(who, "GET /api/sessions");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body.comingUp;
  };
  const gardenRow = async (who: string): Promise<ComingUpRow | undefined> => (await comingUp(who)).rows.find((r) => r.circleId === "c-garden");
  const setRhythm = async (who: string, circleId: string, body: Record<string, unknown>) =>
    as(who, "PUT /api/sessions/circles/:circleId/rhythm", { params: { circleId }, body });
  const skip = async (who: string, circleId: string, key: unknown) => as(who, "POST /api/sessions/circles/:circleId/rhythm/skip", { params: { circleId }, body: { key } });
  const summary = async (who: string, circleId: string) => as(who, "GET /api/sessions/circles/:circleId/summary", { params: { circleId } });
  const opened = async (who: string, title: string, circleId: string): Promise<number> => {
    const out = await as(who, "POST /api/sessions", { body: { title, circleId, durationMin: 60 } });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return Number(out.body.id);
  };
  const join = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/join", { params: { id: String(id) } })).status).toBe(200);
  const close = async (who: string, id: number) => expect((await as(who, "POST /api/sessions/:id/close", { params: { id: String(id) } })).status).toBe(200);
  const discard = async (who: string, id: number) => expect((await as(who, "DELETE /api/sessions/:id", { params: { id: String(id) } })).status).toBe(200);
  const noOf = async (userId: string) => Number((await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = ?", [userId]))[0]?.no ?? 0);
  const jobDeps = (over: Record<string, unknown> = {}) => ({
    circles: () => liveCircles({ all: () => CIRCLES } as any),
    lapseContext: () => LAPSE as any,
    getPool: () => pool as any,
    notify: async (n: any) => {
      notices.push(n);
      return { fresh: true };
    },
    window: () => ({ start: 0, end: 24 }),
    lifecycle: () => "members",
    ...over,
  });

  let week1 = 0;
  let weekday = 0;

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
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => LAPSE,
    } as any;
    registerRoom(c.app, deps);
    registerTasks(c.app, deps);
    registerLibrary(c.app, deps);
    registerRhythm(c.app, deps);
    handlers = c.handlers;
    // Cai sits in the garden's water seat and has never joined a session.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL)",
    );
    // The garden's first meeting: Ana and Ben.
    week1 = await opened("m-ana", "Garden, week 1", "c-garden");
    await join("m-ben", week1);
    await close("m-ana", week1);
    // The day after tomorrow's weekday, so the next meeting is two days off.
    weekday = new Date(Date.now() + 2 * DAY_MS).getUTCDay();
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets the circle's members and admins set when it meets, and nobody else", async () => {
    expect((await setRhythm("m-eve", "c-garden", { kind: "weekly", weekday, everyWeeks: 1, time: "18:00" })).body.error).toBe(RHYTHM_REFUSALS.notYours);
    expect((await setRhythm("m-cai", "c-moon", { kind: "weekly", weekday, everyWeeks: 1, time: "18:00" })).status).toBe(400);
    expect((await setRhythm("m-cai", "c-garden", { kind: "weekly", weekday, everyWeeks: 9, time: "18:00" })).body.error).toBe(RHYTHM_REFUSALS.everyWeeks);
    // Cai sits in a garden seat and has never been to a session: the seat is enough.
    const out = await setRhythm("m-cai", "c-garden", { kind: "weekly", weekday, everyWeeks: 1, time: "18:00", durationMin: 45 });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.row).toMatchObject({ circleId: "c-garden", durationMin: 45, next: { key: dayFromNow(2) }, canKeep: true });
    expect((await setRhythm("m-founder", "c-kitchen", { kind: "moon", on: "full_moon", time: "19:00" })).status).toBe(200);
    expect((await setRhythm("m-eve", "c-kitchen", { kind: "none" })).status).toBe(403);
  });

  it("shows every member when each circle meets, their own circles first", async () => {
    const eve = await comingUp("m-eve");
    expect(eve.rows.map((r) => r.circleId).sort()).toEqual(["c-garden", "c-kitchen"]);
    expect(eve.keepCircleIds).toEqual([]);
    expect(eve.rows.every((r) => !r.canKeep && !r.mine)).toBe(true);
    const ana = await comingUp("m-ana");
    expect(ana.rows[0]).toMatchObject({ circleId: "c-garden", mine: true, canKeep: true, words: expect.stringMatching(/at 18:00$/) });
    expect(ana.keepCircleIds).toEqual(["c-garden"]);
    expect((await comingUp("m-founder")).keepCircleIds.sort()).toEqual(["c-garden", "c-kitchen"]);
    expect(ana.zone).toBe("UTC");
  });

  it("counts the agenda items waiting for a meeting as each member may see them", async () => {
    // Dee has no standing in the garden; her item is hers, the circle's, and the admins' to read.
    expect((await as("m-dee", "POST /api/sessions/library", { body: { title: "Shed roof", circleId: "c-garden" } })).status).toBe(200);
    expect((await gardenRow("m-eve"))?.waiting).toBe(0);
    expect((await gardenRow("m-dee"))?.waiting).toBe(1);
    expect((await gardenRow("m-ben"))?.waiting).toBe(1);
  });

  it("offers the circle's open room while it is open", async () => {
    const room = await opened("m-ana", "Garden, early", "c-garden");
    expect((await gardenRow("m-eve"))?.openRoom).toEqual({ id: room, title: "Garden, early" });
    await discard("m-ana", room);
    expect((await gardenRow("m-eve"))?.openRoom).toBeNull();
  });

  it("skips one coming meeting for the circle's members, and nothing else", async () => {
    const before = (await gardenRow("m-cai"))!;
    expect(await skip("m-eve", "c-garden", before.next.key)).toMatchObject({ status: 403 });
    expect(await skip("m-cai", "c-garden", "2099-01-01")).toMatchObject({ status: 409, body: { error: RHYTHM_REFUSALS.skipUnknown } });
    const out = await skip("m-cai", "c-garden", before.next.key);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.row.next.key).toBe(dayFromNow(9));
    const [row] = await q("SELECT `recurrence` FROM `live_session_rhythms` WHERE `circle_id` = 'c-garden'");
    expect(JSON.parse(row.recurrence).exceptions).toEqual([before.next.key]);
  });

  it("answers one circle's sessions for its home page", async () => {
    const out = await summary("m-eve", "c-garden");
    expect(out.status).toBe(200);
    const [w1] = await q("SELECT `closed_at` FROM `live_sessions` WHERE `id` = ?", [week1]);
    expect(out.body).toMatchObject({
      circleId: "c-garden",
      rhythm: { kind: "weekly", words: expect.stringMatching(/^Every \w+day at 18:00$/) },
      next: { key: dayFromNow(9) },
      lastMetAt: new Date(w1.closed_at).toISOString(),
      waiting: 0,
      openRoom: null,
      canKeep: false,
    });
    expect((await summary("m-ben", "c-garden")).body.waiting).toBe(1);
    expect((await summary("m-eve", "c-moon")).status).toBe(404);
    // A circle with no rhythm has a summary too.
    await setRhythm("m-founder", "c-kitchen", { kind: "none" });
    expect((await summary("m-eve", "c-kitchen")).body).toMatchObject({ rhythm: null, next: null, lastMetAt: null });
  });

  it("tells the circle's members the day before, once each, with what is on the agenda", async () => {
    notices.length = 0;
    const next = (await gardenRow("m-cai"))!.next;
    const dayBefore = new Date(Date.parse(next.at) - 20 * 3_600_000);
    expect(await runComingUpNotes(jobDeps(), dayBefore)).toMatch(/^3 coming-up notice/);
    expect(notices.map((n) => n.userId).sort()).toEqual(["m-ana", "m-ben", "m-cai"]);
    for (const n of notices) {
      expect(n).toMatchObject({
        type: "session_coming_up",
        title: "The Garden circle meets tomorrow at 18:00",
        body: "On the agenda: Shed roof.",
        link: "/sessions#coming-c-garden",
        dedupeKey: `session-coming:c-garden:${next.key}:${n.userId}`,
      });
    }
    // Every hour of the day asks with the same keys, so the bell keeps one each.
    const keys = notices.map((n) => n.dedupeKey).sort();
    notices.length = 0;
    await runComingUpNotes(jobDeps(), new Date(dayBefore.getTime() + 3_600_000));
    expect(notices.map((n) => n.dedupeKey).sort()).toEqual(keys);
  });

  it("says nothing too early, outside the daytime window, or while the module is off", async () => {
    notices.length = 0;
    const next = (await gardenRow("m-cai"))!.next;
    expect(await runComingUpNotes(jobDeps(), new Date(Date.parse(next.at) - 3 * DAY_MS))).toBe("no circle meets in the next day");
    // Twenty hours before an 18:00 meeting is 22:00 the evening before: outside an 08:00 to 09:00 day.
    expect(await runComingUpNotes(jobDeps({ window: () => ({ start: 8, end: 9 }) }), new Date(Date.parse(next.at) - 20 * 3_600_000))).toBe(
      "outside the village's daytime window",
    );
    expect(notices).toEqual([]);
    expect(await runComingUpNotes(jobDeps({ lifecycle: () => "off" }), new Date(Date.parse(next.at) - 3_600_000))).toBe("the sessions module is off");
  });

  it("refuses a single meeting already gone, and stops a rhythm on request", async () => {
    expect((await setRhythm("m-ana", "c-garden", { kind: "once", on: dayFromNow(-3), time: "18:00" })).body.error).toBe(RHYTHM_REFUSALS.past);
    expect((await setRhythm("m-ana", "c-garden", { kind: "once", on: dayFromNow(5), time: "18:00" })).body.row.next.key).toBe(dayFromNow(5));
    expect((await setRhythm("m-ana", "c-garden", { kind: "none" })).body.row).toBeNull();
    expect((await comingUp("m-ana")).rows).toEqual([]);
  });

  it("exports the rhythms a member set, and forgets them when the member leaves", async () => {
    expect((await setRhythm("m-cai", "c-garden", { kind: "weekly", weekday, everyWeeks: 2, time: "07:30" })).status).toBe(200);
    expect((await exportMemberSessions(pool, "m-cai")).rhythmsSet.map((r: any) => r.circleId)).toEqual(["c-garden"]);
    const cai = await noOf("m-cai");
    expect(cai).toBeGreaterThan(0);
    await forgetMemberSessions(pool, "m-cai", async (id) => PEOPLE[id] ?? null);
    expect((await q("SELECT `set_by_no` FROM `live_session_rhythms` WHERE `circle_id` = 'c-garden'"))[0].set_by_no).toBe(0);
    // The rhythm itself is the circle's, and stays.
    expect((await gardenRow("m-ana"))?.rhythmWords).toMatch(/^Every 2 weeks on \w+day at 07:30$/);
  });
});
