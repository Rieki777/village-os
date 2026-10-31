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
  // THIS FIXTURE SENDS `Circle` AS A STRING, and that is the shape the live
  // service does NOT send: a role's circle there is a relation (see the last
  // describe). A string fixture is what hid the 2026-10-09 defect, where all
  // 56 seats lost their circle. It stays because a plain name must still be
  // read, and it is no longer the only shape under test.
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

  it("CARRIES THE STATUS AS THE SOURCE WROTE IT, and never turns it into recruiting", () => {
    // The values are known now (Active, Proposed, Vacant, Archived) and their
    // meaning is applied by the structure plan. Whether a village advertises a
    // seat is still the village's call, so `recruiting` is never set here.
    const r = proposeStructure(
      [
        role("r-1", {
          "Role Name": "Water Steward",
          Status: "Vacant",
          "Role Type": "Steward",
          "Assignment Method": "Appointed",
          "Next Audit Date": "2027-01-15",
        }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).toEqual({ name: "Water Steward", sourceStatus: "Vacant", id: "r-1" });
    expect(r.payload.seats[0]).not.toHaveProperty("recruiting");
    expect(r.unmapped).toEqual(["Assignment Method", "Next Audit Date", "Role Type"]);
  });

  it("CARRIES WHAT THE SOURCE HOLDS A ROLE TO PAY beside the seat, and never into it", () => {
    const r = proposeStructure(
      [
        role("r-1", {
          "Role Name": "Finance Steward",
          "Compensation Model": { name: "Part-Time Salaried" },
          "Compensation Status": { name: "Active" },
          "Compensation Terms": [{ plain_text: "Twenty hours a week." }],
          "Compensation Target (Monthly)": { number: 1500 },
        }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).toEqual({
      name: "Finance Steward",
      sourcePay: { model: "Part-Time Salaried", status: "Active", terms: "Twenty hours a week.", monthlyUsd: 1500 },
      id: "r-1",
    });
    // Read, so never reported as a field this chart has no home for.
    expect(r.unmapped).toEqual([]);
    // Nothing a seat is paid with is set from it.
    for (const k of ["valueMinor", "valueTokens", "cashMinor", "termsOffer"]) {
      expect(r.payload.seats[0]).not.toHaveProperty(k);
    }
  });

  it("carries no pay at all when the source holds none", () => {
    const r = proposeStructure([role("r-1", { "Role Name": "Greeter", "Compensation Target (Monthly)": null })], {
      sourceName: SOURCE,
    });
    expect(r.payload.seats[0]).not.toHaveProperty("sourcePay");
  });

  it("skips a seat with no name rather than proposing a blank one", () => {
    const r = proposeStructure([role("r-1", { Status: "Active", Body: "Someone should do this." })], {
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
      [role("r-1", { "Role Name": "Water Steward", Body: "Ask mika@example.test." })],
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
    expect(r.payload.rationale).toContain("one role");
    expect(r.payload.rationale).toContain("Nothing here is part of this village's chart until you accept it.");
    expect(r.payload.rationale).toContain("Who holds each role is not included");
  });

  it("does not quietly drop a record kind it was not built for", () => {
    const r = proposeStructure([{ id: "t-1", kind: "tension", fields: { Tension: "x" } }], {
      sourceName: SOURCE,
    });
    expect(r.skipped).toEqual([{ id: "t-1", reason: "not-a-role" }]);
  });
});

/**
 * THE SHAPES THE SERVICE ACTUALLY SENDS. Its store is Notion-backed: a role's
 * `Circle` is a relation (a list of page ids, or of objects carrying an id and
 * sometimes a name), `Status` may be a select, and `Body` may be rich text or
 * absent from a list read. Ids are page-id shaped, as in the live payload.
 */
describe("the shape the service actually sends", () => {
  const LAND = "3ed0a88e-f36a-8104-80fa-cd2bfe15c001";
  const OLD = "3ed0a88e-f36a-8104-80fa-cd2bfe15c002";
  const MONEY = "3ed0a88e-f36a-8104-80fa-cd2bfe15c003";
  const circles = [
    circle(LAND, { "Circle Name": "Land & Ecology", Status: "Active" }),
    circle(OLD, { "Circle Name": "Old Hearth", Status: "Archived", Notes: "Archived 2026-09-22, superseded." }),
    circle(MONEY, { "Circle Name": "Economics & Finance", Status: { name: "Proposed" } }),
  ];

  it("PLACES A ROLE WHOSE CIRCLE IS A LIST OF PAGE IDS, which is what the live sync lost", () => {
    const r = proposeStructure(
      [role("r-1", { "Role Name": "Water Steward", Circle: [LAND], Status: "Active" }), ...circles],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats).toEqual([
      { name: "Water Steward", circleName: "Land & Ecology", sourceCircleStatus: "Active", sourceStatus: "Active", id: "r-1" },
    ]);
    expect(r.circles).toMatchObject({ placed: 1, unresolved: 0, absent: 0, shapes: ["list of 1 id"] });
  });

  it("places a role whose circle is a list of objects, with or without a name", () => {
    const r = proposeStructure(
      [
        ...circles,
        role("r-1", { "Role Name": "Water Steward", Circle: [{ id: LAND }] }),
        role("r-2", { "Role Name": "Treasurer", Circle: [{ id: MONEY, name: "Economics & Finance" }] }),
        role("r-3", { "Role Name": "Hearth Keeper", Circle: { id: "not-in-this-read", name: "Hearth" } }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats.map((s) => s.circleName)).toEqual(["Land & Ecology", "Economics & Finance", "Hearth"]);
  });

  it("KEEPS THE NAME OF AN ARCHIVED CIRCLE AND FLAGS IT, so the page can say so", () => {
    const r = proposeStructure([...circles, role("r-1", { "Role Name": "Cook", Circle: [OLD] })], { sourceName: SOURCE });
    expect(r.payload.seats[0]).toMatchObject({ circleName: "Old Hearth", sourceCircleStatus: "Archived" });
    expect(r.circles.inArchived).toBe(1);
  });

  it("takes the first of several circles and reports the rest", () => {
    const r = proposeStructure([...circles, role("r-1", { "Role Name": "Bridge", Circle: [LAND, MONEY] })], {
      sourceName: SOURCE,
    });
    expect(r.payload.seats[0]).toMatchObject({ circleName: "Land & Ecology", sourceOtherCircles: ["Economics & Finance"] });
    expect(r.circles.several).toBe(1);
  });

  it("NEVER INVENTS A CIRCLE from an id the read does not hold, and says it pointed somewhere", () => {
    const r = proposeStructure(
      [...circles, role("r-1", { "Role Name": "Water Steward", Circle: ["3ed0a88e-f36a-8104-80fa-cd2bfe15c999"] })],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).not.toHaveProperty("circleName");
    expect(r.payload.seats[0].sourceCircleUnresolved).toBe(true);
    expect(r.circles.unresolved).toBe(1);
    expect(r.payload.rationale).toContain("One role arrived with no circle this village could read.");
  });

  it("carries the aim from a rich-text Body, and leaves it out when Body is absent", () => {
    const r = proposeStructure(
      [
        role("r-1", { "Role Name": "Water Steward", Body: [{ plain_text: "Holds the " }, { plain_text: "water." }] }),
        role("r-2", { "Role Name": "Treasurer" }),
      ],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0].aim).toBe("Holds the water.");
    expect(r.payload.seats[1]).not.toHaveProperty("aim");
  });

  it("still refuses a Body carrying an address, and still drops the holders", () => {
    const r = proposeStructure(
      [role("r-1", { "Role Name": "Water Steward", Body: [{ plain_text: "Ask mika@example.test" }], "Active Holders": [{ id: "p-1" }] })],
      { sourceName: SOURCE },
    );
    expect(r.payload.seats[0]).toEqual({ name: "Water Steward", id: "r-1" });
    expect(r.addressesSeen).toEqual([{ id: "r-1", fields: ["Body"] }]);
    expect(r.unmapped).toContain("Active Holders");
  });

  it("reads a select-shaped Status", () => {
    const r = proposeStructure([role("r-1", { "Role Name": "Treasurer", Status: { name: "Proposed" } })], { sourceName: SOURCE });
    expect(r.payload.seats[0].sourceStatus).toBe("Proposed");
  });

  it("does not report an archived circle as an empty one", () => {
    const r = proposeStructure([...circles, role("r-1", { "Role Name": "Water Steward", Circle: [LAND] })], {
      sourceName: SOURCE,
    });
    expect(r.payload.rationale).toContain("Economics & Finance");
    expect(r.payload.rationale).not.toContain("Old Hearth");
  });
});
