/**
 * THE DOOR A DECISION GOES THROUGH, worked out on the server from the inputs
 * the publish door uses (review S2): the live holders the gate counts (role
 * held, a badge deny taken off), the roles carrying the power, and whether a
 * launch vote has carried. Never a stage, never a denied holder, never a guess.
 */
import { describe, expect, it } from "vitest";
import { doorFrom } from "./seraDoors";

const carrying = [
  { id: "ops-lead", name: "Ops lead" },
  { id: "steward", name: "Steward" },
  { id: "garden", name: "Garden lead" },
];
const holdings = [
  { roleId: "ops-lead", userId: "u-rye" },
  { roleId: "steward", userId: "u-sam" },
  { roleId: "garden", userId: "u-ana" },
];
const names: Record<string, string> = { "u-rye": "Rye Weaver", "u-sam": "Sam Steward", "u-ana": "Ana Moss" };
const nameOf = (id: string) => names[id] ?? null;

describe("the door", () => {
  it("is the admins before launch, and the vote after it, when nobody holds the power", () => {
    expect(doorFrom({ holders: [], carrying, holdings, nameOf, launched: false })).toEqual({ by: "admins" });
    expect(doorFrom({ holders: [], carrying, holdings, nameOf, launched: true })).toEqual({ by: "vote" });
  });

  it("names live holders by role and first name, and the stewards only when the steward role holds it", () => {
    expect(doorFrom({ holders: ["u-rye"], carrying, holdings, nameOf, launched: true })).toEqual({
      by: "holders", labels: ["Ops lead (Rye)"], more: 0, stewards: false, others: 0,
    });
    expect(doorFrom({ holders: ["u-rye", "u-sam"], carrying, holdings, nameOf, launched: true })).toEqual({
      by: "holders", labels: ["Ops lead (Rye)"], more: 0, stewards: true, others: 0,
    });
  });

  it("never names a holder the gate does not count, such as one a badge denies", () => {
    // Ana sits in a role carrying the power, and the live count left her out.
    const d = doorFrom({ holders: ["u-rye"], carrying, holdings, nameOf, launched: true });
    expect(JSON.stringify(d)).not.toContain("Ana");
  });

  it("caps the roles at three and counts the rest", () => {
    const many = ["a", "b", "c", "d", "e"].map((x) => ({ id: `r-${x}`, name: `Role ${x}` }));
    const held = many.map((r, i) => ({ roleId: r.id, userId: `u-${i}` }));
    const d = doorFrom({ holders: held.map((h) => h.userId), carrying: many, holdings: held, nameOf: () => "Pat Doe", launched: true });
    expect(d).toEqual({ by: "holders", labels: ["Role a (Pat)", "Role b (Pat)", "Role c (Pat)"], more: 2, stewards: false, others: 0 });
  });

  it("counts a holder no role names, without naming them", () => {
    const d = doorFrom({ holders: ["u-badge"], carrying, holdings, nameOf, launched: true });
    expect(d).toEqual({ by: "holders", labels: [], more: 0, stewards: false, others: 1 });
  });
});
