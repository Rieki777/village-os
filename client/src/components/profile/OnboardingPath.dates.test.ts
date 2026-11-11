/**
 * The first-days card says its due date as a person would ("24 November", not
 * "2026-11-24" cut across two lines), and the profile reads the day the
 * holder's own path is on to decide whether they are still in their first
 * days (audit M8, P7).
 */
import { describe, expect, it } from "vitest";
import { humanDate, ONBOARDING_WORDS, ownDay } from "./OnboardingPath";
import { FIRST_DAYS } from "@shared/roleStartWords";

describe("the first-days card", () => {
  it("writes a due date as day and month, whatever the time zone", () => {
    expect(humanDate("2026-11-24")).toBe("24 November");
    expect(humanDate("2026-01-05T23:30:00.000Z")).toBe("5 January");
    expect(ONBOARDING_WORDS.line(3, humanDate("2026-11-24"))).toBe("Day 3. The steps are due by 24 November.");
    // CONTROL: what is not a date comes back as it was.
    expect(humanDate("soon")).toBe("soon");
  });

  it("reads the day of the reader's own path only, and the first days are fourteen", () => {
    expect(FIRST_DAYS).toBe(14);
    expect(ownDay([{ mine: false, day: 2 }])).toBeNull();
    expect(ownDay([{ mine: true, day: 9 }, { mine: false, day: 2 }])).toBe(9);
    expect(ownDay([])).toBeNull();
  });
});
