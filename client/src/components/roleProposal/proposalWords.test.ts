import { describe, expect, it } from "vitest";
import { RP_WORDS } from "./proposalWords";
import { OPS_FALLBACK } from "@shared/roleProposalHonesty";

describe("proposalFor", () => {
  it("names the season, and says next season when the name is blank", () => {
    expect(RP_WORDS.proposalFor("Season of Roots")).toBe("Role proposal for Season of Roots");
    expect(RP_WORDS.proposalFor("")).toBe("Role proposal for next season");
    expect(RP_WORDS.proposalFor("   ")).toBe("Role proposal for next season");
  });
});

describe("the share step's ops line (audit P5)", () => {
  it("starts its second sentence with a capital when the role name is the lowercase fallback", () => {
    expect(RP_WORDS.sendOpsLine(OPS_FALLBACK)).toBe("The terms are still open. The village's operations role can read this draft and fill them with you.");
  });
  it("leaves a named role as it is", () => {
    expect(RP_WORDS.sendOpsLine("Operations Steward")).toContain("open. Operations Steward can read");
  });
});
