/**
 * A village's own seasons: the grammar `calendar.seasons` is written in, the
 * refusals the Admin door gives, and which season is on for a day of the year.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY, validateVariable } from "./gameVariables";
import {
  TROPIC_LATITUDE,
  VILLAGE_SEASONS_MAX,
  isTropicalLatitude,
  parseVillageSeasons,
  villageSeasonOn,
  villageSeasonsProblem,
} from "./villageSeasons";

describe("reading a village's seasons", () => {
  it("reads names and start days, in calendar order whatever order they were written in", () => {
    expect(parseVillageSeasons("Green: 05-01, Dry: 12-01")).toEqual([
      { name: "Green", month: 5, day: 1 },
      { name: "Dry", month: 12, day: 1 },
    ]);
    expect(parseVillageSeasons("  Little   summer :7-10 ")).toEqual([{ name: "Little summer", month: 7, day: 10 }]);
    // A name may come back later in the year.
    expect(parseVillageSeasons("Green: 05-01, Little summer: 07-10, Green: 08-01")?.map((s) => s.name)).toEqual(["Green", "Little summer", "Green"]);
    // Names in any script.
    expect(parseVillageSeasons("Época seca: 12-01, Época lluviosa: 05-01")?.length).toBe(2);
  });

  it("reads blank as no list, and any wrong part as no list at all", () => {
    expect(parseVillageSeasons("")).toBeNull();
    expect(parseVillageSeasons(null)).toBeNull();
    expect(parseVillageSeasons("Dry: 12-01, Green")).toBeNull();
    expect(parseVillageSeasons("Dry: 12-01, Green: 02-30")).toBeNull();
  });

  it("refuses at the door what it cannot read whole, and lets blank through", () => {
    expect(villageSeasonsProblem("")).toBeNull();
    expect(villageSeasonsProblem("Dry: 12-01, Green: 05-01")).toBeNull();
    expect(villageSeasonsProblem("Feb: 02-29")).toBeNull();
    for (const bad of [
      "Dry 12-01",
      "Dry: 2026-12-01",
      "Dry: 13-01",
      "Dry: 04-31",
      ": 05-01",
      "Dry: 12-01, Wet: 12-01",
      "<b>Dry</b>: 12-01",
      `${"x".repeat(41)}: 01-01`,
      Array.from({ length: VILLAGE_SEASONS_MAX + 1 }, (_, i) => `S${i}: ${String(i + 1).padStart(2, "0")}-01`).join(", "),
    ]) {
      expect(villageSeasonsProblem(bad), bad).toBeTruthy();
    }
  });

  it("is the dial's own check, so Admin refuses the same values", () => {
    const def = VARIABLES_BY_KEY["calendar.seasons"];
    expect(def).toBeTruthy();
    expect(def.type).toBe("text");
    expect(def.default).toBe("");
    expect(validateVariable(def, "")).toBeNull();
    expect(validateVariable(def, "Dry: 12-01, Green: 05-01")).toBeNull();
    expect(validateVariable(def, "Dry: 12-01, Green")).toBe(villageSeasonsProblem("Dry: 12-01, Green"));
  });
});

describe("which season is on", () => {
  const dryAndGreen = parseVillageSeasons("Dry: 12-01, Green: 05-01")!;

  it("is the one whose start most recently passed, wrapping December to April", () => {
    expect(villageSeasonOn(dryAndGreen, 12, 1)).toBe("Dry");
    expect(villageSeasonOn(dryAndGreen, 12, 31)).toBe("Dry");
    expect(villageSeasonOn(dryAndGreen, 1, 1)).toBe("Dry");
    expect(villageSeasonOn(dryAndGreen, 4, 30)).toBe("Dry");
    expect(villageSeasonOn(dryAndGreen, 5, 1)).toBe("Green");
    expect(villageSeasonOn(dryAndGreen, 11, 30)).toBe("Green");
  });

  it("works on a list in any order, and on one season", () => {
    const unsorted = [
      { name: "Green", month: 5, day: 1 },
      { name: "Dry", month: 12, day: 1 },
      { name: "Little summer", month: 7, day: 10 },
    ];
    expect(villageSeasonOn(unsorted, 3, 3)).toBe("Dry");
    expect(villageSeasonOn(unsorted, 7, 20)).toBe("Little summer");
    expect(villageSeasonOn(unsorted, 6, 1)).toBe("Green");
    expect(villageSeasonOn([{ name: "Rain", month: 6, day: 1 }], 1, 1)).toBe("Rain");
    expect(villageSeasonOn([], 1, 1)).toBeNull();
  });

  it("knows the tropics, and the equator is in them", () => {
    expect(isTropicalLatitude(0)).toBe(true);
    expect(isTropicalLatitude(9.2)).toBe(true);
    expect(isTropicalLatitude(-20)).toBe(true);
    expect(isTropicalLatitude(TROPIC_LATITUDE)).toBe(false);
    expect(isTropicalLatitude(-40)).toBe(false);
    expect(isTropicalLatitude(Number.NaN)).toBe(false);
  });
});
