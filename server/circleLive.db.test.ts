/**
 * THE CIRCLE CARD'S LIVE PARTS ON A REAL SCHEMA (circle cards PR 3).
 *
 * What is pinned:
 *
 *   - three signs, counted by the catalog's own counters on this circle's rows
 *     only: times it met this moon (two or more people), decisions written in
 *     its own meetings (another circle's are left out), and its roles with a
 *     full card and a term; each with its trend against the moon before;
 *   - the last real meeting, by Live Sessions' own rule, and the room's
 *     practices, only while Live Sessions is on for the reader;
 *   - open tensions on the circle's roles, counted, never their words;
 *   - the review date is the current season's last day, for every reader;
 *   - below the member tier none of the live parts is read at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/circleCard";
import { LUNAR_CLOCK } from "../shared/cycleClock";
import { cycleWindows } from "../shared/roleSigns";
import type { CircleCard, CircleSection } from "../shared/circleCard";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const configured = testDbConfigured();
if (!configured) console.warn("[circleLive.db] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

const NOW = new Date("2026-10-22T18:00:00Z");
const CIRCLES = [
  { id: "c-garden", name: "Garden circle", purpose: "Grow food together.", status: "active", parentCircleId: null },
  { id: "c-other", name: "Other circle", purpose: null, status: "active", parentCircleId: null },
];

describe.skipIf(!configured)("the circle card's live parts, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let handler: Handler;
  let admin = true;
  let sessions: "members" | "off" = "members";
  /** The card route's `viewer`, from the last `read()`. */
  let viewer: { signedIn: boolean; mayPropose: boolean; sessionsOn: boolean };
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  async function read(): Promise<CircleCard> {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = {
      status(code: number) {
        out.status = code;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
    };
    await handler({ params: { id: "c-garden" }, headers: {} }, res);
    expect(out.status).toBe(200);
    viewer = out.body.viewer;
    return out.body.card;
  }
  // Loosely typed on purpose: each case reads the one kind its key draws as.
  const section = (c: CircleCard, key: string): any => c.sections.find((s) => s.key === key)!;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    const handlers = new Map<string, Handler>();
    const app: any = { get: (p: string, h: Handler) => handlers.set(`GET ${p}`, h), post: () => undefined };
    register(app, {
      authedUser: async () => (admin ? { id: "m-ana", name: "Ana Reyes" } : null),
      isAdmin: async () => admin,
      capabilityCtx: async () => ({ stageIndex: 0, stageIndexOf: () => 0, roleCapabilities: [], isAdmin: admin }) as any,
      getPool: () => pool as any,
      overLimit: async () => false,
      circles: () => CIRCLES,
      seasonState: () => ({ timezone: "UTC", current: { endsOn: "2026-12-21" } }),
      lapse: () => ({ currentSeasonId: null, cadence: "never" }) as any,
      mapLifecycle: () => "public",
      sessionsLifecycle: () => sessions,
      boolVar: () => true,
      now: () => NOW,
      clock: () => LUNAR_CLOCK,
    });
    handler = handlers.get("GET /api/org/circles/:id/card")!;

    const w = cycleWindows(NOW, LUNAR_CLOCK, "UTC");
    const thisMoon = new Date(w.current.from.getTime() + 60_000);
    const lastMoon = new Date(w.previous.from.getTime() + 60_000);
    const termEnds = new Date(NOW.getTime() + 60 * 86_400_000);

    await q(
      "INSERT INTO `org_roles` (`id`, `circle_id`, `name`, `aim`, `domain`, `accountabilities`, `active`, `is_example`) VALUES " +
        "('seat-water', 'c-garden', 'Water Keeper', 'Clean water.', 'The tanks.', '[\"Testing the spring\"]', 1, 0), " +
        "('seat-bees', 'c-garden', 'Bee Steward', NULL, NULL, NULL, 1, 0)",
    );
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `term_ends_at`) VALUES " +
        "('ora-cai', 'seat-water', 'member', 'm-cai', 'm-cai', ?)",
      [termEnds],
    );
    // This moon: the garden circle met with two people and decided one thing; another circle decided one too.
    // Last moon: a session one person was in, which is not a meeting.
    const session = async (circle: string, at: Date, people: number[]) => {
      const r: any = await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table
        "INSERT INTO `live_sessions` (`circle_id`, `title`, `status`, `facilitator_no`, `created_by_no`, `duration_min`, `state`, `stamp`, `created_at`, `closed_at`) " +
          "VALUES (?, 'Meeting', 'closed', 1, 1, 45, '{}', '', ?, ?)",
        [circle, at, new Date(at.getTime() + 45 * 60_000)],
      );
      const id = Number(r[0].insertId);
      for (const p of people) await q("INSERT INTO `live_session_people` (`session_id`, `member_no`) VALUES (?, ?)", [id, p]);
      return id;
    };
    const met = await session("c-garden", thisMoon, [1, 2]);
    const elsewhere = await session("c-other", thisMoon, [1, 2]);
    await session("c-garden", lastMoon, [1]);
    // A decision counts once the room consents to it (`done`); one still proposed, or set aside, is not one.
    await q(
      "INSERT INTO `live_session_entries` (`session_id`, `kind`, `text`, `status`, `author_no`, `created_at`) VALUES " +
        "(?, 'decision', 'Plant the beans', 'done', 1, ?), (?, 'decision', 'Elsewhere', 'done', 1, ?), " +
        "(?, 'decision', 'Still being proposed', 'open', 1, ?), (?, 'decision', 'Set aside', 'parked', 1, ?)",
      [met, thisMoon, elsewhere, thisMoon, met, thisMoon, met, thisMoon],
    );
    // A rhythm the circle keeps, written the way Live Sessions stores one (0271).
    await q(
      "INSERT INTO `live_session_rhythms` (`circle_id`, `kind`, `recurrence`, `starts_on`, `time_of_day`, `duration_min`) " +
        "VALUES ('c-garden', 'weekly', '{\"freq\":\"weekly\",\"byWeekday\":[4],\"interval\":1}', '2026-10-01', '18:00', 45)",
    );
    await q(
      "INSERT INTO `role_tensions` (`id`, `org_role_id`, `raised_by`, `text`, `status`) VALUES " +
        "('rt-1', 'seat-water', 'm-dee', 'The valve sticks', 'open'), ('rt-2', 'seat-water', 'm-dee', 'Answered one', 'answered')",
    );
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("counts three signs on this circle's rows only, each with its trend", async () => {
    admin = true;
    const card = await read();
    const signs = section(card, "signs") as Extract<CircleSection, { kind: "signs" }>;
    expect(signs.kind).toBe("signs");
    expect(signs.term).toBe("CCOS: Measurable Key Performance Indicators (KPIs)");
    expect(signs.slot.kind === "shown" && signs.slot.value.map((s) => [s.label, s.value, s.trend])).toEqual([
      ["Times the circle met", "1", "Up on last moon"],
      ["Decisions recorded", "1", "Up on last moon"],
      ["Roles with a full card and a term", "1 of 2", "Trend from next moon"],
    ]);
  });

  it("says when the circle last met and how its meetings look after people, while Live Sessions is on", async () => {
    sessions = "members";
    const card = await read();
    const meet = section(card, "meet");
    // Through Live Sessions' own door (circleSummary): the rhythm and the next meeting in its words, then the last real meeting.
    expect(meet.slot.value.lines[0]).toBe("Meeting rhythm: Every Thursday at 18:00");
    expect(meet.slot.value.lines[1]).toMatch(/^Next meeting: /);
    expect(meet.slot.value.lines[2]).toMatch(/^Last met on \d{1,2} \w{3} 2026$/);
    expect(meet.slot.value.lines[3]).toMatch(/waiting for the next meeting$/);
    expect(meet.slot.kind === "shown" && meet.slot.value.links).toEqual([{ label: "Open Live Sessions", href: "/sessions" }]);
    const whole = section(card, "wholeness");
    expect(whole.slot.kind === "shown" && whole.slot.value.lines[0]).toContain("how everyone is arriving");
    expect(viewer.sessionsOn).toBe(true);
    sessions = "off";
    const off = await read();
    expect(section(off, "meet").slot).toEqual({ kind: "unread" });
    expect(section(off, "wholeness").slot).toEqual({ kind: "unread" });
    // The page reads the same answer, and asks Live Sessions nothing.
    expect(viewer.sessionsOn).toBe(false);
    sessions = "members";
  });

  it("counts the open tensions on its roles, never their words", async () => {
    const card = await read();
    const t = section(card, "tensions");
    expect(t.slot.kind === "shown" && t.slot.value.lines[0]).toBe("1 open tension on this circle's roles");
    expect(JSON.stringify(card)).not.toContain("The valve sticks");
  });

  it("is due for review on the season's last day, for every reader, and a visitor reads no live part", async () => {
    admin = false;
    const card = await read();
    expect(section(card, "review").slot).toEqual({
      kind: "shown",
      value: { lines: ["Due for review on 21 Dec 2026, the last day of this season."], links: [] },
    });
    for (const key of ["signs", "meet", "wholeness", "tensions"]) expect(section(card, key).slot).toEqual({ kind: "unread" });
    expect(viewer.sessionsOn).toBe(false);
    admin = true;
  });
});
