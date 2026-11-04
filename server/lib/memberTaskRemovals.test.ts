/**
 * CHECK 45 (end-of-moon spec, section 18): a task the library cancelled, let
 * go stale, archived or reassigned is never marked done on the board, and a
 * done task carries the library's own close time. Pure: the reading and the
 * decision. The SQL that follows the decision is one UPDATE per kind in
 * server/repos/memberTaskFeedback.ts.
 */
import { describe, expect, it } from "vitest";
import { removalAction, removedEntriesOf, removedIdsOf } from "./memberTaskBridge";

describe("reading removed_since with reasons", () => {
  it("keeps the reason and the close time for each entry", () => {
    const got = removedEntriesOf({
      removed: [
        { task_id: "a", reason: "done", status: "Done", closed_at: "2026-11-01T15:00:00Z" },
        { task_id: "b", reason: "cancelled", status: "suppressed", closed_at: "2026-11-02T10:00:00Z" },
      ],
    });
    expect(got).toEqual([
      { id: "a", reason: "done", closedAt: new Date("2026-11-01T15:00:00Z") },
      { id: "b", reason: "cancelled", closedAt: new Date("2026-11-02T10:00:00Z") },
    ]);
  });

  it("reads a bare id, an unknown reason and a bad date as no reason and no time", () => {
    expect(removedEntriesOf({ removed_ids: ["x"] })).toEqual([{ id: "x", reason: null, closedAt: null }]);
    expect(removedEntriesOf({ removed: [{ id: "y", reason: "melted", closed_at: "not a date" }] })).toEqual([{ id: "y", reason: null, closedAt: null }]);
  });

  it("still gives plain ids to callers that only want ids", () => {
    expect(removedIdsOf({ removed: [{ task_id: "x", reason: "stale" }] })).toEqual(["x"]);
  });
});

describe("what the board does with each reason", () => {
  const at = new Date("2026-11-01T15:00:00Z");

  it("closes a done task as done, at the library's own close time", () => {
    expect(removalAction({ id: "a", reason: "done", closedAt: at })).toEqual({ kind: "done", doneAt: at });
  });

  it("never marks a cancelled, stale or archived task done", () => {
    for (const reason of ["cancelled", "stale", "archived"] as const) {
      expect(removalAction({ id: "a", reason, closedAt: at })).toEqual({ kind: "removed", removeReason: "not_relevant" });
    }
  });

  it("removes a reassigned task as not this member's", () => {
    expect(removalAction({ id: "a", reason: "reassigned", closedAt: at })).toEqual({ kind: "removed", removeReason: "not_mine" });
  });

  it("keeps the old behaviour when the service sends no reason", () => {
    expect(removalAction({ id: "a", reason: null, closedAt: null })).toEqual({ kind: "done", doneAt: null });
  });
});
