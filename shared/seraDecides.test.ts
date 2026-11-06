/**
 * WHO DECIDES WHAT WAITS, AND WHO SETS PAY, IN WORDS (spec R38, R23; review S2).
 *
 * The server works out the door from the code's own holder test
 * (server/lib/seraDoors.ts); these are the words for each answer, the same on
 * the member view and the pay row.
 */
import { describe, expect, it } from "vitest";
import { NO_HOLDER_WORDS, NO_PAY_HOLDER_WORDS, whoDecidesWords, whoSetsPayWords, type Door } from "./seraDecides";

const holders = (over: Partial<Extract<Door, { by: "holders" }>> = {}): Door => ({ by: "holders", labels: [], more: 0, stewards: false, others: 0, ...over });

describe("who decides", () => {
  it("names the roles that hold the power, in the house form", () => {
    expect(whoDecidesWords(holders({ labels: ["Ops lead (Rye)"] }), 5)).toBe("Ops lead (Rye) decides them.");
    expect(whoDecidesWords(holders({ labels: ["Ops lead (Rye)"], stewards: true }), 5)).toBe("Ops lead (Rye) and the stewards decide them.");
    expect(whoDecidesWords(holders({ stewards: true }), 1)).toBe("The stewards decide it.");
  });

  it("names the stewards only when a steward role is among the holders", () => {
    expect(whoDecidesWords(holders({ labels: ["Ops lead (Rye)", "Steward Circle (Sam)"] }), 2)).toBe("Ops lead (Rye) and Steward Circle (Sam) decide them.");
  });

  it("caps the roles at three, then +N", () => {
    expect(whoDecidesWords(holders({ labels: ["A (Ana)", "B (Bo)", "C (Cy)"], more: 2 }), 5)).toBe("A (Ana), B (Bo) and C (Cy) +2 decide them.");
  });

  it("says the admins before launch, and the vote line after it, when the door is open to nobody", () => {
    expect(whoDecidesWords({ by: "admins" }, 5)).toBe("The admins decide them until the village launches.");
    expect(whoDecidesWords({ by: "vote" }, 5)).toBe(NO_HOLDER_WORDS);
    expect(NO_HOLDER_WORDS).toBe("Nobody holds the power to decide these right now, so the village decides by vote.");
  });
});

describe("who sets pay", () => {
  it("names the role that holds the power to set pay", () => {
    expect(whoSetsPayWords(holders({ labels: ["Treasurer (Rick)"] }))).toBe("The Treasurer (Rick) sets pay.");
    expect(whoSetsPayWords(holders({ labels: ["Treasurer (Rick)"], stewards: true }))).toBe("The Treasurer (Rick) and the stewards set pay.");
  });

  it("says nobody holds it after launch, and the admins before", () => {
    expect(whoSetsPayWords({ by: "vote" })).toBe(NO_PAY_HOLDER_WORDS);
    expect(NO_PAY_HOLDER_WORDS).toBe("Nobody holds the power to set pay right now.");
    expect(whoSetsPayWords({ by: "admins" })).toBe("The admins set pay until the village launches.");
  });
});
