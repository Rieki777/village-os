/**
 * Circle meetings on a calendar against a real schema: the mirror into the
 * village calendar, following circles, the private address, and the feed a
 * calendar app reads at it.
 *
 * The room's, the agenda library's, the rhythm's and the calendar's route
 * modules are registered on a fake Express with the scratch schema's pool
 * behind them, so every case goes through the real doors. The people are a
 * stub member list. Live Sessions is turned on in this schema the way an
 * admin would, in `module_settings`, because the feed and the mirror measure
 * the module's state themselves.
 *
 * THE CASES RUN IN ORDER and share one story: the garden and the kitchen keep
 * rhythms, Ana follows the garden, then every circle, and her calendar app
 * reads what she follows at each moment.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { loadModuleSettings } from "./lib/modules";
import { forgetMemberSessions } from "./lib/liveSessions";
import { calendarIdFor } from "./lib/calendar";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerRhythm } from "./routes/sessionRhythm";
import { register as registerCalendar } from "./routes/sessionCalendar";
import { CALENDAR_REFUSALS, CIRCLE_FEED_PATH, MIRROR_SOURCE, type FollowPayload } from "../shared/sessionCalendar";

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
    type(t: string) {
      out.headers["content-type"] = t;
      return res;
    },
    send(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    end() {
      return res;
    },
  };
  return { res, out };
}

const PEOPLE: Record<string, any> = {
  "m-ana": { id: "m-ana", name: "Ana Reyes", email: "ana@village.example.test", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", email: "ben@village.example.test", membershipGranted: true },
  "m-gus": { id: "m-gus", name: "Gus Guest", email: "gus@village.example.test" },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

const DAY_MS = 86_400_000;
const configured = testDbConfigured();

describe.skipIf(!configured)("circle meetings on a calendar against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];
  let anaKey = "";

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const following = async (who: string): Promise<FollowPayload> => {
    const out = await as(who, "GET /api/sessions/circles/following");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    return out.body;
  };
  const follow = async (who: string, body: unknown) => as(who, "PUT /api/sessions/circles/following", { body });
  const feed = async (key: unknown) => as(null, `GET ${CIRCLE_FEED_PATH}`, { query: { key } });
  const setRhythm = async (who: string, circleId: string, body: Record<string, unknown>) =>
    as(who, "PUT /api/sessions/circles/:circleId/rhythm", { params: { circleId }, body });
  const lifecycle = async (value: string) => {
    await q("UPDATE `module_settings` SET `lifecycle` = ? WHERE `module_id` = 'sessions'", [value]); // module-review-ok: moves Live Sessions between members, preview and off in the scratch schema this suite provisioned, the way an admin would
    await loadModuleSettings(pool);
  };
  const mirrored = async () =>
    q("SELECT `source_id`, `layer`, `kind`, `title`, `link`, `recurrence`, `removed_at` FROM `events` WHERE `source_module` = ? ORDER BY `source_id`", [MIRROR_SOURCE]);

  const weekday = new Date(Date.now() + 2 * DAY_MS).getUTCDay();

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('sessions', 'members')"); // module-review-ok: turns Live Sessions on in the scratch schema this suite provisioned, since the feed and the mirror measure the module's state
    await loadModuleSettings(pool);
    const c = collect();
    const deps = {
      authedUser: async () => (whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null),
      isAdmin: async () => whoami === "m-founder",
      getPool: () => pool,
      overLimit: async () => false,
      members: { byId: async (id: string) => PEOPLE[id] ?? null },
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
      clientIp: () => "203.0.113.9",
      deploymentOrigin: () => "https://village.example.test",
      projectName: () => "Village",
    } as any;
    registerRoom(c.app, deps);
    registerLibrary(c.app, deps);
    registerRhythm(c.app, deps);
    registerCalendar(c.app, deps);
    handlers = c.handlers;
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("mirrors each circle's rhythm into the village calendar as it is set, on the circle layer", async () => {
    expect((await setRhythm("m-founder", "c-garden", { kind: "weekly", weekday, everyWeeks: 2, time: "18:00" })).status).toBe(200);
    expect((await setRhythm("m-founder", "c-kitchen", { kind: "moon", on: "full_moon", time: "19:00" })).status).toBe(200);
    const rows = await mirrored();
    expect(rows.map((r: any) => [r.source_id, r.layer, r.kind, r.title, r.link, r.removed_at])).toEqual([
      ["c-garden", "circle", "call", "Garden circle meeting", "/sessions#coming-c-garden", null],
      ["c-kitchen", "circle", "call", "Kitchen circle meeting", "/sessions#coming-c-kitchen", null],
    ]);
    // The calendar keeps its recurrence in a JSON column, which the driver hands back parsed.
    expect(typeof rows[0].recurrence === "string" ? JSON.parse(rows[0].recurrence) : rows[0].recurrence).toMatchObject({ freq: "weekly", interval: 2 });
  });

  it("lists every live circle to follow, with how it meets, and nothing followed yet", async () => {
    const ana = await following("m-ana");
    expect(ana.circles.map((c) => [c.id, c.followed])).toEqual([
      ["c-garden", false],
      ["c-kitchen", false],
    ]);
    expect(ana.circles[0].rhythm).toMatch(/^Every 2 weeks on \w+day at 18:00$/);
    expect(ana).toMatchObject({ all: false, address: null, serving: true });
    expect((await as(null, "GET /api/sessions/circles/following")).status).toBe(401);
  });

  it("follows the circles chosen, and refuses one that is not a live circle", async () => {
    expect(await follow("m-ana", { circleIds: ["c-moon"] })).toMatchObject({ status: 400, body: { error: CALENDAR_REFUSALS.circleUnknown } });
    const out = await follow("m-ana", { circleIds: ["c-garden"] });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.circles.map((c: any) => [c.id, c.followed])).toEqual([
      ["c-garden", true],
      ["c-kitchen", false],
    ]);
  });

  it("makes an address shown once, and the calendar app reads only the circles followed", async () => {
    // The address sits on the origin this request came in on (FRONTEND_URL is not set here).
    const made = await as("m-ana", "POST /api/sessions/circles/following/key", { headers: { host: "garden.example.test", "x-forwarded-proto": "https" } });
    expect(made.status).toBe(200);
    expect(made.headers["cache-control"]).toBe("no-store");
    const url = new URL(made.body.url);
    expect(url.origin + url.pathname).toBe(`https://garden.example.test${CIRCLE_FEED_PATH}`);
    anaKey = url.searchParams.get("key") ?? "";
    // Only its hash is kept.
    const [row] = await q("SELECT `key_hash` FROM `live_session_feed_keys`");
    expect(row.key_hash).toHaveLength(64);
    expect(row.key_hash).not.toBe(anaKey);

    const out = await feed(anaKey);
    expect(out.status).toBe(200);
    expect(out.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(out.body).toContain("X-WR-CALNAME:Village circle meetings");
    expect(out.body).toContain("SUMMARY:Garden circle meeting");
    expect(out.body).toMatch(/RRULE:FREQ=WEEKLY;[^\r\n]*INTERVAL=2/);
    expect(out.body).not.toContain("Kitchen circle meeting");
    expect(out.body).toContain(`UID:${calendarIdFor({ sourceModule: MIRROR_SOURCE, sourceId: "c-garden" })}@village.example.test`);
    expect((await following("m-ana")).address).toMatchObject({ madeAt: expect.any(String), lastReadAt: expect.any(String) });
  });

  it("follows every circle, and a circle's new meetings reach the same address", async () => {
    expect((await follow("m-ana", { all: true })).body).toMatchObject({ all: true });
    expect((await feed(anaKey)).body).toContain("SUMMARY:Kitchen circle meeting");
    // A skipped garden meeting leaves the feed with no new address.
    const next = (await as("m-ana", "GET /api/sessions")).body.comingUp.rows.find((r: any) => r.circleId === "c-garden").next.key;
    expect((await as("m-founder", "POST /api/sessions/circles/:circleId/rhythm/skip", { params: { circleId: "c-garden" }, body: { key: next } })).status).toBe(200);
    expect((await feed(anaKey)).body).toMatch(new RegExp(`EXDATE[^\\r\\n]*${next.replace(/-/g, "")}T180000`));
  });

  it("answers a bare 404 to a wrong key, a stopped key, a guest, and a module in preview or off", async () => {
    expect((await feed("f".repeat(64))).status).toBe(404);
    expect((await feed("not-a-key")).status).toBe(404);
    // A guest's address answers nothing: the room is for members.
    expect((await as("m-gus", "POST /api/sessions/circles/following/key")).status).toBe(200);
    const gusKey = new URL((await as("m-gus", "POST /api/sessions/circles/following/key")).body.url).searchParams.get("key");
    expect((await feed(gusKey)).status).toBe(404);
    for (const value of ["preview", "off"]) {
      await lifecycle(value);
      expect((await feed(anaKey)).status, value).toBe(404);
    }
    // An admin trying the module in preview is told the address shows nothing yet.
    await lifecycle("preview");
    expect((await following("m-founder")).serving).toBe(false);
    await lifecycle("members");
    expect((await feed(anaKey)).status).toBe(200);
    // A new address retires the old one.
    const fresh = new URL((await as("m-ana", "POST /api/sessions/circles/following/key")).body.url).searchParams.get("key");
    expect((await feed(anaKey)).status).toBe(404);
    expect((await feed(fresh)).status).toBe(200);
    anaKey = fresh ?? "";
    expect((await as("m-ana", "DELETE /api/sessions/circles/following/key")).status).toBe(200);
    expect((await feed(anaKey)).status).toBe(404);
    expect((await following("m-ana")).address).toBeNull();
  });

  it("takes circle meetings off the village calendar while the module is not open to members, and puts them back", async () => {
    const { mirrorRhythms } = await import("./lib/sessionCalendar");
    const deps = { circles: () => CIRCLES.map((c) => ({ id: c.id, name: c.name })) };
    await lifecycle("preview");
    expect(await mirrorRhythms(pool, deps)).toEqual({ written: 0, retired: 2 });
    expect((await mirrored()).every((r: any) => r.removed_at != null)).toBe(true);
    await lifecycle("members");
    expect(await mirrorRhythms(pool, deps)).toEqual({ written: 2, retired: 0 });
    // A stopped rhythm leaves the calendar.
    expect((await setRhythm("m-founder", "c-kitchen", { kind: "none" })).status).toBe(200);
    expect((await mirrored()).map((r: any) => [r.source_id, r.removed_at == null])).toEqual([
      ["c-garden", true],
      ["c-kitchen", false],
    ]);
  });

  it("exports what a member follows and their address without its key, and forgets both when they leave", async () => {
    await follow("m-ben", { circleIds: ["c-garden"] });
    await as("m-ben", "POST /api/sessions/circles/following/key");
    const out = await exportMemberSessions(pool, "m-ben");
    expect(out.circlesFollowed).toEqual([{ circleId: "c-garden", since: expect.any(String) }]);
    expect(out.calendarAddress).toEqual([{ madeAt: expect.any(String), lastReadAt: null }]);
    expect(JSON.stringify(out)).not.toMatch(/[0-9a-f]{64}/);
    const [{ no }] = await q("SELECT `no` FROM `live_session_members` WHERE `user_id` = 'm-ben'");
    await forgetMemberSessions(pool, "m-ben", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT * FROM `live_session_follows` WHERE `member_no` = ?", [no])).toEqual([]);
    expect(await q("SELECT * FROM `live_session_feed_keys` WHERE `member_no` = ?", [no])).toEqual([]);
  });
});
