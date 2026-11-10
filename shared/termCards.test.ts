import { describe, expect, it } from "vitest";
import { SEAT_PRESETS as PRESETS, WHOLE_PRESETS } from "./seatPresets";
import { GLOSSARY, MONEY_PROMISE, fillTogetherTag, plainTerm, presetExample, presetTag, recommendsPay, unsureLine, wholeCardCopy, wholeCardTag } from "./termCards";
import { OPS_FALLBACK } from "./roleProposalHonesty";
import { GROUP_LABELS, SETTINGS_GROUPS } from "./seatSettings";

describe("terms preset cards", () => {
  it("names the four whole roles, with a plain example and no pay recommendation", () => {
    expect(WHOLE_PRESETS.map((w) => w.label)).toEqual(["Volunteer role", "Stipend role", "Core team role", "Trial moon"]);
    for (const whole of WHOLE_PRESETS) {
      const card = wholeCardCopy(whole);
      expect(card.rhythm).toMatch(/^How often you meet \(rhythm\): .+/);
      expect(card.example).toMatch(/^Example: .+/);
      expect(card.official.length).toBeGreaterThan(0);
      expect(recommendsPay(whole.label)).toBe(false);
      expect(recommendsPay(whole.blurb)).toBe(false);
      expect(recommendsPay(card.example)).toBe(false);
      expect(recommendsPay(card.official)).toBe(false);
      expect(recommendsPay(MONEY_PROMISE)).toBe(false);
    }
  });

  it("gives every preset an Example line, and tags money as filled together, never Suggested", () => {
    for (const p of PRESETS) expect(presetExample(p)).toMatch(/^Example: .{3,}/);
    expect(presetExample({ id: "platform:until-season-end", label: "Until the season ends" })).toContain("season closes");
    expect(presetTag("term", "Operations Steward")).toBe("Suggested");
    for (const g of ["pay", "allowance", "bonus"] as const) expect(presetTag(g, "Operations Steward")).toBe("Fill together with Operations Steward");
    expect(fillTogetherTag(null)).toBe("Fill together with the village's operations role");
  });

  it("tags only the money-free whole roles Suggested", () => {
    const tags = Object.fromEntries(WHOLE_PRESETS.map((w) => [w.label, wholeCardTag(w, "Operations Steward")]));
    expect(tags["Volunteer role"]).toBe("Suggested");
    expect(tags["Stipend role"]).toBe("Fill together with Operations Steward");
    expect(tags["Core team role"]).toBe("Fill together with Operations Steward");
  });

  it("puts the plain phrase before the official word, and explains the jargon", () => {
    expect(plainTerm("rhythm")).toBe("How often you meet (rhythm)");
    // The label in brackets, which is the stored key except where the words moved on (quests reads Tasks, guide v2).
    for (const group of SETTINGS_GROUPS) expect(plainTerm(group)).toContain(`(${GROUP_LABELS[group].toLowerCase()})`);
    expect(plainTerm("quests")).toBe("How many tasks you take on each moon (tasks)");
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
