import { describe, expect, it } from "vitest";
import { addBusinessDays, isBusinessDay, isWithinBusinessDays } from "./businessDays";

const CR = "America/Costa_Rica"; // UTC-6 all year
const LON = "Europe/London";
const NY = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("addBusinessDays", () => {
  it("skips the weekend: Friday plus 2 is Tuesday, same wall-clock time", () => {
    // Fri 23 Oct 2026, 10:00 in Costa Rica.
    expect(addBusinessDays(at("2026-10-23T16:00:00Z"), 2, CR).toISOString()).toBe("2026-10-27T16:00:00.000Z");
  });

  it("Monday plus 2 is Wednesday, and 0 is the same instant", () => {
    const mon = at("2026-10-19T15:30:00Z");
    expect(addBusinessDays(mon, 2, CR).toISOString()).toBe("2026-10-21T15:30:00.000Z");
    expect(addBusinessDays(mon, 0, CR).toISOString()).toBe(mon.toISOString());
  });

  it("a weekend start counts from Monday 00:00, so 2 business days end as Wednesday begins", () => {
    // Sat 24 Oct 2026, 14:00 in Costa Rica.
    expect(addBusinessDays(at("2026-10-24T20:00:00Z"), 2, CR).toISOString()).toBe("2026-10-28T06:00:00.000Z");
    // Sunday likewise.
    expect(addBusinessDays(at("2026-10-25T20:00:00Z"), 2, CR).toISOString()).toBe("2026-10-28T06:00:00.000Z");
  });

  it("reads the day in the village's zone: the same instant is Friday in one zone and Saturday in another", () => {
    const instant = at("2026-10-24T03:00:00Z"); // Fri 21:00 in Costa Rica, Sat 03:00 in UTC
    expect(isBusinessDay(instant, CR)).toBe(true);
    expect(isBusinessDay(instant, "UTC")).toBe(false);
    expect(addBusinessDays(instant, 2, CR).toISOString()).toBe("2026-10-28T03:00:00.000Z"); // Tue 21:00 CR
    expect(addBusinessDays(instant, 2, "UTC").toISOString()).toBe("2026-10-28T00:00:00.000Z"); // Wed 00:00 UTC
  });

  it("keeps the wall-clock time across a daylight change forward (London, 29 Mar 2026)", () => {
    // Fri 27 Mar 09:00 GMT; Tue 31 Mar 09:00 is BST, an hour earlier in UTC.
    expect(addBusinessDays(at("2026-03-27T09:00:00Z"), 2, LON).toISOString()).toBe("2026-03-31T08:00:00.000Z");
  });

  it("keeps the wall-clock time across a daylight change back (New York, 1 Nov 2026)", () => {
    // Fri 30 Oct 09:00 EDT is 13:00Z; Tue 3 Nov 09:00 EST is 14:00Z.
    expect(addBusinessDays(at("2026-10-30T13:00:00Z"), 2, NY).toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });

  it("carries seconds and milliseconds along", () => {
    expect(addBusinessDays(at("2026-10-19T15:30:12.345Z"), 1, CR).toISOString()).toBe("2026-10-20T15:30:12.345Z");
  });
});

describe("isWithinBusinessDays", () => {
  const fri = at("2026-10-23T16:00:00Z");
  it("is true up to and including the deadline, false after it", () => {
    expect(isWithinBusinessDays(fri, at("2026-10-27T16:00:00Z"), 2, CR)).toBe(true);
    expect(isWithinBusinessDays(fri, at("2026-10-27T16:00:01Z"), 2, CR)).toBe(false);
  });
  it("a weekend in between costs nothing: answered Monday evening is in time", () => {
    expect(isWithinBusinessDays(fri, at("2026-10-27T00:00:00Z"), 2, CR)).toBe(true);
  });
  it("an end before the start is never within", () => {
    expect(isWithinBusinessDays(fri, at("2026-10-22T16:00:00Z"), 2, CR)).toBe(false);
  });
});
