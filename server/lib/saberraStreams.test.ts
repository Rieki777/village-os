/**
 * The split that lets the structure land without waiting for the people.
 */
import { describe, expect, it } from "vitest";
import { splitStreams, streamFor } from "./saberraStreams";
import type { VendorRecord } from "./saberraProposals";

const rec = (id: string, kind: VendorRecord["kind"], fields: Record<string, unknown>): VendorRecord => ({
  id,
  kind,
  fields,
});

describe("splitting a vendor read into two streams", () => {
  it("sends a role to the structure stream as an org proposal", () => {
    const r = splitStreams([rec("r-1", "role", { "Role Name": "Water Steward", Circle: "Land & Ecology" })]);
    expect(r.structure).toEqual([{ kind: "org.proposed", records: [expect.objectContaining({ id: "r-1" })] }]);
    expect(r.held).toEqual([]);
  });

  it("PROPOSES A CIRCLE AS A CIRCLE, now that the operation to make one exists", () => {
    // This case used to assert the opposite, and the reason it flipped is the
    // point: `circle.proposed` was an accepted kind whose accept path ran it
    // through the SEAT reader, so accepting one made a seat named after the
    // circle. `create_circle` and the branch in the accept path landed together
    // with this line.
    const r = splitStreams([rec("c-1", "circle", { "Circle Name": "Land & Ecology", Status: "Active" })]);
    expect(r.structure).toEqual([{ kind: "circle.proposed", records: [expect.objectContaining({ id: "c-1" })] }]);
    expect(r.held).toEqual([]);
    // It still produces detail, which is what the panel reads.
    expect(r.facts).toHaveLength(1);
    expect(r.facts[0].attachesTo).toBe("Land & Ecology");
  });

  it("PUTS ROLE ASSIGNMENTS IN THE STRUCTURE HALF, because no person survives the boundary", () => {
    // This is the arithmetic that changed when `Assignment Title` was excluded.
    // What is left is state about a seat, so it stops being people-data and
    // stops waiting on the erasure protections.
    expect(streamFor("roleAssignment")).toBe("structure");
    const r = splitStreams([
      rec("a-1", "roleAssignment", {
        Role: "Finance Steward",
        "Energization Level": "Partial",
        "Term Length": "One season",
        "Role Holder": "Ada Fenwick",
        "Assignment Title": "Ada Fenwick - Finance Steward",
      }),
    ]);
    expect(JSON.stringify(r.facts)).not.toContain("Ada Fenwick");
    expect(r.facts[0].fields["Energization Level"]).toBe("Partial");
    expect(r.facts[0].attachesTo).toBe("Finance Steward");
    expect(r.unmapped).toEqual(["Assignment Title", "Role Holder"]);
  });

  it("sends a tension and a risk to their observed kinds", () => {
    const r = splitStreams([
      rec("t-1", "tension", { Tension: "Two circles claim the buyer list", Status: "Open" }),
      rec("k-1", "risk", { Risk: "Surveys expire", Severity: "High", "Owner Role": "Project Manager" }),
    ]);
    expect(r.structure.map((s) => s.kind)).toEqual(["risk.observed", "tension.observed"]);
    expect(r.facts.find((f) => f.vendorKind === "risk")?.attachesTo).toBe("Project Manager");
  });

  it("KEEPS DETAIL FOR A RECORD IT CANNOT PROPOSE, which is the point of the store", () => {
    // A role assignment proposes nothing: what survives the boundary is state
    // about a seat, and this village decides its own seatings. The detail is
    // still worth showing beside the seat, which is why a fact exists for a
    // record that produces no proposal at all.
    const r = splitStreams([
      rec("a-1", "roleAssignment", {
        Role: "Finance Steward",
        "Energization Level": "Partial",
        "Next Review Date": "2026-12-01",
      }),
    ]);
    expect(r.structure).toEqual([]);
    expect(r.held).toEqual([{ id: "a-1", kind: "roleAssignment", reason: "kind-not-allowed" }]);
    expect(r.facts[0].fields).toEqual({
      Role: "Finance Steward",
      "Energization Level": "Partial",
      "Next Review Date": "2026-12-01",
    });
  });

  it("holds a record the boundary emptied, and does not invent a fact for it", () => {
    const r = splitStreams([rec("a-1", "roleAssignment", { "Role Holder": "Ada Fenwick" })]);
    expect(r.facts).toEqual([]);
    expect(r.held).toEqual([{ id: "a-1", kind: "roleAssignment", reason: "everything-was-dropped" }]);
  });

  it("carries an address refusal upward, per record", () => {
    const r = splitStreams([
      rec("r-1", "role", { "Role Name": "Water Steward", Body: "Ask mika@example.test." }),
    ]);
    expect(r.addressesSeen).toEqual([{ id: "r-1", fields: ["Body"] }]);
    expect(r.facts[0].fields).toEqual({ "Role Name": "Water Steward" });
  });

  it("groups a whole read by kind, in a stable order", () => {
    const r = splitStreams([
      rec("r-1", "role", { "Role Name": "A" }),
      rec("t-1", "tension", { Tension: "x" }),
      rec("r-2", "role", { "Role Name": "B" }),
    ]);
    expect(r.structure.map((s) => s.kind)).toEqual(["org.proposed", "tension.observed"]);
    expect(r.structure[0].records).toHaveLength(2);
  });

  it("names a kind it was not built for instead of dropping it", () => {
    const r = splitStreams([{ id: "d-1", kind: "decision" as never, fields: { Name: "x" } }]);
    expect(r.held).toEqual([{ id: "d-1", kind: "decision", reason: "kind-not-allowed" }]);
    expect(r.facts).toEqual([]);
  });
});
