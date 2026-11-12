/**
 * The board's lead card and what a member can give (0383, lane E1): a quest
 * that asks more than the member can give now never leads, and with no word
 * from the member the lead is chosen exactly as before.
 */
import { describe, expect, it } from "vitest";
import { leadQuestFor, type BoardQuest } from "./questBoard";

const q = (id: string, over: Partial<BoardQuest> = {}): BoardQuest => ({ id, title: id, gratitude: "", status: "Open", difficulty: "Beginner", ...over });

describe("the lead card reads the member's percent", () => {
  const board = [q("heavy", { commitmentPct: 90, order: 1, archetypes: ["gardener"] }), q("light", { commitmentPct: 20, order: 2 })];

  it("a quest beyond what the member can give does not lead, even one that carries their roots", () => {
    expect(leadQuestFor(board, [], ["gardener"], [], 30)?.quest.id).toBe("light");
  });

  it("with no word from the member the roots still lead, as before", () => {
    expect(leadQuestFor(board, [], ["gardener"], [], null)?.quest.id).toBe("heavy");
  });

  it("a member who can give enough is led by their roots", () => {
    expect(leadQuestFor(board, [], ["gardener"], [], 90)?.quest.id).toBe("heavy");
  });

  it("when every quest is beyond reach the board still leads with one", () => {
    expect(leadQuestFor([q("big", { commitmentPct: 100 })], [], [], [], 10)?.quest.id).toBe("big");
  });
});
