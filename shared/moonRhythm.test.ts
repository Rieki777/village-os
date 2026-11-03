/**
 * The moon rhythm (shared/moonRhythm.ts), spec section 17 B1 as section 18
 * settles it. Check 27: for the October 2026 moon the rhythm gives Friday 6
 * November and Monday 9 November; for November, Friday 4 December and Monday
 * 7 December; an override moves December's Friday off 1 January.
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "./cycleClock";
import { circleMonday, closingNewMoonDay, EMPTY_RHYTHM, endOfMoonFriday, halfwayDay, parseRhythm, prepReminderDay } from "./moonRhythm";

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

  it("lets a village move December's Friday off New Year's Day, and the Monday follows unless moved too", () => {
    const rhythm = { ...EMPTY_RHYTHM, cycles: { [DEC.id]: { friday: "2026-12-31" } } };
    expect(endOfMoonFriday(DEC, TZ, rhythm)).toBe("2026-12-31");
    expect(circleMonday(DEC, TZ, rhythm)).toBe("2027-01-04");
    expect(circleMonday(DEC, TZ, { ...rhythm, cycles: { [DEC.id]: { friday: "2026-12-31", monday: "2027-01-05" } } })).toBe("2027-01-05");
    expect(endOfMoonFriday(NOV, TZ, rhythm)).toBe("2026-12-04");
  });

  it("reads the rhythm document, empty by default", () => {
    expect(parseRhythm(undefined)).toEqual({ ok: true, value: { sendHour: 9, cycles: {} } });
    expect(parseRhythm({ sendHour: 8, cycles: { [DEC.id]: { friday: "2026-12-31" } } })).toEqual({ ok: true, value: { sendHour: 8, cycles: { [DEC.id]: { friday: "2026-12-31" } } } });
    expect(parseRhythm({ sendHour: 24 }).ok).toBe(false);
    expect(parseRhythm({ cycles: { [DEC.id]: { friday: "2027-01-04", monday: "2027-01-01" } } }).ok).toBe(false);
  });
});
