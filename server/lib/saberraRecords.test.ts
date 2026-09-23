/**
 * THE BOUNDARY THAT KEEPS NAMES OUT OF THE CHART.
 *
 * Rye's decision of 2026-09-23 is that the org chart takes structure and state
 * from the outside service and no personal information. This file is where
 * that decision is held to, because the decision is one sentence and the
 * failure is silent: a name crosses, the module's data class is wrong, and the
 * three protections that class requires were never built.
 *
 * The cases below are the vendor's REAL field names, read off their live
 * connector on 2026-09-23, rather than names invented for a test.
 */
import { describe, expect, it } from "vitest";
import { readVendorRecord, shownFields } from "./saberraRecords";

describe("reading a vendor record", () => {
  it("takes a circle's structure and leaves its people behind", () => {
    const r = readVendorRecord("circle", {
      "Circle Name": "Regenerative Business",
      Status: "Active",
      Sector: "Ventures",
      Notes: "Runs its own weekly rhythm.",
      "Next Review Date": "2026-12-01",
      // Every one of these names or reaches people.
      "Circle Members": ["Jess", "Ky"],
      "Circle Decisions": ["d-1"],
      "Circle Meetings": ["m-1"],
    });
    expect(r.fields).toEqual({
      "Circle Name": "Regenerative Business",
      Status: "Active",
      Sector: "Ventures",
      Notes: "Runs its own weekly rhythm.",
      "Next Review Date": "2026-12-01",
    });
    expect(r.ignored).toEqual(["Circle Decisions", "Circle Meetings", "Circle Members"]);
  });

  it("takes a role and never its holders", () => {
    const r = readVendorRecord("role", {
      "Role Name": "Finance Steward",
      Circle: "Economics & Finance",
      Status: "Filled",
      "Role Type": "Steward",
      "Assignment Method": "Appointed",
      "Next Audit Date": "2027-01-15",
      "Active Holders": ["Kyleen"],
    });
    expect(r.fields["Role Name"]).toBe("Finance Steward");
    expect(r.fields).not.toHaveProperty("Active Holders");
    expect(r.ignored).toContain("Active Holders");
  });

  it("keeps the seat a risk belongs to and drops the person holding it", () => {
    // Owner Role is a seat. Owner is a person. The first is structure.
    const r = readVendorRecord("risk", {
      Risk: "Surveys expire before the subdivision lands",
      Severity: "High",
      Status: "Open",
      "Owner Role": "On-Ground Project Manager",
      Owner: "Michael",
      "Collapse Pattern Type": "Single point of failure",
    });
    expect(r.fields["Owner Role"]).toBe("On-Ground Project Manager");
    expect(r.fields).not.toHaveProperty("Owner");
    expect(r.ignored).toEqual(["Owner"]);
  });

  it("shows a tension and keeps who felt it out of the village's database", () => {
    const r = readVendorRecord("tension", {
      Tension: "Two circles both think they own the buyer list",
      Status: "Open",
      Type: "Role clarity",
      "Affected Roles": ["Sales Lead", "Marketing Lead"],
      "Sensed By": "Jess",
      Meeting: "m-14",
    });
    expect(r.fields.Tension).toContain("buyer list");
    expect(r.fields).not.toHaveProperty("Sensed By");
    expect(r.ignored).toEqual(["Meeting", "Sensed By"]);
  });

  it("DROPS A FIELD NOBODY HAS MAPPED YET, which is the whole reason this is an allow list", () => {
    // The vendor adds a field next month. With a deny list it would arrive
    // allowed by default, and a name would ride in behind it.
    const r = readVendorRecord("circle", {
      "Circle Name": "Land & Ecology",
      "Primary Contact": "ana@example.test",
      "Steward Phone": "+506 8888 8888",
    });
    expect(r.fields).toEqual({ "Circle Name": "Land & Ecology" });
    expect(r.ignored).toEqual(["Primary Contact", "Steward Phone"]);
  });

  it("drops an allowed field whose value carries an address, and says so separately", () => {
    // Notes is allowed, and a note can still hold somebody's address.
    const r = readVendorRecord("circle", {
      "Circle Name": "Governance & Coordination",
      Notes: "Ask jess@amora.test before changing the rhythm.",
      Status: "Active",
    });
    expect(r.fields).toEqual({ "Circle Name": "Governance & Coordination", Status: "Active" });
    expect(r.droppedForAnAddress).toEqual(["Notes"]);
    // Not conflated with the unmapped ones: they mean different things.
    expect(r.ignored).toEqual([]);
  });

  it("finds an address nested inside a value, not only at the top", () => {
    const r = readVendorRecord("risk", {
      Risk: "Water letters went late",
      Evidence: "ignored anyway",
      "Related Circles": [{ name: "Land & Ecology", contact: "surveyor@example.test" }],
    });
    expect(r.fields).not.toHaveProperty("Related Circles");
    expect(r.droppedForAnAddress).toEqual(["Related Circles"]);
  });

  it("answers an empty record rather than throwing, for every shape a vendor can send", () => {
    for (const bad of [null, undefined, 42, "text", [], true]) {
      const r = readVendorRecord("circle", bad);
      expect(r.fields).toEqual({});
      expect(r.ignored).toEqual([]);
    }
  });

  it("can say what it will show, so a card never promises a field this drops", () => {
    expect(shownFields("role")).toContain("Role Name");
    expect(shownFields("role")).not.toContain("Active Holders");
    expect(shownFields("tension")).not.toContain("Sensed By");
  });
});
