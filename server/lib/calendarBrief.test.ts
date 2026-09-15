/**
 * The weekly brief (L5b): zero tokens, one row per opted-in member, layers
 * held per recipient, and a second run that sends nothing.
 *
 * THE HARM METRIC, verbatim from the brief: `runWeeklyBrief` on three members
 * leaves `COUNT(*) FROM assistant_usage` and `COUNT(*) FROM rate_hits WHERE
 * bucket LIKE 'assistant-day:%'` unchanged, one row per opted-in member, zero
 * for the opted-out, and a re-run inserts nothing. A timer has no actor and
 * does not borrow one (K2's rule): the digest is a template over readers the
 * village already has, and this suite is what keeps it that way.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { renderWeeklyBrief } from "./assistantTemplates";
import {
  gatherWeeklyBrief,
  setOpportunitiesProvider,
  villageDateKey,
} from "./calendarBrief";
import { runWeeklyBrief, type NotifyDeps } from "./notify";
import { presenceTest } from "./memberPresence";

const TZ = "America/Costa_Rica";

describe("renderWeeklyBrief (pure)", () => {
  it("refuses junk whole, drops junk sections, and keeps the honest quiet line", () => {
    expect(renderWeeklyBrief(null)).toBeNull();
    expect(renderWeeklyBrief([])).toBeNull();
    expect(renderWeeklyBrief({ weekKey: "not a date" })).toBeNull();

    const quiet = renderWeeklyBrief({ weekKey: "2026-08-23", timezone: TZ, projectName: "Alder Creek" });
    expect(quiet).not.toBeNull();
    expect(quiet!.subject).toBe("Your week at Alder Creek");
    expect(quiet!.text).toContain("Nothing is on the calendar for the coming week.");

    // A section whose data is the wrong shape is dropped, never guessed at.
    const mixed = renderWeeklyBrief({
      weekKey: "2026-08-23",
      timezone: TZ,
      projectName: "Alder Creek",
      gatherings: [{ title: "Village supper", startsAt: "2026-08-25T00:30:00Z", allDay: false, place: "The commons", spotsLeft: 2, waitlistCount: null, kind: "gathering" }],
      marks: "not a list",
      openSeats: { count: "many" },
      newQuests: { count: 2, titles: ["Fix the pump", "Paint the gate"] },
      opportunities: ["A ride to town is offered on Tuesday"],
    });
    expect(mixed!.text).toContain("Village supper");
    expect(mixed!.text).toContain("2 seats open");
    expect(mixed!.text).toContain("New quests");
    expect(mixed!.text).toContain("Fix the pump");
    expect(mixed!.text).toContain("Openings for you");
    expect(mixed!.text).not.toContain("sky");
    // The malformed openSeats section must be DROPPED. This heading is the
    // one renderWeeklyBrief prints for a well-formed section (renamed from
    // "Open seats" in the R5 copy pass), so the assertion stays load-bearing.
    expect(mixed!.text).not.toContain("Open roles");
    expect(mixed!.html).toContain("<h3");
  });

  it("says full rooms and their queues out loud, and omits empty sections", () => {
    const r = renderWeeklyBrief({
      weekKey: "2026-08-23",
      timezone: TZ,
      projectName: "Alder Creek",
      gatherings: [{ title: "Moon circle", startsAt: "2026-08-26T01:00:00Z", allDay: false, place: null, spotsLeft: 0, waitlistCount: 3, kind: "gathering" }],
      opportunities: [],
    });
    expect(r!.text).toContain("full, 3 waiting");
    expect(r!.text).not.toContain("Openings for you");
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the weekly brief, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
  });

  afterAll(async () => {
    setOpportunitiesProvider(null);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    setOpportunitiesProvider(null);
    for (const t of ["notifications", "event_rsvps", "event_waitlist", "events", "stays", "users", "quests", "org_role_assignments", "org_roles", "assistant_usage", "rate_hits"]) {
      await pool.query(`DELETE FROM ${t}`);
    }
  });

  const weekKey = villageDateKey(TZ, new Date(Date.now() + 60_000));
  const inWindow = new Date(Date.now() + 2 * 86_400_000);

  const addMember = async (id: string, name: string, prefs: any = null) => {
    await pool.query(
      "INSERT INTO users (id, name, email, password_hash, prefs) VALUES (?,?,?,?,?)",
      [id, name, `${id}@example.test`, "hash", prefs ? JSON.stringify(prefs) : null],
    );
  };

  const deps = (sent: Array<{ to: string[]; subject: string; html: string }>): NotifyDeps => ({
    pool,
    memberById: async (id: string) => {
      const [[u]] = await pool.query<any[]>("SELECT * FROM users WHERE id = ?", [id]);
      return u ? { id: u.id, name: u.name, email: u.email, passwordHash: u.password_hash, prefs: typeof u.prefs === "string" ? JSON.parse(u.prefs) : u.prefs } : null;
    },
    sendEmail: async (opts) => { sent.push(opts); },
    origin: () => "https://example.test",
    projectName: () => "Alder Creek",
    isPresent: presenceTest("calendar-brief-test-secret"),
  });

  const gatherFor = (userId: string, withNames: boolean) => async () => {
    const data = await gatherWeeklyBrief(pool, {
      userId,
      isAdmin: false,
      withNames,
      timezone: TZ,
      weekKey,
      projectName: "Alder Creek",
    });
    const rendered = renderWeeklyBrief(data);
    return rendered ? { ...rendered, data } : null;
  };

  it("three members: zero assistant spend, one row per opted-in member, a re-run sends nothing", async () => {
    await addMember("m-in-1", "First In");
    await addMember("m-in-2", "Second In");
    await addMember("m-out", "Opted Out", { notify: { weeklyBrief: "off" } });
    await pool.query(
      "INSERT INTO events (id, title, starts_at, status, kind, layer) VALUES ('ev-b','Village supper', ?, 'scheduled', 'gathering', 'village')",
      [inWindow],
    );

    const before = async () => {
      const [[au]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM assistant_usage");
      const [[rh]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket LIKE 'assistant-day:%'");
      return { usage: Number(au.n), buckets: Number(rh.n) };
    };
    const base = await before();

    const sent: any[] = [];
    const enqueued: Array<{ userId: string; data: unknown }> = [];
    const opts = {
      weekKey,
      members: [{ id: "m-in-1" }, { id: "m-in-2" }, { id: "m-out" }],
      gather: async (user: any) => gatherFor(user.id, false)(),
      enqueueAgent: async (userId: string, data: unknown) => {
        enqueued.push({ userId, data });
        // The member has no agent inbox: the honest common case, quiet.
        return { ok: false, reason: "no_inbox" };
      },
    };
    const first = await runWeeklyBrief(deps(sent), opts);
    expect(first).toMatchObject({ eligible: 2, fresh: 2, emailed: 2, agents: 0, optedOut: 1 });

    // THE ZERO-TOKEN PROOF: nothing spent, nothing counted.
    expect(await before()).toEqual(base);

    const [rows] = await pool.query<any[]>(
      "SELECT user_id, type, title, link, emailed_at FROM notifications ORDER BY user_id",
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.user_id)).toEqual(["m-in-1", "m-in-2"]);
    expect(rows.every((r: any) => r.type === "weekly_brief")).toBe(true);
    expect(rows.every((r: any) => r.link === `/events?brief=${weekKey}`)).toBe(true);
    expect(rows.every((r: any) => r.emailed_at !== null)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].subject).toBe("Your week at Alder Creek");
    expect(sent[0].html).toContain("Village supper");
    expect(sent[0].html).toContain("turn the weekly brief off");
    // The agent inbox was OFFERED the digest for both; both said no inbox.
    expect(enqueued.map((e) => e.userId)).toEqual(["m-in-1", "m-in-2"]);

    // A second run in the same week: nothing new anywhere.
    const second = await runWeeklyBrief(deps(sent), opts);
    expect(second).toMatchObject({ fresh: 0, emailed: 0 });
    const [[count]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM notifications");
    expect(Number(count.n)).toBe(2);
    expect(sent).toHaveLength(2);
    expect(await before()).toEqual(base);
  });

  it("emailsOff members still get the in-app row and no email", async () => {
    await addMember("m-quiet", "No Email", { notify: { emailsOff: true } });
    const sent: any[] = [];
    const r = await runWeeklyBrief(deps(sent), {
      weekKey,
      members: [{ id: "m-quiet" }],
      gather: async (user: any) => gatherFor(user.id, false)(),
    });
    expect(r).toMatchObject({ fresh: 1, emailed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("holds the layer line per recipient: another member's private item never enters a brief", async () => {
    await addMember("m-owner", "Owner");
    await addMember("m-other", "Other");
    await pool.query(
      "INSERT INTO events (id, title, starts_at, status, kind, layer, owner_user_id) VALUES " +
        "('ev-priv','Ladder back to the barn', ?, 'scheduled', 'gathering', 'private', 'm-owner')," +
        "('ev-vill','Village supper', ?, 'scheduled', 'gathering', 'village', NULL)," +
        "('ev-adm','Founders audit', ?, 'scheduled', 'gathering', 'admin', NULL)," +
        "('ev-draft','Open day, unapproved', ?, 'draft', 'gathering', 'public', 'm-owner')",
      [inWindow, inWindow, inWindow, inWindow],
    );

    const ownerData = await gatherWeeklyBrief(pool, { userId: "m-owner", isAdmin: false, withNames: false, timezone: TZ, weekKey, projectName: "Alder Creek" });
    const otherData = await gatherWeeklyBrief(pool, { userId: "m-other", isAdmin: false, withNames: false, timezone: TZ, weekKey, projectName: "Alder Creek" });
    const ownerText = renderWeeklyBrief(ownerData)!.text;
    const otherText = renderWeeklyBrief(otherData)!.text;

    expect(ownerText).toContain("Ladder back to the barn");
    expect(otherText).not.toContain("Ladder");
    expect(ownerText).toContain("Village supper");
    expect(otherText).toContain("Village supper");
    // The admin layer reaches no plain member; a public DRAFT reaches nobody
    // until the crew approves it, its own creator's brief included.
    expect(ownerText).not.toContain("Founders audit");
    expect(otherText).not.toContain("Founders audit");
    expect(ownerText).not.toContain("Open day");
    expect(otherText).not.toContain("Open day");
  });

  it("counts stay counts for the lower tier and names for the seeing tier", async () => {
    await addMember("m-see", "Sees People");
    await addMember("m-count", "Counts Only");
    await pool.query("INSERT INTO accommodations (id, name) VALUES ('acc-b','The loft')");
    await pool.query(
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on) VALUES ('st-b','m-see','acc-b','requested', ?)",
      [weekKey],
    );
    const seeing = renderWeeklyBrief(await gatherWeeklyBrief(pool, { userId: "m-see", isAdmin: false, withNames: true, timezone: TZ, weekKey, projectName: "A" }))!;
    const counting = renderWeeklyBrief(await gatherWeeklyBrief(pool, { userId: "m-count", isAdmin: false, withNames: false, timezone: TZ, weekKey, projectName: "A" }))!;
    expect(seeing.text).toContain("Sees People arriving");
    expect(counting.text).toContain("1 arriving");
    expect(counting.text).not.toContain("Sees People");
  });

  it("names new quests only when created_at says they are new, and takes L7's provider when wired", async () => {
    await addMember("m-q", "Quester");
    await pool.query("INSERT INTO quests (id, title, gratitude, status) VALUES ('q-new','Paint the gate','', 'open')");
    // A quest from before the column existed: created_at NULL, never "new".
    await pool.query("INSERT INTO quests (id, title, gratitude, status, created_at) VALUES ('q-old','Dig the swale','', 'open', NULL)");

    setOpportunitiesProvider(async (_pool, userId) => [`A ride to town on Tuesday for ${userId}`]);
    const data = await gatherWeeklyBrief(pool, { userId: "m-q", isAdmin: false, withNames: false, timezone: TZ, weekKey, projectName: "A" });
    expect(data.newQuests).toEqual({ count: 1, titles: ["Paint the gate"] });
    expect(data.opportunities).toEqual(["A ride to town on Tuesday for m-q"]);
    const text = renderWeeklyBrief(data)!.text;
    expect(text).toContain("Paint the gate");
    expect(text).not.toContain("Dig the swale");
    expect(text).toContain("A ride to town on Tuesday");

    // A provider that throws leaves the section empty, never broken.
    setOpportunitiesProvider(async () => { throw new Error("L7 fell over"); });
    const data2 = await gatherWeeklyBrief(pool, { userId: "m-q", isAdmin: false, withNames: false, timezone: TZ, weekKey, projectName: "A" });
    expect(data2.opportunities).toEqual([]);
  });
});
