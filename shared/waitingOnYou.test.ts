/**
 * `readWaiting`, the client's reading of Waiting on you, across deploy skew:
 * a server from before the toAccept group (PR 4 of the player role card)
 * sends none, and the page must read that as an empty group, never as a
 * payload it cannot draw.
 */
import { describe, expect, it } from "vitest";
import { WAITING_COPY, readWaiting } from "./waitingOnYou";

describe("readWaiting", () => {
  it("reads a payload with no toAccept as an empty group", () => {
    expect(readWaiting({ applications: [], drafts: [] })).toEqual({ applications: [], drafts: [], toAccept: [], raisedWithYou: [], toConsent: [], openProposals: [] });
  });

  it("keeps the rows it can draw and drops the ones it cannot", () => {
    const out = readWaiting({
      applications: [],
      drafts: [],
      toAccept: [
        { entryId: 21, text: "Fix the water tank", role: "Water steward", circle: "Garden circle", doneOn: "2026-10-14" },
        { entryId: 22, text: "Sweep the yard", role: "  ", doneOn: "2026-10-13" },
        { entryId: "23", text: "Not a number", doneOn: "2026-10-13" },
        { entryId: 24, doneOn: "2026-10-13" },
        null,
      ],
    });
    expect(out?.toAccept).toEqual([
      { entryId: 21, text: "Fix the water tank", role: "Water steward", circle: "Garden circle", doneOn: "2026-10-14" },
      { entryId: 22, text: "Sweep the yard", role: null, circle: null, doneOn: "2026-10-13" },
    ]);
  });

  it("reads a toAccept that is not a list as none, and still refuses a payload without its first two groups", () => {
    expect(readWaiting({ applications: [], drafts: [], toAccept: "soon" })?.toAccept).toEqual([]);
    expect(readWaiting({ toAccept: [] })).toBeNull();
  });

  it("words the row with no person in it", () => {
    expect(WAITING_COPY.acceptLine("Fix the water tank")).toBe("Done: Fix the water tank");
    expect(WAITING_COPY.acceptWhere("Water steward", null)).toBe("Water steward");
    expect(WAITING_COPY.acceptWhere(null, null)).toBe("");
    expect(WAITING_COPY.acceptAction).toBe("Accept as accomplished");
  });
});
