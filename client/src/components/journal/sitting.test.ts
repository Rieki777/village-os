/**
 * Which practice the hour suggests. The small hours belong to the evening:
 * somebody writing at half past one is closing a long day, the same line the
 * guide draws when it treats 22:00 to 04:59 as writing late.
 */
import { describe, expect, it } from "vitest";
import { suggestedPractice } from "./sitting";

describe("suggestedPractice", () => {
  it.each([
    [0, "evening"],
    [1, "evening"],
    [4, "evening"],
    [5, "morning"],
    [11, "morning"],
    [12, null],
    [17, null],
    [18, "evening"],
    [23, "evening"],
  ] as const)("at %i:00 suggests %s", (hour, practice) => {
    expect(suggestedPractice(hour)).toBe(practice);
  });

  it("names a suggestion or none for every hour of the day", () => {
    const seen = new Set(Array.from({ length: 24 }, (_, h) => suggestedPractice(h)));
    expect([...seen].sort()).toEqual(["evening", "morning", null].sort());
  });
});
