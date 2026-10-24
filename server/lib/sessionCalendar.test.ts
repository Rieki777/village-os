/**
 * A circle's rhythm on the village calendar, without a database: the mirrored
 * row expands, through the calendar's own `expandOccurrences`, to exactly the
 * meetings "Coming up" shows (`nextMeetings`), for a fortnightly rhythm with a
 * skipped date, across a daylight change, at each full moon, and once; and the
 * feed's writer says a weekly rhythm as one rule with the skipped date taken
 * out. If the two halves ever counted weeks or skips differently, a member's
 * calendar and the sessions page would disagree, and this file is where that
 * shows first.
 */
import { describe, expect, it } from "vitest";
import { expandOccurrences } from "./calendar";
import { buildIcs } from "./icsFeed";
import { calendarRowFor, mirrorInput, mirrorRhythms } from "./sessionCalendar";
import { civilParts } from "../../shared/lunar";
import { nextMeetings, type StoredRhythm } from "../../shared/sessionRhythm";

const DAY_MS = 86_400_000;
const stored = (over: Partial<StoredRhythm>): StoredRhythm => ({
  circleId: "garden",
  kind: "weekly",
  recurrence: { freq: "weekly", byWeekday: [4], interval: 1 },
  startsOn: "2026-10-22",
  time: "18:00",
  durationMin: 60,
  ...over,
});

/** The meetings both halves give, as instants, over the same window. */
function both(r: StoredRhythm, from: Date, zone: string, days = 90) {
  const to = new Date(from.getTime() + days * DAY_MS);
  const row = calendarRowFor(r, "Garden", zone, new Date("2026-10-01T00:00:00.000Z"));
  const calendar = expandOccurrences(row, from, to, zone).map((o) => o.startsAt.toISOString());
  const sessions = nextMeetings(r, from, zone, 50, days).map((m) => m.at).filter((at) => Date.parse(at) < to.getTime());
  return { calendar, sessions };
}

describe("the village calendar and Coming up give the same meetings", () => {
  const from = new Date("2026-10-21T00:00:00.000Z");

  it("for every other Thursday with one skipped", () => {
    const r = stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2, exceptions: ["2026-11-05"] } });
    const { calendar, sessions } = both(r, from, "UTC");
    expect(sessions.slice(0, 3)).toEqual(["2026-10-22T18:00:00.000Z", "2026-11-19T18:00:00.000Z", "2026-12-03T18:00:00.000Z"]);
    expect(calendar).toEqual(sessions);
  });

  it("across a daylight change, in the village's zone", () => {
    const { calendar, sessions } = both(stored({}), from, "America/New_York");
    expect(sessions).toContain("2026-11-05T23:00:00.000Z");
    expect(calendar).toEqual(sessions);
  });

  it("at each full moon", () => {
    const r = stored({ kind: "moon", recurrence: { freq: "lunar", on: "full_moon" }, startsOn: "2026-10-21", time: "19:30" });
    const { calendar, sessions } = both(r, from, "UTC", 120);
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    expect(calendar).toEqual(sessions);
  });

  it("when the first meeting falls in the hour the clocks skip, every later meeting keeps the chosen time", () => {
    // 14 March 2027 in New York has no 02:30. The calendar counts from the next meeting that has one.
    const NY = "America/New_York";
    const r = stored({ recurrence: { freq: "weekly", byWeekday: [0], interval: 1 }, startsOn: "2027-03-14", time: "02:30" });
    const row = calendarRowFor(r, "Garden", NY, new Date("2027-03-01T00:00:00.000Z"));
    const later = expandOccurrences(row, new Date("2027-03-15T00:00:00.000Z"), new Date("2027-04-15T00:00:00.000Z"), NY);
    expect(later.length).toBeGreaterThanOrEqual(4);
    for (const o of later) expect(civilParts(o.startsAt, NY).hour, o.startsAt.toISOString()).toBe(2);
    // An every-other-week rhythm steps by whole rhythms, so it keeps its week.
    const fortnight = stored({ recurrence: { freq: "weekly", byWeekday: [0], interval: 2 }, startsOn: "2027-03-14", time: "02:30" });
    expect(mirrorInput(fortnight, "Garden", NY).startsAt).toEqual(new Date("2027-03-28T06:30:00.000Z"));
  });

  it("for a single meeting", () => {
    const { calendar, sessions } = both(stored({ kind: "once", recurrence: null, startsOn: "2026-10-30" }), from, "UTC");
    expect(sessions).toEqual(["2026-10-30T18:00:00.000Z"]);
    expect(calendar).toEqual(sessions);
  });
});

describe("the mirror", () => {
  it("runs one at a time, so two at once never retire what the other just wrote", async () => {
    // A pool that records the order statements arrive in, and holds each rhythm read a moment.
    const order: string[] = [];
    let reads = 0;
    const pool = {
      query: async (sql: string) => {
        // The circles' own calendars are read first (none here), and are no part of the order this case watches.
        if (/FROM `live_session_circle_calendars`/.test(sql)) return [[]];
        if (/FROM `live_session_rhythms`/.test(sql)) {
          const n = ++reads;
          order.push(`read ${n}`);
          await new Promise((r) => setTimeout(r, n === 1 ? 30 : 0));
          return [[]];
        }
        order.push(/removed_at = UTC_TIMESTAMP/.test(sql) ? `retire after read ${reads}` : "write");
        return [{ affectedRows: 0 }];
      },
    } as never;
    const deps = { circles: () => [], lifecycle: () => "members" };
    await Promise.all([mirrorRhythms(pool, deps), mirrorRhythms(pool, deps)]);
    expect(order).toEqual(["read 1", "retire after read 1", "read 2", "retire after read 2"]);
  });
});

describe("the mirrored row", () => {
  it("is the circle's meeting, on the circle layer, linking to its row on /sessions", () => {
    expect(mirrorInput(stored({}), "Garden", "UTC")).toMatchObject({
      sourceId: "garden",
      kind: "call",
      layer: "circle",
      title: "Garden circle meeting",
      link: "/sessions#coming-garden",
      startsAt: new Date("2026-10-22T18:00:00.000Z"),
      endsAt: new Date("2026-10-22T19:00:00.000Z"),
    });
  });

  it("leaves the feed as one weekly rule with the skipped date taken out", () => {
    const r = stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2, exceptions: ["2026-11-05"] } });
    const ics = buildIcs([calendarRowFor(r, "Garden", "UTC", new Date("2026-10-01T00:00:00.000Z"))], {
      calendarName: "Village circle meetings",
      timezone: "UTC",
      anchor: "december_solstice",
      hemisphere: "north",
      names: [],
      moonOneCycle: null,
      host: "village.example.test",
      siteUrl: "https://village.example.test",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2027-06-01T00:00:00.000Z"),
      now: new Date("2026-10-21T00:00:00.000Z"),
    });
    expect(ics).toContain("SUMMARY:Garden circle meeting");
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;[^\r\n]*INTERVAL=2/);
    expect(ics).toMatch(/EXDATE[^\r\n]*20261105T180000/);
    expect(ics).toContain("URL:https://village.example.test/sessions#coming-garden");
  });
});
