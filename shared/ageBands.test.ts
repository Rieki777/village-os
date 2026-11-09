import { describe, expect, it } from "vitest";
import { bandMeets, effectiveMinAge, isAgeBand } from "./ageBands";

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

  it("asks 18 of a physical quest that names no age, never below 16 for one that does, and nothing of the rest", () => {
    expect(effectiveMinAge({ physical: true, minAge: null })).toBe(18);
    expect(effectiveMinAge({ physical: true, minAge: 16 })).toBe(16);
    expect(effectiveMinAge({ physical: true, minAge: 12 })).toBe(16);
    expect(effectiveMinAge({ physical: false, minAge: null })).toBeNull();
    expect(effectiveMinAge({ physical: false, minAge: 14 })).toBe(14);
    expect(effectiveMinAge(null)).toBeNull();
  });
});
