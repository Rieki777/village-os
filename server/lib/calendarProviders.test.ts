/**
 * The providers (0085): the sky as rows, the mirror of facts saved elsewhere,
 * and the quests repo writing its own dates on save.
 *
 * Against a real scratch schema, because idempotency is a unique-key
 * behaviour and the mirror is SQL against seven tables. Skips loudly without
 * TEST_DATABASE_URL.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ensureSky, mirrorCalendarSources, questCalendarInput } from "./calendarProviders";
import { listCalendarItems } from "./calendar";
import { questsRepo } from "../repos/quests";

const TZ = "America/Costa_Rica";

describe("questCalendarInput", () => {
  it("is null without a date, a window with one, a deadline with only that", () => {
    expect(questCalendarInput({ id: "q", title: "Plant", status: "open" })).toBeNull();
    const w = questCalendarInput({ id: "q", title: "Plant", status: "open", startsAt: "2026-09-05T14:00:00Z", endsAt: "2026-09-05T20:00:00Z" })!;
    expect(w.kind).toBe("quest-window");
    expect(w.sourceId).toBe("quest:q");
    expect(w.link).toBe("/quests/q");
    expect(new Date(w.startsAt).toISOString()).toBe("2026-09-05T14:00:00.000Z");
    expect(new Date(w.endsAt as string).toISOString()).toBe("2026-09-05T20:00:00.000Z");
    const d = questCalendarInput({ id: "q", title: "Report", status: "open", dueAt: "2026-09-30T00:00:00Z" })!;
    expect(new Date(d.startsAt).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(d.endsAt).toBeNull();
    // A closed quest cancels its mark rather than deleting it.
    expect(questCalendarInput({ id: "q", title: "Done", status: "closed", dueAt: "2026-09-30T00:00:00Z" })!.status).toBe("cancelled");
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("providers against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    for (const t of ["event_rsvps", "events", "quests", "gratitude_cycles", "org_role_assignments", "org_roles", "library_loans", "library_items", "exits", "milestones", "health_snapshots"]) {
      await pool.query(`DELETE FROM ${t}`);
    }
  });

  const admin = { userId: "a1", isAdmin: true };
  const count = async (sourceModule: string) => {
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n FROM events WHERE source_module = ? AND removed_at IS NULL", [sourceModule]);
    return Number(rows[0].n);
  };

  it("writes the sky once per year, idempotently, and retires what the village turns off", async () => {
    const opts = { anchor: "december_solstice" as const, hemisphere: "north" as const, crossQuarters: true, years: [2026] };
    const first = await ensureSky(pool, opts);
    // 12 new moons + 13 full moons + 4 quarter days + 4 cross-quarters + 1 year anchor.
    expect(first).toEqual({ written: 34, retired: 0 });
    expect(await count("sky")).toBe(34);
    const second = await ensureSky(pool, opts);
    expect(second).toEqual({ written: 34, retired: 0 });
    expect(await count("sky")).toBe(34);

    const off = await ensureSky(pool, { ...opts, crossQuarters: false });
    expect(off).toEqual({ written: 30, retired: 4 });
    expect(await count("sky")).toBe(30);

    // The year anchor names the moon count of the year it opens: 2026's
    // December solstice opens a 12-moon year, and its first new moon is
    // 2027-01-07 (the memo's solstice-year 2026->2027: 12).
    const items = await listCalendarItems(pool, { from: new Date("2026-12-01T00:00:00Z"), to: new Date("2027-02-01T00:00:00Z"), timezone: TZ, viewer: { userId: null, isAdmin: false }, kinds: ["sky"] });
    const anchor = items.find((i) => i.sourceId?.startsWith("sky:year-anchor:"))!;
    // The title names the YEAR and no longer numbers its first moon: the only
    // moon number a member reads now is the village's own count.
    expect(anchor.title).toBe("The village year begins: 12 moons");
    expect(anchor.startsAt.slice(0, 10)).toBe("2027-01-07");
    // Anyone may see the sky.
    expect(items.every((i) => i.layer === "village")).toBe(true);
    // The solstice carries the hemisphere's note.
    const dec = items.find((i) => i.title === "December solstice")!;
    expect(dec.description).toBe("The shortest day of the year.");
  });

  it("mirrors cycles, seasons, seat terms, loans, exits, milestones and snapshots with the source named", async () => {
    await pool.query("INSERT INTO gratitude_cycles (id, cycle_number, starts_at, ends_at, status, closed_at) VALUES ('lunar-000327', 327, '2026-06-15 06:17:00', '2026-07-14 19:01:00', 'closed', '2026-07-15 00:00:00')");
    await pool.query("INSERT INTO org_roles (id, name) VALUES ('r1', 'Land steward')");
    await pool.query("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at) VALUES ('as1', 'r1', 'member', 'u1', 'u1', '2026-12-21 00:00:00')");
    await pool.query("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, term_ends_at, ended_at) VALUES ('as2', 'r1', 'member', 'u2', 'u2', '2026-10-01 00:00:00', '2026-08-01 00:00:00')");
    await pool.query("INSERT INTO library_items (id, name) VALUES ('it1', 'Ladder')");
    await pool.query("INSERT INTO library_loans (id, item_id, user_id, status, due_on) VALUES ('ln1', 'it1', 'u1', 'active', '2026-09-10')");
    await pool.query("INSERT INTO library_loans (id, item_id, user_id, status, due_on) VALUES ('ln2', 'it1', 'u2', 'closed', '2026-09-11')");
    await pool.query("INSERT INTO exits (id, user_id, opened_by, notice_ends_at, status) VALUES ('ex1', 'u3', 'a1', '2026-10-15 00:00:00', 'open')");
    await pool.query("INSERT INTO milestones (id, title, completed_date) VALUES ('m1', 'Roof on the barn', '2026-08-01')");
    await pool.query("INSERT INTO milestones (id, title, completed_date) VALUES ('m2', 'Undated', 'someday')");
    await pool.query("INSERT INTO health_snapshots (id, cycle_number, metric_key, value, created_at) VALUES ('hs1', 327, 'members', 12, '2026-07-15 01:00:00')");
    await pool.query("INSERT INTO quests (id, title, gratitude, status, due_at) VALUES ('q1', 'Write the report', '', 'open', '2026-09-30 00:00:00')");

    const now = new Date("2026-08-16T12:00:00Z"); // cycle 329
    const ctx = {
      timezone: TZ,
      seasons: [{ id: "s1", name: "Season of Rooting", startsOn: "2026-09-22", endsOn: "2026-12-21" }],
      moduleOn: (id: string) => id !== "health", // health off: nothing mirrored from it
      now,
    };
    const r = await mirrorCalendarSources(pool, ctx);
    expect(r.written).toMatchObject({ gratitude: 6, seasons: 1, org: 1, library: 1, exits: 1, milestones: 1, quests: 1 });
    expect(r.written.health).toBeUndefined();

    const all = await listCalendarItems(pool, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2027-06-01T00:00:00Z"), timezone: TZ, viewer: admin, includeRemoved: false, now });
    const by = (m: string) => all.filter((i) => i.sourceModule === m);
    // Cycles: the stored 327 as saved, then 329 and 330 from the clock.
    expect(by("gratitude").map((i) => i.title).sort()).toEqual(["Cycle 327 closed", "Cycle 327 opens", "Cycle 329 closes", "Cycle 329 opens", "Cycle 330 closes", "Cycle 330 opens"]);
    expect(by("gratitude").find((i) => i.title === "Cycle 327 opens")!.startsAt).toBe("2026-06-15T06:17:00.000Z");
    // Cycle 330 opens at the TRUE new moon: the switch cycle.
    expect(by("gratitude").find((i) => i.title === "Cycle 330 opens")!.startsAt.slice(0, 16)).toBe("2026-09-11T03:27");
    // The season is one all-day row at village midnight (UTC-6).
    const season = by("seasons")[0];
    expect(season.kind).toBe("season");
    expect(season.allDay).toBe(true);
    expect(season.startsAt).toBe("2026-09-22T06:00:00.000Z");
    expect(season.endsAt).toBe("2026-12-21T06:00:00.000Z");
    // The live seating only; the ended one is not on the calendar.
    expect(by("org").map((i) => i.title)).toEqual(["Land steward: term ends"]);
    // The admin does not own u1's loan, so it is not in this list.
    expect(by("library")).toEqual([]);
    const mine = await listCalendarItems(pool, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z"), timezone: TZ, viewer: { userId: "u1", isAdmin: false }, now });
    expect(mine.find((i) => i.kind === "loan-due")!.title).toBe("Ladder due back");
    // The exit notice reaches the admins and the leaver.
    expect(by("exits").map((i) => i.title)).toEqual(["Notice period ends"]);
    const leaver = await listCalendarItems(pool, { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z"), timezone: TZ, viewer: { userId: "u3", isAdmin: false }, now });
    expect(leaver.map((i) => i.kind)).toContain("notice-end");
    // Milestones: only the dated one; the quest deadline is there.
    expect(by("milestones").map((i) => i.title)).toEqual(["Roof on the barn"]);
    expect(by("quests").map((i) => i.title)).toEqual(["Write the report"]);
    expect(by("health")).toEqual([]);

    // Second pass: nothing new, nothing retired. Idempotent.
    const again = await mirrorCalendarSources(pool, ctx);
    expect(Object.values(again.retired).every((n) => n === 0)).toBe(true);
    // Retire what is gone: the loan settles, the season is deleted.
    await pool.query("UPDATE library_loans SET status = 'closed' WHERE id = 'ln1'");
    const third = await mirrorCalendarSources(pool, { ...ctx, seasons: [] });
    expect(third.retired.library).toBe(1);
    expect(third.retired.seasons).toBe(1);
  });

  it("writes a quest's dates on the quests repo's own save path", async () => {
    const repo = questsRepo(pool);
    await repo.add({ id: "q-plant", title: "Planting day", gratitude: "10", status: "open", tags: [], order: 1, startsAt: "2026-09-05T14:00:00Z", endsAt: "2026-09-05T20:00:00Z" });
    expect(await count("quests")).toBe(1);
    const viewer = { userId: null, isAdmin: false };
    const win = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z"), timezone: TZ, viewer };
    let items = await listCalendarItems(pool, win);
    expect(items.map((i) => [i.kind, i.title, i.link])).toEqual([["quest-window", "Planting day", "/quests/q-plant"]]);

    // Moving the date moves the row; the round trip keeps the ISO strings.
    const back = await repo.byId("q-plant");
    expect(back?.startsAt).toBe("2026-09-05T14:00:00.000Z");
    await repo.update("q-plant", (q) => { q.startsAt = "2026-09-12T14:00:00Z"; q.endsAt = null; });
    items = await listCalendarItems(pool, win);
    expect(items[0].startsAt).toBe("2026-09-12T14:00:00.000Z");
    expect(await count("quests")).toBe(1);

    // Clearing every date retires the row (marked, kept).
    await repo.update("q-plant", (q) => { q.startsAt = null; q.dueAt = null; });
    expect(await listCalendarItems(pool, win)).toEqual([]);
    const [rows] = await pool.query<any[]>("SELECT removed_at FROM events WHERE source_module = 'quests'");
    expect(rows).toHaveLength(1);
    expect(rows[0].removed_at).not.toBeNull();
  });
});
