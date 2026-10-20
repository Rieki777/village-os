/**
 * The map's projection of the live org, and the version it is known by.
 *
 * The open map asks for this every few seconds and redraws only when the
 * version moves, so two things have to be true and both are held here: an
 * unchanged village hashes the same twice, and every change the map would
 * DRAW moves the hash. A version that missed a change is a map that never
 * updates; one that moved on nothing is a map that redraws for nothing.
 */
import { describe, expect, it } from "vitest";
import { etagHits, mapOrgEtag, projectMapOrg, type MapOrgInput } from "./mapOrg";
import type { OrgAssignment, OrgRole } from "./orgChart";

function role(id: string, over: Partial<OrgRole> = {}): OrgRole {
  return {
    id, circleId: "land", name: id, aim: `Aim of ${id}`, domain: null, accountabilities: [], whyItMatters: null,
    seats: 1, criticality: "normal", active: true, recruiting: false, expiresEachSeason: null,
    statusOverride: null, statusOverrideExpiresAt: null, icon: null, color: null, order: 0, isExample: false,
    representsCircle: false, howChosen: null, howChosenGloss: null, archetypes: [],
    authority: null, firstYearOutcomes: null, first90DayOutcomes: null, locationExpectations: null,
    compensationReality: null, evidenceRequired: null,
    termsOffer: null, termsOfferAt: null, termsOfferBy: null,
    ...over,
  };
}

function seating(orgRoleId: string, over: Partial<OrgAssignment> = {}): OrgAssignment {
  return {
    id: `a-${orgRoleId}`, orgRoleId, holderKind: "documented", userId: null, displayName: "Ana Ruiz",
    holderKey: "doc:ana", focus: null, note: null, seasonId: null, termEndsAt: null,
    startedAt: new Date("2026-09-01T00:00:00Z"), endedAt: null, endedReason: null, isExample: false, isAgent: false,
    ...over,
  };
}

const base = (): MapOrgInput => ({
  circles: [
    { id: "land", name: "Land Circle", order: 2, status: "active", color: "bg-sage" },
    { id: "hearth", name: "Hearth Council", order: 1, status: "forming", parentCircleId: "land" },
    { id: "demo", name: "Example Circle", order: 0, isExample: true },
  ],
  roles: [role("water-steward", { seats: 2 }), role("cook"), role("old", { active: false }), role("sample", { isExample: true })],
  assignments: [seating("water-steward"), seating("cook", { holderKind: "member", userId: "u1", displayName: null })],
  viewPeople: true,
  memberName: (id) => (id === "u1" ? "Bea" : "Member"),
  now: new Date("2026-10-02T12:00:00Z"),
});

describe("projectMapOrg", () => {
  it("carries the village's circles and active seats, never an example or a retired seat", () => {
    const s = projectMapOrg(base());
    expect(s.circles.map((c) => c.id)).toEqual(["hearth", "land"]);
    expect(s.roles.map((r) => r.id)).toEqual(["water-steward", "cook"]);
    expect(s.circles.find((c) => c.id === "hearth")).toMatchObject({ status: "forming", parentCircleId: "land" });
    expect(s.circles.every((c) => /^#[0-9a-f]{6}$/i.test(c.colour))).toBe(true);
  });

  it("says each seat's state the way the org chart does, with names on the people tier", () => {
    const s = projectMapOrg(base());
    expect(s.roles.find((r) => r.id === "water-steward")).toMatchObject({
      state: "partial", seats: 2, holderCount: 1, circleId: "land", description: "Aim of water-steward",
      holders: [{ name: "Ana Ruiz", lapsed: false, isAgent: false }],
    });
    expect(s.roles.find((r) => r.id === "cook")).toMatchObject({ state: "filled", holders: [{ name: "Bea" }] });
  });

  it("sends no name to a reader without viewPeople, and that reader's version is its own", () => {
    const people = projectMapOrg(base());
    const shape = projectMapOrg({ ...base(), viewPeople: false });
    expect(shape.roles.every((r) => r.holders.length === 0)).toBe(true);
    expect(shape.roles.find((r) => r.id === "cook")?.holderCount).toBe(1);
    expect(shape.version).not.toBe(people.version);
  });

  it("hashes an unchanged village the same way twice", () => {
    expect(projectMapOrg(base()).version).toBe(projectMapOrg(base()).version);
    expect(projectMapOrg(base()).version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("moves the version for every change the map would draw", () => {
    const v0 = projectMapOrg(base()).version;
    const changed: Record<string, MapOrgInput> = {
      "a new seat": { ...base(), roles: [...base().roles, role("beekeeper")] },
      "a seat retired": { ...base(), roles: base().roles.filter((r) => r.id !== "cook") },
      "a seat renamed": { ...base(), roles: base().roles.map((r) => (r.id === "cook" ? { ...r, name: "Head Cook" } : r)) },
      "a seat moved to another circle": { ...base(), roles: base().roles.map((r) => (r.id === "cook" ? { ...r, circleId: "hearth" } : r)) },
      "a holder seated": { ...base(), assignments: [...base().assignments, seating("water-steward", { id: "a2", displayName: "Cy" })] },
      "a holder gone": { ...base(), assignments: base().assignments.slice(1) },
      "a mandate lapsed": { ...base(), assignments: base().assignments.map((a) => ({ ...a, lapsed: true })) },
      "a new circle": { ...base(), circles: [...base().circles, { id: "arts", name: "Arts Circle" }] },
      "a circle renamed": { ...base(), circles: base().circles.map((c) => (c.id === "land" ? { ...c, name: "Soil Circle" } : c)) },
      "a circle nested elsewhere": { ...base(), circles: base().circles.map((c) => (c.id === "hearth" ? { ...c, parentCircleId: null } : c)) },
    };
    for (const [what, input] of Object.entries(changed)) {
      expect(projectMapOrg(input).version, what).not.toBe(v0);
    }
  });
});

describe("etagHits", () => {
  const v = "0123456789abcdef";
  it("matches the strong tag, the weak form a compressing proxy sends back, a list and the wildcard", () => {
    expect(etagHits(mapOrgEtag(v), v)).toBe(true);
    expect(etagHits(`W/${mapOrgEtag(v)}`, v)).toBe(true);
    expect(etagHits(`"org-other", ${mapOrgEtag(v)}`, v)).toBe(true);
    expect(etagHits("*", v)).toBe(true);
  });
  it("does not match another version, a bare version, or nothing", () => {
    expect(etagHits(mapOrgEtag("ffffffffffffffff"), v)).toBe(false);
    expect(etagHits(v, v)).toBe(false);
    expect(etagHits(undefined, v)).toBe(false);
    expect(etagHits("", v)).toBe(false);
  });
});
