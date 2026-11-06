/**
 * External calendars (0085): subscribe by address, mirror by UID, and the
 * URL is a credential that reaches no response, no log line and no
 * last_error (harm metric 5).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { listCalendarItems } from "./calendar";
import {
  addExternalCalendar,
  getExternalCalendar,
  listExternalCalendars,
  parseIcs,
  pollExternalCalendar,
  removeExternalCalendar,
  scrub,
} from "./externalCalendars";
import { allSecretStatuses, loadSecrets, secretValue } from "./secrets";

const SECRET_URL = "https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/private-9f8e7d6c5b4a/basic.ics";

const FIXTURE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/Los_Angeles",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:one@upstream",
  "DTSTAMP:20260801T000000Z",
  "DTSTART:20260905T160000Z",
  "DTEND:20260905T180000Z",
  "SUMMARY:Seed swap",
  "LOCATION:The barn",
  "DESCRIPTION:Bring seeds\\, take seeds.",
  "URL:https://example.org/seed-swap",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:allday@upstream",
  "DTSTAMP:20260801T000000Z",
  "DTSTART;VALUE=DATE:20260912",
  "DTEND;VALUE=DATE:20260913",
  "SUMMARY:Open farm day",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly@upstream",
  "DTSTAMP:20260801T000000Z",
  "DTSTART;TZID=America/Los_Angeles:20261023T200000",
  "DTEND;TZID=America/Los_Angeles:20261023T210000",
  "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4",
  "SUMMARY:Friday film",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly@upstream",
  "RECURRENCE-ID;TZID=America/Los_Angeles:20261106T200000",
  "DTSTAMP:20260801T000000Z",
  "DTSTART;TZID=America/Los_Angeles:20261106T190000",
  "DTEND;TZID=America/Los_Angeles:20261106T200000",
  "SUMMARY:Friday film (early)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gone@upstream",
  "DTSTAMP:20260801T000000Z",
  "DTSTART:20260920T160000Z",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n") + "\r\n";

const from = new Date("2026-08-01T00:00:00Z");
const to = new Date("2027-08-01T00:00:00Z");

describe("parseIcs", () => {
  it("reads one-offs, all-day events, RRULE instances through the feed's own VTIMEZONE, overrides and cancellations", () => {
    const events = parseIcs(FIXTURE, from, to);
    const byUid = new Map(events.map((e) => [e.uid, e]));
    expect(byUid.get("one@upstream")).toMatchObject({ title: "Seed swap", location: "The barn", description: "Bring seeds, take seeds.", url: "https://example.org/seed-swap", allDay: false, cancelled: false });
    expect(byUid.get("one@upstream")!.startsAt.toISOString()).toBe("2026-09-05T16:00:00.000Z");
    expect(byUid.get("allday@upstream")).toMatchObject({ title: "Open farm day", allDay: true });
    // Four Fridays; 20:00 PDT is 03:00Z, and 20:00 PST after the November change is 04:00Z.
    const fridays = events.filter((e) => e.uid.startsWith("weekly@upstream:"));
    expect(fridays).toHaveLength(4);
    expect(fridays.map((e) => e.startsAt.toISOString())).toEqual([
      "2026-10-24T03:00:00.000Z", "2026-10-31T03:00:00.000Z", "2026-11-07T03:00:00.000Z", "2026-11-14T04:00:00.000Z",
    ]);
    // The overridden instance carries its own title and start (19:00 PST = 03:00Z).
    const early = fridays.find((e) => e.title === "Friday film (early)")!;
    expect(early.startsAt.toISOString()).toBe("2026-11-07T03:00:00.000Z");
    expect(byUid.get("gone@upstream")!.cancelled).toBe(true);
    // Outside the window: nothing.
    expect(parseIcs(FIXTURE, new Date("2030-01-01T00:00:00Z"), new Date("2031-01-01T00:00:00Z"))).toEqual([]);
  });

  it("refuses text that is not a calendar", () => {
    expect(() => parseIcs("hello", from, to)).toThrow();
  });

  it("forgets a feed's VTIMEZONEs after the parse, so one subscription cannot redefine a zone for the next", async () => {
    const ICAL = (await import("ical.js")).default;
    parseIcs(FIXTURE, from, to);
    expect(ICAL.TimezoneService.has("America/Los_Angeles")).toBe(false);
    // A hostile feed that redefines a zone with a wrong offset does not leak past its own parse.
    const hostile = FIXTURE.replace("TZOFFSETTO:-0700", "TZOFFSETTO:+0500").replace("TZOFFSETTO:-0800", "TZOFFSETTO:+0500");
    parseIcs(hostile, from, to);
    const again = parseIcs(FIXTURE, from, to);
    expect(again.find((e) => e.uid === "weekly@upstream:2026-10-23T20:00:00")!.startsAt.toISOString()).toBe("2026-10-24T03:00:00.000Z");
  });
});

describe("scrub", () => {
  it("strips the address, its path and anything URL-shaped from a message", () => {
    const m = scrub(`request to ${SECRET_URL} failed`, SECRET_URL);
    expect(m).not.toContain("private-9f8e7d6c5b4a");
    expect(m).not.toContain("google.com");
    expect(scrub("see https://x.test/a?token=abc for details")).toBe("see <url> for details");
    expect(scrub("path /calendar/ical/private-9f8e7d6c5b4a/basic.ics broke", SECRET_URL)).not.toContain("private-9f8e7d6c5b4a");
    expect(scrub("x".repeat(500)).length).toBe(200);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("subscriptions against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const logged: string[] = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // A calendar address is stored through the secrets store, which seals at
    // rest since 2026-08-30 and REFUSES to write without a key. This suite
    // asserts the round trip, so it needs one; without it every write here
    // fails with "this deployment has no village-secrets key".
    process.env.VILLAGE_SECRETS_KEY = "c4".repeat(32);
    await loadSecrets(pool);
    // Every log line the module could write, captured, so the URL can be shown absent.
    for (const level of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM event_rsvps");
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM external_calendars");
  });

  it("refuses a private address, a plain http one and junk", async () => {
    expect((await addExternalCalendar(pool, { name: "x", url: "https://127.0.0.1/cal.ics", createdBy: "a1" })).ok).toBe(false);
    expect((await addExternalCalendar(pool, { name: "x", url: "https://10.0.0.5/cal.ics", createdBy: "a1" })).ok).toBe(false);
    expect((await addExternalCalendar(pool, { name: "x", url: "http://8.8.8.8/cal.ics", createdBy: "a1" })).ok).toBe(false);
    expect((await addExternalCalendar(pool, { name: "x", url: "not a url", createdBy: "a1" })).ok).toBe(false);
    expect((await addExternalCalendar(pool, { name: "", url: "https://8.8.8.8/cal.ics", createdBy: "a1" })).ok).toBe(false);
    expect((await addExternalCalendar(pool, { name: "x", url: "https://8.8.8.8/cal.ics\r\nX: y", createdBy: "a1" })).ok).toBe(false);
    expect(await listExternalCalendars(pool)).toEqual([]);
    // webcal:// is Apple's https.
    const web = await addExternalCalendar(pool, { name: "Apple", url: "webcal://8.8.8.8/pub.ics", createdBy: "a1" });
    expect(web.ok).toBe(true);
    if (web.ok) { expect(web.calendar.urlHost).toBe("8.8.8.8"); await removeExternalCalendar(pool, web.calendar.id, "a1"); }
  });

  it("stores the address as a secret, keeps host and last4, mirrors by UID, updates, retires, and never shows the URL (harm metric 5)", async () => {
    // A literal public address skips DNS; the fetch itself is the test seam.
    const added = await addExternalCalendar(pool, { name: "Farm Google Calendar", url: SECRET_URL.replace("calendar.google.com", "8.8.8.8"), layer: "public", colour: "#0369a1", createdBy: "a1" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const cal = added.calendar;
    const storedUrl = SECRET_URL.replace("calendar.google.com", "8.8.8.8");
    expect(cal.urlHost).toBe("8.8.8.8");
    expect(cal.urlLast4).toBe(".ics");
    expect(JSON.stringify(cal)).not.toContain("private-9f8e7d6c5b4a");
    expect(secretValue(`external_calendar_url:${cal.id}`)).toBe(storedUrl);
    // The Secrets panel lists only the platform's keys; the namespaced key stays out of it.
    expect(allSecretStatuses().some((s) => String(s.key).startsWith("external_calendar_url:"))).toBe(false);
    // The row itself holds no URL.
    const [rows] = await pool.query<any[]>("SELECT * FROM external_calendars WHERE id = ?", [cal.id]);
    expect(JSON.stringify(rows[0])).not.toContain("private-9f8e7d6c5b4a");

    // Poll with the fixture standing in for the network.
    const seen: string[] = [];
    const now = new Date("2026-08-16T12:00:00Z");
    const r1 = await pollExternalCalendar(pool, cal.id, { timezone: "America/Costa_Rica", now, fetchText: async (u) => { seen.push(u); return FIXTURE; } });
    expect(seen).toEqual([storedUrl]);
    expect(r1).toMatchObject({ ok: true, imported: 7, retired: 0, error: null });
    const anon = { userId: null, isAdmin: false };
    const items = await listCalendarItems(pool, { from, to, timezone: "America/Costa_Rica", viewer: anon, kinds: ["external"], now });
    expect(items.map((i) => i.title).sort()).toEqual(["Cancelled thing", "Friday film", "Friday film", "Friday film", "Friday film (early)", "Open farm day", "Seed swap"]);
    const swap = items.find((i) => i.title === "Seed swap")!;
    expect(swap).toMatchObject({ kind: "external", layer: "public", colour: "#0369a1", locationText: "The barn", link: "https://example.org/seed-swap", external: { sourceId: cal.id, uid: "one@upstream" } });
    expect(items.find((i) => i.title === "Cancelled thing")!.status).toBe("cancelled");
    expect(items.find((i) => i.title === "Open farm day")!.allDay).toBe(true);
    // RSVP still works on our side.
    const { rsvp } = await import("./gatherings");
    expect((await rsvp(pool, swap.id, "u1", "going")).ok).toBe(true);

    // Second poll: an update and a removal upstream.
    const changed = FIXTURE.replace("SUMMARY:Seed swap", "SUMMARY:Seed and tool swap").replace(/BEGIN:VEVENT\r\nUID:allday@upstream[\s\S]*?END:VEVENT\r\n/, "");
    const r2 = await pollExternalCalendar(pool, cal.id, { timezone: "America/Costa_Rica", now, fetchText: async () => changed });
    expect(r2).toMatchObject({ ok: true, imported: 6, retired: 1 });
    const after = await listCalendarItems(pool, { from, to, timezone: "America/Costa_Rica", viewer: anon, kinds: ["external"], now });
    expect(after.map((i) => i.title)).toContain("Seed and tool swap");
    expect(after.map((i) => i.title)).not.toContain("Open farm day");
    // The row now says when and how it went; still no URL.
    const view = (await getExternalCalendar(pool, cal.id))!;
    expect(view.lastStatus).toBe("ok");
    expect(view.importedCount).toBe(6);
    expect(view.lastPolledAt).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain("private-9f8e7d6c5b4a");

    // A failing fetch whose error carries the URL: last_error keeps none of it.
    const r3 = await pollExternalCalendar(pool, cal.id, { timezone: "America/Costa_Rica", now, fetchText: async () => { throw new Error(`getaddrinfo ENOTFOUND for ${storedUrl}`); } });
    expect(r3.ok).toBe(false);
    expect(r3.error).not.toContain("private-9f8e7d6c5b4a");
    expect(r3.error).not.toContain("8.8.8.8/");
    const failed = (await getExternalCalendar(pool, cal.id))!;
    expect(failed.lastStatus).toBe("failed");
    expect(failed.lastError ?? "").not.toContain("private-9f8e7d6c5b4a");
    // And a body that is not a calendar.
    const r4 = await pollExternalCalendar(pool, cal.id, { timezone: "America/Costa_Rica", now, fetchText: async () => "<html>login</html>" });
    expect(r4.ok).toBe(false);
    expect(r4.error).toContain("not a calendar");

    // Nothing this module logged carries the URL.
    expect(logged.join("\n")).not.toContain("private-9f8e7d6c5b4a");

    // Detach: secret cleared, mirrored rows retired, row gone.
    expect(await removeExternalCalendar(pool, cal.id, "a1")).toBe(true);
    expect(secretValue(`external_calendar_url:${cal.id}`)).toBe("");
    expect(await listExternalCalendars(pool)).toEqual([]);
    expect(await listCalendarItems(pool, { from, to, timezone: "America/Costa_Rica", viewer: anon, kinds: ["external"], now })).toEqual([]);
    const [kept] = await pool.query<any[]>("SELECT COUNT(*) n FROM events WHERE external_source_id = ? AND removed_at IS NOT NULL", [cal.id]);
    expect(Number(kept[0].n)).toBeGreaterThan(0);
    expect(await removeExternalCalendar(pool, cal.id, "a1")).toBe(false);
  });
});
