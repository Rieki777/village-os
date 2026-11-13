import { describe, expect, it } from "vitest";
import { foundingRoleIds, foundingRoleList, foundingRoles, withFoundingRoles } from "./foundingTeam";

const ROLES = [
  { id: "finance", listed: null, active: true },
  { id: "land", listed: true, active: true },
  { id: "community", active: true },
  { id: "hidden", listed: false, active: true },
  { id: "ended", listed: null, active: false },
  { id: "demo", listed: null, active: true, isExample: true },
];

describe("the founding team setting", () => {
  it("reads ids separated by commas, spaces or new lines, each once, in order", () => {
    expect(foundingRoleIds(" land, finance\nland ;community ")).toEqual(["land", "finance", "community"]);
    expect(foundingRoleIds("")).toEqual([]);
  });

  it("features the roles in the order written", () => {
    expect(foundingRoles(true, "community land finance", ROLES).map((r) => r.id)).toEqual(["community", "land", "finance"]);
  });

  it("never features an unlisted, ended, example or unknown role, whatever the setting says", () => {
    expect(foundingRoles(true, "hidden ended demo nobody finance", ROLES).map((r) => r.id)).toEqual(["finance"]);
  });

  it("features nothing while the section is off (control: the same setting on features them)", () => {
    expect(foundingRoles(false, "finance land", ROLES)).toEqual([]);
    expect(foundingRoles(true, "finance land", ROLES)).toHaveLength(2);
  });
});

describe("the {foundingRoles} word", () => {
  const BODY = "We are building the team for {village}. The roles open now are {foundingRoles}. Read each card and apply.";

  it("names the open roles in natural words", () => {
    expect(foundingRoleList(["Lead Finance Steward", "Land Lead", "Community Lead"])).toBe("the Lead Finance Steward, the Land Lead and the Community Lead");
    expect(foundingRoleList(["Land Lead", "Community Lead"])).toBe("the Land Lead and the Community Lead");
    expect(foundingRoleList(["Land Lead"])).toBe("the Land Lead");
    expect(foundingRoleList(["The Weaver", "", "Land Lead", "Land Lead"])).toBe("The Weaver and the Land Lead");
  });

  it("fills the word from the live list, so a new role shows without anybody editing the words", () => {
    expect(withFoundingRoles(BODY, ["Land Lead"])).toBe("We are building the team for {village}. The roles open now are the Land Lead. Read each card and apply.");
    expect(withFoundingRoles(BODY, ["Land Lead", "Cook"])).toContain("are the Land Lead and the Cook.");
  });

  it("with no role open, leaves out the sentence that would name them and keeps the rest true", () => {
    expect(withFoundingRoles(BODY, [])).toBe("We are building the team for {village}. Read each card and apply.");
    expect(withFoundingRoles("Open now: {foundingRoles}", [])).toBe("");
  });

  it("leaves words without the placeholder exactly as written", () => {
    expect(withFoundingRoles("Read the open roles.", [])).toBe("Read the open roles.");
  });
});
