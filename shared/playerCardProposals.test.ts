import { describe, expect, it } from "vitest";
import { roleProposalsOut } from "./playerCardProposals";

describe("a role's open proposals, as the card shows them", () => {
  it("reads each role word a draft names under the card's own heading, oldest first", () => {
    const out = roleProposalsOut(
      [
        { draftId: "d-2", proposedAt: "2026-10-22T10:00:00Z", payload: { accountabilities: ["Testing the spring", " ", "Mending the pipes"], bringMe: null } },
        { draftId: "d-1", proposedAt: "2026-10-20T10:00:00Z", payload: { aim: "  Water for all. " } },
      ],
      "UTC",
    );
    expect(out).toEqual([
      { draftId: "d-1", proposedOn: "Proposed on 20 Oct 2026", fields: [{ key: "purpose", label: "Purpose", lines: ["Water for all."] }] },
      {
        draftId: "d-2",
        proposedOn: "Proposed on 22 Oct 2026",
        fields: [
          { key: "countOnMe", label: "What you can count on me for", lines: ["Testing the spring", "Mending the pipes"] },
          { key: "bringMe", label: "Bring me", lines: [] },
        ],
      },
    ]);
  });

  it("leaves out a draft that changes none of the role words the card shows", () => {
    expect(roleProposalsOut([{ draftId: "d-3", proposedAt: "2026-10-22T10:00:00Z", payload: { seats: 3 } }], "UTC")).toEqual([]);
  });
});
