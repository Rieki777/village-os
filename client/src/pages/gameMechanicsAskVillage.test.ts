import { describe, expect, it } from "vitest";
import { mayAskVillageOn } from "./gameMechanicsAskVillage";

describe("the door for a held outcome (R039, Rye 2026-11-06)", () => {
  const standing = { denied: false, mayAskVillage: true };

  it("shows on a held outcome to a member the route admits", () => {
    expect(mayAskVillageOn({ status: "passed_verified" }, standing)).toBe(true);
  });

  it("never shows on a proposal that can land or be voted on by its ordinary door", () => {
    for (const status of ["open", "onsite_vote", "passed_onsite", "applied", "failed", "to_hypha"]) {
      expect(mayAskVillageOn({ status }, standing), status).toBe(false);
    }
  });

  it("never shows to a viewer the route would refuse, or before the standing has loaded", () => {
    expect(mayAskVillageOn({ status: "passed_verified" }, { denied: false, mayAskVillage: false })).toBe(false);
    expect(mayAskVillageOn({ status: "passed_verified" }, { denied: true, mayAskVillage: true })).toBe(false);
    expect(mayAskVillageOn({ status: "passed_verified" }, null)).toBe(false);
  });
});
