import { describe, expect, it } from "vitest";
import { DRAFT_PARTS, draftFill } from "./roleProposalProgress";

describe("draft fill", () => {
  it("starts empty", () => {
    expect(draftFill({ roleCount: 0, goalCount: 0 })).toEqual({ done: 0, total: DRAFT_PARTS, line: "Nothing written yet" });
  });

  it("counts a role, the member's own words, and a season", () => {
    expect(draftFill({ roleCount: 1, goalCount: 0 }).done).toBe(1);
    expect(draftFill({ roleCount: 1, love: "  baking  ", goalCount: 0 })).toMatchObject({ done: 2, line: "2 of 3 parts written" });
    expect(draftFill({ roleCount: 2, why: "now", aim: "Feed the village", goalCount: 0 })).toEqual({
      done: 3,
      total: 3,
      line: "Roles, your words and your season are written",
    });
  });

  it("counts a seasonal goal as the season, and ignores blank words", () => {
    expect(draftFill({ roleCount: 0, love: "   ", offer: "", goalCount: 1 }).done).toBe(1);
  });
});
