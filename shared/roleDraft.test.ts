import { describe, expect, it } from "vitest";
import {
  DRAFT_MAX_CHARACTERS,
  addPick,
  applyHrefFor,
  draftFromStored,
  openRolesFrom,
  rankForCharacters,
  type DraftRole,
} from "./roleDraft";
import { OPEN_PROPOSAL_MAX_ROLES } from "./openProposals";

const ORG = {
  circles: [
    { id: "anchor", name: "Anchor Circle", status: "active" },
    { id: "land", name: "Land Circle", status: "active" },
  ],
  roles: [
    { id: "lfs", name: "Lead Financial Steward", circleId: "anchor", seats: 1, holderCount: 0, state: "open", archetypes: ["researching", "catalyzing"], timeCommitment: "25 to 30 hours a week", aim: "Money kept true.", accountabilities: ["a", "b", "c"] },
    { id: "held", name: "Water Keeper", circleId: "land", seats: 1, holderCount: 1, state: "filled", archetypes: ["building"] },
    { id: "half", name: "Gardener", circleId: "land", seats: 2, holderCount: 1, state: "partial", archetypes: ["building"] },
    { id: "forming", name: "Seed Keeper", circleId: "land", seats: 1, holderCount: 0, state: "forming", archetypes: [] },
    { id: "example", name: "Example Role", circleId: "land", seats: 1, holderCount: 0, state: "open", isExample: true },
    { id: "orphan", name: "Nowhere", circleId: "gone", seats: 1, holderCount: 0, state: "open" },
    { id: "recruit", name: "Host", circleId: "land", seats: 1, holderCount: 1, state: "filled", recruiting: true, archetypes: ["facilitating"] },
  ],
};

describe("openRolesFrom", () => {
  const roles = openRolesFrom(ORG);
  const ids = roles.map((r) => r.id);

  it("keeps the roles a newcomer can apply for, read live from the chart", () => {
    expect(ids).toEqual(expect.arrayContaining(["lfs", "half", "recruit"]));
  });

  it("drops held, forming, example and circle-less roles", () => {
    for (const id of ["held", "forming", "example", "orphan"]) expect(ids).not.toContain(id);
  });

  it("carries the role's own words and its circle's name, with nothing invented", () => {
    const lfs = roles.find((r) => r.id === "lfs") as DraftRole;
    expect(lfs).toMatchObject({ circleName: "Anchor Circle", timeCommitment: "25 to 30 hours a week", aim: "Money kept true.", accountabilities: 3, openPlaces: 1 });
    const half = roles.find((r) => r.id === "half") as DraftRole;
    expect(half).toMatchObject({ timeCommitment: null, aim: null, openPlaces: 1, seats: 2 });
  });

  it("answers an empty list for a chart it cannot read", () => {
    expect(openRolesFrom(null)).toEqual([]);
    expect(openRolesFrom({ roles: "nope" })).toEqual([]);
  });
});

describe("rankForCharacters", () => {
  const roles = openRolesFrom(ORG);

  it("puts the roles that fit more of the picked characters first, and hides none", () => {
    const ranked = rankForCharacters(roles, ["researching", "catalyzing", "building"]);
    expect(ranked.map((r) => r.role.id)).toEqual(["lfs", "half", "recruit"]);
    expect(ranked.map((r) => r.fits)).toEqual([["researching", "catalyzing"], ["building"], []]);
  });

  it("keeps the chart's order by name when no character is picked", () => {
    expect(rankForCharacters(roles, []).map((r) => r.role.id)).toEqual(["recruit", "half", "lfs"].sort((a, b) => {
      const n = (id: string) => roles.find((r) => r.id === id)!.name;
      return n(a).localeCompare(n(b));
    }));
  });
});

describe("the stored draft", () => {
  it("reads back what was saved, and nothing it does not recognise", () => {
    expect(draftFromStored({ chars: ["catalyzing", 7, "facilitating"], picks: ["lfs", null, "half"] })).toEqual({ chars: ["catalyzing", "facilitating"], picks: ["lfs", "half"] });
    expect(draftFromStored("garbage")).toEqual({ chars: [], picks: [] });
    expect(draftFromStored(undefined)).toEqual({ chars: [], picks: [] });
  });

  it("caps the picks at the proposal's own limit and the characters at the cast", () => {
    const many = Array.from({ length: 9 }, (_, i) => `r${i}`);
    const d = draftFromStored({ chars: many, picks: many });
    expect(d.picks).toHaveLength(OPEN_PROPOSAL_MAX_ROLES);
    expect(d.chars).toHaveLength(DRAFT_MAX_CHARACTERS);
  });

  it("drops duplicates", () => {
    expect(draftFromStored({ chars: ["a", "a"], picks: ["x", "x"] })).toEqual({ chars: ["a"], picks: ["x"] });
  });
});

describe("addPick", () => {
  it("adds in order, refuses a fourth, and toggles a pick off", () => {
    let p: string[] = [];
    for (const id of ["a", "b", "c"]) p = addPick(p, id).picks;
    expect(p).toEqual(["a", "b", "c"]);
    expect(addPick(p, "d")).toEqual({ picks: ["a", "b", "c"], full: true });
    expect(addPick(p, "b")).toEqual({ picks: ["a", "c"], full: false });
  });
});

describe("applyHrefFor", () => {
  it("sends a visitor to the open proposal with every pick ticked", () => {
    expect(applyHrefFor(["lfs", "half"], false)).toBe("/propose-a-role?role=lfs&role=half");
  });

  it("sends a member to Propose my roles, starting from the first pick", () => {
    expect(applyHrefFor(["lfs", "half"], true)).toBe("/role-proposals/new?role=lfs&path=quick");
  });

  it("has no door with nothing drafted", () => {
    expect(applyHrefFor([], false)).toBeNull();
  });
});
