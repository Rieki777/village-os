import { describe, expect, it } from "vitest";
import { bandMeets, effectiveMinAge, isAgeBand, isMinimumAgeChoice } from "./ageBands";

describe("age bands", () => {
  it("knows only the three bands", () => {
    expect(isAgeBand("18plus")).toBe(true);
    expect(isAgeBand("1990-04-01")).toBe(false);
    expect(isAgeBand(17)).toBe(false);
  });

  it("meets a minimum age only when the band's youngest age does", () => {
    expect(bandMeets("18plus", 18)).toBe(true);
    expect(bandMeets("16to17", 18)).toBe(false);
    expect(bandMeets("16to17", 16)).toBe(true);
    expect(bandMeets("under16", 16)).toBe(false);
  });

  it("asks no age of any quest while the village's minimum-age setting is off (Rye, 2026-11-09: families are encouraged)", () => {
    expect(effectiveMinAge({ physical: true, minAge: null }, false)).toBeNull();
    expect(effectiveMinAge({ physical: true, minAge: 18 }, false)).toBeNull();
    expect(effectiveMinAge({ physical: false, minAge: 16 }, false)).toBeNull();
  });

  it("asks only the minimum a quest sets once the setting is on, and nothing by default, physical or not", () => {
    expect(effectiveMinAge({ physical: true, minAge: null }, true)).toBeNull();
    expect(effectiveMinAge({ physical: true, minAge: 16 }, true)).toBe(16);
    expect(effectiveMinAge({ physical: false, minAge: 18 }, true)).toBe(18);
    expect(effectiveMinAge(null, true)).toBeNull();
  });

  it("lets a quest ask only an age a band can answer: 16 or 18", () => {
    expect(isMinimumAgeChoice(16)).toBe(true);
    expect(isMinimumAgeChoice(18)).toBe(true);
    expect(isMinimumAgeChoice(12)).toBe(false);
    expect(isMinimumAgeChoice(null)).toBe(false);
  });
});
