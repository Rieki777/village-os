import { describe, expect, it } from "vitest";
import { BLANK_GOAL } from "./proposalGoals";
import { DRAFT_WORDS, draftBody, goalsFromDraft, isTextDraft, unconfirmedDrafts, withoutDraftFlag } from "./seraDrafts";
import { AI_SAFE_PROPOSAL_FIELDS } from "./proposalAbout";

describe("what a press sends", () => {
  it("is the roles, why and aim, trimmed, and no other key", () => {
    const body = draftBody("goals", { roles: [{ roleId: "r1", note: " cooks " }, { roleId: "r2" }], why: " why ", aim: " aim " });
    expect(body).toEqual({ kind: "goals", roles: [{ roleId: "r1", note: "cooks" }, { roleId: "r2" }], why: "why", aim: "aim" });
    expect(Object.keys(body).filter((k) => k !== "kind").sort()).toEqual([...AI_SAFE_PROPOSAL_FIELDS].sort());
  });
  it("cannot carry anything a caller adds on the way in", () => {
    const sneaky = draftBody("aim", { roles: [{ roleId: "r1", references: "x" } as any], why: "w", aim: "", references: [{ name: "n" }] } as any);
    expect(JSON.stringify(sneaky)).not.toContain("references");
  });
});

describe("a draft is a draft until it is edited or kept", () => {
  const goals = goalsFromDraft([{ title: "T", doneWhen: "D", moves: "M", roleId: "r1" }]);
  it("flags drafted goals, and a kept or edited goal drops the flag", () => {
    expect(goals[0]!.seraDraft).toBe(true);
    expect(unconfirmedDrafts({ aim: "", story: "", marks: {}, goals })).toEqual(["goals"]);
    expect(unconfirmedDrafts({ aim: "", story: "", marks: {}, goals: [{ ...goals[0]!, seraDraft: undefined }] })).toEqual([]);
  });
  it("a text stays a draft only while it holds exactly Sera's words", () => {
    expect(isTextDraft("Food grows here", "Food grows here")).toBe(true);
    expect(isTextDraft("Food grows here.", "Food grows here")).toBe(false);
    expect(isTextDraft("", undefined)).toBe(false);
    expect(unconfirmedDrafts({ aim: "A", story: "S", marks: { aim: "A", story: "S" }, goals: [BLANK_GOAL] })).toEqual(["aim", "story"]);
    expect(unconfirmedDrafts({ aim: "A!", story: "S", marks: { aim: "A", story: "S" }, goals: [] })).toEqual(["story"]);
  });
  it("what is sent carries no trace of the draft", () => {
    expect(JSON.stringify(withoutDraftFlag(goals))).not.toContain("seraDraft");
  });
  it("names what blocks the send", () => {
    expect(DRAFT_WORDS.blocked(["aim"])).toBe('Your aim is still a draft from Sera. Edit it or press "Keep this", then send.');
    expect(DRAFT_WORDS.blocked(["aim", "goals", "story"])).toContain("Your aim, your goals and your story line are still a draft");
  });
});
