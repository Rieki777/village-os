import { describe, expect, it } from "vitest";
import { RP_WORDS } from "./proposalWords";

describe("proposalFor", () => {
  it("names the season, and says next season when the name is blank", () => {
    expect(RP_WORDS.proposalFor("Season of Roots")).toBe("Role proposal for Season of Roots");
    expect(RP_WORDS.proposalFor("")).toBe("Role proposal for next season");
    expect(RP_WORDS.proposalFor("   ")).toBe("Role proposal for next season");
  });
});
