/**
 * A measure may name a sign from the closed catalog, and a whole-number
 * target for it. Kept beside `seatSettings.test.ts` rather than inside it, so
 * the role-words rename that also edits that file rebases cleanly.
 */
import { describe, expect, it } from "vitest";
import { parseSeatSettings } from "./seatSettings";
import { SIGN_KEYS } from "./roleSigns";

const measures = (row: Record<string, unknown>) => parseSeatSettings({ v: 1, scoreboard: { measures: [row] } });

describe("ScoreMeasure.countedBy and targetCount", () => {
  it("accepts every key of the sign catalog, and a whole-number target", () => {
    for (const key of SIGN_KEYS) {
      const p = measures({ measure: "Applications answered", countedBy: key, targetCount: 5 });
      expect(p.problems).toEqual([]);
      expect(p.settings?.scoreboard?.measures[0]).toEqual({ measure: "Applications answered", countedBy: key, targetCount: 5 });
    }
  });

  it("refuses an unknown sign key, by path", () => {
    const p = measures({ measure: "Sign-ins", countedBy: "sign-ins" });
    expect(p.ok).toBe(false);
    expect(p.problems.map((x) => x.path)).toContain("scoreboard.measures.0.countedBy");
  });

  it("refuses a target that is not a whole number", () => {
    expect(measures({ measure: "Plans filed", countedBy: "season-plans-filed", targetCount: 2.5 }).ok).toBe(false);
    expect(measures({ measure: "Plans filed", countedBy: "season-plans-filed", targetCount: "five" }).ok).toBe(false);
    expect(measures({ measure: "Plans filed", countedBy: "season-plans-filed", targetCount: -1 }).ok).toBe(false);
  });

  it("keeps a measure with neither field exactly as it was", () => {
    const p = measures({ measure: "Meals served", target: "dinner every gathering" });
    expect(p.ok).toBe(true);
    expect(p.settings?.scoreboard?.measures[0]).toEqual({ measure: "Meals served", target: "dinner every gathering" });
  });

  it("control: a key outside the measure is still refused", () => {
    expect(measures({ measure: "Meals served", counted_by: "circle-met" }).ok).toBe(false);
  });
});
