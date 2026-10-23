/**
 * A circle's decisions and their review dates, against a real schema: who
 * reads the log and sets a review date, what the log says to each, and the
 * job that makes a review that has come one of the circle's agenda items,
 * once per review.
 *
 * The room's, the agenda library's and the decisions' route modules are
 * registered on a fake Express with the scratch schema's pool behind them.
 * THE CASES RUN IN ORDER: the garden decides once in week 1, then sets a
 * review date, and the review comes back. In week 2 Ben decides, Ana leaves
 * the village, and last the log grows past two hundred decisions.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { forgetMemberSessions } from "./lib/liveSessions";
import { runDecisionReviews } from "./lib/sessionDecisions";
import { exportMemberSessions, register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { liveCircles } from "./routes/sessionRhythm";
import { register as registerDecisions } from "./routes/sessionDecisions";
import { DECISION_REFUSALS, addDaysTo, addMonthsTo, type CircleDecisionLog } from "../shared/sessionDecisions";

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
  "m-ana": { id: "m-ana", name: "Ana Reyes", email: "ana@village.example.test", membershipGranted: true },
  "m-ben": { id: "m-ben", name: "Ben Ortiz", email: "ben@village.example.test", membershipGranted: true },
  "m-cai": { id: "m-cai", name: "Cai Moreno", email: "cai@village.example.test", membershipGranted: true },
  "m-eve": { id: "m-eve", name: "Eve Strand", email: "eve@village.example.test", membershipGranted: true },
  "m-founder": { id: "m-founder", name: "Founding Admin", role: "admin", email: "founder@village.example.test" },
};

const configured = testDbConfigured();

describe.skipIf(!configured)("a circle's decisions and their review dates, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handlers: Map<string, Handler>;
  let whoami: string | null = null;
  const CIRCLES = [
    { id: "c-garden", name: "Garden circle", status: "active" },
    { id: "c-kitchen", name: "Kitchen circle", status: "active" },
  ];
  let week1 = 0;
  let tanks = 0;
  let week2 = 0;
  let compost = 0;
  const today = new Date().toISOString().slice(0, 10);

  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const as = async (who: string | null, key: string, req: any = {}) => {
    whoami = who;
    const handler = handlers.get(key);
    if (!handler) throw new Error(`no handler registered for ${key}`);
    const { res, out } = makeRes();
    await handler({ params: {}, body: {}, query: {}, headers: {}, ...req }, res);
    return out;
  };
  const log = async (who: string, circleId = "c-garden") => as(who, "GET /api/sessions/circles/:circleId/decisions", { params: { circleId } });
  const review = async (who: string, entryId: number, reviewOn: unknown, circleId = "c-garden") =>
    as(who, "PUT /api/sessions/circles/:circleId/decisions/:entryId/review", { params: { circleId, entryId: String(entryId) }, body: { reviewOn } });
  const jobDeps = (over: Record<string, unknown> = {}) => ({
    circles: () => liveCircles({ all: () => CIRCLES } as any),
    lapseContext: () => ({ currentSeasonId: null, cadence: "never" }) as any,
    getPool: () => pool as any,
    lifecycle: () => "members",
    ...over,
  });
  /** A copy of a closed session in another circle, closed some seconds after it. */
  const copySession = async (from: number, circleId: string, laterSec: number): Promise<number> => {
    const cols = (await q("SHOW COLUMNS FROM `live_sessions`")).map((c: any) => String(c.Field)).filter((f: string) => f !== "id");
    const params: unknown[] = [];
    const picks = cols.map((f: string) => {
      if (f === "circle_id") return params.push(circleId), "?";
      if (f === "closed_at") return params.push(laterSec), "`closed_at` + INTERVAL ? SECOND";
      return `\`${f}\``;
    });
    const out: any = await q(`INSERT INTO \`live_sessions\` (${cols.map((f: string) => `\`${f}\``).join(", ")}) SELECT ${picks.join(", ")} FROM \`live_sessions\` WHERE \`id\` = ?`, [...params, from]);
    return Number(out.insertId);
  };
  /** Some copies of a decided decision, in another session. */
  const copyDecisions = async (from: number, sessionId: number, count: number): Promise<void> => {
    const cols = (await q("SHOW COLUMNS FROM `live_session_entries`")).map((c: any) => String(c.Field)).filter((f: string) => f !== "id");
    const picks = cols.map((f: string) => (f === "session_id" ? "?" : `e.\`${f}\``));
    const numbers = Array.from({ length: count }, (_, i) => `SELECT ${i} AS n`).join(" UNION ALL ");
    await q(
      `INSERT INTO \`live_session_entries\` (${cols.map((f: string) => `\`${f}\``).join(", ")}) SELECT ${picks.join(", ")} FROM \`live_session_entries\` e JOIN (${numbers}) k WHERE e.\`id\` = ?`,
      [sessionId, from],
    );
  };
  const reviewItems = async () =>
    q(
      "SELECT l.`circle_id`, l.`title`, l.`brought_by_no`, l.`status`, s.`ref`, s.`label` FROM `live_session_library` l " +
        "JOIN `live_session_library_sources` s ON s.`library_id` = l.`id` WHERE s.`kind` = 'decision_review' ORDER BY l.`id`",
    );

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
      notify: async () => ({ fresh: true }),
      notifyAdmins: async () => undefined,
      circlesRepo: { all: () => CIRCLES },
      lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
    } as any;
    registerRoom(c.app, deps);
    registerLibrary(c.app, deps);
    registerDecisions(c.app, deps);
    handlers = c.handlers;
    // Cai sits in the garden's water seat and was never in a session.
    await q("INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `active`, `is_example`) VALUES ('seat-water', 'c-garden', 'Water keeper', 1, 0)");
    await q("INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES ('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', NULL)");
    // Week 1: Ana and Ben decide to fill the tanks on Mondays.
    week1 = Number((await as("m-ana", "POST /api/sessions", { body: { title: "Garden, week 1", circleId: "c-garden", durationMin: 60 } })).body.id);
    expect((await as("m-ben", "POST /api/sessions/:id/join", { params: { id: String(week1) } })).status).toBe(200);
    tanks = Number((await as("m-ana", "POST /api/sessions/:id/entries", { params: { id: String(week1) }, body: { kind: "decision", text: "We fill the tanks on Mondays.", itemId: null } })).body.id);
    // The consent round itself is the room's own suite's; here the decision is simply decided.
    await q("UPDATE `live_session_entries` SET `status` = 'done' WHERE `id` = ?", [tanks]);
    expect((await as("m-ana", "POST /api/sessions/:id/close", { params: { id: String(week1) } })).status).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("shows the circle's members and admins its decisions, and the session's title only to somebody who was in it", async () => {
    const ana = (await log("m-ana")).body as CircleDecisionLog;
    expect(ana.decisions).toEqual([expect.objectContaining({ entryId: tanks, text: "We fill the tanks on Mondays.", session: { id: week1, title: "Garden, week 1" }, review: null })]);
    expect(ana.today).toBe(today);
    // Cai sits in a garden seat: the circle's member, never in that session.
    expect(((await log("m-cai")).body as CircleDecisionLog).decisions[0].session).toBeNull();
    expect(((await log("m-founder")).body as CircleDecisionLog).decisions[0].session).toMatchObject({ id: week1 });
    expect(await log("m-eve")).toMatchObject({ status: 403, body: { error: DECISION_REFUSALS.notYours } });
    expect((await log("m-ana", "c-moon")).status).toBe(404);
    // The kitchen decided nothing.
    expect(((await log("m-founder", "c-kitchen")).body as CircleDecisionLog).decisions).toEqual([]);
  });

  it("lets the circle's members and admins set a review date, change it and take it off, and nobody else", async () => {
    const later = addMonthsTo(today, 6);
    expect(await review("m-eve", tanks, later)).toMatchObject({ status: 403 });
    expect(await review("m-cai", tanks, today)).toMatchObject({ status: 400, body: { error: DECISION_REFUSALS.pastDate } });
    expect(await review("m-cai", tanks, later, "c-kitchen")).toMatchObject({ status: 403 });
    expect(await review("m-founder", tanks, later, "c-kitchen")).toMatchObject({ status: 404, body: { error: DECISION_REFUSALS.notFound } });
    const set = await review("m-cai", tanks, later);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.decision.review).toEqual({ on: later, due: false, brought: false });
    expect((await review("m-ana", tanks, null)).body.decision.review).toBeNull();
    expect((await review("m-ana", tanks, addMonthsTo(today, 3))).status).toBe(200);
  });

  it("makes a review that has come one of the circle's agenda items, once", async () => {
    expect(await runDecisionReviews(jobDeps())).toBe("0 decision review(s) on the agenda items");
    // The date comes. It was set long ago, and the job never says otherwise: the export reports when it was set.
    await q("UPDATE `live_session_decision_reviews` SET `review_on` = ?, `updated_at` = '2026-01-02 03:04:05' WHERE `entry_id` = ?", [today, tanks]);
    expect(await runDecisionReviews(jobDeps({ lifecycle: () => "preview" }))).toBe("the sessions module is not open to members");
    expect(await runDecisionReviews(jobDeps())).toBe("1 decision review(s) on the agenda items");
    expect(await reviewItems()).toEqual([
      { circle_id: "c-garden", title: "Review: We fill the tanks on Mondays.", brought_by_no: 0, status: "waiting", ref: `${tanks}:${today}`, label: "Garden circle" },
    ]);
    expect(((await log("m-ana")).body as CircleDecisionLog).decisions[0].review).toEqual({ on: today, due: true, brought: true });
    expect(await q("SELECT DATE_FORMAT(`updated_at`, '%Y-%m-%d %H:%i:%s') AS `at` FROM `live_session_decision_reviews` WHERE `entry_id` = ?", [tanks])).toEqual([{ at: "2026-01-02 03:04:05" }]);
    // Asked again, nothing more.
    expect(await runDecisionReviews(jobDeps())).toBe("0 decision review(s) on the agenda items");
    expect(await reviewItems()).toHaveLength(1);
    // The circle's members find it with the rest of its agenda items, saying where it came from.
    const list = await as("m-cai", "GET /api/sessions");
    expect(list.body.library.items).toContainEqual(
      expect.objectContaining({
        title: "Review: We fill the tanks on Mondays.",
        circleId: "c-garden",
        broughtBy: "the Garden circle",
        source: { kind: "decision_review", label: "Garden circle" },
      }),
    );
  });

  it("starts the next cycle with a new date, and brings that review back as its own item", async () => {
    const next = addMonthsTo(today, 12);
    expect((await review("m-ana", tanks, next)).body.decision.review).toEqual({ on: next, due: false, brought: false });
    await q("UPDATE `live_session_decision_reviews` SET `review_on` = ? WHERE `entry_id` = ?", [today, tanks]);
    // The same date as the first cycle's: still its own item, since the first one was made already.
    expect(await runDecisionReviews(jobDeps())).toBe("0 decision review(s) on the agenda items");
    expect(((await log("m-ana")).body as CircleDecisionLog).decisions[0].review).toMatchObject({ brought: true });
    // A different day is a new item.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await review("m-ana", tanks, tomorrow)).status).toBe(200);
    expect(await runDecisionReviews(jobDeps(), new Date(Date.now() + 86_400_000 + 60_000))).toBe("1 decision review(s) on the agenda items");
    expect((await reviewItems()).map((r: any) => r.ref)).toEqual([`${tanks}:${today}`, `${tanks}:${tomorrow}`]);
  });

  it("exports the review dates a member set; when they leave, a date they set stays the circle's, and a decision they wrote takes its review with it", async () => {
    // Week 2: Ben decides compost goes left, with Ana in the room, and Ana sets when it is reviewed.
    week2 = Number((await as("m-ben", "POST /api/sessions", { body: { title: "Garden, week 2", circleId: "c-garden", durationMin: 60 } })).body.id);
    expect((await as("m-ana", "POST /api/sessions/:id/join", { params: { id: String(week2) } })).status).toBe(200);
    compost = Number((await as("m-ben", "POST /api/sessions/:id/entries", { params: { id: String(week2) }, body: { kind: "decision", text: "Compost goes left.", itemId: null } })).body.id);
    await q("UPDATE `live_session_entries` SET `status` = 'done' WHERE `id` = ?", [compost]);
    expect((await as("m-ben", "POST /api/sessions/:id/close", { params: { id: String(week2) } })).status).toBe(200);
    expect((await review("m-ana", compost, addMonthsTo(today, 2))).status).toBe(200);
    expect((await exportMemberSessions(pool, "m-ana")).reviewsSet.map((r: any) => r.entryId)).toEqual([tanks, compost]);
    await forgetMemberSessions(pool, "m-ana", async (id) => PEOPLE[id] ?? null);
    // The date Ana set on Ben's decision is the circle's, and stays.
    expect(await q("SELECT `entry_id`, `set_by_no` FROM `live_session_decision_reviews` ORDER BY `entry_id`")).toEqual([{ entry_id: compost, set_by_no: 0 }]);
    // Her own decision went with the rest of her words, and so did its review and every "Review:" item that carried them.
    expect(await reviewItems()).toEqual([]);
    expect(await q("SELECT `id` FROM `live_session_library` WHERE CONCAT(`title`, ' ', COALESCE(`note`, '')) LIKE '%tanks%'")).toEqual([]);
  });

  it("brings a live circle's review when two hundred of a gone circle's wait first, and reads back a decision older than the newest two hundred", async () => {
    // Two hundred decided decisions in a circle that is gone, each with a review that came a month ago...
    const gone = await copySession(week2, "c-gone", 0);
    await copyDecisions(compost, gone, 200);
    await q(
      "INSERT INTO `live_session_decision_reviews` (`entry_id`, `review_on`, `set_by_no`, `library_id`, `created_at`, `updated_at`) " +
        "SELECT `id`, ?, 0, NULL, NOW(), NOW() FROM `live_session_entries` WHERE `session_id` = ?",
      [addDaysTo(today, -30), gone],
    );
    // ...and two hundred more in the garden, decided after compost.
    const newer = await copySession(week2, "c-garden", 60);
    await copyDecisions(compost, newer, 200);
    expect(((await log("m-founder")).body as CircleDecisionLog).decisions.map((d) => d.entryId)).not.toContain(compost);
    // Compost is older than the log shows, and its new date reads back.
    const on = addMonthsTo(today, 4);
    const set = await review("m-founder", compost, on);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.decision).toMatchObject({ entryId: compost, text: "Compost goes left.", session: { id: week2, title: "Garden, week 2" }, review: { on, due: false, brought: false } });
    // Its date comes, and the gone circle's two hundred do not stand in its way.
    await q("UPDATE `live_session_decision_reviews` SET `review_on` = ? WHERE `entry_id` = ?", [today, compost]);
    expect(await runDecisionReviews(jobDeps())).toBe("1 decision review(s) on the agenda items");
    expect(await reviewItems()).toEqual([
      { circle_id: "c-garden", title: "Review: Compost goes left.", brought_by_no: 0, status: "waiting", ref: `${compost}:${today}`, label: "Garden circle" },
    ]);
  });
});
