/**
 * A circle's rhythm, without a database: reading a body, the first meeting a
 * rhythm stores, the next meetings it gives (weekly with an interval, across a
 * daylight change, skipped dates, the moon, a single date), and the words a
 * member reads. The same rules run against a real schema in
 * server/sessionRhythm.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { civilParts, fullMoonsBetween, newMoonsBetween } from "./lunar";
import { SESSION_LIMITS, SESSION_REFUSALS } from "./sessions";
import {
  RHYTHM_NOTICES,
  RHYTHM_REFUSALS,
  cleanRhythm,
  mayKeepRhythm,
  meetingPhrase,
  meetingWords,
  nextMeetings,
  rhythmAsInput,
  rhythmRecord,
  rhythmWords,
  type StoredRhythm,
} from "./sessionRhythm";

const UTC = "UTC";
const NY = "America/New_York";

const stored = (over: Partial<StoredRhythm>): StoredRhythm => ({
  circleId: "garden",
  kind: "weekly",
  recurrence: { freq: "weekly", byWeekday: [4], interval: 1 },
  startsAt: "2026-10-22T18:00:00.000Z",
  durationMin: 60,
  ...over,
});

describe("reading a rhythm from a body", () => {
  it("reads a weekly rhythm, every one to four weeks, with the usual length when none is sent", () => {
    expect(cleanRhythm({ kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00" })).toEqual({
      ok: true,
      value: { kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00", durationMin: SESSION_LIMITS.durationDefault },
    });
    expect(cleanRhythm({ kind: "weekly", weekday: 4, everyWeeks: 5, time: "18:00" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.everyWeeks });
    expect(cleanRhythm({ kind: "weekly", weekday: 7, time: "18:00" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.weekdayNeeded });
  });

  it("refuses a time, a date or a length that does not read", () => {
    expect(cleanRhythm({ kind: "once", on: "2026-11-05", time: "6pm" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.timeNeeded });
    expect(cleanRhythm({ kind: "once", on: "2026-02-30", time: "18:00" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.dateNeeded });
    expect(cleanRhythm({ kind: "once", on: "2026-11-05", time: "18:00", durationMin: 5 })).toMatchObject({ ok: false, error: SESSION_REFUSALS.durationRange });
    expect(cleanRhythm({ kind: "moon", on: "half_moon", time: "18:00" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.moonNeeded });
    expect(cleanRhythm({ kind: "fortnightly" })).toMatchObject({ ok: false, error: RHYTHM_REFUSALS.kindNeeded });
  });

  it("reads none as stopping the rhythm", () => {
    expect(cleanRhythm({ kind: "none" })).toEqual({ ok: true, value: { kind: "none" } });
  });
});

describe("the first meeting a rhythm stores", () => {
  // Wednesday 21 October 2026, 12:00 UTC.
  const now = new Date("2026-10-21T12:00:00.000Z");

  it("starts a weekly rhythm on the next of its weekday, today included while its time is still to come", () => {
    const thursday = rhythmRecord({ kind: "weekly", weekday: 4, everyWeeks: 1, time: "18:00" }, now, UTC);
    expect(thursday?.startsAt.toISOString()).toBe("2026-10-22T18:00:00.000Z");
    const today = rhythmRecord({ kind: "weekly", weekday: 3, everyWeeks: 1, time: "18:00" }, now, UTC);
    expect(today?.startsAt.toISOString()).toBe("2026-10-21T18:00:00.000Z");
    // Today's time already over: the week after.
    const gone = rhythmRecord({ kind: "weekly", weekday: 3, everyWeeks: 1, time: "09:00", durationMin: 60 }, now, UTC);
    expect(gone?.startsAt.toISOString()).toBe("2026-10-28T09:00:00.000Z");
  });

  it("waits for a later start date, and keeps the calendar's own recurrence shape", () => {
    const later = rhythmRecord({ kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00", startsOn: "2026-11-10" }, now, UTC);
    expect(later?.startsAt.toISOString()).toBe("2026-11-12T18:00:00.000Z");
    expect(later?.recurrence).toEqual({ freq: "weekly", byWeekday: [4], interval: 2 });
  });

  it("refuses a single meeting already over, and keeps one still to come", () => {
    expect(rhythmRecord({ kind: "once", on: "2026-10-20", time: "18:00" }, now, UTC)).toBeNull();
    expect(rhythmRecord({ kind: "once", on: "2026-10-30", time: "18:00" }, now, UTC)?.startsAt.toISOString()).toBe("2026-10-30T18:00:00.000Z");
  });

  it("meets on the village's date of the next new moon, at the chosen time", () => {
    const r = rhythmRecord({ kind: "moon", on: "new_moon", time: "19:30" }, now, UTC)!;
    const moon = newMoonsBetween(new Date(now.getTime() - 2 * 86_400_000), new Date(now.getTime() + 62 * 86_400_000)).find(
      (m) => Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate(), 19, 30) + 60 * 60_000 > now.getTime(),
    )!;
    expect(r.startsAt.toISOString().slice(0, 10)).toBe(moon.toISOString().slice(0, 10));
    expect(r.startsAt.toISOString().slice(11, 16)).toBe("19:30");
  });
});

describe("the next meetings", () => {
  it("counts every other week from the first meeting's week", () => {
    const r = stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2 } });
    const got = nextMeetings(r, new Date("2026-10-21T00:00:00.000Z"), UTC, 3).map((m) => m.key);
    expect(got).toEqual(["2026-10-22", "2026-11-05", "2026-11-19"]);
  });

  it("passes over a skipped date, and never offers a meeting before the first", () => {
    const r = stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 1, exceptions: ["2026-10-29"] } });
    expect(nextMeetings(r, new Date("2026-10-01T00:00:00.000Z"), UTC, 3).map((m) => m.key)).toEqual(["2026-10-22", "2026-11-05", "2026-11-12"]);
  });

  it("keeps a meeting on screen until it ends", () => {
    const r = stored({});
    const during = new Date("2026-10-22T18:30:00.000Z");
    expect(nextMeetings(r, during, UTC, 1)[0].key).toBe("2026-10-22");
    const after = new Date("2026-10-22T19:00:00.000Z");
    expect(nextMeetings(r, after, UTC, 1)[0].key).toBe("2026-10-29");
  });

  it("keeps its wall-clock time across a daylight change", () => {
    // 18:00 in New York, before and after the clocks go back on 1 November 2026.
    const r = stored({ startsAt: "2026-10-22T22:00:00.000Z" });
    const meetings = nextMeetings(r, new Date("2026-10-21T00:00:00.000Z"), NY, 3);
    for (const m of meetings) {
      const p = civilParts(new Date(m.at), NY);
      expect([p.hour, p.minute], m.key).toEqual([18, 0]);
    }
    expect(meetings.map((m) => m.at)).toEqual(["2026-10-22T22:00:00.000Z", "2026-10-29T22:00:00.000Z", "2026-11-05T23:00:00.000Z"]);
  });

  it("meets at each full moon, on the village's date of it", () => {
    const from = new Date("2026-10-21T00:00:00.000Z");
    const r = stored({ kind: "moon", recurrence: { freq: "lunar", on: "full_moon" }, startsAt: "2026-10-01T18:00:00.000Z" });
    const got = nextMeetings(r, from, UTC, 2);
    const moons = fullMoonsBetween(new Date(from.getTime() - 2 * 86_400_000), new Date(from.getTime() + 120 * 86_400_000));
    const expected = moons
      .map((m) => `${m.toISOString().slice(0, 10)}T18:00:00.000Z`)
      .filter((at) => Date.parse(at) + 60 * 60_000 > from.getTime())
      .slice(0, 2);
    expect(got.map((m) => m.at)).toEqual(expected);
  });

  it("gives a single meeting once, and nothing after it", () => {
    const r = stored({ kind: "once", recurrence: null, startsAt: "2026-10-30T18:00:00.000Z" });
    expect(nextMeetings(r, new Date("2026-10-21T00:00:00.000Z"), UTC, 3).map((m) => m.key)).toEqual(["2026-10-30"]);
    expect(nextMeetings(r, new Date("2026-10-31T00:00:00.000Z"), UTC, 3)).toEqual([]);
  });
});

describe("the words", () => {
  const now = new Date("2026-10-21T12:00:00.000Z");

  it("says when in the village's own words", () => {
    expect(meetingWords(new Date("2026-10-21T18:00:00.000Z"), now, UTC)).toBe("Today at 18:00");
    expect(meetingWords(new Date("2026-10-22T18:00:00.000Z"), now, UTC)).toBe("Tomorrow at 18:00");
    expect(meetingWords(new Date("2026-10-29T18:00:00.000Z"), now, UTC)).toBe("Thursday 29 October at 18:00");
    expect(meetingWords(new Date("2027-01-07T18:00:00.000Z"), now, UTC)).toBe("Thursday 7 January 2027 at 18:00");
    expect(meetingPhrase(new Date("2026-10-22T18:00:00.000Z"), now, UTC)).toBe("tomorrow at 18:00");
    expect(meetingPhrase(new Date("2026-10-29T18:00:00.000Z"), now, UTC)).toBe("on Thursday 29 October at 18:00");
  });

  it("says how a circle meets, and reads back the form it came from", () => {
    expect(rhythmWords(stored({}), UTC)).toBe("Every Thursday at 18:00");
    expect(rhythmWords(stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2 } }), UTC)).toBe("Every 2 weeks on Thursday at 18:00");
    expect(rhythmWords(stored({ kind: "moon", recurrence: { freq: "lunar", on: "new_moon" } }), UTC)).toBe("At each new moon, 18:00");
    expect(rhythmWords(stored({ kind: "once", recurrence: null }), UTC)).toBe("Once, Thursday 22 October at 18:00");
    expect(rhythmAsInput(stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 3 } }), UTC)).toEqual({
      kind: "weekly",
      weekday: 4,
      everyWeeks: 3,
      time: "18:00",
      durationMin: 60,
    });
  });

  it("tells the circle when it meets, with what waits for it", () => {
    expect(RHYTHM_NOTICES.comingUp("Garden", "tomorrow at 18:00")).toBe("The Garden circle meets tomorrow at 18:00");
    expect(RHYTHM_NOTICES.agenda(["Shed roof", "Water rota"], 0)).toBe("On the agenda: Shed roof, Water rota.");
    expect(RHYTHM_NOTICES.agenda(["A", "B", "C"], 2)).toBe("On the agenda: A, B, C, and 2 more.");
    expect(RHYTHM_NOTICES.agenda([], 0)).toBe("Nothing is on the agenda yet. Add an agenda item for it.");
  });
});

describe("who keeps a rhythm", () => {
  it("is the circle's own members and admins", () => {
    expect(mayKeepRhythm("garden", { admin: false, standing: new Set(["garden"]) })).toBe(true);
    expect(mayKeepRhythm("garden", { admin: false, standing: new Set(["kitchen"]) })).toBe(false);
    expect(mayKeepRhythm("garden", { admin: true, standing: new Set() })).toBe(true);
  });
});
