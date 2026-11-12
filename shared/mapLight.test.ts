import { describe, expect, it } from "vitest";
import { LIGHT_CAP, LIGHT_FLOOR, lightsShown, readMapLight } from "./mapLight";

describe("a member's light on the map is off unless they chose it", () => {
  it("reads only a literal true as on", () => {
    expect(readMapLight({ mapLight: true })).toBe(true);
    for (const v of [undefined, null, false, "true", 1, "on", {}]) {
      expect(readMapLight({ mapLight: v })).toBe(false);
    }
    expect(readMapLight(null)).toBe(false);
    expect(readMapLight(undefined)).toBe(false);
    expect(readMapLight({})).toBe(false);
    // Erasure empties prefs to {}: off.
    expect(readMapLight({ notify: { emailsOff: true } })).toBe(false);
  });
});

describe("a hearth's lights never point at one person and never become a tally", () => {
  it("shows none below the floor", () => {
    expect(LIGHT_FLOOR).toBe(2);
    expect(lightsShown(0)).toBe(0);
    expect(lightsShown(1)).toBe(0);
  });

  it("shows the people from the floor up, held to the cap", () => {
    expect(lightsShown(2)).toBe(2);
    expect(lightsShown(5)).toBe(5);
    expect(lightsShown(LIGHT_CAP)).toBe(LIGHT_CAP);
    expect(lightsShown(40)).toBe(LIGHT_CAP);
  });

  it("refuses junk", () => {
    expect(lightsShown(Number.NaN)).toBe(0);
    expect(lightsShown(-3)).toBe(0);
    expect(lightsShown(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
