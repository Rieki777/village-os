/**
 * The load check on a role proposal's terms step (role proposals PR C): each
 * role's time read as hours a week where the words say an amount, the sum,
 * and the plain sentence when it goes past a full season. A time that does
 * not say an amount is named and left out, never guessed.
 */
import { describe, expect, it } from "vitest";
import { FULL_SEASON_HOURS, hoursAWeek, LOAD_WORDS, loadCheck } from "./roleProposalLoad";

describe("one role's time as hours a week", () => {
  it.each([
    ["8 hours a week", 8],
    ["About 10 hrs per week", 10],
    ["6-8 hours a week", 8],
    ["6 to 8 h/week", 8],
    ["2 days a week", 16],
    ["Half time", 20],
    ["Full-time", 40],
    ["50%", 20],
    ["1,5 days per week", 12],
  ])("reads %s as %s", (words, hours) => {
    expect(hoursAWeek(words)).toBe(hours);
  });

  it("reads hours a moon as a week's share", () => {
    expect(hoursAWeek("20 hours a moon")).toBeCloseTo((20 * 7) / 29.53, 5);
  });

  it.each([["Part of a full-time season"], ["Part-time"], ["Mornings"], [""], [null]])("does not guess at %s", (words) => {
    expect(hoursAWeek(words as string | null)).toBeNull();
  });
});

describe("the whole check", () => {
  it("says plainly when the roles go past a full season", () => {
    const c = loadCheck([
      { name: "Kitchen keeper", time: "30 hours a week" },
      { name: "Orchard keeper", time: "3 days a week" },
    ]);
    expect(c.hours).toBe(54);
    expect(c.over).toBe(true);
    expect(c.lines).toEqual([LOAD_WORDS.over(54)]);
    expect(c.lines[0]).toBe(`Together these roles ask for about 54 hours a week. That is more than a full season of ${FULL_SEASON_HOURS} hours a week.`);
  });

  it("says it fits when it does, and names what it left out and why", () => {
    const c = loadCheck([
      { name: "Kitchen keeper", time: "10 hours a week" },
      { name: "Steward", time: "Part of a full-time season" },
      { name: "Gate keeper", time: null },
    ]);
    expect(c.over).toBe(false);
    expect(c.lines).toEqual([LOAD_WORDS.within(10), LOAD_WORDS.leftOut]);
    expect(c.notCounted).toEqual([
      { name: "Steward", why: '"Part of a full-time season" does not say how many hours' },
      { name: "Gate keeper", why: "No time written yet" },
    ]);
  });

  it("exactly a full season fits", () => {
    expect(loadCheck([{ name: "A", time: "Full time" }]).over).toBe(false);
  });

  it("with nothing countable, says there is nothing to add up", () => {
    expect(loadCheck([{ name: "A", time: "Part of a full-time season" }]).lines).toEqual([LOAD_WORDS.noneCounted]);
    expect(loadCheck([]).lines).toEqual([LOAD_WORDS.noRoles]);
  });
});
