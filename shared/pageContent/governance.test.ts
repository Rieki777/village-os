import { describe, expect, it } from "vitest";
import { VETO_HOURS_FLOOR } from "../governanceKinds";
import { VARIABLES_BY_KEY } from "../gameVariables";
import { GOVERNANCE_PAGE, VETO_HOURS_KEY, VETO_HOURS_MIN, vetoWindowWords } from "./governance";
import { pageSpecForSection } from "./index";

describe("the veto window in words", () => {
  it("reads the setting the engine enforces, with the engine's floor", () => {
    expect(VETO_HOURS_MIN).toBe(VETO_HOURS_FLOOR);
    expect(Number(VARIABLES_BY_KEY[VETO_HOURS_KEY]?.default)).toBe(VETO_HOURS_MIN);
    expect(VARIABLES_BY_KEY[VETO_HOURS_KEY]?.min).toBe(VETO_HOURS_MIN);
  });

  it("says whole days as days and anything else as hours", () => {
    expect(vetoWindowWords(72)).toBe("three days");
    expect(vetoWindowWords(96)).toBe("four days");
    expect(vetoWindowWords(168)).toBe("seven days");
    expect(vetoWindowWords(720)).toBe("30 days");
    expect(vetoWindowWords(100)).toBe("100 hours");
  });

  it("never says less than the floor", () => {
    for (const low of [0, 24, 71.9, -5, "", null, undefined, "soon"]) expect(vetoWindowWords(low), String(low)).toBe("three days");
  });
});

describe("the How We Govern spec", () => {
  it("is registered, so Admin, Pages edits it and the save route checks it", () => {
    expect(pageSpecForSection("page-governance")).toBe(GOVERNANCE_PAGE);
  });

  it("lets every section after the top be hidden", () => {
    const [top, ...rest] = GOVERNANCE_PAGE.sections;
    expect(top.hideable).toBeFalsy();
    expect(rest.filter((s) => !s.hideable).map((s) => s.id)).toEqual([]);
  });

  it("asks for the veto window by its word, never as typed days", () => {
    const stewards = GOVERNANCE_PAGE.sections.find((s) => s.id === "stewards")!;
    const said = stewards.fields.map((f) => f.default).join(" ");
    expect(said).toContain("{veto}");
    expect(said).not.toMatch(/\bthree days\b/);
  });
});
