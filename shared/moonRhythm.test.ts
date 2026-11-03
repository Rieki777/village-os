/**
 * The moon rhythm (shared/moonRhythm.ts), spec section 17 B1 as section 18
 * settles it.
 *
 *   27 October 2026: Friday 6 November and Monday 9 November; November:
 *      Friday 4 December and Monday 7 December; with the override,
 *      December's walkthrough and circle are both Monday 4 January.
 *   49 (addendum v5) the December override gives walkthrough and circle on
 *      Monday 4 January, `eom_prep` fires Wednesday 30 December, and a moon's
 *      name is the month of its full moon.
 *
 * The December override and the guide link are data a village sets; the
 * override here is a test fixture, never a default.
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "./cycleClock";
import { circleDay, circleMonday, closingNewMoonDay, EMPTY_RHYTHM, endOfMoonFriday, guideSheetLink, halfwayDay, moonName, moonNameWords, parseRhythm, prepReminderDay, walkthroughDay } from "./moonRhythm";

const TZ = "America/Costa_Rica";
const moon = (iso: string) => LUNAR_CLOCK.boundsFor(new Date(iso));
const OCT = moon("2026-11-01T12:00:00Z");
const NOV = moon("2026-11-20T12:00:00Z");
const DEC = moon("2026-12-20T12:00:00Z");

describe("the moon rhythm (check 27)", () => {
  it("gives the Friday, the Monday and the full moon for the three moons the addendum lists", () => {
    expect([endOfMoonFriday(OCT, TZ), circleMonday(OCT, TZ), halfwayDay(OCT, TZ)]).toEqual(["2026-11-06", "2026-11-09", "2026-10-25"]);
    expect([endOfMoonFriday(NOV, TZ), circleMonday(NOV, TZ), halfwayDay(NOV, TZ)]).toEqual(["2026-12-04", "2026-12-07", "2026-11-24"]);
    expect([endOfMoonFriday(DEC, TZ), circleMonday(DEC, TZ), halfwayDay(DEC, TZ)]).toEqual(["2027-01-01", "2027-01-04", "2026-12-23"]);
    expect(closingNewMoonDay(OCT, TZ)).toBe("2026-11-09");
    expect(prepReminderDay(OCT, TZ)).toBe("2026-11-04");
  });

  it("moves December's walkthrough and circle together to Monday 4 January, and eom_prep to Wednesday 30 December (check 49)", () => {
    const rhythm = { ...EMPTY_RHYTHM, cycles: { [DEC.id]: { walkthrough: "2027-01-04", circle: "2027-01-04" } } };
    expect([walkthroughDay(DEC, TZ, rhythm), circleDay(DEC, TZ, rhythm), prepReminderDay(DEC, TZ, rhythm)]).toEqual(["2027-01-04", "2027-01-04", "2026-12-30"]);
    expect([walkthroughDay(NOV, TZ, rhythm), circleDay(NOV, TZ, rhythm)]).toEqual(["2026-12-04", "2026-12-07"]);
    expect([endOfMoonFriday, circleMonday]).toEqual([walkthroughDay, circleDay]);
  });

  it("names a moon by the month of its full moon", () => {
    expect([moonName(OCT, TZ), moonName(NOV, TZ), moonName(DEC, TZ)]).toEqual(["October", "November", "December"]);
    expect(moonNameWords(OCT, TZ)).toBe("the October Moon");
  });

  it("shows no guide link anywhere until the village sets one (check 50, the pure half)", () => {
    expect(EMPTY_RHYTHM.guideUrl).toBe("");
    expect(guideSheetLink(EMPTY_RHYTHM)).toBeNull();
    expect(guideSheetLink({ guideUrl: "https://example.org/guide" })).toBe("https://example.org/guide#sheet");
  });

  it("reads the rhythm document, empty by default", () => {
    expect(parseRhythm(undefined)).toEqual({ ok: true, value: { sendHour: 9, guideUrl: "", cycles: {} } });
    expect(parseRhythm({ sendHour: 8, guideUrl: "https://example.org/g", cycles: { [DEC.id]: { walkthrough: "2027-01-04", circle: "2027-01-04" } } }))
      .toEqual({ ok: true, value: { sendHour: 8, guideUrl: "https://example.org/g", cycles: { [DEC.id]: { walkthrough: "2027-01-04", circle: "2027-01-04" } } } });
    expect(parseRhythm({ sendHour: 24 }).ok).toBe(false);
    expect(parseRhythm({ guideUrl: "http://example.org/g" }).ok).toBe(false);
    expect(parseRhythm({ guideUrl: "https://example.org/g#sheet" }).ok).toBe(false);
    expect(parseRhythm({ cycles: { [DEC.id]: { walkthrough: "2027-01-04", circle: "2027-01-01" } } }).ok).toBe(false);
  });
});
