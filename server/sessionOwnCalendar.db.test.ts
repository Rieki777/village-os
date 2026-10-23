/**
 * A circle's own calendar against a real schema: who may attach one, what the
 * address must be, how its meetings join Coming up, the circle's summary, the
 * day-before notice and a follower's feed, and replacing, detaching, the
 * export and the erasure.
 *
 * The room's, the agenda library's, the rhythm's and the calendar's route
 * modules are registered on a fake Express with the scratch schema's pool
 * behind them, so every case goes through the real doors. Reading the
 * circle's calendar goes through the rhythm module's test seam
 * (`fetchCalendarText`), which hands back a small calendar of its own; the
 * address is a public address literal, so the outbound guard passes it without
 * asking DNS. The village holds a secrets key for the suite, since an
 * address is sealed before it is kept.
 *
 * THE CASES RUN IN ORDER and share one story: the garden attaches the
 * calendar it keeps its planning meetings in, then sets a rhythm too, then
 * changes calendars, then detaches.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { loadModuleSettings } from "./lib/modules";
import { loadSecrets } from "./lib/secrets";
import { forgetMemberSessions } from "./lib/liveSessions";
import { runComingUpNotes } from "./lib/sessionRhythm";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { liveCircles, register as registerRhythm } from "./routes/sessionRhythm";
import { register as registerCalendar } from "./routes/sessionCalendar";
import { CIRCLE_FEED_PATH, OWN_CALENDAR_COPY, OWN_CALENDAR_REFUSALS } from "../shared/sessionCalendar";
import type { ComingUpPayload, ComingUpRow } from "../shared/sessionRhythm";

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
  "m-cai": { id: "m-cai", name: "Cai Moreno", email: "cai@village.example.test", membershipGranted: true },
  "m-eve": { id: "m-eve", name: "Eve Strand", email: "eve@village.example.test", membershipGranted: true },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

const DAY_MS = 86_400_000;
const GARDEN_URL = "https://8.8.8.8/garden-planning.ics";
const OTHER_URL = "https://8.8.4.4/garden-other.ics";

/** RFC 5545 UTC form. */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
/** A small calendar with one meeting, as a circle's own calendar would serve it. */
const calendarWith = (uid: string, title: string, start: Date, minutes: number) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//village test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date("2026-10-01T00:00:00Z"))}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + minutes * 60_000))}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const configured = testDbConfigured();

describe.skipIf(!configured)("a circle's own calendar against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const fetched: string[] = [];
  let serving = "";
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];
  const notices: any[] = [];
  // Three days out at 17:00 UTC, an hour and a half: the garden's planning meeting.
  const day3 = new Date(Date.now() + 3 * DAY_MS);
  const planning = new Date(Date.UTC(day3.getUTCFullYear(), day3.getUTCMonth(), day3.getUTCDate(), 17, 0));

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const comingUp = async (who: string): Promise<ComingUpPayload> => (await as(who, "GET /api/sessions")).body.comingUp;
  const gardenRow = async (who: string): Promise<ComingUpRow | undefined> => (await comingUp(who)).rows.find((r) => r.circleId === "c-garden");
  const attach = async (who: string, circleId: string, url: unknown) => as(who, "PUT /api/sessions/circles/:circleId/calendar", { params: { circleId }, body: { url } });
  const detach = async (who: string, circleId: string) => as(who, "DELETE /api/sessions/circles/:circleId/calendar", { params: { circleId } });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('sessions', 'members')"); // module-review-ok: turns Live Sessions on in the scratch schema this suite provisioned, since the feed measures the module's state
    await loadModuleSettings(pool);
    process.env.VILLAGE_SECRETS_KEY = "d5".repeat(32);
    await loadSecrets(pool);
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
      fetchCalendarText: async (url: string) => {
        fetched.push(url);
        return serving;
      },
    } as any;
    registerRoom(c.app, deps);
    registerLibrary(c.app, deps);
    registerRhythm(c.app, deps);
    registerCalendar(c.app, deps);
    handlers = c.handlers;
    // Cai sits in the garden's water seat: a member of the garden by standing.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL)",
    );
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("lets the circle's members and admins attach its calendar, and nobody else", async () => {
    expect(await attach("m-eve", "c-garden", GARDEN_URL)).toMatchObject({ status: 403, body: { error: OWN_CALENDAR_REFUSALS.notYours } });
    expect((await attach("m-cai", "c-moon", GARDEN_URL)).status).toBe(400);
    expect(await attach("m-cai", "c-garden", "  ")).toMatchObject({ status: 400, body: { error: OWN_CALENDAR_REFUSALS.urlNeeded } });
    // The subscription's own rules for an address hold: https only, and never a private address.
    expect((await attach("m-cai", "c-garden", "http://8.8.8.8/x.ics")).status).toBe(400);
    expect((await attach("m-cai", "c-garden", "https://127.0.0.1/x.ics")).status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("reads the calendar at once, and its next meeting becomes the circle's, with its own title", async () => {
    serving = calendarWith("garden-planning-1@test", "Garden planning", planning, 90);
    const out = await attach("m-cai", "c-garden", GARDEN_URL);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(fetched).toEqual([GARDEN_URL]);
    expect(out.body).toMatchObject({ read: true, ownCalendar: { host: "8.8.8.8", last4: ".ics", status: "ok" } });
    expect(out.body.row).toMatchObject({
      circleId: "c-garden",
      nextFrom: "calendar",
      nextTitle: "Garden planning",
      durationMin: 90,
      rhythmWords: OWN_CALENDAR_COPY.fromOwnCalendar,
      rhythm: { kind: "none" },
      next: { at: planning.toISOString() },
    });
    // The address is kept sealed, and never comes back.
    expect(JSON.stringify(out.body)).not.toContain("garden-planning.ics");
    const [sub] = await q("SELECT `layer`, `url_host`, `url_last4`, `secret_ref` FROM `external_calendars`");
    expect(sub).toMatchObject({ layer: "circle", url_host: "8.8.8.8", url_last4: ".ics" });
  });

  it("shows every member the circle's next meeting, and only its keepers which calendar it comes from", async () => {
    expect((await gardenRow("m-eve"))?.nextTitle).toBe("Garden planning");
    expect((await comingUp("m-eve")).ownCalendars).toEqual({});
    const cai = await comingUp("m-cai");
    expect(cai.ownCalendars["c-garden"]).toMatchObject({ host: "8.8.8.8", last4: ".ics" });
    expect(JSON.stringify(cai)).not.toContain("garden-planning.ics");
    expect((await as("m-eve", "GET /api/sessions/circles/:circleId/summary", { params: { circleId: "c-garden" } })).body.next).toMatchObject({ at: planning.toISOString() });
  });

  it("takes the sooner of the rhythm's meeting and the calendar's", async () => {
    const weekday = new Date(Date.now() + 2 * DAY_MS).getUTCDay();
    expect((await as("m-cai", "PUT /api/sessions/circles/:circleId/rhythm", { params: { circleId: "c-garden" }, body: { kind: "weekly", weekday, everyWeeks: 1, time: "09:00" } })).status).toBe(200);
    const row = (await gardenRow("m-eve"))!;
    expect(row).toMatchObject({ nextFrom: "rhythm", nextTitle: null, rhythmWords: expect.stringMatching(/^Every \w+day at 09:00$/) });
    expect(Date.parse(row.next.at)).toBeLessThan(planning.getTime());
    // The rhythm stopped, the calendar's meeting is the next one again.
    expect((await as("m-cai", "PUT /api/sessions/circles/:circleId/rhythm", { params: { circleId: "c-garden" }, body: { kind: "none" } })).status).toBe(200);
    expect((await gardenRow("m-eve"))?.nextFrom).toBe("calendar");
  });

  it("tells the circle's members the day before a meeting on its own calendar", async () => {
    notices.length = 0;
    const dayBefore = new Date(planning.getTime() - 20 * 3_600_000);
    const out = await runComingUpNotes(
      {
        circles: () => liveCircles({ all: () => CIRCLES } as any),
        lapseContext: () => ({ currentSeasonId: null, cadence: "never" }) as any,
        getPool: () => pool as any,
        notify: async (n: any) => {
          notices.push(n);
          return { fresh: true };
        },
        window: () => ({ start: 0, end: 24 }),
        lifecycle: () => "members",
      },
      dayBefore,
    );
    expect(out).toMatch(/^1 coming-up notice/);
    const key = `${planning.toISOString().slice(0, 10)}T17:00`;
    expect(notices).toEqual([expect.objectContaining({ userId: "m-cai", title: "The Garden circle meets tomorrow at 17:00", dedupeKey: `session-coming:c-garden:${key}:m-cai` })]);
  });

  it("carries the circle's own meetings to everyone who follows the circle", async () => {
    expect((await as("m-ana", "PUT /api/sessions/circles/following", { body: { circleIds: ["c-garden"] } })).status).toBe(200);
    const address = new URL((await as("m-ana", "POST /api/sessions/circles/following/key")).body.url);
    const feed = await as(null, `GET ${CIRCLE_FEED_PATH}`, { query: { key: address.searchParams.get("key") } });
    expect(feed.status).toBe(200);
    expect(feed.body).toContain("SUMMARY:Garden planning");
  });

  it("attaches a different calendar in its place, and the old one goes whole", async () => {
    serving = calendarWith("garden-other-1@test", "Garden work day", new Date(planning.getTime() + DAY_MS), 60);
    const out = await attach("m-founder", "c-garden", OTHER_URL);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.row).toMatchObject({ nextTitle: "Garden work day" });
    const subs = await q("SELECT `url_host` FROM `external_calendars`");
    expect(subs).toEqual([{ url_host: "8.8.4.4" }]);
    // The old calendar's imported meeting has left the village calendar.
    const live = await q("SELECT `title` FROM `events` WHERE `kind` = 'external' AND `removed_at` IS NULL");
    expect(live).toEqual([{ title: "Garden work day" }]);
  });

  it("detaches, and the circle has nothing coming from it any more", async () => {
    expect((await detach("m-eve", "c-garden")).status).toBe(403);
    const out = await detach("m-cai", "c-garden");
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.row).toBeNull();
    expect(await gardenRow("m-cai")).toBeUndefined();
    expect(await q("SELECT * FROM `external_calendars`")).toEqual([]);
    expect(await detach("m-cai", "c-garden")).toMatchObject({ status: 404, body: { error: OWN_CALENDAR_REFUSALS.noneAttached } });
  });

  it("exports the circles whose calendar a member attached, and keeps the calendar when they leave", async () => {
    serving = calendarWith("kitchen-1@test", "Kitchen tasting", planning, 60);
    expect((await attach("m-founder", "c-kitchen", GARDEN_URL)).status).toBe(200);
    expect((await exportMemberSessions(pool, "m-founder")).ownCalendarsAttached).toEqual([{ circleId: "c-kitchen", since: expect.any(String) }]);
    await forgetMemberSessions(pool, "m-founder", async (id) => PEOPLE[id] ?? null);
    expect(await q("SELECT `circle_id`, `set_by_no` FROM `live_session_circle_calendars`")).toEqual([{ circle_id: "c-kitchen", set_by_no: 0 }]);
  });
});
