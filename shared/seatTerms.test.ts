/**
 * Every seat has a term, and by default it ends with the season. The rulings
 * this holds are quoted in shared/seatTerms.ts; each block below names the one
 * it proves.
 */
import { describe, expect, it } from "vitest";
import {
  CAUTION_MOONS,
  cautionLine,
  civilDateInstant,
  resolveSeatTerm,
  restampsFor,
  type SeatCalendar,
} from "./seatTerms";
import { cycleBoundsFor, cycleStartMs } from "./lunar";

const NOW = new Date("2026-09-14T12:00:00Z");

/** A village on the solar pattern, with the running autumn and a year ahead. */
const SOLAR: SeatCalendar = {
  timezone: "UTC",
  currentSeasonId: "autumn-2026",
  seasons: [
    { id: "summer-2026", startsOn: "2026-06-21", endsOn: "2026-09-22" },
    { id: "autumn-2026", startsOn: "2026-09-22", endsOn: "2026-12-21" },
    { id: "winter-2026", startsOn: "2026-12-21", endsOn: "2027-03-20" },
    { id: "spring-2027", startsOn: "2027-03-20", endsOn: "2027-06-21" },
    { id: "summer-2027", startsOn: "2027-06-21", endsOn: "2027-09-23" },
  ],
};

describe("rule 1: with no date asked, the seat ends when the season ends", () => {
  it("ends at the first moment of the day the season turns, and follows it", () => {
    const t = resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.endsOn).toBe("2026-12-21");
    expect(t.endsAt.toISOString()).toBe("2026-12-21T00:00:00.000Z");
    expect(t.seasonId).toBe("autumn-2026");
    expect(t.followsSeason).toBe(true);
    expect(t.caution).toBeNull();
  });

  it("lands on the village's own midnight, not UTC's", () => {
    const t = resolveSeatTerm({ calendar: { ...SOLAR, timezone: "America/Los_Angeles" }, capAtSeasonEnd: false, now: NOW });
    expect(t.ok && t.endsAt.toISOString()).toBe("2026-12-21T08:00:00.000Z");
  });

  it("refuses, with a sentence, when no season runs or the season never ends", () => {
    const none = resolveSeatTerm({ calendar: { ...SOLAR, currentSeasonId: null }, capAtSeasonEnd: false, now: NOW });
    expect(none.ok || none.code).toBe("no_season");
    const open = resolveSeatTerm({
      calendar: { ...SOLAR, seasons: SOLAR.seasons.map((s) => (s.id === "autumn-2026" ? { ...s, endsOn: "" } : s)) },
      capAtSeasonEnd: false,
      now: NOW,
    });
    expect(open.ok || open.code).toBe("open_ended_season");
    // Both name the two ways out, so an admin is never left guessing.
    if (!open.ok) expect(open.error).toContain("its own end date");
  });

  it("an explicit date needs no season at all for an ordinary seat", () => {
    const t = resolveSeatTerm({
      requestedEndsOn: "2027-01-15",
      calendar: { ...SOLAR, currentSeasonId: null },
      capAtSeasonEnd: false,
      now: NOW,
    });
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.followsSeason).toBe(false);
      expect(t.seasonId).toBeNull();
    }
  });
});

describe("rule 2: a steward's seat ends with the season at the latest", () => {
  it("accepts the season's end and anything earlier", () => {
    expect(resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: true, now: NOW }).ok).toBe(true);
    const shorter = resolveSeatTerm({ requestedEndsOn: "2026-11-01", calendar: SOLAR, capAtSeasonEnd: true, now: NOW });
    expect(shorter.ok).toBe(true);
    if (shorter.ok) expect(shorter.followsSeason, "a shorter seat is its own date").toBe(false);
  });

  it("refuses one day past the season, and names the season's end", () => {
    const t = resolveSeatTerm({ requestedEndsOn: "2026-12-22", calendar: SOLAR, capAtSeasonEnd: true, now: NOW });
    expect(t.ok || t.code).toBe("past_season_end");
    if (!t.ok) expect(t.error).toContain("2026-12-21");
  });

  it("refuses even an early date when the season has no end, because the cap has nothing to hold to", () => {
    const t = resolveSeatTerm({
      requestedEndsOn: "2026-10-01",
      calendar: { ...SOLAR, seasons: SOLAR.seasons.map((s) => (s.id === "autumn-2026" ? { ...s, endsOn: "" } : s)) },
      capAtSeasonEnd: true,
      now: NOW,
    });
    expect(t.ok || t.code).toBe("open_ended_season");
  });
});

describe("rule 3: any length is allowed, and a long one carries a caution that never blocks", () => {
  it("measures by the schedule when it reaches four seasons ahead", () => {
    const line = cautionLine(SOLAR, NOW);
    expect(line.measure).toBe("seasons");
    // The running autumn is the first; summer 2027 is the fourth.
    expect(line.at.toISOString()).toBe("2027-09-23T00:00:00.000Z");
    const within = resolveSeatTerm({ requestedEndsOn: "2027-09-23", calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
    expect(within.ok && within.caution).toBeNull();
    const past = resolveSeatTerm({ requestedEndsOn: "2027-09-24", calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
    expect(past.ok).toBe(true);
    if (past.ok) expect(past.caution).toContain("fourth season");
  });

  it("measures in moons when the schedule stops short", () => {
    const short: SeatCalendar = { ...SOLAR, seasons: SOLAR.seasons.slice(0, 3) };
    const line = cautionLine(short, NOW);
    expect(line.measure).toBe("moons");
    const expected = Math.ceil(cycleStartMs(cycleBoundsFor(NOW).cycleNumber + CAUTION_MOONS));
    expect(line.at.getTime()).toBe(expected);
    const t = resolveSeatTerm({ requestedEndsOn: "2028-06-01", calendar: short, capAtSeasonEnd: false, now: NOW });
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.caution).toContain("thirteen moons");
  });

  it("says many seasons is allowed: a ten-year seat is accepted, with its caution", () => {
    const t = resolveSeatTerm({ requestedEndsOn: "2036-09-14", calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.caution).not.toBeNull();
  });
});

describe("dates that cannot be a term", () => {
  it("refuses a date the calendar does not have, and anything that is not a date", () => {
    for (const bad of ["2027-02-30", "2027-13-01", "next spring", "21/12/2026", "2026-12-21T00:00:00Z"]) {
      const t = resolveSeatTerm({ requestedEndsOn: bad, calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
      expect(t.ok || t.code, bad).toBe("unreadable_date");
    }
    expect(civilDateInstant("2028-02-29", "UTC")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("treats blank, null and undefined as 'with the season'", () => {
    for (const blank of ["", "   ", null, undefined]) {
      const t = resolveSeatTerm({ requestedEndsOn: blank, calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
      expect(t.ok && t.followsSeason, String(blank)).toBe(true);
    }
  });

  it("refuses a date already past, and one before the vote could land", () => {
    const past = resolveSeatTerm({ requestedEndsOn: "2026-09-01", calendar: SOLAR, capAtSeasonEnd: false, now: NOW });
    expect(past.ok || past.code).toBe("already_over");
    const early = resolveSeatTerm({
      requestedEndsOn: "2026-09-16",
      calendar: SOLAR,
      capAtSeasonEnd: false,
      now: NOW,
      startsNoEarlierThan: new Date("2026-09-20T00:00:00Z"),
    });
    expect(early.ok || early.code).toBe("ends_before_it_starts");
  });

  it("a vote that lands after the season turns takes the NEXT season's end, default and steward cap alike", () => {
    // Main met this on 2026-09-15: a derived season turned on the 22nd, one vote-length away.
    const late = new Date("2026-12-18T12:00:00Z");
    const lands = new Date("2026-12-24T00:00:00Z");
    const t = resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: false, now: late, startsNoEarlierThan: lands });
    expect(t.ok && t.endsOn).toBe("2027-03-20");
    if (t.ok) {
      expect(t.seasonId, "the season the seat sits in").toBe("winter-2026");
      expect(t.followsSeason).toBe(true);
    }
    const steward = resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: true, now: late, startsNoEarlierThan: lands });
    expect(steward.ok && steward.endsOn, "a steward seat can be voted in during a season's last week").toBe("2027-03-20");
    const pastIt = resolveSeatTerm({ requestedEndsOn: "2027-03-21", calendar: SOLAR, capAtSeasonEnd: true, now: late, startsNoEarlierThan: lands });
    expect(pastIt.ok || pastIt.code, "and is capped at THAT season's end").toBe("past_season_end");
    // Landing exactly on the day the season turns is the boundary itself.
    const onTheTurn = resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: false, now: late, startsNoEarlierThan: new Date("2026-12-21T00:00:00Z") });
    expect(onTheTurn.ok && onTheTurn.endsOn).toBe("2027-03-20");
    // A vote that lands before the season turns is unchanged.
    const early = resolveSeatTerm({ calendar: SOLAR, capAtSeasonEnd: false, now: NOW, startsNoEarlierThan: new Date("2026-09-21T00:00:00Z") });
    expect(early.ok && early.endsOn).toBe("2026-12-21");
  });

  it("refuses in words when the season turns before the vote lands and no next season is set", () => {
    const lastScheduled: SeatCalendar = { ...SOLAR, seasons: SOLAR.seasons.slice(0, 2) };
    const late = new Date("2026-12-18T12:00:00Z");
    const lands = new Date("2026-12-24T00:00:00Z");
    const t = resolveSeatTerm({ calendar: lastScheduled, capAtSeasonEnd: false, now: late, startsNoEarlierThan: lands });
    expect(t.ok || t.code).toBe("no_next_season");
    if (!t.ok) expect(t.error).toContain("Add the next season in Admin");
    const own = resolveSeatTerm({ requestedEndsOn: "2027-02-01", calendar: lastScheduled, capAtSeasonEnd: false, now: late, startsNoEarlierThan: lands });
    expect(own.ok, "an ordinary seat with its own end date still opens").toBe(true);
    const steward = resolveSeatTerm({ requestedEndsOn: "2027-02-01", calendar: lastScheduled, capAtSeasonEnd: true, now: late, startsNoEarlierThan: lands });
    expect(steward.ok || steward.code, "a steward seat needs a season to be capped by").toBe("no_next_season");
  });
});

describe("the calendar and the seats talk: restampsFor", () => {
  const holding = (over: Partial<Parameters<typeof restampsFor>[0][number]> = {}) => ({
    id: "rh-1",
    seasonId: "autumn-2026",
    termEndsAt: new Date("2026-12-21T00:00:00Z"),
    followsSeason: true,
    ...over,
  });
  const moved = (endsOn: string): SeatCalendar => ({
    ...SOLAR,
    seasons: SOLAR.seasons.map((s) => (s.id === "autumn-2026" ? { ...s, endsOn } : s)),
  });

  it("moves a following seat when the season's end moves, in either direction", () => {
    expect(restampsFor([holding()], moved("2026-12-10"), NOW)).toEqual([
      { id: "rh-1", from: new Date("2026-12-21T00:00:00Z"), to: new Date("2026-12-10T00:00:00Z") },
    ]);
    expect(restampsFor([holding()], moved("2027-01-05"), NOW)[0]?.to.toISOString()).toBe("2027-01-05T00:00:00.000Z");
  });

  it("moves nothing when nothing moved, which is what makes it safe to run on every save", () => {
    expect(restampsFor([holding()], SOLAR, NOW)).toEqual([]);
  });

  it("never makes a seat indefinite: an open-ended or deleted season leaves the last date", () => {
    expect(restampsFor([holding()], moved(""), NOW)).toEqual([]);
    expect(restampsFor([holding()], { ...SOLAR, seasons: SOLAR.seasons.filter((s) => s.id !== "autumn-2026") }, NOW)).toEqual([]);
  });

  it("leaves a seat with its own date alone, and never revives a seat that has ended", () => {
    expect(restampsFor([holding({ followsSeason: false })], moved("2027-01-05"), NOW)).toEqual([]);
    const ended = holding({ seasonId: "summer-2026", termEndsAt: new Date("2026-09-01T00:00:00Z") });
    const summerMoved: SeatCalendar = {
      ...SOLAR,
      seasons: SOLAR.seasons.map((s) => (s.id === "summer-2026" ? { ...s, endsOn: "2026-10-01" } : s)),
    };
    expect(restampsFor([ended], summerMoved, NOW)).toEqual([]);
  });
});
