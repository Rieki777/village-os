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
import { readVendorRecord, shownFields, type SaberraRecordKind } from "./saberraRecords";

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
      // Out of alphabetical order on purpose: the assertion below pins the
      // fact that what was left behind comes back sorted, so a steward reading
      // it is not handed the vendor's arrival order as though it meant something.
      "Steward Phone": "+506 8888 8888",
      "Primary Contact": "ana@example.test",
    });
    expect(r.fields).toEqual({ "Circle Name": "Land & Ecology" });
    expect(r.ignored).toEqual(["Primary Contact", "Steward Phone"]);
  });

  it("drops an allowed field whose value carries an address, and says so separately", () => {
    // Notes is allowed, and a note can still hold somebody's address.
    const r = readVendorRecord("circle", {
      "Circle Name": "Governance & Coordination",
      Notes: "Ask jess@example.test before changing the rhythm.",
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

  it("takes the role page's text, because a seat with no aim is a job title", () => {
    const r = readVendorRecord("role", {
      "Role Name": "Water Steward",
      Body: "Holds the village's relationship with its water: the springs, the tanks, the lines.",
      "Last Audit Date": "2026-06-01",
    });
    expect(r.fields.Body).toContain("springs");
    expect(r.fields["Last Audit Date"]).toBe("2026-06-01");
    expect(r.ignored).toEqual([]);
  });

  it("still drops that text when it carries an address, like any other field", () => {
    // Body is the one allowed field most likely to carry one, being free prose.
    const r = readVendorRecord("role", {
      "Role Name": "Water Steward",
      Body: "Holds the water. Questions to mika@example.test.",
    });
    expect(r.fields).toEqual({ "Role Name": "Water Steward" });
    expect(r.droppedForAnAddress).toEqual(["Body"]);
  });

  it("can say what it will show, so a card never promises a field this drops", () => {
    expect(shownFields("role")).toContain("Role Name");
    expect(shownFields("role")).not.toContain("Active Holders");
    expect(shownFields("tension")).not.toContain("Sensed By");
  });
});

/**
 * THE FIELDS THE VENDOR TOLD US ABOUT ON 2026-09-23.
 *
 * Their founder checked his live schema against the structural-field list we
 * had been working from and reported it correct but INCOMPLETE: seven further
 * fields carry a person and were not on it. One of them, `Role Holders`, is an
 * automatic back-reference nobody wrote — it simply exists because a relation
 * points at it.
 *
 * That is the allow list's whole argument, arriving as an event rather than as
 * a hypothetical: seven name-carrying fields we did not know about, one of
 * which nobody created on purpose. Under a deny list every one of them would
 * have been admitted by default. These cases exist so the next such email is
 * answered by a test run rather than by reading the file and reasoning.
 */
describe("the fields the vendor named on 2026-09-23", () => {
  it("drops the two that look most like structure to a reader", () => {
    // A lead and a steward sound like seats. They hold people.
    const r = readVendorRecord("circle", {
      "Circle Name": "Land & Ecology",
      "Circle Lead": "Michael",
      "Rep Steward": "Jess",
    });
    expect(r.fields).toEqual({ "Circle Name": "Land & Ecology" });
    expect(r.ignored).toEqual(["Circle Lead", "Rep Steward"]);
  });

  it("drops the back-reference nobody wrote onto the role", () => {
    const r = readVendorRecord("role", { "Role Name": "Water Steward", "Role Holders": ["Mika"] });
    expect(r.fields).toEqual({ "Role Name": "Water Steward" });
    expect(r.ignored).toEqual(["Role Holders"]);
  });

  it("HAS NO DOOR AT ALL for the three record kinds where the Profile fields live", () => {
    // Decisions, Projects and Commitments carry Decision Maker Profile,
    // Reviewer Profile, Lead Profile, Team Profiles and Parties. The safety is
    // not that those names are denied — it is that these kinds have no allow
    // list, so an unknown kind resolves to an empty one and everything is
    // dropped. Fails CLOSED. The cast is the point: these are not readable
    // kinds, and this proves what happens if one is asked for anyway.
    for (const kind of ["decision", "project", "commitment"]) {
      const r = readVendorRecord(kind as SaberraRecordKind, {
        Name: "Buy the north parcel",
        "Decision Maker Profile": "Rick",
        "Reviewer Profile": "Jess",
        "Lead Profile": "Michael",
        "Team Profiles": ["Ky", "Mika"],
        Parties: ["North Parcel Group", "Kyleen"],
      });
      expect(r.fields).toEqual({});
      expect(r.ignored).toContain("Decision Maker Profile");
      expect(r.ignored).toContain("Team Profiles");
      expect(r.ignored).toContain("Parties");
    }
  });

  it("names every kind that has a door, so adding one is a deliberate act", () => {
    // If this list grows, somebody widened the boundary. That should be a
    // conversation and a failing test, not a quiet commit.
    for (const kind of ["circle", "role", "roleAssignment", "tension", "risk"] as const) {
      expect(shownFields(kind).length).toBeGreaterThan(0);
    }
    for (const kind of ["decision", "project", "commitment", "meeting", "profile", "task"]) {
      expect(shownFields(kind as SaberraRecordKind)).toEqual([]);
    }
  });
});
