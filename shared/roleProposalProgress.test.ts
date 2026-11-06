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

describe("where a draft opens", () => {
  it("opens at the first unwritten part, and keeps a fresh draft's welcome", async () => {
    const { resumeAt } = await import("./roleProposalProgress");
    expect(resumeAt({ roleCount: 0, goalCount: 0 })).toBeNull();
    expect(resumeAt({ roleCount: 2, goalCount: 0 })).toEqual({ front: "yours", step: "roles" });
    expect(resumeAt({ roleCount: 2, love: "soil", goalCount: 0 })).toEqual({ front: "steps", step: "season" });
    expect(resumeAt({ roleCount: 0, love: "soil", aim: "feed", goalCount: 0 })).toEqual({ front: "steps", step: "roles" });
    expect(resumeAt({ roleCount: 1, love: "soil", aim: "feed", goalCount: 1 })).toEqual({ front: "steps", step: "terms" });
  });
});
