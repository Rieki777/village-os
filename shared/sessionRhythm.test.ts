/**
 * A circle's rhythm, without a database: reading a body, the first meeting a
 * rhythm stores, the next meetings it gives (weekly with an interval, across a
 * daylight change, skipped dates, the moon, a single date), a change that
 * keeps the circle's week and its skips, and the words a member reads. The
 * same rules run against a real schema in server/sessionRhythm.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { civilParts, fullMoonsBetween, newMoonsBetween } from "./lunar";
import { SESSION_LIMITS, SESSION_REFUSALS } from "./sessions";
import {
  RHYTHM_COPY,
  RHYTHM_NOTICES,
  RHYTHM_REFUSALS,
  cleanRhythm,
  keptSkips,
  mayKeepRhythm,
  meetingPhrase,
  meetingWords,
  nextMeetings,
  phraseOf,
  rhythmAsInput,
  rhythmRecord,
  rhythmWords,
  type RhythmInput,
  type StoredRhythm,
} from "./sessionRhythm";

const UTC = "UTC";
const NY = "America/New_York";

const stored = (over: Partial<StoredRhythm>): StoredRhythm => ({
  circleId: "garden",
  kind: "weekly",
  recurrence: { freq: "weekly", byWeekday: [4], interval: 1 },
  startsOn: "2026-10-22",
  time: "18:00",
  durationMin: 60,
  ...over,
});

/** What a rhythm input stores, as a stored rhythm, or the refusal's words. */
const record = (input: Exclude<RhythmInput, { kind: "none" }>, now: Date, zone = UTC): StoredRhythm | string => {
  const out = rhythmRecord(input, now, zone);
  return out.ok ? { circleId: "garden", ...out.value } : out.error;
};
const asStored = (r: StoredRhythm | string): StoredRhythm => {
  if (typeof r === "string") throw new Error(r);
  return r;
};

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
    const thursday = asStored(record({ kind: "weekly", weekday: 4, everyWeeks: 1, time: "18:00" }, now));
    expect([thursday.startsOn, thursday.time]).toEqual(["2026-10-22", "18:00"]);
    const today = asStored(record({ kind: "weekly", weekday: 3, everyWeeks: 1, time: "18:00" }, now));
    expect(nextMeetings(today, now, UTC, 1)[0].at).toBe("2026-10-21T18:00:00.000Z");
    // Today's time already over: the first meeting is the week after.
    const gone = asStored(record({ kind: "weekly", weekday: 3, everyWeeks: 1, time: "09:00", durationMin: 60 }, now));
    expect(nextMeetings(gone, now, UTC, 1)[0].at).toBe("2026-10-28T09:00:00.000Z");
  });

  it("waits for a later start date, and keeps the calendar's own recurrence shape", () => {
    const later = asStored(record({ kind: "weekly", weekday: 4, everyWeeks: 2, time: "18:00", startsOn: "2026-11-10" }, now));
    expect(later.startsOn).toBe("2026-11-12");
    expect(later.recurrence).toEqual({ freq: "weekly", byWeekday: [4], interval: 2 });
  });

  it("refuses a single meeting already over, and keeps one still to come", () => {
    expect(record({ kind: "once", on: "2026-10-20", time: "18:00" }, now)).toBe(RHYTHM_REFUSALS.past);
    expect(nextMeetings(asStored(record({ kind: "once", on: "2026-10-30", time: "18:00" }, now)), now, UTC, 1)[0].at).toBe("2026-10-30T18:00:00.000Z");
  });

  it("refuses a first meeting further ahead than Coming up looks, so a saved rhythm always shows", () => {
    expect(record({ kind: "weekly", weekday: 1, everyWeeks: 1, time: "18:00", startsOn: "2027-03-01" }, now)).toBe(RHYTHM_REFUSALS.tooFar);
    expect(record({ kind: "once", on: "2027-03-01", time: "18:00" }, now)).toBe(RHYTHM_REFUSALS.tooFar);
    // The last day it looks ahead is still a first meeting it shows.
    const edge = asStored(record({ kind: "once", on: "2027-02-18", time: "18:00" }, now));
    expect(nextMeetings(edge, now, UTC, 1).map((m) => m.key)).toEqual(["2027-02-18"]);
  });

  it("meets on the village's date of the next new moon, at the chosen time", () => {
    const r = asStored(record({ kind: "moon", on: "new_moon", time: "19:30" }, now));
    const moon = newMoonsBetween(new Date(now.getTime() - 2 * 86_400_000), new Date(now.getTime() + 62 * 86_400_000)).find(
      (m) => Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate(), 19, 30) + 60 * 60_000 > now.getTime(),
    )!;
    expect(nextMeetings(r, now, UTC, 1)[0].at).toBe(`${moon.toISOString().slice(0, 10)}T19:30:00.000Z`);
  });
});

describe("changing a rhythm", () => {
  // Every other Thursday from 22 October: 22 October, 5 November, 19 November.
  const fortnight = stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2 } });

  it("keeps the circle's week when only the length changes, on any day of the off week", () => {
    for (const day of ["2026-10-23", "2026-10-26", "2026-10-28"]) {
      const now = new Date(`${day}T12:00:00.000Z`);
      const before = nextMeetings(fortnight, now, UTC, 3).map((m) => m.key);
      expect(before, day).toEqual(["2026-11-05", "2026-11-19", "2026-12-03"]);
      // What the Change form opens with: the rhythm as it is, starting from its next meeting.
      const form = rhythmAsInput(fortnight, before[0]);
      expect(form).toMatchObject({ kind: "weekly", startsOn: "2026-11-05" });
      const changed = asStored(record({ ...(form as Extract<RhythmInput, { kind: "weekly" }>), durationMin: 90 }, now));
      expect(nextMeetings(changed, now, UTC, 3).map((m) => m.key), day).toEqual(before);
    }
  });

  it("keeps the skipped dates still among its next meetings, and lets go of those no meeting falls on", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const skipped = { freq: "weekly" as const, byWeekday: [4], interval: 1, exceptions: ["2026-10-29", "2026-11-05"] };
    const sameDay = asStored(record({ kind: "weekly", weekday: 4, everyWeeks: 1, time: "19:00" }, now));
    expect(keptSkips(skipped, sameDay, now, UTC)).toEqual(["2026-10-29", "2026-11-05"]);
    const tuesday = asStored(record({ kind: "weekly", weekday: 2, everyWeeks: 1, time: "19:00" }, now));
    expect(keptSkips(skipped, tuesday, now, UTC)).toEqual([]);
    expect(keptSkips(null, sameDay, now, UTC)).toEqual([]);
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
    const r = stored({});
    const meetings = nextMeetings(r, new Date("2026-10-21T00:00:00.000Z"), NY, 3);
    for (const m of meetings) {
      const p = civilParts(new Date(m.at), NY);
      expect([p.hour, p.minute], m.key).toEqual([18, 0]);
    }
    expect(meetings.map((m) => m.at)).toEqual(["2026-10-22T22:00:00.000Z", "2026-10-29T22:00:00.000Z", "2026-11-05T23:00:00.000Z"]);
  });

  it("keeps the chosen time when the first meeting falls in the hour the clocks skip", () => {
    // 14 March 2027 in New York has no 02:30. That one meeting moves; the rhythm stays at 02:30.
    const r = asStored(record({ kind: "weekly", weekday: 0, everyWeeks: 1, time: "02:30", startsOn: "2027-03-14" }, new Date("2027-03-01T12:00:00.000Z"), NY));
    expect(rhythmWords(r)).toBe("Every Sunday at 02:30");
    const later = nextMeetings(r, new Date("2027-03-15T00:00:00.000Z"), NY, 2);
    for (const m of later) {
      const p = civilParts(new Date(m.at), NY);
      expect([p.hour, p.minute], m.key).toEqual([2, 30]);
    }
  });

  it("keeps the day and the time when the village moves to another zone", () => {
    const from = new Date("2026-10-21T00:00:00.000Z");
    for (const zone of ["America/Los_Angeles", "Pacific/Auckland"]) {
      const [m] = nextMeetings(stored({ time: "19:00" }), from, zone, 1);
      const p = civilParts(new Date(m.at), zone);
      expect([m.key, p.weekday, p.hour], zone).toEqual(["2026-10-22", 4, 19]);
    }
  });

  it("meets at each full moon, on the village's date of it", () => {
    const from = new Date("2026-10-21T00:00:00.000Z");
    const r = stored({ kind: "moon", recurrence: { freq: "lunar", on: "full_moon" }, startsOn: "2026-10-01" });
    const got = nextMeetings(r, from, UTC, 2);
    const moons = fullMoonsBetween(new Date(from.getTime() - 2 * 86_400_000), new Date(from.getTime() + 120 * 86_400_000));
    const expected = moons
      .map((m) => `${m.toISOString().slice(0, 10)}T18:00:00.000Z`)
      .filter((at) => Date.parse(at) + 60 * 60_000 > from.getTime())
      .slice(0, 2);
    expect(got.map((m) => m.at)).toEqual(expected);
  });

  it("gives a single meeting once, and nothing after it", () => {
    const r = stored({ kind: "once", recurrence: null, startsOn: "2026-10-30" });
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
    expect(RHYTHM_COPY.skipped("Garden", phraseOf("Thursday 5 November at 18:00"))).toBe("Skipped. The next Garden circle meeting is on Thursday 5 November at 18:00.");
  });

  it("says how a circle meets, and reads back the form it came from", () => {
    expect(rhythmWords(stored({}))).toBe("Every Thursday at 18:00");
    expect(rhythmWords(stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 2 } }))).toBe("Every 2 weeks on Thursday at 18:00");
    expect(rhythmWords(stored({ kind: "moon", recurrence: { freq: "lunar", on: "new_moon" } }))).toBe("At each new moon, 18:00");
    expect(rhythmWords(stored({ kind: "once", recurrence: null }), now, UTC)).toBe("Once, Thursday 22 October at 18:00");
    expect(rhythmWords(stored({ kind: "once", recurrence: null, startsOn: "2027-01-07" }), now, UTC)).toBe("Once, Thursday 7 January 2027 at 18:00");
    expect(rhythmAsInput(stored({ recurrence: { freq: "weekly", byWeekday: [4], interval: 3 } }))).toEqual({
      kind: "weekly",
      weekday: 4,
      everyWeeks: 3,
      time: "18:00",
      durationMin: 60,
    });
    expect(rhythmAsInput(stored({}), "2026-10-29")).toMatchObject({ startsOn: "2026-10-29" });
    expect(rhythmAsInput(stored({ kind: "once", recurrence: null }), "2026-10-22")).toEqual({ kind: "once", on: "2026-10-22", time: "18:00", durationMin: 60 });
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
