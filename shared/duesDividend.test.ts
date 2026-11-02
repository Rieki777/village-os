/**
 * WHAT THE MINT PANEL SAYS A FLAT ROLE AMOUNT DOES (item 13, part 3). Rye,
 * 2026-11-01: card dues only for now, and Admin says so plainly.
 */
import { describe, expect, it } from "vitest";
import { ROLE_FLAT_AMOUNT_EXPLAINED, flatRoleAmountLine } from "./duesDividend";

describe("the Mint panel's words for a flat role amount", () => {
  it("says who gets it, how often, and that card dues are the only ones counted", () => {
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("once each cycle");
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("membership dues were paid by card");
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("whether or not they hold a role");
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("Members who have not paid get nothing");
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("Zeffy or by hand are not counted");
    expect(ROLE_FLAT_AMOUNT_EXPLAINED).toContain("Leave it blank and each role is paid only what its own pay list names");
  });

  it("states a set amount as a dues dividend, never as pay for each role holder", () => {
    const line = flatRoleAmountLine("25", "Village Credits");
    expect(line).toBe("25 Village Credits, once a cycle, to each member whose dues were paid by card that cycle");
    expect(line).not.toContain("holder");
  });

  it("carries no dash a member would read", () => {
    for (const words of [ROLE_FLAT_AMOUNT_EXPLAINED, flatRoleAmountLine("1", "X")]) {
      expect(words).not.toMatch(/[–—]/);
    }
  });
});
