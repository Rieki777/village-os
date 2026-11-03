import { describe, expect, it } from "vitest";
import { itemsOf, planImport, planSummary, type HeldTask } from "./memberTaskImport";

const OWNER = "own-jess";
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, priority: "High", status: "Open", owner_id: OWNER, ...over });

describe("planning a library import", () => {
  it("maps priorities, skips done and cancelled, queues Needs Owner, flags the unknown", () => {
    const plan = planImport(
      [
        item("1"),
        item("2", { priority: "Medium" }),
        item("3", { priority: "Low", due_date: "2026-11-20" }),
        item("4", { priority: "Urgent" }),
        item("5", { status: "Done" }),
        item("6", { status: "Cancelled" }),
        item("7", { status: "Needs Owner" }),
        item("8", { owner_id: "someone-else" }),
        item("1"),
      ],
      OWNER, [],
    );
    expect(plan.create.map((t) => [t.externalId, t.tier])).toEqual([["1", "high"], ["2", "priority"], ["3", "not_yet"], ["4", "priority"]]);
    expect(plan.create[2].dueOn).toBe("2026-11-20");
    expect(plan.flagged.map((t) => t.externalId)).toEqual(["4"]);
    expect(plan.needsOwner.map((t) => t.externalId)).toEqual(["7"]);
    expect(plan.skipped.map((s) => s.why)).toEqual(["done", "cancelled", "other_owner", "duplicate"]);
    const sum = planSummary(plan);
    expect(sum.counts.create).toBe(4);
    expect(sum.firstTitles).toHaveLength(4);
  });

  it("is idempotent: a second run over what the first made changes nothing", () => {
    const items = [item("1"), item("2", { priority: "Low" })];
    const first = planImport(items, OWNER, []);
    const held: HeldTask[] = first.create.map((t, i) => ({ id: `mt-${i}`, externalId: t.externalId, title: t.title, tier: t.tier, dueOn: t.dueOn, status: "open", memberEdited: false }));
    const second = planImport(items, OWNER, held);
    expect(second.create).toHaveLength(0);
    expect(second.update).toHaveLength(0);
    expect(second.unchanged).toHaveLength(2);
  });

  it("never overwrites the member's edits, and never brings back what they removed or finished", () => {
    const held: HeldTask[] = [
      { id: "a", externalId: "1", title: "Mine now", tier: "not_yet", dueOn: null, status: "open", memberEdited: true },
      { id: "b", externalId: "2", title: "Task 2", tier: "high", dueOn: null, status: "removed", memberEdited: false },
      { id: "c", externalId: "3", title: "Task 3", tier: "high", dueOn: null, status: "done", memberEdited: false },
      { id: "d", externalId: "4", title: "Old words", tier: "high", dueOn: null, status: "open", memberEdited: false },
    ];
    const plan = planImport([item("1"), item("2"), item("3"), item("4")], OWNER, held);
    expect(plan.keptEdits.map((t) => t.externalId)).toEqual(["1"]);
    expect(plan.tombstoned.map((t) => t.externalId)).toEqual(["2", "3"]);
    expect(plan.update).toEqual([{ id: "d", next: expect.objectContaining({ externalId: "4", title: "Task 4" }) }]);
  });

  it("reads the answer whether it is an array or wrapped", () => {
    expect(itemsOf([1, 2])).toHaveLength(2);
    expect(itemsOf({ tasks: [1] })).toHaveLength(1);
    expect(itemsOf({ result: { items: [1, 2, 3] } })).toHaveLength(3);
    expect(itemsOf("nope")).toEqual([]);
    expect(itemsOf([{ tasks: [1, 2], next_cursor: "c" }, { tasks: [3] }])).toHaveLength(3);
  });
});

describe("requested_by from the library", () => {
  it("reads it, takes out emails, and refreshes an unedited task when it changes", async () => {
    const { readLibraryTask, planImport } = await import("./memberTaskImport");
    expect(readLibraryTask({ id: "x", title: "T", requested_by: "Ana (ana@x.org)" })!.requestedBy).not.toContain("@");
    expect(readLibraryTask({ id: "x", title: "T" })!.requestedBy).toBeNull();
    const held = [{ id: "m1", externalId: "x", title: "T", tier: "high" as const, dueOn: null, status: "open" as const, memberEdited: false, requestedBy: null }];
    const p = planImport([{ id: "x", title: "T", priority: "High", requested_by: "Ana" }], "own", held);
    expect(p.update).toHaveLength(1);
  });
});
