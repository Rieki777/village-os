/**
 * Sheet 19: admin access through a power group, the pure half. The route-level
 * half, against the built server, is server/groupAdmin.routes.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import { accountsWithReach, adminGroupsOf, hasAdminReach, type AdminGroup, type GroupHolding } from "./groupAdmin";
import { holdingHasLapsed } from "./stewardship";

const NOW = new Date("2026-11-01T12:00:00Z");
const GROUPS: AdminGroup[] = [
  { id: "founders-circle", name: "Founders Circle", grantsAdmin: true },
  { id: "steward-circle", name: "Steward Circle", grantsAdmin: true },
  { id: "gardeners", name: "Gardeners", grantsAdmin: false },
  { id: "example-admins", name: "Example Admins", grantsAdmin: true, isExample: true },
];
const hold = (userId: string, roleId: string, termEndsAt: string | null = null): GroupHolding => ({ userId, roleId, termEndsAt });

describe("admin access through a power group", () => {
  it("control: a member who holds no admin group has no access", () => {
    expect(adminGroupsOf("u1", GROUPS, [hold("u1", "gardeners")], NOW, holdingHasLapsed)).toEqual([]);
    expect(hasAdminReach({ id: "u1", role: "member" }, GROUPS, [hold("u1", "gardeners")], NOW, holdingHasLapsed)).toBe(false);
  });

  it("a live holding of a group with the switch on gives access, and names the group", () => {
    const groups = adminGroupsOf("u1", GROUPS, [hold("u1", "steward-circle", "2027-01-01T00:00:00Z")], NOW, holdingHasLapsed);
    expect(groups.map((g) => g.name)).toEqual(["Steward Circle"]);
    expect(hasAdminReach({ id: "u1", role: "member" }, GROUPS, [hold("u1", "steward-circle")], NOW, holdingHasLapsed)).toBe(true);
  });

  it("ends the moment the holding's term runs out, with nothing written", () => {
    expect(adminGroupsOf("u1", GROUPS, [hold("u1", "founders-circle", "2026-11-01T11:59:59Z")], NOW, holdingHasLapsed)).toEqual([]);
  });

  it("an example group grants nothing, even with the switch on", () => {
    expect(adminGroupsOf("u1", GROUPS, [hold("u1", "example-admins")], NOW, holdingHasLapsed)).toEqual([]);
  });

  it("two admin groups for one member count as one way in, never two", () => {
    const users = [{ id: "u1", role: "member" }];
    const holdings = [hold("u1", "founders-circle"), hold("u1", "steward-circle")];
    expect(accountsWithReach(users, GROUPS, holdings, NOW, holdingHasLapsed, () => false)).toHaveLength(1);
  });

  it("counts the account's own role and a group as the same set, examples excluded", () => {
    const users = [
      { id: "founder", role: "founder" },
      { id: "steward", role: "member" },
      { id: "plain", role: "member" },
      { id: "example", role: "admin", isExample: true },
    ];
    const holdings = [hold("steward", "steward-circle")];
    const ids = accountsWithReach(users, GROUPS, holdings, NOW, holdingHasLapsed, (u) => (u as any).isExample === true).map((u) => u.id);
    expect(ids).toEqual(["founder", "steward"]);
  });

  it("the last-admin question is asked of the state a change would leave", () => {
    const users = [{ id: "steward", role: "member" }];
    const holdings = [hold("steward", "steward-circle")];
    // Turning the switch off on the one group that is the only way in leaves nobody.
    const switchedOff = GROUPS.map((g) => (g.id === "steward-circle" ? { ...g, grantsAdmin: false } : g));
    expect(accountsWithReach(users, GROUPS, holdings, NOW, holdingHasLapsed, () => false)).toHaveLength(1);
    expect(accountsWithReach(users, switchedOff, holdings, NOW, holdingHasLapsed, () => false)).toHaveLength(0);
    // And so does removing the only holder.
    expect(accountsWithReach(users, GROUPS, [], NOW, holdingHasLapsed, () => false)).toHaveLength(0);
  });
});
