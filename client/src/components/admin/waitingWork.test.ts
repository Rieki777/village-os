import { describe, expect, it } from "vitest";
import { needsAction, requestRow, waitingRequests } from "./waitingWork";

describe("waiting work", () => {
  it("counts a form only while a steward still has to act", () => {
    const rows = [
      { status: "new" },
      { status: "accepted" },
      { status: "Accepted" },
      { status: "declined" },
      { status: "reviewing" },
      {},
    ];
    expect(waitingRequests(rows)).toBe(3);
    expect(needsAction("accepted")).toBe(false);
    expect(needsAction(undefined)).toBe(true);
  });

  it("puts the type, the date and the status on the row so two of the same name can be told apart", () => {
    const ada = requestRow({ id: "1", name: "Ada", type: "membership-request", status: "new", submittedAt: "2026-11-01T15:00:00Z" });
    const adaAgain = requestRow({ id: "2", name: "Ada", type: "seat-claim", status: "accepted", submittedAt: "2026-10-02T15:00:00Z" });
    expect(ada.next).toBe("Open it and answer.");
    expect(ada.detail).toContain("Membership Request");
    expect(ada.detail).toContain("New");
    expect(adaAgain.next).toBe("Already answered. Open the form to read it.");
    expect(adaAgain.detail).toContain("Seat Claim");
    expect(adaAgain.detail).toContain("Accepted");
    expect(ada.detail).not.toBe(adaAgain.detail);
  });
});