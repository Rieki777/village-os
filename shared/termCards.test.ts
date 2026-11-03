import { describe, expect, it } from "vitest";
import { WHOLE_PRESETS } from "./seatPresets";
import { GLOSSARY, MONEY_PROMISE, plainTerm, recommendsPay, unsureLine, wholeCardCopy } from "./termCards";
import { OPS_FALLBACK } from "./roleProposalHonesty";
import { SETTINGS_GROUPS } from "./seatSettings";

describe("terms preset cards", () => {
  it("names the four whole roles, with a plain example and no pay recommendation", () => {
    expect(WHOLE_PRESETS.map((w) => w.label)).toEqual(["Volunteer role", "Stipend role", "Core team role", "Trial moon"]);
    for (const whole of WHOLE_PRESETS) {
      const card = wholeCardCopy(whole);
      expect(card.example).toMatch(/^How often you meet \(rhythm\): .+/);
      expect(card.official.length).toBeGreaterThan(0);
      expect(recommendsPay(whole.label)).toBe(false);
      expect(recommendsPay(whole.blurb)).toBe(false);
      expect(recommendsPay(card.example)).toBe(false);
      expect(recommendsPay(card.official)).toBe(false);
      expect(recommendsPay(MONEY_PROMISE)).toBe(false);
    }
  });

  it("puts the plain phrase before the official word, and explains the jargon", () => {
    expect(plainTerm("rhythm")).toBe("How often you meet (rhythm)");
    for (const group of SETTINGS_GROUPS) expect(plainTerm(group)).toContain(`(${group})`);
    expect(GLOSSARY.map((g) => g.key)).toEqual(["clocks", "rhythm", "allowance", "scoreboard", "domain"]);
    for (const g of GLOSSARY) {
      expect(g.plain.length).toBeGreaterThan(g.word.length);
      expect(recommendsPay(`${g.word} ${g.plain}`)).toBe(false);
    }
    expect(GLOSSARY.find((g) => g.key === "allowance")?.plain).toContain(MONEY_PROMISE);
  });

  it("leaves an open card with the operations role, and falls back when the chart has none", () => {
    expect(unsureLine("Operations Steward")).toBe("Leave these open. We'll fill them together with Operations Steward.");
    expect(unsureLine(null)).toBe(`Leave these open. We'll fill them together with ${OPS_FALLBACK}.`);
    expect(unsureLine("")).not.toMatch(/@/);
  });
});
