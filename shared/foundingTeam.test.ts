import { describe, expect, it } from "vitest";
import { foundingRoleIds, foundingRoles } from "./foundingTeam";

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
