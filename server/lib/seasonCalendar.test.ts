/**
 * A fresh village's seasons.
 *
 * The property under test is the one whose absence made every seat
 * unremovable: on ANY date, a village that has written no season list still
 * has a current season, so a term that expires each season can come due.
 */
import { describe, expect, it } from "vitest";
import { defaultSeasonsFor, seasonRunningProblem, suggestNextSeasonDates } from "./seasonCalendar";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { LUNAR_CLOCK } from "../../shared/cycleClock";

/** The seasonState rule, in miniature: latest season begun and not ended. */
function currentOn(seasons: ReturnType<typeof defaultSeasonsFor>, today: string) {
  const running = seasons.filter((s) => s.startsOn <= today && (!s.endsOn || today < s.endsOn));
  return running.length ? running[running.length - 1] : null;
}

const DATES = [
  "2020-01-01", "2024-02-29", "2026-09-03", "2026-12-21", "2026-12-22",
  "2027-06-30", "2030-03-20", "2044-11-11", "2051-01-15",
];

describe("the platform no longer ships one village's expired dates", () => {
  it("seeds an empty list, so the derivation is what a fork gets", () => {
    expect(GAME_CONFIG.season.seasons).toEqual([]);
  });
});

describe("a fresh village has a current season on any date", () => {
  for (const cadence of ["solstice-equinox", "quarterly", "lunar", "custom"]) {
    for (const tz of ["UTC", "America/Costa_Rica", "Pacific/Auckland"]) {
      it(`${cadence} in ${tz}`, () => {
        for (const iso of DATES) {
          const at = new Date(`${iso}T12:00:00Z`);
          const seasons = defaultSeasonsFor(cadence, tz, at);
          expect(seasons.length).toBeGreaterThan(0);
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          }).format(at);
          const current = currentOn(seasons, today);
          expect(current, `${cadence}/${tz} on ${today}`).not.toBeNull();
          expect(current!.name).toBeTruthy();
        }
      });
    }
  }

  it("lays the seasons end to end with no gap and no overlap", () => {
    const seasons = defaultSeasonsFor("solstice-equinox", "UTC", new Date("2026-09-03T12:00:00Z"));
    for (let i = 0; i + 1 < seasons.length; i++) {
      expect(seasons[i].endsOn).toBe(seasons[i + 1].startsOn);
      expect(seasons[i].startsOn < seasons[i].endsOn).toBe(true);
    }
  });

  it("gives every entry a distinct id and an end date", () => {
    const seasons = defaultSeasonsFor("quarterly", "UTC", new Date("2026-09-03T12:00:00Z"));
    expect(new Set(seasons.map((s) => s.id)).size).toBe(seasons.length);
    expect(seasons.every((s) => !!s.endsOn)).toBe(true);
  });

  it("carries no village's name, theme or goals", () => {
    for (const s of defaultSeasonsFor("solstice-equinox", "UTC", new Date())) {
      expect(s.theme).toBe("");
      expect(s.focus).toBe("");
      expect(s.goals).toEqual([]);
    }
  });
});

describe("the next-season suggestion reads the clock", () => {
  it("puts a lunar cadence on real cycle boundaries, never 30 civil days", () => {
    const { startsOn, endsOn } = suggestNextSeasonDates("lunar", "2026-09-03", "UTC");
    expect(startsOn).toBe("2026-09-03");
    const from = new Date("2026-09-03T00:00:00Z");
    const expected = LUNAR_CLOCK.startOf(LUNAR_CLOCK.cycleNumberAt(from) + 3);
    expect(endsOn).toBe(expected.toISOString().slice(0, 10));
    // Three lunations is about 88.6 days, so the old "+30 days" answer is
    // nowhere near it and the two can never be confused.
    expect(endsOn).not.toBe("2026-10-03");
  });

  it("runs a solstice cadence to the next turning, never to a one-day season", () => {
    const { endsOn } = suggestNextSeasonDates("solstice-equinox", "2026-09-20", "UTC");
    expect(endsOn > "2026-11-01").toBe(true);
  });

  it("falls back to a quarter for quarterly and custom", () => {
    expect(suggestNextSeasonDates("quarterly", "2026-09-03", "UTC").endsOn).toBe("2026-12-03");
    expect(suggestNextSeasonDates("custom", "2026-09-03", "UTC").endsOn).toBe("2026-12-03");
  });
});

describe("no season running is a loud condition", () => {
  it("says nothing while a season runs", () => {
    expect(seasonRunningProblem({ currentId: "s1", configuredCount: 2, allEnded: false })).toBeNull();
  });

  it("names the seat consequence when nothing is configured", () => {
    const p = seasonRunningProblem({ currentId: null, configuredCount: 0, allEnded: false });
    expect(p).toContain("cannot come due");
    expect(p).toContain("none is configured");
  });

  it("distinguishes all-ended from a gap in the dates", () => {
    const ended = seasonRunningProblem({ currentId: null, configuredCount: 2, allEnded: true });
    const gap = seasonRunningProblem({ currentId: null, configuredCount: 2, allEnded: false });
    expect(ended).toContain("have ended");
    expect(gap).toContain("gap in the season dates");
    expect(ended).not.toBe(gap);
  });
});
