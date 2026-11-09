import { describe, expect, it } from "vitest";
import { effortGuess } from "./questEffortGuess";

/** The duration lines on the live board, 2026-11-09, and what the desk opens with. */
describe("a first guess at a quest's effort, read off its card", () => {
  it("reads a range in hours and starts at its middle", () => {
    expect(effortGuess("Per event (3-6 hrs)")).toEqual({ hours: 4.5, low: 3, high: 6 });
    expect(effortGuess("4-6 hours")).toEqual({ hours: 5, low: 4, high: 6 });
    expect(effortGuess("Per meeting (2-3 hrs)")).toEqual({ hours: 2.5, low: 2, high: 3 });
    expect(effortGuess("Night shift (6-8 hrs)")).toEqual({ hours: 7, low: 6, high: 8 });
  });

  it("reads a full day and a half day", () => {
    expect(effortGuess("Full day")).toEqual({ hours: 8, low: 6, high: 9 });
    expect(effortGuess("Half day (monthly)")).toEqual({ hours: 4, low: 3, high: 5 });
  });

  it("makes no guess where the card names no effort", () => {
    for (const d of ["Per event", "Per retreat", "Flexible / ongoing", "Project-based", "Per session", "", null]) {
      expect(effortGuess(d)).toBeNull();
    }
  });
});
