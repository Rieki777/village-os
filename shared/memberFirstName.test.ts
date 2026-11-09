import { describe, expect, it } from "vitest";
import { DEPARTED_MEMBER_NAME, memberFirstName } from "./memberFirstName";
import { firstNameForAward } from "../server/lib/proposalAward";

describe("memberFirstName (EXTRA-A-erased-member-shows-A)", () => {
  it("returns the erased member's placeholder whole, never 'A'", () => {
    expect(memberFirstName(DEPARTED_MEMBER_NAME)).toBe("A departed member");
    expect(memberFirstName(`  ${DEPARTED_MEMBER_NAME} `)).toBe("A departed member");
  });

  it("still takes the first word of an ordinary name, and falls back on an empty one", () => {
    expect(memberFirstName("Rose Ashby")).toBe("Rose");
    expect(memberFirstName("", "A member")).toBe("A member");
    expect(memberFirstName(null)).toBe("Someone");
  });

  it("the proposal award line splits on whitespace, not on the letters 's+'", () => {
    expect(firstNameForAward("Rose Ashby")).toBe("Rose");
    expect(firstNameForAward(DEPARTED_MEMBER_NAME)).toBe("A departed member");
  });
});
