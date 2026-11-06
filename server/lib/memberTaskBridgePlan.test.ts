/**
 * PR F: the evidence-phrase filter, which tool each outbox row goes to
 * (retract for undo), and the id a released note carries.
 */
import { describe, expect, it } from "vitest";
import { filterByPhrase, noteFeedbackId, planSend, removedIdsOf } from "./memberTaskBridge";
import { DEFAULT_IMPORT_PHRASE } from "../../shared/memberTaskFeedback";

const tools = (...names: string[]) => new Map(names.map((n) => [n, { name: n, inputSchema: null }]));

describe("the evidence-phrase filter", () => {
  it("drops a task whose evidence lacks the phrase and keeps one that holds it", () => {
    const items = [
      { id: "a", evidence: `Note. ${DEFAULT_IMPORT_PHRASE}.` },
      { id: "b", evidence: "Heard in a meeting" },
      { id: "c", evidence: null },
    ];
    expect(filterByPhrase(items, DEFAULT_IMPORT_PHRASE).map((t: any) => t.id)).toEqual(["a"]);
  });
  it("keeps everything with no phrase, and leaves tasks with no evidence field to the service", () => {
    expect(filterByPhrase([{ id: "a" }, { id: "b", evidence: "x" }], "").length).toBe(2);
    expect(filterByPhrase([{ id: "a" }], "phrase").length).toBe(1);
  });
});

describe("which tool a row goes to", () => {
  it("undo calls retract_task_feedback with only the feedback id", () => {
    const p = planSend(tools("retract_task_feedback", "submit_task_feedback"), { kind: "undo", payload: { feedback_id: "fb-1", task_id: "t", owner_id: "o", reason_code: "not_mine" } });
    expect(p).toEqual({ tool: "retract_task_feedback", args: { feedback_id: "fb-1" }, minimal: { feedback_id: "fb-1" } });
  });
  it("undo waits when the service has no retract tool", () => {
    expect(planSend(tools("submit_task_feedback"), { kind: "undo", payload: { feedback_id: "fb-1" } }).tool).toBeNull();
  });
  it("a note waits when submit_task_feedback declares no note field", () => {
    const t = new Map([["submit_task_feedback", { name: "submit_task_feedback", inputSchema: { properties: { task_id: {} } } }]]);
    expect(planSend(t, { kind: "note", payload: { note: "x" } }).tool).toBeNull();
  });
  it("forgetting a person uses either name of the delete tool", () => {
    expect(planSend(tools("delete_owner_feedback"), { kind: "forget_person", payload: { owner_id: "o" } }).tool).toBe("delete_owner_feedback");
    expect(planSend(tools("delete_feedback_for_person", "delete_owner_feedback"), { kind: "forget_person", payload: { owner_id: "o" } }).tool).toBe("delete_feedback_for_person");
  });
  it("suppress is dropped, not retried, when no suppress tool exists", () => {
    const p = planSend(tools("submit_task_feedback"), { kind: "suppress", payload: { task_id: "t" } });
    expect(p.tool).toBeNull();
    expect(p.tool === null && p.drop).toBe(true);
  });
});

describe("a released note's id", () => {
  it("is the press's id with -note, so the service's idempotency never swallows it", () => {
    expect(noteFeedbackId("fb-abc")).toBe("fb-abc-note");
  });
});

describe("removed ids", () => {
  it("reads suppressed entries given as objects with task_id", () => {
    expect(removedIdsOf({ removed: [{ task_id: "x", status: "suppressed" }] })).toEqual(["x"]);
  });
});
