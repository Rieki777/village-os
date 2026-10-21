import { describe, expect, it } from "vitest";
import {
  appliedOption,
  cleanOption,
  cleanOptions,
  clockLabel,
  finalOption,
  liveOptions,
  lockAt,
  mayMove,
  optionLabel,
  overridesWithMoves,
  planWeeklyMoves,
  pollLeader,
  resolvePoll,
  slotStartOnOrAfter,
  stillBeingVoted,
  tallyVotes,
  weeklyLabel,
  weeklyLabelIn,
  type PollOption,
  type PollSnapshot,
  type PollVote,
  type SeriesOccurrence,
} from "./timePoll";

/**
 * The live time vote's rules (the comms build spec 5.10): the tally, the
 * leader and its tie rule, the settle time, the pin, the lock time, the weekly
 * freeze and how a weekly series moves. Every rule that decides where a
 * gathering sits is pinned here, because the routes and the job only carry
 * out what these functions answer.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-06T12:00:00Z");

const once = (id: string, position: number, startsAt: string, extra: Partial<PollOption> = {}): PollOption => ({
  id,
  position,
  startsAt,
  weekday: null,
  startMinute: null,
  durationMinutes: 60,
  removed: false,
  ...extra,
});

const weekly = (id: string, position: number, weekday: number, startMinute: number, extra: Partial<PollOption> = {}): PollOption => ({
  id,
  position,
  startsAt: null,
  weekday,
  startMinute,
  durationMinutes: 90,
  removed: false,
  ...extra,
});

const votes = (pairs: Array<[string, string]>): PollVote[] => pairs.map(([optionId, personKey]) => ({ optionId, personKey }));

const A = once("a", 0, "2026-10-20T18:00:00Z");
const B = once("b", 1, "2026-10-21T18:00:00Z");
const C = once("c", 2, "2026-10-22T18:00:00Z");
const ABC = [A, B, C];

const snapshot = (over: Partial<PollSnapshot> = {}): PollSnapshot => ({
  mode: "once",
  state: "open",
  closesAtMs: null,
  settleMinutes: 0,
  freezeHours: 48,
  pinnedId: null,
  leaderId: null,
  leaderSinceMs: null,
  appliedId: null,
  ...over,
});

describe("liveOptions", () => {
  it("drops removed options and keeps the host's order, breaking a position tie on the id", () => {
    const opts = [once("z", 1, A.startsAt!), once("y", 1, B.startsAt!), once("x", 0, C.startsAt!), once("w", 0, C.startsAt!, { removed: true })];
    expect(liveOptions(opts).map((o) => o.id)).toEqual(["x", "y", "z"]);
  });
});

describe("tallyVotes", () => {
  it("counts one approval per person per time, and every live time appears at zero", () => {
    const t = tallyVotes(ABC, votes([["a", "u1"], ["a", "u2"], ["b", "u1"], ["a", "u1"]]));
    expect(t.counts).toEqual({ a: 2, b: 1, c: 0 });
    expect(t.voters).toBe(2);
  });

  it("ignores a vote for a time taken off the poll, and for a time it never offered", () => {
    const removedB = [A, { ...B, removed: true }, C];
    const t = tallyVotes(removedB, votes([["b", "u1"], ["zz", "u2"], ["c", "u3"]]));
    expect(t.counts).toEqual({ a: 0, c: 1 });
    expect(t.voters).toBe(1);
  });

  it("counts a guest's key the same as a member's", () => {
    expect(tallyVotes(ABC, votes([["b", "guest:ct_1"], ["b", "u9"]])).counts.b).toBe(2);
  });
});

describe("pollLeader", () => {
  it("is the time with the most approvals", () => {
    expect(pollLeader({ a: 1, b: 3, c: 2 }, ABC, null)).toBe("b");
  });

  it("keeps the current leader through a tie", () => {
    expect(pollLeader({ a: 2, b: 2, c: 0 }, ABC, "b")).toBe("b");
    expect(pollLeader({ a: 2, b: 2, c: 2 }, ABC, "c")).toBe("c");
  });

  it("gives a tie that leaves the current leader behind to the time listed first", () => {
    expect(pollLeader({ a: 0, b: 2, c: 2 }, ABC, "a")).toBe("b");
    expect(pollLeader({ a: 0, b: 2, c: 2 }, [A, { ...B, position: 5 }, C], "a")).toBe("c");
  });

  it("puts the first time on offer in the lead when nobody has voted, whoever led before", () => {
    expect(pollLeader({ a: 0, b: 0, c: 0 }, ABC, "c")).toBe("a");
    expect(pollLeader({}, [{ ...A, removed: true }, B, C], null)).toBe("b");
  });

  it("is null only when nothing is on offer", () => {
    expect(pollLeader({}, [{ ...A, removed: true }], null)).toBeNull();
  });
});

describe("appliedOption", () => {
  const base = { pinnedId: null, leaderId: "b", leaderSinceMs: NOW, settleMinutes: 0, appliedId: "a", nowMs: NOW, options: ABC };

  it("follows the leader at once when the settle time is zero", () => {
    expect(appliedOption(base)).toBe("b");
  });

  it("waits the settle time before following a new leader, to the minute", () => {
    const settle = { ...base, settleMinutes: 60 };
    expect(appliedOption({ ...settle, nowMs: NOW + 59 * MIN })).toBe("a");
    expect(appliedOption({ ...settle, nowMs: NOW + 60 * MIN })).toBe("b");
  });

  it("lets the pin beat the vote, and ignores a pin taken off the poll", () => {
    expect(appliedOption({ ...base, pinnedId: "c" })).toBe("c");
    expect(appliedOption({ ...base, pinnedId: "c", settleMinutes: 600 })).toBe("c");
    expect(appliedOption({ ...base, pinnedId: "c", options: [A, B, { ...C, removed: true }] })).toBe("b");
  });

  it("keeps the time last applied when no leader has earned the move, even one since removed", () => {
    expect(appliedOption({ ...base, leaderSinceMs: null })).toBe("a");
    expect(appliedOption({ ...base, settleMinutes: 30, options: [{ ...A, removed: true }, B, C] })).toBe("a");
    expect(appliedOption({ ...base, leaderSinceMs: null, appliedId: null })).toBeNull();
  });
});

describe("finalOption", () => {
  it("is the pin, else the leader, whatever the settle time", () => {
    expect(finalOption("c", "b", ABC)).toBe("c");
    expect(finalOption(null, "b", ABC)).toBe("b");
    expect(finalOption("c", "b", [A, B, { ...C, removed: true }])).toBe("b");
    expect(finalOption(null, null, ABC)).toBeNull();
  });
});

describe("lockAt", () => {
  it("defaults a one-off vote to the freeze before its earliest time on offer", () => {
    expect(lockAt("once", null, ABC, 48)).toBe(Date.parse(A.startsAt!) - 48 * HOUR);
    expect(lockAt("once", null, [{ ...A, removed: true }, B, C], 24)).toBe(Date.parse(B.startsAt!) - 24 * HOUR);
  });

  it("uses the host's own close time when there is one", () => {
    expect(lockAt("once", NOW + HOUR, ABC, 48)).toBe(NOW + HOUR);
  });

  it("never locks a weekly vote by itself, and has no time for a poll with nothing on offer", () => {
    expect(lockAt("weekly", NOW, [weekly("w", 0, 2, 1080)], 48)).toBeNull();
    expect(lockAt("once", null, [], 48)).toBeNull();
  });
});

describe("resolvePoll", () => {
  it("records the first leader with the clock it was read on, and moves the gathering to it at settle zero", () => {
    const r = resolvePoll(snapshot(), ABC, [], NOW);
    expect(r).toMatchObject({ leaderId: "a", leaderSinceMs: NOW, leaderChanged: true, appliedId: "a", appliedChanged: true, dueToLock: false });
  });

  it("keeps the leader's start while it keeps the lead, so the settle time can run out", () => {
    const s = snapshot({ leaderId: "b", leaderSinceMs: NOW - 61 * MIN, appliedId: "a", settleMinutes: 60 });
    const r = resolvePoll(s, ABC, votes([["b", "u1"]]), NOW);
    expect(r).toMatchObject({ leaderId: "b", leaderSinceMs: NOW - 61 * MIN, leaderChanged: false, appliedId: "b", appliedChanged: true });
  });

  it("starts the clock again for a new leader, so it waits its own settle time", () => {
    const s = snapshot({ leaderId: "a", leaderSinceMs: NOW - 5 * HOUR, appliedId: "a", settleMinutes: 60 });
    const r = resolvePoll(s, ABC, votes([["c", "u1"], ["c", "u2"], ["a", "u3"]]), NOW);
    expect(r).toMatchObject({ leaderId: "c", leaderSinceMs: NOW, leaderChanged: true, appliedId: "a", appliedChanged: false });
  });

  it("keeps the current time through a tie with the leader", () => {
    const s = snapshot({ leaderId: "b", leaderSinceMs: NOW - HOUR, appliedId: "b" });
    const r = resolvePoll(s, ABC, votes([["b", "u1"], ["c", "u2"]]), NOW);
    expect(r).toMatchObject({ leaderId: "b", appliedId: "b", appliedChanged: false, leaderChanged: false });
  });

  it("is due to lock at its lock time, and not a minute before", () => {
    const lock = Date.parse(A.startsAt!) - 48 * HOUR;
    expect(resolvePoll(snapshot(), ABC, [], lock - MIN).dueToLock).toBe(false);
    expect(resolvePoll(snapshot(), ABC, [], lock).dueToLock).toBe(true);
  });

  it("leaves a locked poll where it is, whatever the votes say", () => {
    const s = snapshot({ state: "locked", leaderId: "a", leaderSinceMs: NOW - HOUR, appliedId: "a" });
    const r = resolvePoll(s, ABC, votes([["c", "u1"]]), NOW + 1000 * HOUR);
    expect(r).toMatchObject({ appliedId: "a", appliedChanged: false, dueToLock: false });
  });
});

describe("stillBeingVoted", () => {
  const openOnce = { state: "open" as const, mode: "once" as const, freezeHours: 48 };
  const openWeekly = { state: "open" as const, mode: "weekly" as const, freezeHours: 48 };

  it("holds a one-off gathering's emails for as long as its vote is open", () => {
    expect(stillBeingVoted(openOnce, NOW + HOUR, NOW)).toBe(true);
    expect(stillBeingVoted({ ...openOnce, state: "locked" }, NOW + 500 * HOUR, NOW)).toBe(false);
    expect(stillBeingVoted(null, null, NOW)).toBe(false);
  });

  it("lets a weekly evening's emails go once it is inside the freeze, where it can no longer move", () => {
    expect(stillBeingVoted(openWeekly, NOW + 48 * HOUR + MIN, NOW)).toBe(true);
    expect(stillBeingVoted(openWeekly, NOW + 48 * HOUR, NOW)).toBe(false);
    expect(stillBeingVoted(openWeekly, NOW + HOUR, NOW)).toBe(false);
    expect(stillBeingVoted(openWeekly, null, NOW)).toBe(true);
  });
});

describe("slotStartOnOrAfter", () => {
  it("keeps the day when it already has the slot's weekday, and changes only the hour", () => {
    // 2026-10-13 is a Tuesday.
    expect(slotStartOnOrAfter("2026-10-13", { weekday: 2, startMinute: 18 * 60 }, "UTC").toISOString()).toBe("2026-10-13T18:00:00.000Z");
  });

  it("moves to the first day with the weekday on or after the evening's own date, never before it", () => {
    expect(slotStartOnOrAfter("2026-10-13", { weekday: 3, startMinute: 19 * 60 + 30 }, "UTC").toISOString()).toBe("2026-10-14T19:30:00.000Z");
    expect(slotStartOnOrAfter("2026-10-13", { weekday: 1, startMinute: 9 * 60 }, "UTC").toISOString()).toBe("2026-10-19T09:00:00.000Z");
    expect(slotStartOnOrAfter("2026-10-13", { weekday: 0, startMinute: 0 }, "UTC").toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("keeps village wall-clock time across a daylight change", () => {
    const slot = { weekday: 2, startMinute: 18 * 60 };
    expect(slotStartOnOrAfter("2026-10-27", slot, "America/Los_Angeles").toISOString()).toBe("2026-10-28T01:00:00.000Z");
    expect(slotStartOnOrAfter("2026-11-03", slot, "America/Los_Angeles").toISOString()).toBe("2026-11-04T02:00:00.000Z");
  });
});

describe("mayMove", () => {
  it("moves an evening only when where it is and where it goes are both beyond the freeze", () => {
    const edge = NOW + 48 * HOUR;
    expect(mayMove(edge + MIN, edge + HOUR, NOW, 48)).toBe(true);
    expect(mayMove(edge, edge + HOUR, NOW, 48)).toBe(false);
    expect(mayMove(edge + HOUR, edge, NOW, 48)).toBe(false);
    expect(mayMove(NOW + HOUR, NOW + 2 * HOUR, NOW, 0)).toBe(true);
  });
});

describe("planWeeklyMoves", () => {
  // A Tuesday series at 18:00 UTC; the vote moves it to Wednesdays at 19:00.
  const tue = (key: string): SeriesOccurrence => {
    const at = new Date(`${key}T18:00:00Z`);
    return { key, startsAt: at, ruleStartsAt: at, cancelled: false };
  };
  const target = { weekday: 3, startMinute: 19 * 60, durationMinutes: 90 };
  const known = [{ weekday: 2, startMinute: 18 * 60 }, { weekday: 3, startMinute: 19 * 60 }];
  const plan = (occurrences: SeriesOccurrence[], nowMs = NOW) =>
    planWeeklyMoves({ occurrences, target, known, nowMs, freezeHours: 48, timeZone: "UTC" });

  it("never moves an evening inside the freeze, and moves every evening beyond it", () => {
    // NOW is Tuesday 2026-10-06 at noon: the 6th is inside the freeze, the 13th and 20th are not.
    const moves = plan([tue("2026-10-06"), tue("2026-10-13"), tue("2026-10-20")]);
    expect(moves.map((m) => [m.key, m.to.toISOString(), m.toEnd.toISOString()])).toEqual([
      ["2026-10-13", "2026-10-14T19:00:00.000Z", "2026-10-14T20:30:00.000Z"],
      ["2026-10-20", "2026-10-21T19:00:00.000Z", "2026-10-21T20:30:00.000Z"],
    ]);
  });

  it("does not move an evening INTO the freeze either", () => {
    // Sunday evening: Tuesday the 13th is 48 hours away plus a bit, and a Monday slot would land inside.
    const sunday = Date.parse("2026-10-11T17:00:00Z");
    const toMonday = planWeeklyMoves({
      occurrences: [tue("2026-10-13")],
      target: { weekday: 1, startMinute: 8 * 60, durationMinutes: 60 },
      known,
      nowMs: sunday,
      freezeHours: 48,
      timeZone: "UTC",
    });
    // On or after the 13th: Monday the 19th, outside the freeze, so it moves.
    expect(toMonday.map((m) => m.to.toISOString())).toEqual(["2026-10-19T08:00:00.000Z"]);
    const toTuesdayMorning = planWeeklyMoves({
      occurrences: [tue("2026-10-13")],
      target: { weekday: 2, startMinute: 8 * 60, durationMinutes: 60 },
      known,
      nowMs: Date.parse("2026-10-11T09:00:00Z"),
      freezeHours: 48,
      timeZone: "UTC",
    });
    // Tuesday 08:00 is 47 hours away from Sunday 09:00: inside the freeze, so the evening stays.
    expect(toTuesdayMorning).toEqual([]);
  });

  it("leaves a cancelled evening, an evening already there, and an evening a person moved by hand", () => {
    const cancelled = { ...tue("2026-10-13"), cancelled: true };
    const already = { ...tue("2026-10-20"), startsAt: new Date("2026-10-21T19:00:00Z") };
    const byHand = { ...tue("2026-10-27"), startsAt: new Date("2026-10-29T10:00:00Z") };
    expect(plan([cancelled, already, byHand])).toEqual([]);
  });

  it("moves an evening the vote moved before, and plans nothing twice", () => {
    const earlier = { ...tue("2026-10-20"), startsAt: new Date("2026-10-20T18:00:00Z") };
    const votedThursday = { ...tue("2026-10-27"), startsAt: new Date("2026-10-29T19:00:00Z") };
    const thursdayKnown = [...known, { weekday: 4, startMinute: 19 * 60 }];
    const moves = planWeeklyMoves({ occurrences: [earlier, votedThursday], target, known: thursdayKnown, nowMs: NOW, freezeHours: 48, timeZone: "UTC" });
    expect(moves.map((m) => m.key)).toEqual(["2026-10-20", "2026-10-27"]);
    const after = [earlier, votedThursday].map((o) => ({ ...o, startsAt: moves.find((m) => m.key === o.key)!.to }));
    expect(planWeeklyMoves({ occurrences: after, target, known: thursdayKnown, nowMs: NOW, freezeHours: 48, timeZone: "UTC" })).toEqual([]);
  });
});

describe("overridesWithMoves", () => {
  const ruleOf = (key: string) => ({ startsAt: new Date(`${key}T18:00:00Z`), endsAt: new Date(`${key}T19:30:00Z`) });

  it("writes the new start and end, and keeps a title or a cancellation a host set", () => {
    const out = overridesWithMoves(
      { "2026-10-13": { title: "Harvest night" }, "2026-10-27": { cancelled: true } },
      [{ key: "2026-10-13", from: new Date("2026-10-13T18:00:00Z"), to: new Date("2026-10-14T19:00:00Z"), toEnd: new Date("2026-10-14T20:30:00Z") }],
      ruleOf,
    );
    expect(out).toEqual({
      "2026-10-13": { title: "Harvest night", startsAt: "2026-10-14T19:00:00.000Z", endsAt: "2026-10-14T20:30:00.000Z" },
      "2026-10-27": { cancelled: true },
    });
  });

  it("clears an evening moved back onto its own rule, and drops an override left empty", () => {
    const out = overridesWithMoves(
      { "2026-10-13": { startsAt: "2026-10-14T19:00:00.000Z", endsAt: "2026-10-14T20:30:00.000Z" }, "2026-10-20": { title: "Kept", startsAt: "2026-10-21T19:00:00.000Z" } },
      [
        { key: "2026-10-13", from: new Date("2026-10-14T19:00:00Z"), to: new Date("2026-10-13T18:00:00Z"), toEnd: new Date("2026-10-13T19:30:00Z") },
        { key: "2026-10-20", from: new Date("2026-10-21T19:00:00Z"), to: new Date("2026-10-20T18:00:00Z"), toEnd: new Date("2026-10-20T19:30:00Z") },
      ],
      ruleOf,
    );
    expect(out).toEqual({ "2026-10-20": { title: "Kept" } });
  });

  it("does not change the object it was handed", () => {
    const existing = { "2026-10-13": { title: "Kept" } };
    overridesWithMoves(existing, [{ key: "2026-10-13", from: new Date(0), to: new Date("2026-10-14T19:00:00Z"), toEnd: new Date("2026-10-14T20:00:00Z") }], ruleOf);
    expect(existing).toEqual({ "2026-10-13": { title: "Kept" } });
  });
});

describe("words", () => {
  it("writes a clock and a weekly time the way the emails read", () => {
    expect(clockLabel(18 * 60)).toBe("6:00 PM");
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(12 * 60 + 30)).toBe("12:30 PM");
    expect(weeklyLabel({ weekday: 2, startMinute: 18 * 60 })).toBe("Tuesdays at 6:00 PM");
    expect(weeklyLabel({ weekday: 0, startMinute: 9 * 60 + 5 })).toBe("Sundays at 9:05 AM");
  });

  it("writes a one-off time in village time through the emails' own formatter", () => {
    expect(optionLabel(A, "UTC")).toBe("Tuesday, October 20 at 6:00 PM");
    expect(optionLabel(A, "America/Los_Angeles")).toBe("Tuesday, October 20 at 11:00 AM");
    expect(optionLabel(weekly("w", 0, 3, 19 * 60), "UTC")).toBe("Wednesdays at 7:00 PM");
  });

  it("says what a weekly time is in another zone, day and all", () => {
    expect(weeklyLabelIn(new Date("2026-10-14T02:00:00Z"), "America/Los_Angeles")).toBe("Tuesdays at 7:00 PM");
    expect(weeklyLabelIn(new Date("2026-10-14T19:00:00Z"), "Asia/Tokyo")).toBe("Thursdays at 4:00 AM");
  });
});

describe("cleanOption and cleanOptions", () => {
  it("takes a future one-off time with a duration, and defaults the duration to an hour", () => {
    expect(cleanOption("once", { startsAt: "2026-10-20T18:00:00Z", durationMinutes: 90 }, NOW)).toEqual({
      ok: true,
      option: { startsAt: "2026-10-20T18:00:00.000Z", weekday: null, startMinute: null, durationMinutes: 90 },
    });
    expect(cleanOption("once", { startsAt: "2026-10-20T18:00:00Z" }, NOW)).toMatchObject({ ok: true, option: { durationMinutes: 60 } });
  });

  it("refuses a time in the past, a time that is not a time, and a duration out of bounds", () => {
    expect(cleanOption("once", { startsAt: "2026-10-01T18:00:00Z" }, NOW)).toEqual({ ok: false, error: "Each time has to be in the future." });
    expect(cleanOption("once", { startsAt: "soon" }, NOW)).toMatchObject({ ok: false });
    expect(cleanOption("once", { startsAt: "2026-10-20T18:00:00Z", durationMinutes: 5 }, NOW)).toMatchObject({ ok: false });
    expect(cleanOption("once", { startsAt: "2026-10-20T18:00:00Z", durationMinutes: 25 * 60 }, NOW)).toMatchObject({ ok: false });
    expect(cleanOption("once", { startsAt: "2026-10-20T18:00:00Z", durationMinutes: 30.5 }, NOW)).toMatchObject({ ok: false });
  });

  it("takes a weekly slot as a weekday and a minute, and refuses one out of range", () => {
    expect(cleanOption("weekly", { weekday: 3, startMinute: 1140 }, NOW)).toEqual({
      ok: true,
      option: { startsAt: null, weekday: 3, startMinute: 1140, durationMinutes: 60 },
    });
    expect(cleanOption("weekly", { weekday: 7, startMinute: 60 }, NOW)).toMatchObject({ ok: false });
    expect(cleanOption("weekly", { weekday: 2, startMinute: 1440 }, NOW)).toMatchObject({ ok: false });
    expect(cleanOption("weekly", { weekday: "", startMinute: 60 }, NOW)).toMatchObject({ ok: false });
  });

  it("holds a vote to two to eight times, none offered twice", () => {
    const at = (h: number) => ({ startsAt: new Date(NOW + h * HOUR).toISOString() });
    expect(cleanOptions("once", [at(100)], NOW)).toEqual({ ok: false, error: "Offer at least 2 times." });
    expect(cleanOptions("once", Array.from({ length: 9 }, (_, i) => at(100 + i)), NOW)).toEqual({ ok: false, error: "A vote can offer at most 8 times." });
    expect(cleanOptions("once", [at(100), at(100)], NOW)).toEqual({ ok: false, error: "That time is already on the vote." });
    expect(cleanOptions("weekly", [{ weekday: 2, startMinute: 60 }, { weekday: 2, startMinute: 60 }], NOW)).toMatchObject({ ok: false });
    expect(cleanOptions("once", [at(100), at(101)], NOW)).toMatchObject({ ok: true });
  });

  it("counts the times already on the vote when the host adds more", () => {
    const already = [{ startsAt: new Date(NOW + 100 * HOUR).toISOString(), weekday: null, startMinute: null }];
    expect(cleanOptions("once", [{ startsAt: new Date(NOW + 100 * HOUR).toISOString() }], NOW, already)).toEqual({ ok: false, error: "That time is already on the vote." });
    expect(cleanOptions("once", [{ startsAt: new Date(NOW + 101 * HOUR).toISOString() }], NOW, already)).toMatchObject({ ok: true });
  });
});
