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
import { boardRoles, characterArt, fitCountFor, roleArtFor, unlistedValue, withoutFounding } from "./roleDraft";
import { OPEN_PROPOSAL_MAX_ROLES } from "./openProposals";

const ORG = {
  circles: [
    { id: "anchor", name: "Anchor Circle", status: "active" },
    { id: "land", name: "Land Circle", status: "active" },
    { id: "asleep", name: "Sleeping Circle", status: "dormant" },
  ],
  roles: [
    { id: "lfs", name: "Lead Financial Steward", circleId: "anchor", seats: 1, holderCount: 0, state: "open", archetypes: ["researching", "catalyzing"], timeCommitment: "25 to 30 hours a week", aim: "Money kept true.", accountabilities: ["a", "b", "c"] },
    { id: "held", name: "Water Keeper", circleId: "land", seats: 1, holderCount: 1, state: "filled", archetypes: ["building"] },
    { id: "half", name: "Gardener", circleId: "land", seats: 2, holderCount: 1, state: "partial", archetypes: ["building"] },
    { id: "forming", name: "Seed Keeper", circleId: "land", seats: 1, holderCount: 0, state: "forming", archetypes: [] },
    { id: "example", name: "Example Role", circleId: "land", seats: 1, holderCount: 0, state: "open", isExample: true },
    { id: "orphan", name: "Nowhere", circleId: "gone", seats: 1, holderCount: 0, state: "open" },
    { id: "dozing", name: "Dozing Role", circleId: "asleep", seats: 1, holderCount: 0, state: "open" },
    { id: "recruit", name: "Host", circleId: "land", seats: 1, holderCount: 1, state: "filled", recruiting: true, archetypes: ["facilitating"] },
  ],
};

describe("openRolesFrom", () => {
  const roles = openRolesFrom(ORG);
  const ids = roles.map((r) => r.id);

  it("keeps the roles a newcomer can apply for, read live from the chart", () => {
    expect(ids).toEqual(expect.arrayContaining(["lfs", "half", "recruit"]));
  });

  it("drops held, forming, example, circle-less roles and roles in a dormant circle", () => {
    for (const id of ["held", "forming", "example", "orphan", "dozing"]) expect(ids).not.toContain(id);
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
    expect(applyHrefFor(["lfs", "half"], false)).toBe("/propose-a-role?role=lfs&role=half&from=%2Froles%2Fdraft");
  });

  it("sends a member to one role application carrying every pick", () => {
    expect(applyHrefFor(["lfs", "half"], true)).toBe("/propose?type=role_application&seat=lfs&seat=half&from=%2Froles%2Fdraft");
  });

  it("has no door with nothing drafted", () => {
    expect(applyHrefFor([], false)).toBeNull();
  });
});

describe("an unlisted role on the draft board (role journey PR-A)", () => {
  it("is left off, with a listed role in the same chart kept as the control", () => {
    const org = { circles: ORG.circles, roles: [...ORG.roles, { id: "hidden", name: "Hidden Role", circleId: "anchor", seats: 1, holderCount: 0, state: "open", listed: false }, { id: "shown", name: "Shown Role", circleId: "anchor", seats: 1, holderCount: 0, state: "open", listed: true }] };
    const ids = openRolesFrom(org).map((r) => r.id);
    expect(ids).toContain("shown");
    expect(ids).not.toContain("hidden");
  });
});

describe("the counts come from the listed roles the board offers (Rye, 9 Nov: 46 fit while one was listed)", () => {
  const withListing = (listed: unknown) => ({
    circles: ORG.circles,
    roles: [
      ORG.roles[0],
      { id: "old1", name: "Old One", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["researching"], listed },
      { id: "old2", name: "Old Two", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["researching"], listed },
    ],
  });

  it("drops a role whose listing the column holds as 0 or a string (fails on the old strict-false check)", () => {
    for (const hidden of [false, 0, "0", "false"]) {
      const ids = openRolesFrom(withListing(hidden)).map((r) => r.id);
      expect(ids, String(hidden)).toEqual(["lfs"]);
    }
    expect(openRolesFrom(withListing(null)).length).toBe(3);
    expect(unlistedValue(null)).toBe(false);
  });

  it("counts a character from the set the open form offers, not from every open role", () => {
    const all = openRolesFrom(withListing(null));
    expect(fitCountFor(all, "researching")).toBe(3);
    const board = boardRoles(all, { member: false, form: { open: true, offered: new Set(["lfs"]) } });
    expect(board.map((r) => r.id)).toEqual(["lfs"]);
    expect(fitCountFor(board, "researching")).toBe(1);
  });

  it("shows a visitor no count until the form has answered, and a member every listed role", () => {
    const all = openRolesFrom(withListing(null));
    expect(boardRoles(all, { member: false, form: null })).toEqual([]);
    expect(boardRoles(all, { member: true, form: null }).length).toBe(3);
  });
});

describe("art", () => {
  it("a character's art is the stock file, a role's falls back to its first character, an upload stays on this host", () => {
    expect(characterArt("building")).toBe("/images/avatars/building-f-deep.webp");
    const [lfs] = openRolesFrom(ORG);
    expect(roleArtFor(lfs)).toBe("/images/avatars/researching-f-olive.webp");
    // A village's own sixth root has no cast look and wears the default.
    expect(characterArt("gardening")).toBe("/images/avatars/gardening-f-olive.webp");
    expect(roleArtFor({ archetypes: [], raw: { imageUrl: "/uploads/x.webp" } })).toBe("/uploads/x.webp");
    expect(roleArtFor({ archetypes: [], raw: { imageUrl: "https://elsewhere.example/x.png" } })).toBeNull();
  });
});

describe("an archetype carried from /roles", () => {
  it("reads only a plain key from the address", async () => {
    const { archetypeFromSearch } = await import("./roleDraft");
    expect(archetypeFromSearch("?archetype=building")).toBe("building");
    expect(archetypeFromSearch("?archetype=<script>")).toBeNull();
    expect(archetypeFromSearch("")).toBeNull();
  });

  it("adds it to the draft once, keeps the picks, and never doubles it", async () => {
    const { draftWithArchetype } = await import("./roleDraft");
    const d = { chars: ["catalyzing"], picks: ["garden"] };
    expect(draftWithArchetype(d, "building")).toEqual({ chars: ["catalyzing", "building"], picks: ["garden"] });
    expect(draftWithArchetype(d, "catalyzing")).toBe(d);
    expect(draftWithArchetype(d, null)).toBe(d);
  });
});

describe("QA2-01: the board while the founding team is featured", () => {
  it("leaves the founding team's roles off the board, and keeps every other open role", () => {
    const all = openRolesFrom(ORG);
    expect(all.some((r) => r.id === "lfs")).toBe(true);
    const board = withoutFounding(all, ["lfs"]);
    expect(board.map((r) => r.id)).not.toContain("lfs");
    expect(board.map((r) => r.id)).toEqual(all.map((r) => r.id).filter((id) => id !== "lfs"));
  });

  it("keeps the whole board while the founding team is off", () => {
    const all = openRolesFrom(ORG);
    expect(withoutFounding(all, [])).toEqual(all);
  });
});
