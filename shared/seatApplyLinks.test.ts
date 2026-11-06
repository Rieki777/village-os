/**
 * The address "Propose these" builds is the address the wizard reads back.
 */
import { describe, expect, it } from "vitest";
import { applySeatsHref, MAX_SEATS_IN_LINK, seatsFromSearch } from "./seatApplyLinks";

describe("several seats in one address", () => {
  it("writes each seat as its own seat parameter, and reads them back in order", () => {
    const href = applySeatsHref(["seat-host", "seat kitchen", "seat-orchard"]);
    expect(href).toBe("/propose?type=role_application&seat=seat-host&seat=seat+kitchen&seat=seat-orchard");
    expect(seatsFromSearch(href.slice(href.indexOf("?")))).toEqual(["seat-host", "seat kitchen", "seat-orchard"]);
  });

  it("with no seats, opens the wizard on the type with nothing picked, and a season when named", () => {
    expect(applySeatsHref([])).toBe("/propose?type=role_application");
    expect(applySeatsHref([], { seasonId: "s-next" })).toBe("/propose?type=role_application&season=s-next");
  });

  it("reads seats=a,b too, drops blanks and repeats, and stops at a bound", () => {
    expect(seatsFromSearch("?seats=a,%20b%20,,a&seat=b&seat=c")).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: MAX_SEATS_IN_LINK + 7 }, (_, i) => `s${i}`).join(",");
    expect(seatsFromSearch(`?seats=${many}`)).toHaveLength(MAX_SEATS_IN_LINK);
    expect(seatsFromSearch(`?seat=${"x".repeat(129)}`)).toEqual([]);
  });
});
