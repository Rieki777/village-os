import { describe, expect, it } from "vitest";
import { JOURNAL_TASK_SUGGESTIONS_MAX, cleanDoneTasks, cleanTaskSuggestions, markableFromJournal } from "./journal";

describe("the journal guide's task suggestions", () => {
  it("keeps short one-line titles, drops duplicates and what is already open, and stops at the cap", () => {
    expect(cleanTaskSuggestions(["  Water the beds ", "water the beds", "Call Ana", { title: "Fix the gate" }, "Mend\nthe fence", 7, "Already open"], ["Already open"])).toEqual([
      "Water the beds",
      "Call Ana",
      "Fix the gate",
    ]);
    expect(cleanTaskSuggestions("nope", [])).toEqual([]);
    expect(cleanTaskSuggestions(Array.from({ length: 9 }, (_, i) => `t${i}`), []).length).toBe(JOURNAL_TASK_SUGGESTIONS_MAX);
  });

  it("only ever marks the member's own open tasks, by id", () => {
    const open = [{ id: "t1", title: "Water" }, { id: "t2", title: "Call" }];
    expect(cleanDoneTasks(["t2", "someone-elses", { id: "t1" }, "t2"], open)).toEqual([{ id: "t2", title: "Call" }, { id: "t1", title: "Water" }]);
    expect(cleanDoneTasks(null, open)).toEqual([]);
  });

  it("never offers to mark a task the library sent: nothing from the journal reaches Saberra", () => {
    const open = [{ id: "t1", title: "Mine", source: "self" }, { id: "t2", title: "From Sera", source: "sera" }, { id: "t3", title: "Journal", source: "journal" }];
    const markable = markableFromJournal(open);
    expect(markable.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(cleanDoneTasks(["t2", "t1"], markable)).toEqual([{ id: "t1", title: "Mine" }]);
  });
});
