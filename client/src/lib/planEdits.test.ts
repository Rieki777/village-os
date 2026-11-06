/**
 * The plan editor's moves. Each returns a new plan, leaves its input alone,
 * skips hidden items, and never deletes anything the server already holds.
 */
import { describe, expect, it } from "vitest";
import { newPlanId, type CommandCentrePlan } from "@shared/commandCentrePlan";
import {
  addTask,
  hiddenItems,
  moveDecision,
  moveTask,
  moveWeek,
  setTaskHidden,
  withoutUntouchedNew,
} from "./planEdits";

const plan = (): CommandCentrePlan => ({
  revision: 0,
  intro: "",
  partnerName: "Builders",
  weeks: [
    {
      id: "w1",
      label: "One",
      goal: "",
      tasks: [
        { id: "a", text: "A", status: "pending" },
        { id: "b", text: "B", status: "pending" },
      ],
    },
    {
      id: "w2",
      label: "Two",
      goal: "",
      hidden: true,
      tasks: [{ id: "c", text: "C", status: "pending" }],
    },
    {
      id: "w3",
      label: "Three",
      goal: "",
      tasks: [
        { id: "d", text: "D", status: "pending", hidden: true },
        { id: "e", text: "E", status: "pending" },
      ],
    },
  ],
  decisions: [
    { id: "x", title: "X", description: "", options: [] },
    { id: "y", title: "Y", description: "", options: [], hidden: true },
    { id: "z", title: "Z", description: "", options: [] },
  ],
});

const ids = (p: CommandCentrePlan) =>
  p.weeks.map(w => `${w.id}:${w.tasks.map(t => t.id).join("")}`);

describe("moving", () => {
  it("moves a task within its week, and leaves the plan it was given alone", () => {
    const before = plan();
    const after = moveTask(before, "b", -1);
    expect(ids(after)[0]).toBe("w1:ba");
    expect(ids(before)[0], "the input is untouched").toBe("w1:ab");
  });

  it("carries a task across a week edge into the next VISIBLE week, past hidden ones", () => {
    // Down from the bottom of week 1: week 2 is hidden, so it lands at the
    // top of week 3.
    expect(ids(moveTask(plan(), "b", 1))).toEqual(["w1:a", "w2:c", "w3:bde"]);
    // Up from the top visible task of week 3 (d is hidden): to the end of week 1.
    expect(ids(moveTask(plan(), "e", -1))).toEqual(["w1:abe", "w2:c", "w3:d"]);
  });

  it("does nothing at the very ends", () => {
    expect(ids(moveTask(plan(), "a", -1))).toEqual(ids(plan()));
    expect(ids(moveTask(plan(), "e", 1))).toEqual(ids(plan()));
  });

  it("moves weeks and decisions past hidden neighbours", () => {
    expect(moveWeek(plan(), "w3", -1).weeks.map(w => w.id)).toEqual([
      "w3",
      "w2",
      "w1",
    ]);
    expect(moveDecision(plan(), "z", -1).decisions.map(d => d.id)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });
});

describe("adding and removing", () => {
  it("gives a new task an id nothing has used, stored keys included", () => {
    const taken = ["a", "b", "c", "d", "e", "task-000000"];
    const id = newPlanId("task", taken, () => 0);
    expect(id).not.toBe("task-000000");
    const { plan: next, id: added } = addTask(plan(), "w1", [
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(next.weeks[0].tasks.at(-1)).toEqual({
      id: added,
      text: "",
      status: "pending",
    });
  });

  it("hides rather than deletes, and lists what is hidden for Restore", () => {
    const next = setTaskHidden(plan(), "a", true);
    expect(next.weeks[0].tasks[0]).toEqual({
      id: "a",
      text: "A",
      status: "pending",
      hidden: true,
    });
    expect(hiddenItems(next).map(i => `${i.kind}:${i.id}`)).toEqual([
      "task:a",
      "week:w2",
      "task:d",
      "decision:y",
    ]);
    expect(setTaskHidden(next, "a", false).weeks[0].tasks[0]).toEqual({
      id: "a",
      text: "A",
      status: "pending",
    });
  });

  it("drops only blank items added in this edit, and unlinks a decision from a dropped task", () => {
    const saved = plan();
    let draft = addTask(saved, "w1", ["a", "b", "c", "d", "e"]).plan;
    const blankId = draft.weeks[0].tasks.at(-1)!.id;
    draft = {
      ...draft,
      decisions: [
        ...draft.decisions,
        {
          id: "new-dec",
          title: "New",
          description: "",
          options: [],
          linkedItem: blankId,
        },
      ],
    };
    draft.weeks[0].tasks[0] = { ...draft.weeks[0].tasks[0], text: " " };
    const sent = withoutUntouchedNew(draft, saved);
    expect(
      sent.weeks[0].tasks.map(t => t.id),
      "the stored blank task stays, so the check can name it"
    ).toEqual(["a", "b"]);
    expect(sent.decisions.at(-1)).toEqual({
      id: "new-dec",
      title: "New",
      description: "",
      options: [],
    });
  });
});
