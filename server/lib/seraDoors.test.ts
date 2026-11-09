/**
 * WHO DECIDES, AS MEMBERS ARE SHOWN IT (review S2, then the coordinator's
 * ruling N2 of 2026-11-06).
 *
 * The count every member reads names the same holders the public powers view
 * names (`villagePowerRows`, `/api/village/powers`): role held, lapsed terms
 * filtered, example users dropped, badge denies NOT applied. A deny-aware list
 * beside a deny-blind one would tell any member whose power is under a warning
 * badge, which `badges.ts` hides on purpose. The publish door itself stays
 * deny-aware; this is display only. Before launch the admins hold the door too.
 */
import { describe, expect, it } from "vitest";
import { doorFrom, doorHolders } from "./seraDoors";
import { villagePowerRows } from "./villagePowers";

const roles = [
  { id: "ops-lead", name: "Ops lead", capabilities: ["org.decide"] },
  { id: "steward", name: "Steward", capabilities: ["org.decide"] },
  { id: "garden", name: "Garden lead", capabilities: ["org.decide"] },
  { id: "kitchen", name: "Kitchen lead", capabilities: [] },
];
const past = new Date(Date.now() - 86_400_000).toISOString();
const holdings = [
  { roleId: "ops-lead", userId: "u-rye" },
  { roleId: "steward", userId: "u-sam" },
  // Ana's power sits under a warning badge's deny: the public view still names her, so the count does too.
  { roleId: "garden", userId: "u-ana" },
  // Bo's term ran out: lapsed, so neither view names him.
  { roleId: "garden", userId: "u-bo", termEndsAt: past },
  // An example user is never named.
  { roleId: "ops-lead", userId: "u-example" },
  // A role that does not carry the power.
  { roleId: "kitchen", userId: "u-cy" },
];
const full: Record<string, string> = { "u-rye": "Rye Weaver", "u-sam": "Sam Steward", "u-ana": "Ana Moss", "u-bo": "Bo Reyes", "u-cy": "Cy Lane" };
const nameOf = (id: string) => full[id] ?? null;
const base = { roles, holdings, nameOf, orgRoleName: () => undefined, villageHolder: null };

describe("the door members are shown", () => {
  it("names exactly the holders the public powers view names, a denied holder included (N2)", () => {
    const publicRow = villagePowerRows({
      holders: new Map(),
      groups: roles,
      holdings,
      orgRoleName: () => undefined,
      nameOf: (id) => (full[id] ? { full: full[id], first: full[id].split(" ")[0] } : null),
      stageName: () => null,
    }).find((r) => r.capability === "org.decide")!;
    const theirs = publicRow.heldToday.slice().sort();
    const ours = doorHolders({ ...base, capability: "org.decide" })
      .map((h) => `${h.role} (${(nameOf(h.userId) ?? "").split(" ")[0]})`)
      .sort();
    expect(ours).toEqual(theirs);
    expect(ours).toContain("Garden lead (Ana)");
    expect(ours.join()).not.toContain("Bo");
  });

  it("is the admins before launch, and the vote after it, when nobody holds the power", () => {
    expect(doorFrom({ ...base, holdings: [], capability: "org.decide", launched: false })).toEqual({ by: "admins" });
    expect(doorFrom({ ...base, holdings: [], capability: "org.decide", launched: true })).toEqual({ by: "vote" });
  });

  it("names roles and first names, the stewards as the stewards, and the admins too before launch (N4)", () => {
    expect(doorFrom({ ...base, capability: "org.decide", launched: true })).toEqual({
      by: "holders", labels: ["Ops lead (Rye)", "Garden lead (Ana)"], more: 0, stewards: true, others: 0, admins: false,
    });
    expect(doorFrom({ ...base, capability: "org.decide", launched: false })).toMatchObject({ by: "holders", admins: true });
  });

  it("names the role the village holds the power through, when it does", () => {
    const d = doorFrom({ ...base, capability: "org.decide", villageHolder: { roleId: "garden", roleName: "Garden lead" }, launched: true });
    expect(d).toEqual({ by: "holders", labels: ["Garden lead (Ana)"], more: 0, stewards: false, others: 0, admins: false });
    // Held by the village and nobody sits there: the vote.
    expect(doorFrom({ ...base, capability: "org.decide", villageHolder: { roleId: "empty", roleName: "Empty role" }, launched: true })).toEqual({ by: "vote" });
  });

  it("caps the roles at three and counts the rest", () => {
    const many = ["a", "b", "c", "d", "e"].map((x) => ({ id: `r-${x}`, name: `Role ${x}`, capabilities: ["org.decide"] }));
    const held = many.map((r, i) => ({ roleId: r.id, userId: `u-${i}` }));
    const d = doorFrom({ roles: many, holdings: held, nameOf: () => "Pat Doe", orgRoleName: () => undefined, villageHolder: null, capability: "org.decide", launched: true });
    expect(d).toEqual({ by: "holders", labels: ["Role a (Pat)", "Role b (Pat)", "Role c (Pat)"], more: 2, stewards: false, others: 0, admins: false });
  });
});
