import { describe, expect, it } from "vitest";
import { DONE_FROMS, stepDone } from "./stepDone";

describe("a step done line", () => {
  it("says what was saved and what comes next, for every screen", () => {
    expect(DONE_FROMS).toEqual(["welcome", "yours", "roles", "words", "season", "terms", "preview"]);
    for (const from of DONE_FROMS) {
      const line = stepDone(from);
      expect(line.saved.length).toBeGreaterThan(8);
      expect(line.next.length).toBeGreaterThan(8);
      expect(line.saved).not.toMatch(/[—–]/);
      expect(line.next).not.toMatch(/[—–]/);
    }
    expect(stepDone("yours").saved).toContain("as you wrote them");
  });
});
