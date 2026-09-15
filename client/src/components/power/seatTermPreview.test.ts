/**
 * The term preview a form shows is the server's own rule, run early.
 *
 * Each case pins a sentence a person reads under a date picker before they
 * seat anybody, against the rulings of 2026-09-13/14: no date means the
 * season's end, a steward can end no later than that, anything else runs as
 * long as the village wants and carries a caution past four seasons or
 * thirteen moons, and a caution never refuses.
 */
import { describe, expect, it } from "vitest";
import { pickerBounds, previewSeatTerm, voteStartsAt, type SeasonPayload } from "./seatTermPreview";

const NOW = new Date("2026-09-14T12:00:00Z");

const ONE_SEASON: SeasonPayload = {
  current: { id: "autumn", endsOn: "2026-12-21" },
  seasons: [{ id: "autumn", startsOn: "2026-09-01", endsOn: "2026-12-21" }],
  timezone: "UTC",
  today: "2026-09-14",
};

const FOUR_SEASONS: SeasonPayload = {
  current: { id: "s1", endsOn: "2026-12-21" },
  seasons: [
    { id: "s1", startsOn: "2026-09-01", endsOn: "2026-12-21" },
    { id: "s2", startsOn: "2026-12-21", endsOn: "2027-03-20" },
    { id: "s3", startsOn: "2027-03-20", endsOn: "2027-06-21" },
    { id: "s4", startsOn: "2027-06-21", endsOn: "2027-09-22" },
  ],
  timezone: "UTC",
  today: "2026-09-14",
};

describe("previewSeatTerm", () => {
  it("says a seat with no date asked ends with the season, on the season's date", () => {
    const p = previewSeatTerm(ONE_SEASON, { now: NOW });
    expect(p).toMatchObject({ state: "ok", line: "Ends with the season on 2026-12-21.", followsSeason: true, caution: null });
  });

  it("says a picked date plainly, and a date equal to the season's end still follows the season", () => {
    expect(previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2026-11-01", now: NOW })).toMatchObject({
      state: "ok",
      line: "Ends on 2026-11-01.",
      followsSeason: false,
    });
    expect(previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2026-12-21", now: NOW })).toMatchObject({
      state: "ok",
      line: "Ends with the season on 2026-12-21.",
      followsSeason: true,
    });
  });

  it("cautions past thirteen moons when the schedule does not reach four seasons, and still says yes", () => {
    const p = previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2031-01-01", now: NOW });
    expect(p.state).toBe("ok");
    if (p.state !== "ok") return;
    expect(p.caution).toContain("more than thirteen moons");
  });

  it("measures the caution in seasons when the schedule reaches four of them", () => {
    const inside = previewSeatTerm(FOUR_SEASONS, { requestedEndsOn: "2027-09-01", now: NOW });
    expect(inside).toMatchObject({ state: "ok", caution: null });
    const past = previewSeatTerm(FOUR_SEASONS, { requestedEndsOn: "2027-10-01", now: NOW });
    expect(past.state).toBe("ok");
    if (past.state !== "ok") return;
    expect(past.caution).toContain("fourth season");
  });

  it("holds a steward's seat to the season's end, and lets it end sooner", () => {
    const late = previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2027-01-15", capAtSeasonEnd: true, now: NOW });
    expect(late).toMatchObject({ state: "refused", code: "past_season_end" });
    if (late.state === "refused") expect(late.error).toContain("2026-12-21");
    expect(previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2026-10-01", capAtSeasonEnd: true, now: NOW })).toMatchObject({
      state: "ok",
      line: "Ends on 2026-10-01.",
    });
  });

  it("carries the server's own sentence when no season is running", () => {
    const p = previewSeatTerm({ ...ONE_SEASON, current: null }, { now: NOW });
    expect(p).toMatchObject({ state: "refused", code: "no_season" });
    if (p.state === "refused") expect(p.error).toMatch(/^No season is running/);
    // A date of its own is still a term, with no season to end with.
    expect(previewSeatTerm({ ...ONE_SEASON, current: null }, { requestedEndsOn: "2026-11-01", now: NOW })).toMatchObject({
      state: "ok",
    });
  });

  it("refuses a date that has already passed", () => {
    expect(previewSeatTerm(ONE_SEASON, { requestedEndsOn: "2026-09-10", now: NOW })).toMatchObject({
      state: "refused",
      code: "already_over",
    });
  });
});

describe("pickerBounds", () => {
  it("starts tomorrow, and stops at the season's end only for a steward", () => {
    expect(pickerBounds(ONE_SEASON, false)).toEqual({ min: "2026-09-15", max: undefined });
    expect(pickerBounds(ONE_SEASON, true)).toEqual({ min: "2026-09-15", max: "2026-12-21" });
  });

  it("rolls over a month and a year", () => {
    expect(pickerBounds({ ...ONE_SEASON, today: "2026-12-31" }, false).min).toBe("2027-01-01");
  });

  it("offers no bound it cannot read", () => {
    expect(pickerBounds({ current: null, today: null }, true)).toEqual({ min: undefined, max: undefined });
  });
});

describe("a seat vote is measured from when it lands", () => {
  const LATE = new Date("2026-12-10T12:00:00Z");
  /** Autumn turns on the 21st, and a vote opened today lands on the 29th. */
  const TURNING: SeasonPayload = {
    current: { id: "autumn", endsOn: "2026-12-21" },
    seasons: [
      { id: "autumn", startsOn: "2026-09-22", endsOn: "2026-12-21" },
      { id: "winter", startsOn: "2026-12-21", endsOn: "2027-03-20" },
    ],
    timezone: "UTC",
    today: "2026-12-10",
    seatVoteLandsAt: "2026-12-29T00:00:00.000Z",
  };

  it("reads the forecast only for a form that opens a vote, and never an unreadable one", () => {
    expect(voteStartsAt(TURNING, true)?.toISOString()).toBe("2026-12-29T00:00:00.000Z");
    expect(voteStartsAt(TURNING, false)).toBeNull();
    expect(voteStartsAt({ ...TURNING, seatVoteLandsAt: "soon" }, true)).toBeNull();
    expect(voteStartsAt({ ...TURNING, seatVoteLandsAt: null }, true)).toBeNull();
  });

  it("gives a vote that lands after the turn the next season's end, steward included", () => {
    const starts = voteStartsAt(TURNING, true);
    expect(previewSeatTerm(TURNING, { now: LATE, startsNoEarlierThan: starts })).toMatchObject({
      state: "ok",
      line: "Ends with the season on 2027-03-20.",
    });
    expect(previewSeatTerm(TURNING, { now: LATE, capAtSeasonEnd: true, startsNoEarlierThan: starts })).toMatchObject({
      state: "ok",
      endsOn: "2027-03-20",
    });
    // A seating made now, with no vote behind it, still sits in the autumn.
    expect(previewSeatTerm(TURNING, { now: LATE })).toMatchObject({ state: "ok", endsOn: "2026-12-21" });
  });

  it("refuses a date the seat would never reach, in the route's own words", () => {
    expect(
      previewSeatTerm(TURNING, { requestedEndsOn: "2026-12-25", now: LATE, startsNoEarlierThan: voteStartsAt(TURNING, true) }),
    ).toMatchObject({ state: "refused", code: "ends_before_it_starts" });
  });

  it("opens the picker the day after the landing, and caps a steward at the season the seat starts in", () => {
    const starts = voteStartsAt(TURNING, true);
    expect(pickerBounds(TURNING, true, starts)).toEqual({ min: "2026-12-30", max: "2027-03-20" });
    expect(pickerBounds(TURNING, false, starts)).toEqual({ min: "2026-12-30", max: undefined });
    expect(pickerBounds(TURNING, true), "a seating made now keeps the running season").toEqual({ min: "2026-12-11", max: "2026-12-21" });
  });

  it("keeps the running season for a vote that lands before the turn", () => {
    const early = { ...TURNING, seatVoteLandsAt: "2026-12-15T06:00:00.000Z" };
    expect(pickerBounds(early, true, voteStartsAt(early, true))).toEqual({ min: "2026-12-16", max: "2026-12-21" });
  });

  it("counts the landing day where the village lives", () => {
    // 03:00 UTC on the 29th is still the 28th in Los Angeles.
    const west = { ...TURNING, timezone: "America/Los_Angeles", seatVoteLandsAt: "2026-12-29T03:00:00.000Z" };
    expect(pickerBounds(west, false, voteStartsAt(west, true)).min).toBe("2026-12-29");
  });

  it("offers no steward cap when nothing is scheduled after the turn", () => {
    const last = { ...TURNING, seasons: TURNING.seasons!.slice(0, 1) };
    expect(pickerBounds(last, true, voteStartsAt(last, true))).toEqual({ min: "2026-12-30", max: undefined });
  });
});
