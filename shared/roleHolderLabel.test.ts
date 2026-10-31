import { describe, expect, it } from "vitest";
import { holderFirstName, holderNames, roleWithHolders, ROLE_HOLDER_NAME_CAP } from "./roleHolderLabel";

describe("roleWithHolders", () => {
  it("prints a vacant role alone", () => {
    expect(roleWithHolders("Treasurer", [])).toBe("Treasurer");
    expect(roleWithHolders("Treasurer", null)).toBe("Treasurer");
    expect(roleWithHolders("Treasurer", ["", "   ", null])).toBe("Treasurer");
  });

  it("puts the role first and the holder's first name in parentheses", () => {
    expect(roleWithHolders("Treasurer", ["Rick Moss"])).toBe("Treasurer (Rick)");
    expect(roleWithHolders("  Treasurer ", ["  Rick   Moss "])).toBe("Treasurer (Rick)");
  });

  it("lists several holders in roster order", () => {
    expect(roleWithHolders("Steward", ["Rye Cordon", "Jessica Lee"])).toBe("Steward (Rye, Jessica)");
  });

  it("folds holders past the cap into +N", () => {
    expect(ROLE_HOLDER_NAME_CAP).toBe(3);
    expect(roleWithHolders("Steward", ["Ana", "Ben", "Cy", "Di", "Ed"])).toBe("Steward (Ana, Ben, Cy +2)");
    expect(roleWithHolders("Steward", ["Ana", "Ben", "Cy"])).toBe("Steward (Ana, Ben, Cy)");
    expect(roleWithHolders("Steward", ["Ana", "Ben"], 1)).toBe("Steward (Ana +1)");
  });

  it("never prints an email domain", () => {
    expect(holderFirstName("rick@example.org")).toBe("rick");
    expect(roleWithHolders("Treasurer", ["rick@example.org"])).not.toContain("example.org");
  });

  it("falls back to the names when the role has no title", () => {
    expect(roleWithHolders("", ["Rick Moss"])).toBe("Rick");
    expect(holderNames([])).toBe("");
  });
});
