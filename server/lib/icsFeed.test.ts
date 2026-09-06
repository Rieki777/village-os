/**
 * The .ics feed (0085): our hand-written RFC 5545 round-trips through an
 * independent parser (ical.js) with zero warnings, every VEVENT carries UID,
 * DTSTAMP and DTSTART (harm metric 4), a weekly rhythm survives as an RRULE
 * that expands to the right wall-clock instants through our own VTIMEZONE,
 * and the feed keys are stored hashed and die on revoke.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import type { CalendarRow } from "./calendar";
import {
  buildIcs,
  feedTokenStatus,
  icsEscape,
  icsFold,
  icsTimezone,
  looksLikeFeedToken,
  mintFeedToken,
  resolveFeedToken,
  revokeFeedTokens,
  rruleFor,
} from "./icsFeed";
import { EXAMPLE_MONTH_NAMES } from "./lunarTable";

const TZ = "America/Costa_Rica";
const names = EXAMPLE_MONTH_NAMES.map((name, i) => ({ index: i + 1, name, isExample: true }));
const opts = {
  calendarName: "Test village calendar",
  timezone: TZ,
  anchor: "december_solstice" as const,
  hemisphere: "north" as const,
  names,
  // The lunation this fixture village calls Moon 1. August 2026 is lunation
  // 329, so 283 makes it the village's 47th moon and the descriptions below
  // read one number that never resets rather than a place in a lunar year.
  moonOneCycle: 283,
  host: "village.test",
  siteUrl: "https://village.test",
  from: new Date("2026-08-01T00:00:00Z"),
  to: new Date("2026-12-01T00:00:00Z"),
  now: new Date("2026-08-16T12:00:00Z"),
};

const row = (over: Partial<CalendarRow>): CalendarRow => ({
  id: "ev-1", title: "Moon circle", description: null,
  startsAt: new Date("2026-08-19T01:00:00Z"), endsAt: new Date("2026-08-19T03:00:00Z"),
  locationText: null, structureKeys: [], visitTypeId: null, capacity: null, status: "scheduled",
  attendanceMode: "offline", onlineUrl: null, isExample: false, kind: "gathering", layer: "village",
  ownerUserId: null, allDay: false, sourceModule: null, sourceId: null, link: null, colour: null,
  recurrence: null, externalSourceId: null, externalUid: null, removedAt: null,
  updatedAt: new Date("2026-08-10T10:00:00Z"),
  // 0092: a gathering carries a seat fee. Free is what every fixture here
  // is about, and stating it beats letting the type drift optional.
  seatPrice: 0,
  seatToken: null,
  ...over,
});

/** Parse with ical.js, collecting the parser's warnings loudly. */
function parse(ics: string) {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  try {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    return { comp, warnings, events: comp.getAllSubcomponents("vevent") };
  } finally {
    console.warn = original;
  }
}

describe("the pieces", () => {
  it("escapes and folds per RFC 5545", () => {
    expect(icsEscape("a;b,c\\d\nline")).toBe("a\\;b\\,c\\\\d\\nline");
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = icsFold(long);
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n")[1].startsWith(" ")).toBe(true);
    // Multi-byte characters never split.
    const accents = "DESCRIPTION:" + "é".repeat(120);
    expect(icsFold(accents).replace(/\r\n /g, "")).toContain("é".repeat(120));
  });

  it("lets no control character through a TEXT value or a URL", () => {
    expect(icsEscape("a\rb\r\nc\nd\u0000e\u001bf")).toBe("a\\nb\\nc\\ndef");
    const rows = [row({ id: "inj", title: "ok", link: "/x\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nEND:VALARM" })];
    const ics = buildIcs(rows, opts);
    expect(ics).not.toContain("VALARM");
    expect(ics.split("\r\n").filter((l) => l.startsWith("URL:"))).toEqual([]);
    const fine = buildIcs([row({ id: "ok", title: "ok", link: "https://village.test/events" })], opts);
    expect(fine).toContain("URL:https://village.test/events");
  });

  it("writes an RRULE for weekly and monthly, none for lunar and solar", () => {
    expect(rruleFor(row({ recurrence: { freq: "weekly", byWeekday: [2, 4], interval: 2, until: "2026-12-31T00:00:00Z" } }))).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T000000Z");
    expect(rruleFor(row({ recurrence: { freq: "monthly", byMonthDay: 15 } }))).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(rruleFor(row({ recurrence: { freq: "lunar", on: "full_moon" } }))).toBeNull();
    expect(rruleFor(row({ recurrence: { freq: "solar", on: "either" } }))).toBeNull();
  });

  it("builds a VTIMEZONE from real transitions, and a flat one for a zone without them", () => {
    const flat = icsTimezone(TZ, opts.from, opts.to).join("\n");
    expect(flat).toContain("TZID:America/Costa_Rica");
    expect(flat).toContain("TZOFFSETFROM:-0600");
    expect(flat).not.toContain("DAYLIGHT");
    const la = icsTimezone("America/Los_Angeles", opts.from, opts.to).join("\n");
    expect(la).toContain("BEGIN:DAYLIGHT");
    expect(la).toContain("BEGIN:STANDARD");
    expect(la).toContain("TZOFFSETTO:-0700");
    expect(la).toContain("TZOFFSETTO:-0800");
    // 2026-11-01 02:00 PDT falls back: listed as an RDATE in local time.
    expect(la).toContain("20261101T020000");
  });
});

describe("the feed round-trips through ical.js (harm metric 4)", () => {
  const rows: CalendarRow[] = [
    row({ id: "one", title: "Harvest work party; bring gloves, hats", description: "Lunch on the commons.\nSecond line.", locationText: "The greenhouse", startsAt: new Date("2026-08-22T15:00:00Z"), endsAt: new Date("2026-08-22T20:00:00Z"), link: "/events" }),
    row({ id: "weekly", title: "Tuesday supper", recurrence: { freq: "weekly", byWeekday: [2], exceptions: ["2026-09-01"], overrides: { "2026-09-15": { cancelled: true }, "2026-09-22": { title: "Equinox supper", startsAt: "2026-09-23T02:00:00Z" } } } }),
    row({ id: "moons", title: "Moon circle", recurrence: { freq: "lunar", on: "full_moon" }, startsAt: new Date("2026-08-01T01:00:00Z"), endsAt: null }),
    row({ id: "season", title: "Season of Rooting", kind: "season", allDay: true, startsAt: new Date("2026-09-22T06:00:00Z"), endsAt: new Date("2026-12-21T06:00:00Z") }),
    row({ id: "sky", title: "Full moon", kind: "sky", startsAt: new Date("2026-08-28T04:18:00Z"), endsAt: null, status: "scheduled" }),
    row({ id: "gone", title: "Rained off", status: "cancelled", startsAt: new Date("2026-08-30T15:00:00Z"), endsAt: null }),
  ];
  const ics = buildIcs(rows, opts);

  it("parses with zero warnings and every VEVENT carries UID, DTSTAMP, DTSTART", () => {
    expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true); // CRLF throughout
    const { warnings, events, comp } = parse(ics);
    expect(warnings).toEqual([]);
    expect(comp.getFirstPropertyValue("x-wr-calname")).toBe("Test village calendar");
    expect(events.length).toBeGreaterThanOrEqual(6);
    for (const ev of events) {
      expect(ev.getFirstPropertyValue("uid")).toBeTruthy();
      expect(ev.getFirstPropertyValue("dtstamp")).toBeTruthy();
      expect(ev.getFirstPropertyValue("dtstart")).toBeTruthy();
      expect(ev.getFirstPropertyValue("summary")).toBeTruthy();
      expect(ev.getFirstPropertyValue("sequence")).not.toBeNull();
    }
    for (const l of ics.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
  });

  it("names the lunar month on every event and keeps text intact through escaping", () => {
    const { events } = parse(ics);
    const one = events.find((e) => e.getFirstPropertyValue("uid") === "one@village.test")!;
    expect(one.getFirstPropertyValue("summary")).toBe("Harvest work party; bring gloves, hats");
    // THE VILLAGE'S OWN COUNT, and no "of twelve" behind it. This read
    // "Moon 8 of 12" while the number was the moon's place in the lunar year,
    // so a subscriber's calendar carried the same 8 for a different moon every
    // year. 329 - 283 + 1 = 47.
    expect(String(one.getFirstPropertyValue("description"))).toContain("Moon 47, Sturgeon Moon, day 11 of 29.");
    expect(String(one.getFirstPropertyValue("description"))).toContain("Lunch on the commons.\nSecond line.");
    expect(one.getFirstPropertyValue("location")).toBe("The greenhouse");
    expect(one.getFirstPropertyValue("url")).toBe("https://village.test/events");
    expect(one.getFirstPropertyValue("status")).toBe("CONFIRMED");
    expect(new ICAL.Event(one).startDate.toJSDate().toISOString()).toBe("2026-08-22T15:00:00.000Z");
    const gone = events.find((e) => e.getFirstPropertyValue("uid") === "gone@village.test")!;
    expect(gone.getFirstPropertyValue("status")).toBe("CANCELLED");
    const season = events.find((e) => e.getFirstPropertyValue("uid") === "season@village.test")!;
    expect(String(season.getFirstPropertyValue("dtstart"))).toBe("2026-09-22");
    expect(String(season.getFirstPropertyValue("dtend"))).toBe("2026-12-21");
  });

  it("gives an unanchored village the moon's name and its days with no number at all", () => {
    // The three standings the counter defines are honoured on this surface too:
    // a village that has not set a first moon has no Moon 1, so it gets no
    // ordinal here. Never "Moon 0", never a negative, and never the moon's
    // place in the lunar year standing in for a count it does not have.
    const { events } = parse(buildIcs(rows, { ...opts, moonOneCycle: null }));
    const one = events.find((e) => e.getFirstPropertyValue("uid") === "one@village.test")!;
    const said = String(one.getFirstPropertyValue("description"));
    expect(said).toContain("Sturgeon Moon, day 11 of 29.");
    expect(said).not.toContain("Moon 0");
    expect(said).not.toMatch(/Moon -?\d/);

    // And a lunation earlier than the anchor reads as before the count, which
    // is the second standing. 329 is well before a Moon 1 at lunation 400.
    const early = parse(buildIcs(rows, { ...opts, moonOneCycle: 400 })).events
      .find((e) => e.getFirstPropertyValue("uid") === "one@village.test")!;
    expect(String(early.getFirstPropertyValue("description"))).toContain("Before Moon 1, Sturgeon Moon, day 11 of 29.");
  });

  it("expands the weekly RRULE through our VTIMEZONE to Tuesdays at 19:00 village time, with the exceptions out and the moved one bound", () => {
    const { comp, events } = parse(ics);
    for (const vt of comp.getAllSubcomponents("vtimezone")) {
      ICAL.TimezoneService.register(new ICAL.Timezone(vt));
    }
    const weekly = events.find((e) => e.getFirstPropertyValue("uid") === "weekly@village.test" && !e.getFirstPropertyValue("recurrence-id"))!;
    expect(String(weekly.getFirstPropertyValue("rrule"))).toContain("FREQ=WEEKLY");
    const ev = new ICAL.Event(weekly);
    const it = ev.iterator();
    const got: string[] = [];
    for (let next = it.next(); next && got.length < 6; next = it.next()) got.push(next.toJSDate().toISOString());
    // 19:00 in Costa Rica is 01:00Z the next day; 1 Sep (exception) and 15 Sep (cancelled) are EXDATEs.
    expect(got).toEqual([
      "2026-08-19T01:00:00.000Z", "2026-08-26T01:00:00.000Z", "2026-09-09T01:00:00.000Z",
      "2026-09-23T01:00:00.000Z", "2026-09-30T01:00:00.000Z", "2026-10-07T01:00:00.000Z",
    ]);
    const moved = events.find((e) => e.getFirstPropertyValue("uid") === "weekly@village.test" && e.getFirstPropertyValue("recurrence-id"))!;
    expect(moved.getFirstPropertyValue("summary")).toBe("Equinox supper");
    expect(new ICAL.Event(moved).startDate.toJSDate().toISOString()).toBe("2026-09-23T02:00:00.000Z");
    // The lunar rhythm left as instances: three full moons in the window.
    const moons = events.filter((e) => String(e.getFirstPropertyValue("uid")).startsWith("moons-"));
    expect(moons.map((e) => String(e.getFirstPropertyValue("uid")))).toEqual([
      "moons-2026-08-27@village.test", "moons-2026-09-26@village.test", "moons-2026-10-25@village.test", "moons-2026-11-24@village.test",
    ]);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("feed keys", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 });
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });

  it("mints one live key per member, stores only its hash, resolves it, and kills it on revoke", async () => {
    expect(await feedTokenStatus(pool, "u1")).toEqual({ hasToken: false, createdAt: null });
    const first = await mintFeedToken(pool, "u1");
    expect(looksLikeFeedToken(first)).toBe(true);
    const [rows] = await pool.query<any[]>("SELECT token_hash, revoked_at FROM calendar_feed_tokens WHERE user_id = 'u1'");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(first);
    expect(rows[0].token_hash).toHaveLength(64);
    expect(await resolveFeedToken(pool, first)).toBe("u1");
    expect(await resolveFeedToken(pool, "0".repeat(64))).toBeNull();
    expect(await resolveFeedToken(pool, "not-a-token")).toBeNull();
    expect((await feedTokenStatus(pool, "u1")).hasToken).toBe(true);

    // A second mint retires the first.
    const second = await mintFeedToken(pool, "u1");
    expect(await resolveFeedToken(pool, first)).toBeNull();
    expect(await resolveFeedToken(pool, second)).toBe("u1");
    const [live] = await pool.query<any[]>("SELECT COUNT(*) n FROM calendar_feed_tokens WHERE user_id = 'u1' AND revoked_at IS NULL");
    expect(Number(live[0].n)).toBe(1);

    expect(await revokeFeedTokens(pool, "u1")).toBe(1);
    expect(await resolveFeedToken(pool, second)).toBeNull();
    expect(await feedTokenStatus(pool, "u1")).toEqual({ hasToken: false, createdAt: null });
    expect(await revokeFeedTokens(pool, "u1")).toBe(0);
  });
});
