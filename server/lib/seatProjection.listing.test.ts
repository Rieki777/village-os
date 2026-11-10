/**
 * LISTING IN THE PROJECTION (role journey PR-A): an unlisted role is absent
 * from the payload for a visitor and a member, present with `listed: false`
 * for a steward, and present for its own holder. Every absence carries a
 * listed control.
 */
import { describe, expect, it } from "vitest";
import type { OrgAssignment, OrgRole } from "./orgChart";
import { mapSeatTier, orgSeatTier, projectSeats, type SeatProjectionCtx } from "./seatProjection";

const NOW = new Date("2026-10-01T12:00:00Z");
const base = (id: string, listed: boolean | null): OrgRole =>
  ({
    id, circleId: "c1", name: id, aim: null, domain: null, accountabilities: [], whyItMatters: null,
    seats: 1, criticality: "normal", active: true, recruiting: true, expiresEachSeason: null,
    statusOverride: null, statusOverrideExpiresAt: null, icon: null, color: null, order: 0,
    isExample: false, archetypes: [], authority: null, firstYearOutcomes: null, first90DayOutcomes: null,
    locationExpectations: null, compensationReality: null, evidenceRequired: null,
    representsCircle: false, howChosen: null, howChosenGloss: null,
    termsOffer: null, termsOfferAt: null, termsOfferBy: null, listed,
  }) as OrgRole;

const ROLES = [base("shown", null), base("also-shown", true), base("hidden", false)];
const held = (roleId: string, userId: string): OrgAssignment =>
  ({
    id: `a-${roleId}`, orgRoleId: roleId, holderKind: "member", userId, displayName: null, holderKey: `member:${userId}`,
    focus: null, note: null, seasonId: null, termEndsAt: null, startedAt: NOW, endedAt: null, endedReason: null,
    lapsed: false, lapsedReason: null, isExample: false, isAgent: false,
  }) as OrgAssignment;
const ctx = (route: "map" | "org", listing?: SeatProjectionCtx["listing"]): SeatProjectionCtx => ({
  route, now: NOW, nameOf: () => "Mara", firstName: (s) => s, ...(listing ? { listing } : {}),
});
const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.id);
const tierOrg = orgSeatTier({ editing: false, viewPeople: false, peopleArePublic: true, mapStructure: true });

describe("an unlisted role in the projection", () => {
  it("is absent for a visitor and a member on /api/org, with the listed roles present as the control", () => {
    expect(ids(projectSeats(ROLES, [], tierOrg, ctx("org")))).toEqual(["shown", "also-shown"]);
    const memberTier = orgSeatTier({ editing: false, viewPeople: true, peopleArePublic: true, mapStructure: true, terms: true });
    expect(ids(projectSeats(ROLES, [], memberTier, ctx("org", { seesUnlisted: false })))).toEqual(["shown", "also-shown"]);
  });
  it("is absent on /api/map too", () => {
    expect(ids(projectSeats(ROLES, [], mapSeatTier(false), ctx("map")))).toEqual(["shown", "also-shown"]);
  });
  it("shows to a steward with the chip flag, and the listed roles carry no flag", () => {
    const rows = projectSeats(ROLES, [], tierOrg, ctx("org", { seesUnlisted: true }));
    expect(ids(rows)).toEqual(["shown", "also-shown", "hidden"]);
    expect(rows.find((r) => r.id === "hidden")?.listed).toBe(false);
    expect("listed" in (rows.find((r) => r.id === "shown") as object)).toBe(false);
  });
  it("shows to its own holder, and not to another member", () => {
    const own = projectSeats(ROLES, [held("hidden", "u1")], tierOrg, ctx("org", { seesUnlisted: false, ownRoleIds: new Set(["hidden"]) }));
    expect(ids(own)).toContain("hidden");
    const other = projectSeats(ROLES, [held("hidden", "u1")], tierOrg, ctx("org", { seesUnlisted: false, ownRoleIds: new Set() }));
    expect(ids(other)).not.toContain("hidden");
  });
});
