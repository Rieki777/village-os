/**
 * "You aligned on ..." names the day in the village's calendar (red team U6).
 * The first build formatted every instant in UTC, so a member in a zone
 * behind it who aligned in the evening read tomorrow's date.
 */
import { describe, expect, it } from "vitest";
import { alignedOnWords } from "./alignments";

describe("the day a member aligned", () => {
  it("is the day in the village's zone", () => {
    expect(alignedOnWords("2026-10-10T02:00:00.000Z", "America/Los_Angeles")).toBe("9 Oct 2026");
    // CONTROL: the same instant in UTC is the next day, and a civil date reads as written.
    expect(alignedOnWords("2026-10-10T02:00:00.000Z", "UTC")).toBe("10 Oct 2026");
    expect(alignedOnWords("2026-10-10", "America/Los_Angeles")).toBe("10 Oct 2026");
  });
});
