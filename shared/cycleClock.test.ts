/**
 * The cycle clock seam.
 *
 * Two properties carry the whole feature and everything else in this file
 * exists to protect them:
 *
 *  1. THE LUNAR CLOCK IS TODAY'S CLOCK, unchanged. Every village runs it, and
 *     a seam that moved a boundary by a second would re-price settled moons.
 *     `shared/lunar.test.ts` stays green byte-for-byte beside this file, and
 *     the tests here prove the seam agrees with the arithmetic it wraps.
 *  2. A CLOSED CYCLE KEEPS THE ID AND BOUNDS IT CLOSED UNDER, whatever a
 *     village switches to afterwards.
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_CLOCK,
  CALENDAR_CYCLE_BASE,
  LUNAR_CLOCK,
  boundsForNumber,
  clockFor,
  clockOfNumber,
  daysRemainingIn,
  cycleModeSwitchProblem,
  cycleSettingsProblem,
  cyclesRemaining,
  effectiveVetoHours,
  formatCalendarCycleId,
  formatLunarCycleId,
  hasArrived,
  joiningCycle,
  msRemaining,
  parseId,
  termEndAfter,
  vetoClosesAt,
  VETO_HOURS_DEFAULT,
  CYCLE_SETTING_READERS,
} from "./cycleClock";
import { TRUE_CLOCK_FROM_CYCLE, cycleBoundsByNumber, cycleBoundsFor, cycleStartMs } from "./lunar";

const AT = new Date("2026-09-03T12:00:00Z");

describe("the lunar clock is the arithmetic it wraps", () => {
  it("gives cycleBoundsFor's answer for boundsFor, cycleNumberAt and startOf", () => {
    for (const iso of ["2020-03-01T00:00:00Z", "2024-11-11T11:11:11Z", AT.toISOString(), "2031-01-01T00:00:00Z"]) {
      const at = new Date(iso);
      const direct = cycleBoundsFor(at);
      const seam = LUNAR_CLOCK.boundsFor(at);
      expect(seam.cycleNumber).toBe(direct.cycleNumber);
      expect(seam.startsAt.getTime()).toBe(direct.startsAt.getTime());
      expect(seam.endsAt.getTime()).toBe(direct.endsAt.getTime());
      expect(LUNAR_CLOCK.cycleNumberAt(at)).toBe(direct.cycleNumber);
      // Against the Date-producing API, not the raw float: `cycleStartMs`
      // returns a FRACTIONAL millisecond in the mean-formula era and every
      // Date in this codebase truncates it the same way.
      expect(LUNAR_CLOCK.startOf(direct.cycleNumber).getTime())
        .toBe(cycleBoundsByNumber(direct.cycleNumber).startsAt.getTime());
      expect(LUNAR_CLOCK.startOf(direct.cycleNumber).getTime()).toBe(Math.trunc(cycleStartMs(direct.cycleNumber)));
      expect(LUNAR_CLOCK.nextBoundaryAfter(at).getTime()).toBe(direct.endsAt.getTime());
    }
  });

  it("keeps the pinned cross-product cycle, 328 for 2026-07-26", () => {
    expect(LUNAR_CLOCK.cycleNumberAt(new Date("2026-07-26T00:00:00Z"))).toBe(328);
    expect(LUNAR_CLOCK.idFor(new Date("2026-07-26T00:00:00Z"))).toBe("lunar-000328");
  });

  it("names cycle numbers as lunar and bounds them from the frozen table", () => {
    const b = boundsForNumber(320);
    expect(b.clock).toBe("lunar");
    expect(b.id).toBe("lunar-000320");
    expect(b.startsAt.getTime()).toBe(cycleBoundsByNumber(320).startsAt.getTime());
  });
});

describe("the calendar clock", () => {
  it("runs first of the month to first of the month, in UTC", () => {
    const b = CALENDAR_CLOCK.boundsFor(AT);
    expect(b.startsAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(b.endsAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(b.id).toBe("month-2026-09");
  });

  it("round-trips every month of a decade through its id", () => {
    for (let year = 2020; year <= 2030; year++) {
      for (let month = 1; month <= 12; month++) {
        const at = new Date(Date.UTC(year, month - 1, 15));
        const id = CALENDAR_CLOCK.idFor(at);
        const parsed = parseId(id);
        expect(parsed).not.toBeNull();
        expect(parsed!.clock).toBe("calendar");
        expect(parsed!.cycleNumber).toBe(CALENDAR_CLOCK.cycleNumberAt(at));
        expect(formatCalendarCycleId(parsed!.cycleNumber!)).toBe(id);
        expect(boundsForNumber(parsed!.cycleNumber!).startsAt.toISOString())
          .toBe(new Date(Date.UTC(year, month - 1, 1)).toISOString());
      }
    }
  });

  it("sorts chronologically as plain strings", () => {
    const ids = ["month-2026-12", "month-2026-02", "month-2025-11", "month-2026-01"];
    expect([...ids].sort()).toEqual(["month-2025-11", "month-2026-01", "month-2026-02", "month-2026-12"]);
  });

  it("numbers from a million so no calendar number can ever be a lunar one", () => {
    expect(CALENDAR_CLOCK.cycleNumberAt(AT)).toBeGreaterThanOrEqual(CALENDAR_CYCLE_BASE);
    expect(clockOfNumber(CALENDAR_CLOCK.cycleNumberAt(AT))).toBe("calendar");
    expect(clockOfNumber(330)).toBe("lunar");
    // The collision this base exists to prevent: lunar 700 and month 700
    // would otherwise both be cycle 700 in a UNIQUE column.
    expect(formatLunarCycleId(700)).not.toBe(formatCalendarCycleId(CALENDAR_CYCLE_BASE + 700));
  });
});

describe("nextBoundaryAfter and cycleNumberAt agree with boundsFor", () => {
  for (const clock of [LUNAR_CLOCK, CALENDAR_CLOCK]) {
    it(`holds on the ${clock.mode} clock`, () => {
      for (const iso of ["2021-06-01T00:00:00Z", "2026-09-03T12:00:00Z", "2029-02-28T23:59:59Z"]) {
        const at = new Date(iso);
        const b = clock.boundsFor(at);
        expect(clock.cycleNumberAt(at)).toBe(b.cycleNumber);
        expect(clock.startOf(b.cycleNumber).getTime()).toBe(b.startsAt.getTime());
        expect(clock.nextBoundaryAfter(at).getTime()).toBe(b.endsAt.getTime());
        // The boundary itself belongs to the cycle it opens, and the next
        // boundary after it is the one after that.
        //
        // ASKED ONLY OF THE TRUE-TABLE ERA, and that is a fact about the
        // frozen past rather than a gap in this seam. Below
        // TRUE_CLOCK_FROM_CYCLE a boundary is `REF + k * 29.53058867 days`,
        // which is a fractional millisecond, and `cycleBoundsFor` reads it
        // back with a floor: at the exact boundary instant the floor can land
        // one short by a floating-point ulp. That behaviour is frozen by
        // design (every settled cycle keeps the number it settled under), so
        // this seam reproduces it rather than correcting it. Every landing
        // instant any village will ever use is in the table era, where the
        // boundaries are whole milliseconds and the round-trip is exact.
        if (clock.mode === "calendar" || b.cycleNumber >= TRUE_CLOCK_FROM_CYCLE) {
          const onBoundary = new Date(b.startsAt.getTime());
          expect(clock.cycleNumberAt(onBoundary)).toBe(b.cycleNumber);
          expect(clock.nextBoundaryAfter(onBoundary).getTime()).toBe(b.endsAt.getTime());
        }
        expect(clock.boundsFor(at).startsAt.getTime()).toBeLessThanOrEqual(at.getTime());
        expect(clock.boundsFor(at).endsAt.getTime()).toBeGreaterThan(at.getTime());
      }
    });
  }
});

describe("parseId is total over every prefix a village has ever used", () => {
  it("reads lunar ids", () => {
    expect(parseId("lunar-000328")).toEqual({ id: "lunar-000328", clock: "lunar", cycleNumber: 328 });
  });

  it("reads calendar ids", () => {
    expect(parseId("month-2026-09")?.clock).toBe("calendar");
  });

  it("NAMES the legacy YYYY-MM ids and still refuses to place them", () => {
    const p = parseId("2026-09");
    expect(p).not.toBeNull();
    expect(p!.clock).toBe("legacy_month");
    // No number, because there is no honest lunation for a calendar month.
    // The settlement's refusal stays exactly as loud as it was.
    expect(p!.cycleNumber).toBeNull();
  });

  it("refuses anything else, including the second spelling that once shipped", () => {
    for (const id of ["", "moon-329", "lunar-", "month-2026-13", "2026-13", "lunar-abc", "cycle-1"]) {
      expect(parseId(id)).toBeNull();
    }
  });
});

describe("a switch never changes a closed cycle", () => {
  it("keeps the id and the bounds a cycle closed under after the village moves clocks", () => {
    const closed = LUNAR_CLOCK.boundsFor(new Date("2026-07-26T00:00:00Z"));
    // The village votes for calendar months and the setting changes.
    const after = clockFor("calendar");
    expect(after.mode).toBe("calendar");
    // Nothing recomputes the closed row: its number carries its clock.
    const reread = boundsForNumber(closed.cycleNumber);
    expect(reread.id).toBe(closed.id);
    expect(reread.startsAt.getTime()).toBe(closed.startsAt.getTime());
    expect(reread.endsAt.getTime()).toBe(closed.endsAt.getTime());
    expect(after.parseId(closed.id)?.cycleNumber).toBe(closed.cycleNumber);
  });
});

describe("the landing precondition", () => {
  const boundary = LUNAR_CLOCK.nextBoundaryAfter(AT);

  it("refuses an instant that is not a boundary of the clock being left, and names the one that is", () => {
    const problem = cycleModeSwitchProblem({
      from: "lunar", to: "calendar", landsAt: AT, unsettledCycleNumbers: [],
    });
    expect(problem).toContain("can only land where a cycle ends");
    expect(problem).toContain(boundary.toISOString());
  });

  it("refuses while a finished cycle is unsettled, and names it", () => {
    const problem = cycleModeSwitchProblem({
      from: "lunar", to: "calendar", landsAt: boundary, unsettledCycleNumbers: [329, 330],
    });
    expect(problem).toContain("lunar-000329");
    expect(problem).toContain("not settled yet");
  });

  it("refuses a switch to the clock already running", () => {
    expect(cycleModeSwitchProblem({
      from: "lunar", to: "lunar", landsAt: boundary, unsettledCycleNumbers: [],
    })).toContain("already keeps time");
  });

  it("allows a boundary instant with nothing unsettled", () => {
    expect(cycleModeSwitchProblem({
      from: "lunar", to: "calendar", landsAt: boundary, unsettledCycleNumbers: [],
    })).toBeNull();
  });

  it("joins the clocks with no gap and no overlap", () => {
    const seam = joiningCycle(LUNAR_CLOCK, CALENDAR_CLOCK, boundary);
    // The last lunar cycle ends exactly where the joining cycle begins.
    expect(seam.startsAt.getTime()).toBe(boundary.getTime());
    // And the joining cycle ends on the incoming clock's own next boundary.
    expect(seam.endsAt.getTime()).toBe(CALENDAR_CLOCK.nextBoundaryAfter(boundary).getTime());
    expect(seam.endsAt.getTime()).toBeGreaterThan(seam.startsAt.getTime());
    expect(seam.clock).toBe("calendar");
    expect(seam.id).toBe(CALENDAR_CLOCK.idFor(boundary));
  });
});

describe("the boot assertion 0108 retired a dial for", () => {
  const valueOf = () => "lunar";

  it("passes on the readers this build ships", () => {
    expect(cycleSettingsProblem(Object.keys(CYCLE_SETTING_READERS), CYCLE_SETTING_READERS, valueOf)).toBeNull();
  });

  it("FIRES when a consumer is removed: the positive control", () => {
    // A refactor drops the reader and leaves the setting on the panel. This is
    // exactly the shape `gratitude.cycle_mode` shipped in.
    const problem = cycleSettingsProblem(["cycle.mode"], {}, valueOf);
    expect(problem).toContain("cycle.mode");
    expect(problem).toContain("nothing in this build reads it");
    expect(problem).toContain("0108");
  });

  it("fires when a reader resolves to nothing", () => {
    expect(cycleSettingsProblem(["cycle.mode"], { "cycle.mode": () => null }, valueOf))
      .toContain("resolved to nothing");
  });

  it("fires when a reader throws", () => {
    const problem = cycleSettingsProblem(
      ["cycle.mode"],
      { "cycle.mode": () => { throw new Error("no such key"); } },
      valueOf,
    );
    expect(problem).toContain("reader that threw");
  });
});

describe("governance instants: three days means 72 hours", () => {
  const closes = new Date("2026-09-03T10:00:00Z");

  it("shuts the window 72 hours after the close", () => {
    expect(vetoClosesAt(closes).toISOString()).toBe("2026-09-06T10:00:00.000Z");
    expect(VETO_HOURS_DEFAULT).toBe(72);
  });

  it("never gives a steward less than 72 hours, whatever a village types", () => {
    expect(effectiveVetoHours(1)).toBe(72);
    expect(effectiveVetoHours(0)).toBe(72);
    expect(effectiveVetoHours(-500)).toBe(72);
    expect(effectiveVetoHours(null)).toBe(72);
    expect(effectiveVetoHours(Number.NaN)).toBe(72);
    expect(effectiveVetoHours(168)).toBe(168);
  });





  it("counts down with the same arithmetic the server tests due-ness with", () => {
    /*
     * The four landing tests that used to sit above this one are GONE, with the
     * duplicate landingFor they exercised. Their behaviour is covered against
     * the surviving implementation in shared/governanceKinds.test.ts: the token
     * send at close, the Game change held to its window, the new-moon choice,
     * and the late-carry jump. This one stays because msRemaining and hasArrived
     * are cycleClock's own, and it now takes its instant directly rather than
     * through a landing function this file no longer owns.
     */
    const landsAt = vetoClosesAt(closes);
    const halfway = new Date(closes.getTime() + 36 * 3_600_000);
    expect(msRemaining(halfway, landsAt)).toBe(36 * 3_600_000);
    expect(hasArrived(halfway, landsAt)).toBe(false);
    expect(msRemaining(landsAt, landsAt)).toBe(0);
    expect(hasArrived(landsAt, landsAt)).toBe(true);
  });
});

describe("terms counted in cycles", () => {
  it("ends a term at a boundary the number of cycles later", () => {
    const end = termEndAfter(AT, 3, LUNAR_CLOCK);
    expect(end.getTime()).toBe(LUNAR_CLOCK.startOf(LUNAR_CLOCK.cycleNumberAt(AT) + 3).getTime());
    expect(end.getTime()).toBeGreaterThan(AT.getTime());
  });

  it("never returns a term of zero cycles", () => {
    expect(termEndAfter(AT, 0, LUNAR_CLOCK).getTime()).toBe(termEndAfter(AT, 1, LUNAR_CLOCK).getTime());
    expect(termEndAfter(AT, -4, LUNAR_CLOCK).getTime()).toBe(termEndAfter(AT, 1, LUNAR_CLOCK).getTime());
  });

  it("counts what is left, floored at zero once it has passed", () => {
    const end = termEndAfter(AT, 4, LUNAR_CLOCK);
    expect(cyclesRemaining(AT, end, LUNAR_CLOCK)).toBe(4);
    expect(cyclesRemaining(new Date(end.getTime() + 1), end, LUNAR_CLOCK)).toBe(0);
  });

  it("works on the calendar clock too", () => {
    const end = termEndAfter(AT, 2, CALENDAR_CLOCK);
    expect(end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("walking boundaries forward always moves", () => {
  for (const clock of [LUNAR_CLOCK, CALENDAR_CLOCK]) {
    it(`never returns the same instant twice on the ${clock.mode} clock`, () => {
      // The frozen mean era, where a boundary is a fractional millisecond and
      // `new Date` truncates it down. Handing that truncated instant back used
      // to return itself forever, which turned the calendar's cycle-close
      // recurrence into one occurrence and a hundred thousand loop turns.
      for (const iso of ["2019-01-01T00:00:00Z", "2021-06-01T00:00:00Z", "2026-09-03T12:00:00Z", "2035-01-01T00:00:00Z"]) {
        let at = new Date(iso);
        for (let i = 0; i < 40; i++) {
          const next = clock.nextBoundaryAfter(at);
          expect(next.getTime(), `${clock.mode} from ${at.toISOString()}`).toBeGreaterThan(at.getTime());
          at = next;
        }
      }
    });
  }
});

describe("one countdown, and it belongs to the village's own cycle", () => {
  it("counts whole days up to the cycle's own end, on either clock", () => {
    const at = new Date("2026-09-03T12:00:00Z");
    const cal = CALENDAR_CLOCK.boundsFor(at);
    // 2026-09-03 12:00 to 2026-10-01 00:00 is 27.5 days, rounded up.
    expect(daysRemainingIn(cal, at)).toBe(28);
    const lun = LUNAR_CLOCK.boundsFor(at);
    expect(daysRemainingIn(lun, at)).toBe(
      Math.ceil((lun.endsAt.getTime() - at.getTime()) / 86_400_000),
    );
    // The two clocks give different answers on the same day, which is the
    // whole reason this cannot be `daysRemainingInCycle` from shared/lunar.ts.
    expect(daysRemainingIn(cal, at)).not.toBe(daysRemainingIn(lun, at));
  });

  it("reads zero at the boundary and never goes negative", () => {
    const b = CALENDAR_CLOCK.boundsFor(new Date("2026-09-03T12:00:00Z"));
    expect(daysRemainingIn(b, b.endsAt)).toBe(0);
    expect(daysRemainingIn(b, new Date(b.endsAt.getTime() + 10 * 86_400_000))).toBe(0);
  });
});
