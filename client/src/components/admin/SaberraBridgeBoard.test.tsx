// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { BridgeView } from "./SaberraBridgeBoard";
import { QuestLevel } from "./SaberraBridgeQuests";
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
    const a = { ...base, feedback: { ready: true, sent: 3, queued: 1, failed: 0, notesHeld: 2, notesReleased: false } };
    render(<BridgeView a={a} now={before} />);
    expect(screen.getByText("3 sent, 1 queued, 0 failed.")).toBeTruthy();
    expect(screen.getByText("Notes held until the agreement: 2.")).toBeTruthy();
  });

  it("names a level by its own heading, or by the content's heading when it has one", () => {
    render(
      <>
        <QuestLevel level={2} title="The connection" state="done"><p>inside</p></QuestLevel>
        <QuestLevel level={4} title="Journal outbox" headingId="own"><h3 id="own">What Saberra would receive</h3></QuestLevel>
      </>,
    );
    expect(screen.getByRole("region", { name: "The connection" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The connection" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "What Saberra would receive" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Journal outbox" })).toBeNull();
  });
});

describe("the linked card and the feedback switch count", () => {
  it("says not linked yet when nobody is linked", () => {
    render(<BridgeView a={{ ...base, lists: { ...base.lists, people: [] } }} now={before} />);
    expect(screen.getByText(/Not linked yet/)).toBeTruthy();
  });
  it("shows each linked member and how many turned feedback off", () => {
    const a: BridgeAnswer = {
      ...base,
      lists: { ...base.lists, people: [{ name: "Ana", listOn: true, imported: 33, lastImportAt: null }] },
      feedback: { ready: true, sent: 1, queued: 0, failed: 0, notesHeld: 0, notesReleased: false, membersOff: 2 },
    };
    render(<BridgeView a={a} now={before} />);
    expect(screen.getByText(/list on, 33 tasks imported, no import yet/)).toBeTruthy();
    expect(screen.getByText(/2 members turned feedback off/)).toBeTruthy();
  });
});

describe("the checks disclosure", () => {
  it("is a real button that opens the 8 checks with done and not done", () => {
    render(<BridgeView a={base} now={before} />);
    const b = screen.getByRole("button", { name: /See the checks/ });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(screen.getByRole("button", { name: /Hide the checks/ }).getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("listitem").filter((li) => /: (not )?done$/.test(li.textContent ?? ""));
    expect(items).toHaveLength(8);
  });
});

describe("the quest feed card", () => {
  it("shows the last run's counts and what waits for a steward", () => {
    const a: BridgeAnswer = { ...base, questFeed: { waiting: 3, last: { dryRun: false, status: "ok", read: 9, queued: 3, alreadySeen: 5, droppedForEmail: 1, refusedHere: 0, at: "2026-11-03T03:00:00Z" } } };
    render(<BridgeView a={a} now={before} />);
    expect(screen.getByText(/9 read, 3 queued, 5 already seen,\s+1 dropped by Sera for an email/)).toBeTruthy();
    expect(screen.getByText("3 quests from Sera waiting for a steward.")).toBeTruthy();
  });
});
