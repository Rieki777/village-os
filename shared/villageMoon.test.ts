/**
 * The village moon counter, at the two ends nobody looks at.
 *
 * The middle of this feature is one subtraction and it is not where the risk
 * lives. The risk is in the moons a village has no number for: the ones before
 * it started counting, and every moon of a village that has not started at
 * all. Both of those produce a zero or a negative from the obvious arithmetic,
 * and both of them reach a member's screen.
 */
import { describe, expect, it } from "vitest";
import {
  formatMoonWindow,
  isAnchorDateAcceptable,
  moonCountLabel,
  moonStanding,
  parseAnchorDate,
  villageMoon,
  villageMoonLabel,
  villageMoonOrdinal,
  villageMoonSentence,
  type VillageMoon,
} from "./villageMoon";
import { VARIABLES_BY_KEY, ringOf, validateVariable } from "./gameVariables";

/** A moon with a real window, so the labels under test are real strings. */
const moonAt = (cycleNumber: number, moonOneCycle: number | null): VillageMoon =>
  villageMoon({
    cycleNumber,
    moonOneCycle,
    startsAt: "2026-03-19T01:23:00.000Z",
    endsAt: "2026-04-17T11:52:00.000Z",
  });

describe("the ordinal", () => {
  it("counts the anchor lunation itself as Moon 1", () => {
    expect(villageMoonOrdinal(336, 336)).toBe(1);
    expect(moonStanding(336, 336)).toBe("counted");
  });

  it("counts on from there, one per lunation", () => {
    expect(villageMoonOrdinal(337, 336)).toBe(2);
    expect(villageMoonOrdinal(342, 336)).toBe(7);
    expect(villageMoonOrdinal(348, 336)).toBe(13);
  });

  it("never resets, so a village's thirtieth moon is Moon 30 and not Moon 6", () => {
    expect(villageMoonOrdinal(336 + 29, 336)).toBe(30);
  });

  /*
   * THE EDGE THAT PRODUCES A NUMBER NOBODY SHOULD SEE. Test data, an early
   * seed and a founder who moves the anchor forward all leave rows sitting
   * before Moon 1, and the obvious subtraction hands back 0 and then -1.
   */
  it("gives no number at all to a lunation before the anchor", () => {
    expect(villageMoonOrdinal(335, 336)).toBeNull();
    expect(villageMoonOrdinal(300, 336)).toBeNull();
    expect(moonStanding(335, 336)).toBe("before");
  });

  it("gives no number to any lunation when the village has no anchor", () => {
    expect(villageMoonOrdinal(336, null)).toBeNull();
    expect(villageMoonOrdinal(0, null)).toBeNull();
    expect(moonStanding(336, null)).toBe("unanchored");
  });

  it("treats an anchor that is not a number as no anchor, never as zero", () => {
    expect(villageMoonOrdinal(336, Number.NaN)).toBeNull();
    expect(moonStanding(336, Number.NaN)).toBe("unanchored");
    expect(villageMoonOrdinal(Number.NaN, 336)).toBeNull();
  });
});

describe("the window, in words", () => {
  it("keeps a last day the moon still owns part of", () => {
    // The next new moon lands at 11:52 on 17 Apr, so this moon holds eleven
    // hours of that day and the range says so.
    expect(formatMoonWindow("2026-03-19T01:23:00Z", "2026-04-17T11:52:00Z")).toBe("19 Mar to 17 Apr 2026");
  });

  it("drops a last day the moon owns no part of", () => {
    // Closing exactly at midnight means 17 Apr belongs wholly to the next
    // moon. The half-open boundary is the whole difference between these two
    // cases, and printing the boundary date in both would hand one moon a day
    // of another.
    expect(formatMoonWindow("2026-03-19T00:00:00Z", "2026-04-17T00:00:00Z")).toBe("19 Mar to 16 Apr 2026");
  });

  it("prints both years when the moon crosses one", () => {
    expect(formatMoonWindow("2025-12-20T00:00:00Z", "2026-01-19T00:00:00Z")).toBe("20 Dec 2025 to 18 Jan 2026");
  });

  it("reads the same for every member, because it is UTC and not the viewer", () => {
    // A member in Auckland and a member in Los Angeles are looking at one
    // village fact. Two answers to it would be two answers about which days a
    // moon covered.
    expect(formatMoonWindow("2026-03-19T01:23:00Z", "2026-04-17T11:52:00Z")).toBe(
      formatMoonWindow(new Date("2026-03-19T01:23:00Z"), new Date("2026-04-17T11:52:00Z")),
    );
  });

  it("says nothing rather than Invalid Date when it cannot read an instant", () => {
    expect(formatMoonWindow("not a date", "2026-04-17T00:00:00Z")).toBe("");
  });
});

describe("the count on its own, for the calendar surfaces", () => {
  /*
   * The calendar grid, the wheel, the moon roll and the .ics feed all print
   * the moon number beside dates they already have, so they take the count
   * without a window. Same three standings, same refusal to invent one.
   */
  it("names the village's own count and never the moon's place in the lunar year", () => {
    // Lunation 342 is the seventh moon since a village anchored at 336. Seven
    // is the number a member reads, whatever position that moon holds in the
    // lunar year it falls in: that position still exists, still carries the
    // moon's NAME, and is no longer a number any surface prints.
    expect(moonCountLabel(342, 336)).toBe("Moon 7");
    expect(moonCountLabel(336, 336)).toBe("Moon 1");
  });

  it("keeps counting past thirteen instead of resetting with the lunar year", () => {
    expect(moonCountLabel(365, 336)).toBe("Moon 30");
    expect(moonCountLabel(400, 336)).toBe("Moon 65");
  });

  it("says before the count rather than zero or a negative", () => {
    expect(moonCountLabel(335, 336)).toBe("Before Moon 1");
    expect(moonCountLabel(300, 336)).toBe("Before Moon 1");
  });

  it("says nothing at all for a village that has not started counting", () => {
    expect(moonCountLabel(342, null)).toBe("");
  });

  it("reads as before Moon 1 while a founder's future first moon has not arrived", () => {
    // The third standing: an anchor ahead of today is not an error, it is a
    // village whose count starts later. Everything before it is "before".
    expect(moonCountLabel(342, 400)).toBe("Before Moon 1");
    expect(moonCountLabel(400, 400)).toBe("Moon 1");
  });

  it("never prints Moon 0 or a negative for any anchor and any lunation", () => {
    for (const anchor of [null, 0, 1, 300, 336, 400]) {
      for (const cycle of [0, 1, 299, 335, 336, 337, 500]) {
        expect(moonCountLabel(cycle, anchor), `cycle ${cycle} anchored at ${anchor}`).not.toMatch(/Moon (0|-\d)/);
      }
    }
  });
});

describe("the label a member reads", () => {
  it("names the village's own moon and its dates, and no id", () => {
    const label = villageMoonLabel(moonAt(342, 336));
    expect(label).toBe("Moon 7, 19 Mar to 17 Apr 2026");
    expect(label).not.toContain("lunar-");
    expect(label).not.toContain("342");
  });

  it("shows no number and no minus sign for a moon before the count started", () => {
    const label = villageMoonLabel(moonAt(335, 336));
    expect(label).toBe("Before Moon 1, 19 Mar to 17 Apr 2026");
    expect(label).not.toContain("-1");
    expect(label).not.toContain("Moon 0");
  });

  it("shows dates alone for a village that has not started counting", () => {
    const label = villageMoonLabel(moonAt(342, null));
    expect(label).toBe("19 Mar to 17 Apr 2026");
    expect(label).not.toContain("Moon 0");
  });

  it("survives a missing moon rather than rendering the word undefined", () => {
    expect(villageMoonLabel(null)).toBe("");
    expect(villageMoonLabel(undefined)).toBe("");
  });

  it("never prints Moon 0 or a negative moon for any anchor and any lunation", () => {
    for (const anchor of [null, 300, 336, 400]) {
      for (const cycle of [0, 1, 299, 335, 336, 337, 500]) {
        const label = villageMoonLabel(moonAt(cycle, anchor));
        expect(label, `cycle ${cycle} anchored at ${anchor}`).not.toMatch(/Moon (0|-\d)/);
      }
    }
  });
});

describe("the sentence, for surfaces with room", () => {
  it("states the moon", () => {
    expect(villageMoonSentence(moonAt(342, 336))).toBe("This is Moon 7, 19 Mar to 17 Apr 2026.");
  });

  it("says where a pre-anchor moon sits without numbering it", () => {
    expect(villageMoonSentence(moonAt(335, 336))).toBe(
      "This moon runs 19 Mar to 17 Apr 2026. It falls before this village's Moon 1.",
    );
  });

  it("says the village has not started counting, rather than implying it has", () => {
    expect(villageMoonSentence(moonAt(342, null))).toBe(
      "This moon runs 19 Mar to 17 Apr 2026. This village has not set the moon it counts from yet.",
    );
  });
});

describe("the anchor a founder types", () => {
  it("reads a plain civil date as midnight UTC", () => {
    expect(parseAnchorDate("2026-03-19")?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
  });

  it("reads a full instant", () => {
    expect(parseAnchorDate("2026-03-19T14:30:00Z")?.toISOString()).toBe("2026-03-19T14:30:00.000Z");
  });

  it("treats blank as no override, which is how a village goes back to its launch", () => {
    expect(parseAnchorDate("")).toBeNull();
    expect(parseAnchorDate("   ")).toBeNull();
    expect(parseAnchorDate(null)).toBeNull();
    expect(isAnchorDateAcceptable("")).toBe(true);
  });

  it("refuses anything else, including the shapes Date would have happily guessed at", () => {
    for (const bad of ["19/03/2026", "March 2026", "2026-13-01", "moon 7", "0"]) {
      expect(parseAnchorDate(bad), bad).toBeNull();
      expect(isAnchorDateAcceptable(bad), bad).toBe(false);
    }
  });
});

describe("the founder's dial", () => {
  const def = VARIABLES_BY_KEY["village.first_moon_at"];

  it("exists, is blank by default, and is founder-held", () => {
    expect(def).toBeTruthy();
    expect(def.default).toBe("");
    // Founder ring: this is village setup, so it is admin-held and never
    // proposable. It rides the gate that already governs setup.
    expect(ringOf(def)).toBe("founder");
  });

  it("is not one of the Village Calendar's keys, so it stays visible with that module off", () => {
    // `calendar.year_anchor` owns the words "Moon 1" for the lunar YEAR and is
    // hidden with the calendar. This dial is a different number and every
    // village has one.
    expect(def.key.startsWith("calendar.")).toBe(false);
  });

  it("accepts a date and blank, and refuses a typo in the words Admin will show", () => {
    expect(validateVariable(def, "2026-03-19")).toBeNull();
    expect(validateVariable(def, "")).toBeNull();
    expect(validateVariable(def, "next spring")).toContain("2026-03-19");
  });
});

describe("a display path never throws", () => {
  /*
   * `toISOString` throws on an invalid Date, and a cycle number far enough out
   * of range overflows the Date epoch. That is reachable from a corrupt stored
   * id, and it would have been a 500 on a profile page rather than a missing
   * label.
   */
  it("assembles a moon from instants it cannot read, and says nothing about them", () => {
    const moon = villageMoon({
      cycleNumber: 999_999_999,
      moonOneCycle: 336,
      startsAt: new Date(Number.NaN),
      endsAt: new Date(Number.NaN),
    });
    expect(moon.startsAt).toBe("");
    expect(moon.endsAt).toBe("");
    expect(() => villageMoonLabel(moon)).not.toThrow();
    expect(villageMoonLabel(moon)).toBe(`Moon ${moon.ordinal}`);
  });
});
