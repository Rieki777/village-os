import { describe, expect, it } from "vitest";
import { RP_WORDS } from "./proposalWords";
import { OPS_FALLBACK } from "@shared/roleProposalHonesty";

describe("the share step's ops line (audit P5)", () => {
  it("starts its second sentence with a capital when the role name is the lowercase fallback", () => {
    expect(RP_WORDS.sendOpsLine(OPS_FALLBACK)).toBe("The terms are still open. The village's operations role can read this draft and fill them with you.");
  });
  it("leaves a named role as it is", () => {
    expect(RP_WORDS.sendOpsLine("Operations Steward")).toContain("open. Operations Steward can read");
  });
});
