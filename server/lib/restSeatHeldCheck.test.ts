/**
 * A RETIREMENT WHOSE CHOOSER WAS ERASED STILL NEVER UNSEATS ANYBODY (PR C
 * review, security re-check). Erasure takes a leaver's id off the retirements
 * they chose (`chosenBy`), and marks them `chosenByDeparted`. Before that mark,
 * the held-role check ran only while `chosenBy` was set, so an erased chooser's
 * retirement in a human draft could publish over somebody seated since.
 */
import { describe, it, expect } from "vitest";
import { previewLoadedDraft, type Draft, type PreviewContext } from "./orgDrafts";

function draft(payload: Record<string, unknown>, sourceKind = "human"): Draft {
  return {
    id: "d-1",
    title: "Retire",
    rationale: null,
    status: "open",
    threadId: null,
    createdBy: null,
    publishedAt: null,
    revertedAt: null,
    changes: [{ id: "c-1", draftId: "d-1", op: "rest_seat", orgRoleId: "r-kitchen", payload, beforeJson: null, order: 1 }],
    vision: null,
    sourceKind,
    sourceModuleId: null,
    sourceProposalId: null,
    cites: [],
  } as Draft;
}

const context: PreviewContext = {
  roles: [{ id: "r-kitchen", name: "Kitchen", active: 1, is_example: 0, circle_id: "c-1" }],
  circleIds: new Set(["c-1"]),
  circles: [{ id: "c-1", name: "Hearth", parentCircleId: null, isExample: false }],
  heldSeatIds: new Set(["r-kitchen"]),
};

describe("a retirement over a held role", () => {
  it("is blocked while its chooser is on record", () => {
    const { lines } = previewLoadedDraft(draft({ chosenBy: "u-steward" }), context);
    expect(lines[0].blocked).toContain("Somebody holds this role");
  });

  it("is still blocked once erasure took the chooser off and marked them departed", () => {
    const { lines } = previewLoadedDraft(draft({ chosenBy: null, chosenByDeparted: true }), context);
    expect(lines[0].blocked).toContain("Somebody holds this role");
  });

  it("never blocks a retirement of a role nobody holds", () => {
    const { lines } = previewLoadedDraft(draft({ chosenBy: null, chosenByDeparted: true }), { ...context, heldSeatIds: new Set() });
    expect(lines[0].blocked ?? null).toBeNull();
  });
});
