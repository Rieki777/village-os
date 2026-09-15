/**
 * What a raised hand stores about its term, and what it refuses.
 *
 * The submissions inbox reads `termEndsOn`, `followsSeason` and `caution`
 * straight off the submission's data, so these three keys ARE the contract
 * with the admin screen, and the statuses are the contract with the map form.
 */
import { describe, expect, it } from "vitest";
import { raisedHandTerm } from "./raisedHandTerm";
import type { SeatCalendar } from "../../shared/seatTerms";

const NOW = new Date("2026-09-14T12:00:00Z");
const CALENDAR: SeatCalendar = {
  seasons: [{ id: "autumn", startsOn: "2026-09-01", endsOn: "2026-12-21" }],
  currentSeasonId: "autumn",
  timezone: "UTC",
};

describe("raisedHandTerm", () => {
  it("stores the season's end when no date is asked, and says the seat follows the season", () => {
    expect(raisedHandTerm(undefined, CALENDAR, NOW)).toEqual({
      ok: true,
      data: { termEndsOn: "2026-12-21", followsSeason: true, caution: null },
    });
    expect(raisedHandTerm("  ", CALENDAR, NOW)).toMatchObject({ ok: true, data: { followsSeason: true } });
  });

  it("stores a date of its own, past the season's end included, because a hand is not a steward's seat", () => {
    expect(raisedHandTerm("2026-11-01", CALENDAR, NOW)).toEqual({
      ok: true,
      data: { termEndsOn: "2026-11-01", followsSeason: false, caution: null },
    });
    expect(raisedHandTerm("2027-02-01", CALENDAR, NOW)).toMatchObject({ ok: true, data: { termEndsOn: "2027-02-01" } });
  });

  it("stores the caution beside a long date, and still accepts the hand", () => {
    const long = raisedHandTerm("2031-01-01", CALENDAR, NOW);
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.data.caution).toContain("thirteen moons");
  });

  it("refuses a date it cannot read with a 400", () => {
    expect(raisedHandTerm("next spring", CALENDAR, NOW)).toMatchObject({ ok: false, status: 400, body: { code: "unreadable_date" } });
    expect(raisedHandTerm("2027-02-30", CALENDAR, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(raisedHandTerm(20270301, CALENDAR, NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses every other term with a 409 and the sentence", () => {
    const past = raisedHandTerm("2026-09-01", CALENDAR, NOW);
    expect(past).toMatchObject({ ok: false, status: 409, body: { code: "already_over" } });
    const noSeason = raisedHandTerm(undefined, { ...CALENDAR, currentSeasonId: null }, NOW);
    expect(noSeason).toMatchObject({ ok: false, status: 409, body: { code: "no_season" } });
    if (!noSeason.ok) expect(noSeason.body.error).toMatch(/^No season is running/);
  });
});
