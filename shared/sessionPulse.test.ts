/**
 * A circle's season and the regenerative lens, without a database: the median,
 * the door, and the words. The door runs against a real schema in
 * server/sessionPulse.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { LENS_COPY, PULSE_COPY, circlePulseUrl, medianOf, naturalSeasonStart, villageSeasonStartKey, type CirclePulse } from "./sessionPulse";
import { parseVillageSeasons } from "./villageSeasons";

const pulse = (over: Partial<CirclePulse> = {}): CirclePulse => ({
  circleId: "garden",
  season: "spring",
  since: "2026-09-03",
  sessions: 5,
  people: 7,
  decisions: 12,
  tensions: 4,
  actions: { open: 3, done: 9, letGo: 2 },
  arrival: 7,
  ...over,
});

describe("a circle's season", () => {
  it("takes the median of what was measured", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([7])).toBe(7);
    expect(medianOf([9, 5, 7])).toBe(7);
    expect(medianOf([6, 8])).toBe(7);
    expect(medianOf([6, 7])).toBe(6.5);
  });

  it("reads a village's own season from the day it began, each spell of a repeated name its own, a long one whole", () => {
    // The house's own example list (shared/villageSeasons.ts): Green comes twice, and Dry runs five months.
    const seasons = parseVillageSeasons("Dry: 12-01, Green: 05-01, Little summer: 07-10, Green: 08-01")!;
    expect(villageSeasonStartKey(seasons, "2026-08-20")).toBe("2026-08-01");
    expect(villageSeasonStartKey(seasons, "2026-07-15")).toBe("2026-07-10");
    expect(villageSeasonStartKey(seasons, "2026-04-28")).toBe("2025-12-01");
    expect(villageSeasonStartKey(seasons, "2026-12-01")).toBe("2026-12-01");
    expect(villageSeasonStartKey([], "2026-04-28")).toBeNull();
  });

  it("reads a natural season from the latest equinox or solstice", () => {
    const autumn = naturalSeasonStart(new Date("2026-10-24T12:00:00Z"));
    expect(autumn.toISOString().slice(0, 7)).toBe("2026-09");
    const winter = naturalSeasonStart(new Date("2026-01-10T12:00:00Z"));
    expect(winter.toISOString().slice(0, 7)).toBe("2025-12");
  });

  it("names its door", () => {
    expect(circlePulseUrl("garden circle")).toBe("/api/sessions/circles/garden%20circle/pulse");
  });

  it("says the season in one sentence", () => {
    expect(PULSE_COPY.line("Garden", pulse())).toBe("The Garden circle met 5 times this spring: 12 decisions by consent, 9 of 14 actions done.");
    expect(PULSE_COPY.line("Kitchen circle", pulse({ sessions: 1, decisions: 1, actions: { open: 1, done: 0, letGo: 0 } }))).toBe(
      "The Kitchen circle met once this spring: 1 decision by consent, 0 of 1 action done.",
    );
    expect(PULSE_COPY.line("Garden", pulse({ sessions: 2, actions: { open: 0, done: 0, letGo: 0 } }))).toBe("The Garden circle met twice this spring: 12 decisions by consent.");
    expect(PULSE_COPY.line("Garden", pulse({ season: null }))).toBe("The Garden circle met 5 times in the last three months: 12 decisions by consent, 9 of 14 actions done.");
    expect(PULSE_COPY.line("Garden", pulse({ sessions: 0 }))).toBe("The Garden circle has not met this spring yet.");
  });
});

describe("the regenerative lens", () => {
  it("asks four questions", () => {
    expect(LENS_COPY.questions).toHaveLength(4);
    expect(LENS_COPY.questions.every((q) => q.endsWith("?"))).toBe(true);
  });
});
