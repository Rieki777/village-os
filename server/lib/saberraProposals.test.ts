/**
 * What a steward is actually handed when the outside service suggests a
 * structure. Two promises are under test and they pull in opposite directions:
 * the suggestion has to be rich enough to be worth reviewing, and it has to
 * carry no person and no guess.
 */
import { describe, expect, it } from "vitest";
import { proposeStructure, type VendorRecord } from "./saberraProposals";

const SOURCE = "Saberra";
const role = (id: string, fields: Record<string, unknown>): VendorRecord => ({ id, kind: "role", fields });
const circle = (id: string, fields: Record<string, unknown>): VendorRecord => ({ id, kind: "circle", fields });

describe("suggesting a structure", () => {
  it("turns a role into a seat a steward can read, aim and all", () => {
    const r = proposeStructure(
      [
        role("r-1", {
          "Role Name": "Water Steward",
          Circle: "Land & Ecology",
          Body: "Holds the village's relationship with its water.",
        }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.kind).toBe("org.proposed");
    expect(r.payload.seats).toEqual([
      {
        name: "Water Steward",
        circleName: "Land & Ecology",
        aim: "Holds the village's relationship with its water.",
        id: "r-1",
      },
    ]);
    expect(r.skipped).toEqual([]);
  });

  it("stops a holder at BOTH doors, so neither one alone is load-bearing", () => {
    // Two allow-lists stand between a vendor record and a seat, and this pins
    // the second one. The boundary drops `Active Holders` because it is not an
    // allowed field; `SEAT_FROM` would drop it again because it maps to no seat
    // key. Worth a test of its own precisely BECAUSE the first door makes it
    // look redundant: a neuter that removes the boundary entirely leaves this
    // green, and the tests that go red are the address ones below. So this is
    // not evidence the boundary works — it is evidence a holder cannot become a
    // seat field even if the boundary is one day bypassed.
    const r = proposeStructure(
      [role("r-1", { "Role Name": "Finance Steward", "Active Holders": ["Kyleen"] })],
      { sourceName: SOURCE },
    );
    expect(JSON.stringify(r.payload.seats)).not.toContain("Kyleen");
    expect(r.payload.seats[0]).toEqual({ name: "Finance Steward", id: "r-1" });
    expect(r.unmapped).toContain("Active Holders");
  });

  it("GUESSES NO ENUMERATION: a status we have never been sent is reported, not mapped", () => {
    // Mapping Status onto `recruiting` would silently advertise every seat in a
    // village, or silently fail to, depending on a guess about their values.
    const r = proposeStructure(
      [
        role("r-1", {
          "Role Name": "Water Steward",
          Status: "Filled",
          "Role Type": "Steward",
          "Assignment Method": "Appointed",
          "Next Audit Date": "2027-01-15",
        }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).toEqual({ name: "Water Steward", id: "r-1" });
    expect(r.payload.seats[0]).not.toHaveProperty("recruiting");
    expect(r.unmapped).toEqual(["Assignment Method", "Next Audit Date", "Role Type", "Status"]);
  });

  it("skips a seat with no name rather than proposing a blank one", () => {
    const r = proposeStructure([role("r-1", { Status: "Open", Body: "Someone should do this." })], {
      sourceName: SOURCE,
    });
    expect(r.payload.seats).toEqual([]);
    expect(r.skipped).toEqual([{ id: "r-1", reason: "no-name" }]);
  });

  it("says so when a record was emptied at the boundary, rather than reporting no name", () => {
    const r = proposeStructure([role("r-1", { "Active Holders": ["Jess"], Meeting: "m-1" })], {
      sourceName: SOURCE,
    });
    expect(r.skipped).toEqual([{ id: "r-1", reason: "everything-was-dropped" }]);
  });

  it("keeps the rest of a seat when one field carried an address, and names the record", () => {
    const r = proposeStructure(
      [role("r-1", { "Role Name": "Water Steward", Body: "Ask mika@amora.test." })],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).toEqual({ name: "Water Steward", id: "r-1" });
    expect(r.addressesSeen).toEqual([{ id: "r-1", fields: ["Body"] }]);
  });

  it("tells a steward a circle arrived with no seats in it", () => {
    const r = proposeStructure(
      [
        circle("c-1", { "Circle Name": "Land & Ecology" }),
        circle("c-2", { "Circle Name": "Economics & Finance" }),
        role("r-1", { "Role Name": "Water Steward", Circle: "Land & Ecology" }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats).toHaveLength(1);
    expect(r.payload.rationale).toContain("Economics & Finance");
    expect(r.payload.rationale).not.toContain("Land & Ecology");
  });

  it("leads with what it is and what it is not, because that is read before anything is accepted", () => {
    const r = proposeStructure([role("r-1", { "Role Name": "Water Steward" })], { sourceName: SOURCE });
    expect(r.payload.title).toBe("Structure suggested by Saberra");
    expect(r.payload.rationale).toContain("one seat");
    expect(r.payload.rationale).toContain("Nothing here is part of this village's chart until you accept it.");
    expect(r.payload.rationale).toContain("Who holds each seat is not included");
  });

  it("does not quietly drop a record kind it was not built for", () => {
    const r = proposeStructure([{ id: "t-1", kind: "tension", fields: { Tension: "x" } }], {
      sourceName: SOURCE,
    });
    expect(r.skipped).toEqual([{ id: "t-1", reason: "not-a-role" }]);
  });
});
