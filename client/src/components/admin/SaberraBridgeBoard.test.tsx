// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { BridgeView } from "./SaberraBridgeBoard";
import { bridgeChecks, SERA_AGREEMENT, type BridgeAnswer } from "@shared/seraBridgeBoard";

const before = Date.parse(SERA_AGREEMENT.at) - 3 * 3_600_000;
const base: BridgeAnswer = {
  connection: { mayCall: true, addressSet: true, held: 115 },
  lists: { ready: true, linkedPeople: 1, listsOn: 0, imported: 0, importedOpen: 0, lastBatch: null },
  feedback: { ready: false, sent: 0, queued: 0, failed: 0, notesHeld: 0, notesReleased: null },
  reviewQueue: { waiting: 5 },
  needsOwner: { ready: true, waiting: 2 },
};

describe("the Sera bridge board", () => {
  it("counts only checks that are true in the answer", () => {
    const done = bridgeChecks(base, before).filter((c) => c.done).length;
    expect(done).toBe(4);
    render(<BridgeView a={base} now={before} />);
    expect(screen.getByRole("img", { name: "4 of 8 bridge checks done" })).toBeTruthy();
  });

  it("shows the feedback bridge as Building while its tables are missing", () => {
    render(<BridgeView a={base} now={before} />);
    expect(screen.getByRole("listitem", { name: "Member feedback to Sera: Building" })).toBeTruthy();
    expect(screen.getByText("115 facts held.")).toBeTruthy();
    expect(screen.getByText("5 suggestions waiting.")).toBeTruthy();
    expect(screen.getByText("2 tasks from Sera waiting for an owner.")).toBeTruthy();
  });

  it("counts down to the agreement and marks tools locked and unlocked", () => {
    render(<BridgeView a={base} now={before} />);
    expect(screen.getByText("Starts in 3 h 0 min.")).toBeTruthy();
    expect(screen.getAllByText(/^unlocked:/).length).toBe(6);
    expect(screen.getAllByText(/^locked:/).length).toBe(4);
  });

  it("reads the feedback counts once the bridge lands", () => {
    const a = { ...base, feedback: { ready: true, sent: 3, queued: 1, failed: 0, notesHeld: 2, notesReleased: null } };
    render(<BridgeView a={a} now={before} />);
    expect(screen.getByText("3 sent, 1 queued, 0 failed.")).toBeTruthy();
    expect(screen.getByText("2 notes held until the agreement.")).toBeTruthy();
  });
});
