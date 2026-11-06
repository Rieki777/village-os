/**
 * The one calendar (0085): the read that everything else calls, and the two
 * write doors a module uses to mirror its dated facts.
 *
 * Pure parts first (occurrence expansion in village time), then the same
 * functions against a real scratch schema, because layer visibility and the
 * per-occurrence RSVP count are SQL and a mocked pool would only prove the
 * mock. Skips loudly without TEST_DATABASE_URL, like every DB suite here.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  calendarIdFor,
  calendarRemove,
  calendarRemoveMissing,
  calendarSourceIds,
  calendarUpsert,
  canViewRow,
  cleanRecurrence,
  expandOccurrences,
  getCalendarItemFor,
  listCalendarItems,
  visibleLayersFor,
  type CalendarRow,
} from "./calendar";
import { listGatherings, rsvp, upcomingByStructure, withdrawRsvp } from "./gatherings";

const TZ = "America/Costa_Rica";

const baseRow = (over: Partial<CalendarRow> = {}): CalendarRow => ({
  id: "ev-1",
  title: "Moon circle",
  description: null,
  startsAt: new Date("2026-08-19T01:00:00Z"), // 19:00 on Tue 18 Aug, Costa Rica (UTC-6)
  endsAt: new Date("2026-08-19T03:00:00Z"),
  locationText: null,
  structureKeys: [],
  visitTypeId: null,
  capacity: null,
  status: "scheduled",
  attendanceMode: "offline",
  onlineUrl: null,
  isExample: false,
  kind: "gathering",
  layer: "village",
  ownerUserId: null,
  allDay: false,
  sourceModule: null,
  sourceId: null,
  link: null,
  colour: null,
  recurrence: null,
  externalSourceId: null,
  externalUid: null,
  removedAt: null,
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  // 0092: a gathering carries a seat fee. Free is what every fixture here
  // is about, and stating it beats letting the type drift optional.
  seatPrice: 0,
  seatToken: null,
  ...over,
});

describe("cleanRecurrence", () => {
  it("accepts the four shapes and refuses junk", () => {
    expect(cleanRecurrence({ freq: "weekly", byWeekday: [2, 4, 2] })).toEqual({ freq: "weekly", byWeekday: [2, 4], interval: 1 });
    expect(cleanRecurrence({ freq: "monthly", byMonthDay: 15, interval: 2 })).toEqual({ freq: "monthly", byMonthDay: 15, interval: 2 });
    expect(cleanRecurrence({ freq: "lunar", on: "full_moon" })).toEqual({ freq: "lunar", on: "full_moon" });
    expect(cleanRecurrence({ freq: "solar", on: "either", until: "2027-01-01T00:00:00Z" })).toEqual({ freq: "solar", on: "either", until: "2027-01-01T00:00:00.000Z" });
    expect(cleanRecurrence({ freq: "weekly", byWeekday: [] })).toBeNull();
    expect(cleanRecurrence({ freq: "daily" })).toBeNull();
    expect(cleanRecurrence("weekly")).toBeNull();
    expect(cleanRecurrence(null)).toBeNull();
    // Stored as text on some drivers.
    expect(cleanRecurrence('{"freq":"lunar","on":"new_moon"}')).toEqual({ freq: "lunar", on: "new_moon" });
  });

  it("keeps exceptions and overrides keyed by village date", () => {
    const r = cleanRecurrence({
      freq: "weekly", byWeekday: [2],
      exceptions: ["2026-08-25", "nope"],
      overrides: { "2026-09-01": { cancelled: true }, "2026-09-08": { title: "Moved circle", startsAt: "2026-09-09T02:00:00Z" }, bad: {} },
    })!;
    expect((r as any).exceptions).toEqual(["2026-08-25"]);
    expect(Object.keys((r as any).overrides)).toEqual(["2026-09-01", "2026-09-08"]);
  });
});

describe("expandOccurrences in village time", () => {
  it("returns a one-off once, only when it overlaps the window", () => {
    const row = baseRow();
    expect(expandOccurrences(row, new Date("2026-08-18T00:00:00Z"), new Date("2026-08-20T00:00:00Z"), TZ)).toHaveLength(1);
    expect(expandOccurrences(row, new Date("2026-08-20T00:00:00Z"), new Date("2026-08-30T00:00:00Z"), TZ)).toHaveLength(0);
    // The key of a one-off is the empty string: one gathering, one answer.
    expect(expandOccurrences(row, new Date("2026-08-18T00:00:00Z"), new Date("2026-08-20T00:00:00Z"), TZ)[0].occurrenceKey).toBe("");
  });

  it("repeats weekly on the village weekday at the village wall-clock time", () => {
    const row = baseRow({ recurrence: { freq: "weekly", byWeekday: [2] } }); // Tuesdays
    // The window ends at 00:00Z on 1 Oct, which is 18:00 on 30 Sep in the
    // village: an evening that starts at 19:00 village time on 30 Sep would
    // begin after the window and stay out, and 29 Sep is in.
    const occ = expandOccurrences(row, new Date("2026-08-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"), TZ);
    // Tue 18 Aug (the base), 25 Aug, 1, 8, 15, 22, 29 Sep.
    expect(occ.map((o) => o.occurrenceKey)).toEqual([
      "2026-08-18", "2026-08-25", "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29",
    ]);
    // Every one at 19:00 village time, i.e. 01:00Z the next UTC day, and two hours long.
    for (const o of occ) {
      expect(o.startsAt.toISOString().slice(11, 16)).toBe("01:00");
      expect(o.endsAt!.getTime() - o.startsAt.getTime()).toBe(2 * 3_600_000);
    }
    // Nothing before the base row's own start.
    expect(expandOccurrences(row, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-15T00:00:00Z"), TZ)).toHaveLength(0);
  });

  it("holds the wall-clock time across a daylight change in a zone that has one", () => {
    // 20:00 Fridays in Los Angeles; DST ends 2026-11-01.
    const row = baseRow({ startsAt: new Date("2026-10-24T03:00:00Z"), endsAt: null, recurrence: { freq: "weekly", byWeekday: [5] } });
    const occ = expandOccurrences(row, new Date("2026-10-20T00:00:00Z"), new Date("2026-11-15T00:00:00Z"), "America/Los_Angeles");
    expect(occ.map((o) => o.occurrenceKey)).toEqual(["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"]);
    // 20:00 PDT is 03:00Z; 20:00 PST is 04:00Z.
    expect(occ[1].startsAt.toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(occ[2].startsAt.toISOString()).toBe("2026-11-07T04:00:00.000Z");
  });

  it("honours interval, exceptions, overrides and until", () => {
    const row = baseRow({
      recurrence: {
        freq: "weekly", byWeekday: [2], interval: 2,
        exceptions: ["2026-09-15"],
        overrides: { "2026-09-01": { cancelled: true }, "2026-09-29": { title: "Harvest circle", startsAt: "2026-09-30T02:00:00Z" } },
        until: "2026-10-20T00:00:00Z",
      },
    });
    const occ = expandOccurrences(row, new Date("2026-08-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"), TZ);
    // Every other Tuesday from 18 Aug: 18 Aug, 1 Sep (cancelled but present), 15 Sep (exception, gone), 29 Sep (moved), 13 Oct; 27 Oct is past until.
    expect(occ.map((o) => o.occurrenceKey)).toEqual(["2026-08-18", "2026-09-01", "2026-09-29", "2026-10-13"]);
    expect(occ[1].cancelled).toBe(true);
    expect(occ[2].title).toBe("Harvest circle");
    expect(occ[2].startsAt.toISOString()).toBe("2026-09-30T02:00:00.000Z");
  });

  it("repeats monthly on a day of the month and skips months without it", () => {
    const row = baseRow({ startsAt: new Date("2026-01-31T15:00:00Z"), endsAt: null, recurrence: { freq: "monthly", byMonthDay: 31 } });
    const occ = expandOccurrences(row, new Date("2026-01-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"), TZ);
    expect(occ.map((o) => o.occurrenceKey)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("lands lunar rhythms on the village date of the sky event at the base time", () => {
    const row = baseRow({ startsAt: new Date("2026-08-01T01:00:00Z"), endsAt: null, recurrence: { freq: "lunar", on: "full_moon" } });
    const occ = expandOccurrences(row, new Date("2026-08-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"), TZ);
    // Full moons: 2026-08-28 04:18Z (27 Aug in Costa Rica), 09-26 16:49Z, 10-26 04:12Z (25 Oct in Costa Rica).
    expect(occ.map((o) => o.occurrenceKey)).toEqual(["2026-08-27", "2026-09-26", "2026-10-25"]);
    expect(occ[0].startsAt.toISOString()).toBe("2026-08-28T01:00:00.000Z");
    const closes = baseRow({ startsAt: new Date("2026-08-01T15:00:00Z"), endsAt: null, recurrence: { freq: "lunar", on: "cycle_close" } });
    const c = expandOccurrences(closes, new Date("2026-08-01T00:00:00Z"), new Date("2026-10-15T00:00:00Z"), TZ);
    // Cycle 329 opens 2026-08-13 07:45Z (mean), 330 on 2026-09-11 03:27Z (true), 331 on 2026-10-10 15:50Z (true).
    expect(c.map((o) => o.occurrenceKey)).toEqual(["2026-08-13", "2026-09-10", "2026-10-10"]);
  });

  it("lands solar rhythms on each solstice and equinox", () => {
    const row = baseRow({ startsAt: new Date("2026-01-01T12:00:00Z"), endsAt: null, recurrence: { freq: "solar", on: "either" } });
    const occ = expandOccurrences(row, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), TZ);
    expect(occ.map((o) => o.occurrenceKey)).toEqual(["2026-03-20", "2026-06-21", "2026-09-22", "2026-12-21"]);
    const sol = baseRow({ startsAt: new Date("2026-01-01T12:00:00Z"), endsAt: null, recurrence: { freq: "solar", on: "solstice" } });
    expect(expandOccurrences(sol, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), TZ).map((o) => o.occurrenceKey)).toEqual(["2026-06-21", "2026-12-21"]);
  });
});

describe("visibleLayersFor", () => {
  it("opens layers by who the viewer is, and never lists private", () => {
    expect(visibleLayersFor({ userId: null, isAdmin: false })).toEqual(["public", "village"]);
    expect(visibleLayersFor({ userId: "u1", isAdmin: false })).toEqual(["public", "village", "circle", "household"]);
    expect(visibleLayersFor({ userId: "a1", isAdmin: true })).toEqual(["public", "village", "circle", "household", "admin"]);
  });
});

describe("canViewRow", () => {
  it("applies the list's rule to one row: layer, ownership, removal, drafts", () => {
    const anon = { userId: null, isAdmin: false };
    const member = { userId: "u1", isAdmin: false };
    const admin = { userId: "a1", isAdmin: true };
    const r = (over: Partial<CalendarRow>) => ({ layer: "village" as const, ownerUserId: null, removedAt: null, status: "scheduled" as const, ...over });
    expect(canViewRow(r({}), anon)).toBe(true);
    expect(canViewRow(r({ layer: "circle" }), anon)).toBe(false);
    expect(canViewRow(r({ layer: "circle" }), member)).toBe(true);
    expect(canViewRow(r({ layer: "private", ownerUserId: "u1" }), member)).toBe(true);
    expect(canViewRow(r({ layer: "private", ownerUserId: "u1" }), admin)).toBe(false);
    expect(canViewRow(r({ layer: "admin", ownerUserId: "u1" }), member)).toBe(true);
    expect(canViewRow(r({ layer: "admin" }), member)).toBe(false);
    expect(canViewRow(r({ layer: "admin" }), admin)).toBe(true);
    expect(canViewRow(r({ removedAt: new Date() }), member)).toBe(false);
    expect(canViewRow(r({ removedAt: new Date() }), admin)).toBe(true);
    expect(canViewRow(r({ status: "draft" }), admin)).toBe(false);
    expect(canViewRow(r({ status: "draft" }), admin, { includeDrafts: true })).toBe(true);
  });
});

describe("calendarIdFor", () => {
  it("is stable, short and shaped like an event id", () => {
    const a = calendarIdFor({ sourceModule: "quests", sourceId: "q-1" });
    expect(a).toBe(calendarIdFor({ sourceModule: "quests", sourceId: "q-1" }));
    expect(a).not.toBe(calendarIdFor({ sourceModule: "quests", sourceId: "q-2" }));
    expect(a.startsWith("ev-quests-")).toBe(true);
    expect(a.length).toBeLessThanOrEqual(64);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the one calendar, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM event_rsvps");
    await pool.query("DELETE FROM events");
  });

  const anon = { userId: null, isAdmin: false };
  const member = { userId: "u1", isAdmin: false };
  const admin = { userId: "a1", isAdmin: true };
  const window = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z"), timezone: TZ };

  it("upserts idempotently on (source_module, source_id) and brings a removed fact back", async () => {
    const id1 = await calendarUpsert(pool, { kind: "quest-window", sourceModule: "quests", sourceId: "q-1", title: "Planting day", startsAt: "2026-09-05T14:00:00Z", endsAt: "2026-09-05T20:00:00Z", link: "/quests/q-1" });
    const id2 = await calendarUpsert(pool, { kind: "quest-window", sourceModule: "quests", sourceId: "q-1", title: "Planting day, moved", startsAt: "2026-09-06T14:00:00Z" });
    expect(id2).toBe(id1);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) n, MAX(title) t FROM events WHERE source_module = 'quests'");
    expect(Number(rows[0].n)).toBe(1);
    expect(rows[0].t).toBe("Planting day, moved");

    expect(await calendarRemove(pool, { sourceModule: "quests", sourceId: "q-1" })).toBe(true);
    expect(await calendarRemove(pool, { sourceModule: "quests", sourceId: "q-1" })).toBe(false);
    expect(await listCalendarItems(pool, { ...window, viewer: anon })).toHaveLength(0);
    expect((await listCalendarItems(pool, { ...window, viewer: admin, includeRemoved: true }))[0].removed).toBe(true);

    await calendarUpsert(pool, { kind: "quest-window", sourceModule: "quests", sourceId: "q-1", title: "Planting day", startsAt: "2026-09-06T14:00:00Z" });
    const back = await listCalendarItems(pool, { ...window, viewer: anon });
    expect(back).toHaveLength(1);
    expect(back[0].kind).toBe("quest-window");
    expect(back[0].sourceModule).toBe("quests");
    expect(back[0].removed).toBeUndefined();
  });

  it("reconciles a module's mirror by the source ids that still exist", async () => {
    for (const n of [1, 2, 3]) {
      await calendarUpsert(pool, { kind: "sky", sourceModule: "sky", sourceId: `sky:new-moon:${n}`, title: "New moon", startsAt: `2026-09-0${n}T00:00:00Z` });
    }
    expect((await calendarSourceIds(pool, "sky")).sort()).toEqual(["sky:new-moon:1", "sky:new-moon:2", "sky:new-moon:3"]);
    expect(await calendarRemoveMissing(pool, "sky", ["sky:new-moon:2"])).toBe(2);
    expect(await calendarSourceIds(pool, "sky")).toEqual(["sky:new-moon:2"]);
  });

  it("applies layer visibility over status: anon, member, owner, admin", async () => {
    await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "village", title: "Village supper", startsAt: "2026-09-01T00:00:00Z", layer: "village" });
    await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "public", title: "Open day", startsAt: "2026-09-02T00:00:00Z", layer: "public" });
    await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "circle", title: "Land circle", startsAt: "2026-09-03T00:00:00Z", layer: "circle" });
    await calendarUpsert(pool, { kind: "loan-due", sourceModule: "t", sourceId: "loan-u1", title: "Ladder due", startsAt: "2026-09-04T00:00:00Z", layer: "private", ownerUserId: "u1" });
    await calendarUpsert(pool, { kind: "loan-due", sourceModule: "t", sourceId: "loan-u2", title: "Drill due", startsAt: "2026-09-05T00:00:00Z", layer: "private", ownerUserId: "u2" });
    await calendarUpsert(pool, { kind: "notice-end", sourceModule: "t", sourceId: "exit-u1", title: "Notice ends", startsAt: "2026-09-06T00:00:00Z", layer: "admin", ownerUserId: "u1" });
    await calendarUpsert(pool, { kind: "milestone", sourceModule: "t", sourceId: "ms", title: "Roof on", startsAt: "2026-09-07T00:00:00Z", layer: "admin" });
    // A draft and a cancelled one.
    await pool.query("INSERT INTO events (id, title, starts_at, status, kind, layer) VALUES ('d1','Draft', '2026-09-08 00:00:00', 'draft', 'gathering', 'village')");
    await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "cancelled", title: "Rained off", startsAt: "2026-09-09T00:00:00Z", status: "cancelled" });

    const titles = async (viewer: any, extra: any = {}) => (await listCalendarItems(pool, { ...window, viewer, ...extra })).map((i) => i.title);
    expect(await titles(anon)).toEqual(["Village supper", "Open day", "Rained off"]);
    expect(await titles(member)).toEqual(["Village supper", "Open day", "Land circle", "Ladder due", "Notice ends", "Rained off"]);
    expect(await titles({ userId: "u2", isAdmin: false })).toEqual(["Village supper", "Open day", "Land circle", "Drill due", "Rained off"]);
    expect(await titles(admin)).toEqual(["Village supper", "Open day", "Land circle", "Notice ends", "Roof on", "Rained off"]);
    expect(await titles(admin, { includeDrafts: true })).toContain("Draft");
    // Narrowing by layer and by kind.
    expect(await titles(member, { layers: ["private"] })).toEqual(["Ladder due"]);
    expect(await titles(member, { kinds: ["loan-due", "notice-end"] })).toEqual(["Ladder due", "Notice ends"]);
    // The private row never reaches an admin who does not own it.
    expect(await titles(admin, { layers: ["private"] })).toEqual([]);
  });

  it("hides a hidden row by id too, and keeps the map's lanterns to public layers", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const loanId = await calendarUpsert(pool, { kind: "loan-due", sourceModule: "t", sourceId: "loan-u1", title: "Ladder due", startsAt: soon, layer: "private", ownerUserId: "u1" });
    const circleId = await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "circle", title: "Land circle", startsAt: soon, layer: "circle" });
    await pool.query("UPDATE events SET structure_keys = ? WHERE id = ?", [JSON.stringify(["barn"]), circleId]);
    const openId = await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "open", title: "Open day", startsAt: soon, layer: "public" });
    await pool.query("UPDATE events SET structure_keys = ? WHERE id = ?", [JSON.stringify(["commons"]), openId]);
    // The mirrored id is a hash of its source: anyone can compute it. By id it still 404s.
    expect(await getCalendarItemFor(pool, loanId, anon)).toBeNull();
    expect(await getCalendarItemFor(pool, loanId, admin)).toBeNull();
    expect((await getCalendarItemFor(pool, loanId, member))!.title).toBe("Ladder due");
    expect(await getCalendarItemFor(pool, circleId, anon)).toBeNull();
    expect((await getCalendarItemFor(pool, circleId, member))!.title).toBe("Land circle");
    expect((await getCalendarItemFor(pool, openId, anon))!.title).toBe("Open day");
    // A removed row: gone for a member, visible to an admin.
    await calendarRemove(pool, { sourceModule: "t", sourceId: "open" });
    expect(await getCalendarItemFor(pool, openId, member)).toBeNull();
    expect((await getCalendarItemFor(pool, openId, admin))!.removed).toBe(true);
    // The map's per-structure read is anonymous: only public and village layers reach it.
    const lanterns = await upcomingByStructure(pool, 30);
    expect(lanterns.barn).toBeUndefined();
  });

  it("materialises recurrence and counts RSVPs per occurrence", async () => {
    const [ins] = await pool.query<any>(
      "INSERT INTO events (id, title, starts_at, ends_at, status, kind, layer, capacity, recurrence) VALUES ('circle','Moon circle', '2026-08-19 01:00:00', '2026-08-19 03:00:00', 'scheduled', 'gathering', 'village', 2, ?)",
      [JSON.stringify({ freq: "weekly", byWeekday: [2] })],
    );
    expect(ins.affectedRows).toBe(1);
    // u1 comes on the 18th and the 25th; u2 only the 25th; u3 fills the 25th and is turned away.
    expect((await rsvp(pool, "circle", "u1", "going", undefined, "2026-08-18")).ok).toBe(true);
    expect((await rsvp(pool, "circle", "u1", "going", undefined, "2026-08-25")).ok).toBe(true);
    expect((await rsvp(pool, "circle", "u2", "going", undefined, "2026-08-25")).ok).toBe(true);
    const full = await rsvp(pool, "circle", "u3", "going", undefined, "2026-08-25");
    expect(full).toEqual({ ok: false, reason: "full" });
    // A recurring row refuses an answer with no evening named.
    expect((await rsvp(pool, "circle", "u3", "going")).ok).toBe(false);

    const items = await listCalendarItems(pool, { from: new Date("2026-08-17T00:00:00Z"), to: new Date("2026-09-03T00:00:00Z"), timezone: TZ, viewer: member });
    expect(items.map((i) => [i.occurrenceKey, i.goingCount, i.myRsvp, i.spotsLeft])).toEqual([
      ["2026-08-18", 1, "going", 1],
      ["2026-08-25", 2, "going", 0],
      ["2026-09-01", 0, null, 2],
    ]);
    // Withdrawing one evening leaves the other.
    expect(await withdrawRsvp(pool, "circle", "u1", "2026-08-25")).toBe(true);
    const after = await listCalendarItems(pool, { from: new Date("2026-08-17T00:00:00Z"), to: new Date("2026-09-03T00:00:00Z"), timezone: TZ, viewer: member });
    expect(after.map((i) => [i.occurrenceKey, i.goingCount, i.myRsvp])).toEqual([
      ["2026-08-18", 1, "going"],
      ["2026-08-25", 1, null],
      ["2026-09-01", 0, null],
    ]);
  });

  it("keeps a one-off gathering's RSVP on the empty occurrence key, as before", async () => {
    await pool.query("INSERT INTO events (id, title, starts_at, status, capacity) VALUES ('one','Supper', '2026-09-01 00:00:00', 'scheduled', 1)");
    // A key sent for a one-off is ignored, so the same person cannot take two seats.
    expect((await rsvp(pool, "one", "u1", "going", undefined, "2026-09-01")).ok).toBe(true);
    const again = await rsvp(pool, "one", "u1", "going");
    expect(again.ok && again.duplicate).toBe(true);
    const [rows] = await pool.query<any[]>("SELECT occurrence_key FROM event_rsvps WHERE event_id = 'one'");
    expect(rows.map((r) => r.occurrence_key)).toEqual([""]);
    expect((await rsvp(pool, "one", "u2", "going")).ok).toBe(false);
  });

  it("lists gatherings through the calendar, authored kinds only, and the map's kinds stay gatherings", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await calendarUpsert(pool, { kind: "gathering", sourceModule: "t", sourceId: "g", title: "Work party", startsAt: soon });
    await calendarUpsert(pool, { kind: "sky", sourceModule: "sky", sourceId: "nm", title: "New moon", startsAt: soon });
    await calendarUpsert(pool, { kind: "quest-window", sourceModule: "quests", sourceId: "q", title: "Planting", startsAt: soon });
    const list = await listGatherings(pool, { upcomingDays: 30, pastVisibleDays: 30 });
    expect(list.map((g) => g.title)).toEqual(["Work party"]);
    const all = await listGatherings(pool, { upcomingDays: 30, pastVisibleDays: 30, kinds: ["gathering", "sky", "quest-window"] });
    expect(all.map((g) => g.kind).sort()).toEqual(["gathering", "quest-window", "sky"]);
  });
});
